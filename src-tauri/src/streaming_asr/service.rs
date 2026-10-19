use std::time::Instant;

use serde::Serialize;
use tauri::{async_runtime::JoinHandle, AppHandle, Emitter};
use tokio::sync::watch;

use crate::audio_bus::AudioBus;
use crate::offline_asr::audio::{resample_to_16k, rms, to_mono, TARGET_SAMPLE_RATE};
use crate::offline_asr::service::OfflineTranscriptEvent;

use super::model::{StreamingAsrModel, StreamingProfile, StreamingUpdate};

const SPEECH_RMS_THRESHOLD: f32 = 0.0035;
pub(super) const ENDPOINT_SILENCE_MS: u64 = 2_000;

#[derive(Clone, Serialize)]
struct StreamingTranscriptEvent {
    #[serde(flatten)]
    transcript: OfflineTranscriptEvent,
    streaming: bool,
}

pub struct StreamingAsrStream {
    shutdown: watch::Sender<bool>,
    task: JoinHandle<()>,
}

pub async fn start_streaming_asr_stream_with_model(
    app: AppHandle,
    mut model: StreamingAsrModel,
    input_rate: u32,
    channels: u16,
    kirtan_mode: bool,
    bus: AudioBus,
) -> Result<StreamingAsrStream, String> {
    let mut receiver = bus.subscribe();
    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);
    let task = tauri::async_runtime::spawn(async move {
        let profile = StreamingProfile::for_kirtan(kirtan_mode);
        let step_samples = TARGET_SAMPLE_RATE as usize * profile.refresh_ms / 1_000;
        let mut since_refresh = 0;
        let mut first_refresh = true;
        let mut last_speech_end_ms = None;
        let mut last_partial = String::new();
        println!(
            "Streaming ASR profile={} refresh={}ms right_context={}ms edge_max={}ms",
            if kirtan_mode { "kirtan" } else { "sehaj_paath" },
            profile.refresh_ms,
            profile.right_context_ms,
            profile.edge_context_ms
        );

        loop {
            tokio::select! {
                biased;
                _ = shutdown_rx.changed() => {
                    // Drain audio already captured before the stop request and
                    // emit the last hypothesis before dropping model state.
                    while let Ok(chunk) = receiver.try_recv() {
                        push_chunk(&mut model, &chunk, input_rate, channels, &mut last_speech_end_ms);
                    }
                    if model.has_audio() {
                        match model.update(profile, true) {
                            Ok(update) => publish(&app, update, &mut last_partial),
                            Err(error) => eprintln!("Streaming ASR stop flush: {error}"),
                        }
                    }
                    break;
                }
                chunk = receiver.recv() => {
                    let Some(chunk) = chunk else { break; };
                    since_refresh += push_chunk(&mut model, &chunk, input_rate, channels, &mut last_speech_end_ms);
                    if !model.has_audio() {
                        since_refresh = 0;
                        first_refresh = true;
                        continue;
                    }
                    let initial_delay = if first_refresh { model.startup_delay_samples() } else { 0 };
                    if since_refresh < step_samples + initial_delay { continue; }
                    // Preserve all queued samples and move directly to current
                    // audio before running inference; do not decode stale work.
                    while let Ok(chunk) = receiver.try_recv() {
                        since_refresh += push_chunk(&mut model, &chunk, input_rate, channels, &mut last_speech_end_ms);
                    }
                    since_refresh = (since_refresh - initial_delay) % step_samples;
                    first_refresh = false;
                    if !model.has_audio() { continue; }
                    let endpoint = last_speech_end_ms.is_some_and(|end| model.end_ms().saturating_sub(end) >= ENDPOINT_SILENCE_MS);
                    let started = Instant::now();
                    match model.update(profile, endpoint) {
                        Ok(update) => {
                            println!("[ASR:streaming:{}] end={:.2}s inference={:.3}s chunks={}",
                                if kirtan_mode { "kirtan" } else { "paath" },
                                update.end_ms as f64 / 1_000.0, started.elapsed().as_secs_f64(), model.committed_chunks);
                            publish(&app, update, &mut last_partial);
                        }
                        Err(error) => {
                            // Never continue from a partially advanced cache if
                            // a graph call failed. Report the failure explicitly.
                            eprintln!("Streaming ASR inference stopped: {error}");
                            break;
                        }
                    }
                    if endpoint {
                        model.reset_segment();
                        last_speech_end_ms = None;
                        since_refresh = 0;
                        first_refresh = true;
                    }
                }
            }
        }
    });
    Ok(StreamingAsrStream {
        shutdown: shutdown_tx,
        task,
    })
}

pub(super) fn push_chunk(
    model: &mut StreamingAsrModel,
    chunk: &[f32],
    input_rate: u32,
    channels: u16,
    last_speech: &mut Option<u64>,
) -> usize {
    let mono = to_mono(chunk, channels);
    let audio = resample_to_16k(&mono, input_rate);
    let speech = rms(&audio) >= SPEECH_RMS_THRESHOLD;
    model.push_audio(&audio);
    if speech {
        *last_speech = Some(model.end_ms());
    } else if last_speech.is_none() {
        // Initial/inter-utterance silence advances the clock without filling
        // caches or generating hallucinated text.
        model.reset_segment();
    }
    audio.len()
}

fn publish(app: &AppHandle, update: StreamingUpdate, previous_partial: &mut String) {
    let final_text = update
        .finalized
        .iter()
        .map(|word| word.word.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let partial = update
        .partial
        .iter()
        .map(|word| word.word.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    if final_text.is_empty() && partial == *previous_partial {
        return;
    }
    *previous_partial = partial.clone();
    let _ = app.emit(
        "offline_transcript",
        StreamingTranscriptEvent {
            streaming: true,
            transcript: OfflineTranscriptEvent {
                provider: "offline",
                final_text,
                partial,
                end_ms: update.end_ms,
                word_timings: update.finalized,
                partial_word_timings: update.partial,
            },
        },
    );
}

pub async fn stop_streaming_asr_stream(stream: StreamingAsrStream) {
    let _ = stream.shutdown.send(true);
    let _ = stream.task.await;
}
