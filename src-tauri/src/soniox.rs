use tokio::sync::{mpsc, watch};
use tauri::async_runtime::JoinHandle;

use tokio_tungstenite::connect_async;
use tungstenite::Message;

use futures_util::{SinkExt, StreamExt};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use serde::{Deserialize};
use serde_json::json;

use bytemuck;

use tauri::{AppHandle, Emitter};

const SONIOX_URL: &str = "wss://stt-rt.soniox.com/transcribe-websocket";

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
    mic_stream: cpal::Stream,
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

//
// ==============================
// Start Soniox Stream
// ==============================
//
pub async fn start_soniox_stream(
    app: AppHandle,
    api_key: String,
    mic_name: String,
    panktis: Vec<String>,
) -> Result<SonioxStream, String> {

    println!("Starting Soniox streaming...");

    //
    // Select microphone
    //
    let host = cpal::default_host();

    let device = host
        .input_devices()
        .map_err(|e| format!("Failed to list devices: {}", e))?
        .find(|d| {
            d.name()
                .map(|name| name.contains(&mic_name))
                .unwrap_or(false)
        })
        .ok_or("Microphone not found")?;

    println!("Selected microphone: {}", device.name().unwrap());

    let config = device.default_input_config().map_err(|e| e.to_string())?;

    let sample_rate = config.sample_rate();
    let channels = config.channels() as usize;

    println!(
        "Mic config -> sample_rate: {} Hz | channels: {}",
        sample_rate, channels
    );

    //
    // Connect websocket
    //
    println!("Connecting to Soniox...");

    let (ws_stream, _) = connect_async(SONIOX_URL)
        .await
        .map_err(|e| e.to_string())?;

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
        "max_endpoint_delay_ms": 2000,
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
    // Audio channel
    //
    let (audio_tx, mut audio_rx) = mpsc::channel::<Vec<f32>>(32);

    //
    // Start microphone
    //
    let mic_stream = start_microphone(&device, config.clone(), audio_tx)?;

    println!("Microphone stream started");

    //
    // Shutdown signal
    //
    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

    //
    // Processing pipeline
    //
    let task = tauri::async_runtime::spawn(async move {

        println!("Soniox pipeline started");

        let mut buffer: Vec<i16> = Vec::new();

        // let mut sent_final_count = 0usize;
        let mut last_partial = String::new();

        loop {

            tokio::select! {

                //
                // Shutdown
                //
                _ = shutdown_rx.changed() => {

                    println!("Soniox shutdown received");

                    buffer.clear();

                    break;
                }

                //
                // Audio input
                //
                Some(chunk) = audio_rx.recv() => {

                    let mono: Vec<f32> = chunk
                        .chunks(channels)
                        .map(|f| f.iter().sum::<f32>() / channels as f32)
                        .collect();

                    let resampled = resample_to_16k(&mono, sample_rate);

                    let pcm16: Vec<i16> = resampled
                        .iter()
                        .map(|s| (s.clamp(-1.0,1.0) * i16::MAX as f32) as i16)
                        .collect();

                    buffer.extend_from_slice(&pcm16);

                    let frame_ms = 5;
                    let frame_size = (16000 as usize * frame_ms) / 1000;

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

                            let tokens = sx_msg.tokens;

                            let mut stable_final = Vec::new();
                            let mut first_non_final = 0;

                            for (i, token) in tokens.iter().enumerate() {

                                if token.is_final {

                                    stable_final.push(token.text.clone());

                                } else {

                                    first_non_final = i;
                                    break;
                                }

                                first_non_final = i + 1;
                            }

                            // let stable_count = stable_final.len();

                            // let new_final = if stable_count > sent_final_count {

                            //     stable_final[sent_final_count..].join("")

                            // } else {

                            //     String::new()
                            // };

                            // sent_final_count = stable_count;

                            let partial = tokens[first_non_final..]
                                .iter()
                                .map(|t| t.text.clone())
                                .collect::<Vec<String>>()
                                .join("");

                            if !stable_final.is_empty() || partial != last_partial {

                                last_partial = partial.clone();
                                let last_end_ms = tokens
                                    .last()
                                    .map(|t| t.end_ms)
                                    .unwrap_or(0);

                                let payload = json!({
                                    "final": stable_final.join(""),
                                    "partial": partial,
                                    "end_ms": last_end_ms
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
        mic_stream,
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

    drop(stream.mic_stream);

    println!("Soniox stream stopped");
}

//
// ==============================
// Microphone
// ==============================
//
fn start_microphone(
    device: &cpal::Device,
    config: cpal::SupportedStreamConfig,
    tx: mpsc::Sender<Vec<f32>>,
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

                let _ = tx.try_send(data.to_vec());

            },
            err_fn,
            None,
        ),

        cpal::SampleFormat::I16 => device.build_input_stream(
            &stream_config,
            move |data: &[i16], _| {

                let buffer: Vec<f32> = data
                    .iter()
                    .map(|s| *s as f32 / i16::MAX as f32)
                    .collect();

                let _ = tx.try_send(buffer);
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

                let _ = tx.try_send(buffer);
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