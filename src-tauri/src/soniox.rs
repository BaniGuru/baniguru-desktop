// src/soniox.rs
use tauri::async_runtime::JoinHandle;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::connect_async;
use tungstenite::Message;

use futures_util::{SinkExt, StreamExt};

use cpal::traits::{DeviceTrait, StreamTrait};

use serde::Deserialize;
use serde_json::json;

use bytemuck;

use tauri::{AppHandle, Emitter};

use crate::audio_bus::AudioBus;

#[derive(Debug, Deserialize)]
struct SonioxToken {
    text: String,
    start_ms: u32,
    end_ms: u32,
    confidence: f32,
    #[serde(default)]
    is_final: bool,
}

#[derive(Debug, Deserialize)]
struct SonioxMessage {
    tokens: Vec<SonioxToken>,
    final_audio_proc_ms: u64,
    total_audio_proc_ms: u64,
}

pub struct SonioxStream {
    shutdown: watch::Sender<bool>,
    task: JoinHandle<()>,
}

//
// ==============================
// Resampler
// ==============================
//
fn resample_to_16k(input: &[f32], input_rate: u32) -> Vec<f32> {
    let target_rate = 16000;

    if input_rate == target_rate {
        return input.to_vec();
    }

    let ratio = target_rate as f32 / input_rate as f32;
    let output_len = (input.len() as f32 * ratio) as usize;

    (0..output_len)
        .map(|i| {
            let pos = i as f32 / ratio;
            let idx = pos.floor() as usize;
            let frac = pos - idx as f32;

            let s0 = *input.get(idx).unwrap_or(&0.0);
            let s1 = *input.get(idx + 1).unwrap_or(&s0);

            s0 * (1.0 - frac) + s1 * frac
        })
        .collect()
}

pub async fn start_soniox_stream(
    app: AppHandle,
    soniox_url: String,
    api_key: String,
    panktis: Vec<String>,
    input_rate: u32,
    channels: u16,
    bus: AudioBus,
) -> Result<SonioxStream, String> {
    println!("Starting Soniox streaming...");

    //
    // Connect websocket
    //
    let (ws_stream, _) = connect_async(soniox_url).await.map_err(|e| e.to_string())?;

    println!("Connected to Soniox");

    let (mut write, mut read) = ws_stream.split();

    //
    // Start message
    //
    let start_msg = json!({
        "api_key": api_key,
        "model": "stt-rt-v4",
        "audio_format": "pcm_s16le",
        "num_channels": 1,
        "sample_rate": 16000,
        "language_hints": ["pa"],
        "language_hints_strict": true,
        "enable_speaker_diarization": false,
        "enable_language_identification": false,
        "target_language": "pa",
        "keepAlive": true,
        "enable_endpoint_detection": true,
        "max_endpoint_delay_ms": 3000,
        "context": {
            "terms": panktis
        }
    });

    write
        .send(Message::Text(start_msg.to_string()))
        .await
        .map_err(|e| e.to_string())?;

    //
    // Wait confirmation
    //
    if let Some(msg) = read.next().await {
        if let Ok(Message::Text(txt)) = msg {
            println!("Soniox start confirmation: {}", txt);
        }
    }

    //
    // Subscribe to shared audio bus
    //
    let mut audio_rx = bus.subscribe();

    println!("Soniox pipeline started");

    //
    // Shutdown signal
    //
    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

    //
    // Processing pipeline
    //
    let task = tauri::async_runtime::spawn(async move {
        let mut buffer: Vec<i16> = Vec::new();
        let mut last_partial = String::new();
        let mut total_audio_proc_ms: u64 = 0;

        // track completed words
        let mut current_word = String::new();
        let mut current_word_end_ms: u32 = 0;

        loop {
            tokio::select! {

                //
                // Shutdown
                //
                _ = shutdown_rx.changed() => {
                    println!("Soniox shutdown received");
                    break;
                }

                //
                // Audio input
                //
                Some(chunk) = audio_rx.recv() => {

                    let mono: Vec<f32> = chunk
                        .chunks(channels.into())
                        .map(|f| f.iter().sum::<f32>())
                        .collect();

                    let resampled = resample_to_16k(&mono, input_rate);

                    let pcm16: Vec<i16> = resampled
                        .iter()
                        .map(|s| (s.clamp(-1.0,1.0) * i16::MAX as f32) as i16)
                        .collect();

                    buffer.extend_from_slice(&pcm16);

                    let frame_size = 16000 * 5 / 1000;

                    while buffer.len() >= frame_size {

                        let frame: Vec<i16> = buffer.drain(..frame_size).collect();

                        let bytes = bytemuck::cast_slice(&frame);

                        if write.send(Message::Binary(bytes.to_vec())).await.is_err() {
                            println!("WebSocket send failed");
                            return;
                        }
                    }
                }

                //
                // Soniox transcript
                //
                Some(msg) = read.next() => {

                    if let Ok(Message::Text(text)) = msg {

                        if let Ok(sx_msg) = serde_json::from_str::<SonioxMessage>(&text) {

                            total_audio_proc_ms = sx_msg.total_audio_proc_ms;

                            let tokens = sx_msg.tokens;
                            let mut completed_words = Vec::new();

                            let mut stable_final = Vec::new();
                            let mut first_non_final = tokens.len();

                            for (i, token) in tokens.iter().enumerate() {
                                if !token.is_final {
                                    first_non_final = i;
                                    break;
                                }

                                stable_final.push(token.text.clone());

                                if token.text == "<end>" {
                                    if !current_word.is_empty() {
                                        completed_words.push(json!({
                                            "word": current_word,
                                            "end_ms": current_word_end_ms
                                        }));

                                        current_word.clear();
                                        current_word_end_ms = 0;
                                    }

                                    continue;
                                }

                                let starts_new_word =
                                    token.text.chars().next().is_some_and(char::is_whitespace);

                                if starts_new_word {
                                    if !current_word.is_empty() {
                                        completed_words.push(json!({
                                            "word": current_word,
                                            "end_ms": current_word_end_ms
                                        }));
                                    }

                                    current_word = token.text.trim_start().to_string();
                                } else {
                                    current_word.push_str(&token.text);
                                }

                                current_word_end_ms = token.end_ms;
                            }

                            let partial = tokens[first_non_final..]
                                .iter()
                                .map(|t| t.text.clone())
                                .collect::<Vec<String>>()
                                .join("");

                            /** partial token timing section start */
                            let partial_tokens = &tokens[first_non_final..];
                            let mut partial_words = Vec::new();
                            let mut pw = String::new();
                            let mut pw_start_ms: Option<u32> = None;
                            let mut pw_end_ms: u32 = 0;

                            // word split between final + partial => whole word goes to partial side
                            if let Some(first) = partial_tokens.first() {
                                let starts_new = first.text.chars().next().is_some_and(char::is_whitespace);

                                if !current_word.is_empty() && !starts_new {
                                    pw = current_word.clone();
                                    pw_end_ms = current_word_end_ms;
                                }
                            }

                            for token in partial_tokens {
                                if token.text == "<end>" {
                                    continue;
                                }

                                let starts_new = token.text.chars().next().is_some_and(char::is_whitespace);

                                if starts_new {
                                    if !pw.is_empty() {
                                        partial_words.push(json!({
                                            "word": pw,
                                            "start_ms": pw_start_ms,
                                            "end_ms": pw_end_ms
                                        }));
                                    }

                                    pw = token.text.trim_start().to_string();
                                    pw_start_ms = Some(token.start_ms);
                                } else {
                                    if pw.is_empty() {
                                        pw_start_ms = Some(token.start_ms);
                                    }

                                    pw.push_str(&token.text);
                                }

                                pw_end_ms = token.end_ms;
                            }

                            if !pw.is_empty() {
                                partial_words.push(json!({
                                    "word": pw,
                                    "start_ms": pw_start_ms,
                                    "end_ms": pw_end_ms
                                }));
                            }
                            /* partial token timing section end */

                            if !stable_final.is_empty() || partial != last_partial {

                                last_partial = partial.clone();

                                let payload = json!({
                                    "final": stable_final.join(""),
                                    "partial": partial,
                                    "completed_words": completed_words,
                                    "partial_words": partial_words,
                                    "end_ms": total_audio_proc_ms
                                });

                                let _ = app.emit("soniox_transcript", payload);
                            }
                        }
                    }
                }
            }
        }

        println!("Soniox pipeline stopped");
    });

    Ok(SonioxStream {
        shutdown: shutdown_tx,
        task,
    })
}

