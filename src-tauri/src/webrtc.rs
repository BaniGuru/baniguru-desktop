use crate::audio_bus::AudioBus;
use tauri::AppHandle;

use futures_util::{SinkExt, StreamExt};
use tauri::async_runtime::JoinHandle;
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use url::Url;

use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};

const TARGET_RATE: u32 = 8000; // or 16000 if you want better quality

#[derive(Clone, Debug)]
pub struct ApiConfig {
    pub url: String,
    pub token: String,
}

// ==============================
// Start audio stream (RAW PCM)
// ==============================
pub fn start_audio_stream(
    _app: AppHandle,
    input_rate: u32,
    channels: u16,
    bus: AudioBus,
    api_config: ApiConfig,
) -> JoinHandle<()> {
    let channel_count = channels as usize;

    println!(
        "Device rate: {}Hz → Target {}Hz | channels: {}",
        input_rate, TARGET_RATE, channel_count
    );

    let handle = tauri::async_runtime::spawn(async move {
        println!("Audio stream started (RAW PCM)");

        let (tx, rx) = mpsc::channel::<Vec<u8>>(32);

        let ws = match ws_connect_and_auth(api_config).await {
            Some(ws) => ws,
            None => {
                eprintln!("WS auth failed");
                return;
            }
        };

        tauri::async_runtime::spawn(ws_sender_loop(rx, ws));

        audio_pcm_loop(bus, tx, input_rate, channel_count).await;

        println!("Audio stream stopped");
    });

    handle
}

// ==============================
// WebSocket connect
// ==============================
async fn ws_connect_and_auth(
    api_config: ApiConfig,
) -> Option<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
> {
    let mut url = Url::parse(&api_config.url).unwrap();

    url.query_pairs_mut()
        .append_pair("token", &api_config.token)
        .append_pair("appid", "gurbani-explorer");

    let (ws, _) = match connect_async(url.to_string()).await {
        Ok(v) => v,
        Err(e) => {
            eprintln!("WS connect failed: {:?}", e);
            return None;
        }
    };

    Some(ws)
}

// ==============================
// RAW PCM audio loop
// ==============================
async fn audio_pcm_loop(
    bus: AudioBus,
    tx: mpsc::Sender<Vec<u8>>,
    input_rate: u32,
    channel_count: usize,
) {
    let mut rx = bus.subscribe();

    let input_frame_size = input_rate as usize * 20 / 1000;
    let input_block = input_frame_size * channel_count;

    let target_frame_size = TARGET_RATE as usize * 20 / 1000;

    let mut input_buffer: Vec<f32> = Vec::new();
    let mut resampled_buffer: Vec<f32> = Vec::new();

    // Resampler (only if needed)
    let mut resampler = if input_rate != TARGET_RATE {
        println!("Resampling {}Hz → {}Hz", input_rate, TARGET_RATE);

        Some(
            SincFixedIn::<f32>::new(
                TARGET_RATE as f64 / input_rate as f64,
                2.0,
                SincInterpolationParameters {
                    sinc_len: 64,
                    f_cutoff: 0.95,
                    interpolation: SincInterpolationType::Linear,
                    oversampling_factor: 64,
                    window: WindowFunction::BlackmanHarris2,
                },
                input_frame_size,
                1,
            )
            .expect("Failed to create resampler"),
        )
    } else {
        None
    };

    while let Some(chunk) = rx.recv().await {
        input_buffer.extend_from_slice(&chunk);

        while input_buffer.len() >= input_block {
            let block: Vec<f32> = input_buffer.drain(..input_block).collect();

            let mono: Vec<f32> = block
                .chunks(channel_count)
                .map(|c| c.iter().sum::<f32>() / channel_count as f32)
                .collect();

            if let Some(ref mut r) = resampler {
                match r.process(&[mono], None) {
                    Ok(output) => resampled_buffer.extend_from_slice(&output[0]),
                    Err(e) => {
                        eprintln!("Resample error: {:?}", e);
                        continue;
                    }
                }
            } else {
                resampled_buffer.extend_from_slice(&mono);
            }
        }

        while resampled_buffer.len() >= target_frame_size {
            let frame: Vec<f32> = resampled_buffer.drain(..target_frame_size).collect();

            let pcm16 = f32_to_i16_bytes(&frame);

            if tx.send(pcm16).await.is_err() {
                eprintln!("Channel send failed");
                return;
            }
        }
    }
}

// ==============================
// f32 → i16 PCM
// ==============================
fn f32_to_i16_bytes(input: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len() * 2);

    for &s in input {
        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }

    out
}

// ==============================
// WebSocket sender
// ==============================
async fn ws_sender_loop(
    mut rx: mpsc::Receiver<Vec<u8>>,
    mut ws: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) {
    loop {
        tokio::select! {

            packet = rx.recv() => {
                match packet {
                    Some(data) => {
                        if ws.send(Message::Binary(data)).await.is_err() {
                            eprintln!("WS send failed");
                            break;
                        }
                    }
                    None => break,
                }
            }

            msg = ws.next() => {
                match msg {
                    Some(Ok(Message::Ping(payload))) => {
                        let _ = ws.send(Message::Pong(payload)).await;
                    }
                    Some(Ok(Message::Close(_))) => {
                        eprintln!("WS closed by server");
                        break;
                    }
                    Some(Err(e)) => {
                        eprintln!("WS error: {:?}", e);
                        break;
                    }
                    _ => {}
                }
            }
        }
    }
}
