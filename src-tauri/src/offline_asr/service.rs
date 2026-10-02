use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{async_runtime::JoinHandle, AppHandle, Emitter};
use tokio::sync::watch;

use crate::audio_bus::AudioBus;

use super::audio::{resample_to_16k, rms, to_mono, RollingAudioWindow, TARGET_SAMPLE_RATE};
use super::model::OfflineAsrModel;

const SPEECH_RMS_THRESHOLD: f32 = 0.0035;
const ENDPOINT_SILENCE: Duration = Duration::from_millis(1_500);
const MIN_FINAL_AUDIO_MS: usize = 500;

#[derive(Debug, Clone, Serialize)]
pub struct OfflineTranscriptEvent {
    pub provider: &'static str,
    #[serde(rename = "final")]
    pub final_text: String,
    pub partial: String,
    pub end_ms: u64,
}

pub struct OfflineAsrStream {
    shutdown: watch::Sender<bool>,
    task: JoinHandle<()>,
}

pub async fn start_offline_asr_stream(
    app: AppHandle,
    resource_dir: PathBuf,
    input_rate: u32,
    channels: u16,
    bus: AudioBus,
) -> Result<OfflineAsrStream, String> {
    let mut model = OfflineAsrModel::load(&resource_dir)?;
    let mut receiver = bus.subscribe();
    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

    let task = tauri::async_runtime::spawn(async move {
        let mut window = RollingAudioWindow::default();
        let mut last_partial = String::new();
        let mut last_speech_at: Option<Instant> = None;
        let mut total_target_samples: u64 = 0;

        loop {
            tokio::select! {
                _ = shutdown_rx.changed() => {
                    break;
                }
                maybe_chunk = receiver.recv() => {
                    let Some(chunk) = maybe_chunk else { break; };

                    let mono = to_mono(&chunk, channels);
                    let resampled = resample_to_16k(&mono, input_rate);
                    if resampled.is_empty() {
                        continue;
                    }

                    total_target_samples = total_target_samples.saturating_add(resampled.len() as u64);
                    if rms(&resampled) >= SPEECH_RMS_THRESHOLD {
                        last_speech_at = Some(Instant::now());
                    }

                    window.push(&resampled);

                    if window.should_decode() {
                        let audio = window.snapshot_for_decode();
                        match model.transcribe(&audio) {
                            Ok(text) if !text.is_empty() && text != last_partial => {
                                last_partial = text.clone();
                                let _ = app.emit("offline_transcript", OfflineTranscriptEvent {
                                    provider: "offline",
                                    final_text: String::new(),
                                    partial: text,
                                    end_ms: samples_to_ms(total_target_samples),
                                });
                            }
                            Ok(_) => {}
                            Err(error) => eprintln!("Offline partial inference error: {error}"),
                        }
                    }

                    let endpoint_reached = last_speech_at
                        .map(|instant| instant.elapsed() >= ENDPOINT_SILENCE)
                        .unwrap_or(false);

                    if endpoint_reached && !window.is_empty() {
                        let audio = window.snapshot();
                        if samples_to_ms(audio.len() as u64) >= MIN_FINAL_AUDIO_MS as u64 {
                            match model.transcribe(&audio) {
                                Ok(text) if !text.is_empty() => {
                                    let _ = app.emit("offline_transcript", OfflineTranscriptEvent {
                                        provider: "offline",
                                        final_text: text,
                                        partial: String::new(),
                                        end_ms: samples_to_ms(total_target_samples),
                                    });
                                }
                                Ok(_) => {}
                                Err(error) => eprintln!("Offline final inference error: {error}"),
                            }
                        }

                        window.clear();
                        last_partial.clear();
                        last_speech_at = None;
                    }
                }
            }
        }
    });

    Ok(OfflineAsrStream {
        shutdown: shutdown_tx,
        task,
    })
}

pub async fn stop_offline_asr_stream(stream: OfflineAsrStream) {
    let _ = stream.shutdown.send(true);
    stream.task.abort();
}

fn samples_to_ms(samples: u64) -> u64 {
    samples.saturating_mul(1000) / TARGET_SAMPLE_RATE as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_samples_convert_to_expected_time() {
        assert_eq!(samples_to_ms(16_000), 1_000);
        assert_eq!(samples_to_ms(65_563), 4_097);
    }
}