//
// ==============================
// Stop Stream
// ==============================
//
pub async fn stop_soniox_stream(stream: SonioxStream) {
    println!("Stopping Soniox stream");

    let _ = stream.shutdown.send(true);
    stream.task.abort();

    println!("Soniox stream stopped");
}

//
// ==============================
// Microphone
// ==============================
//
pub fn start_microphone(
    device: &cpal::Device,
    config: cpal::SupportedStreamConfig,
    bus: AudioBus,
) -> Result<cpal::Stream, String> {
    let err_fn = |err| println!("Mic error: {:?}", err);

    let stream_config = cpal::StreamConfig {
        channels: config.channels(),
        sample_rate: config.sample_rate(),
        buffer_size: cpal::BufferSize::Fixed(256),
    };

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &stream_config,
            move |data: &[f32], _| {
                let _ = bus.publish(data.to_vec());
            },
            err_fn,
            None,
        ),

        cpal::SampleFormat::I16 => device.build_input_stream(
            &stream_config,
            move |data: &[i16], _| {
                let buffer: Vec<f32> = data.iter().map(|s| *s as f32 / i16::MAX as f32).collect();

                let _ = bus.publish(buffer);
            },
            err_fn,
            None,
        ),

        cpal::SampleFormat::U16 => device.build_input_stream(
            &stream_config,
            move |data: &[u16], _| {
                let buffer: Vec<f32> = data
                    .iter()
                    .map(|s| (*s as f32 / u16::MAX as f32) * 2.0 - 1.0)
                    .collect();

                let _ = bus.publish(buffer);
            },
            err_fn,
            None,
        ),

        _ => return Err("Unsupported sample format".into()),
    }
    .map_err(|e| e.to_string())?;

    stream.play().map_err(|e| e.to_string())?;

    println!("Microphone stream running");

    Ok(stream)
}
