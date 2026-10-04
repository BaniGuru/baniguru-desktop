use std::time::Duration;

use serde::Serialize;
use tauri::{async_runtime::JoinHandle, AppHandle, Emitter};
use tokio::sync::watch;

use crate::audio_bus::AudioBus;

use super::audio::{resample_to_16k, rms, to_mono, RollingAudioWindow, TARGET_SAMPLE_RATE};
use super::model::{OfflineAsrModel, WordTiming};

const SPEECH_RMS_THRESHOLD: f32 = 0.0035;
const ENDPOINT_SILENCE: Duration = Duration::from_millis(1_500);
const MIN_FINAL_AUDIO_MS: usize = 500;
const KIRTAN_WINDOW_MS: usize = 6_000;
const PAATH_WINDOW_MS: usize = 3_000;
const MINIMUM_WINDOW_MS: usize = 2_000;
const KIRTAN_REFRESH_MS: usize = 720;
const PAATH_REFRESH_MS: usize = 480;
const LEFT_CONTEXT_MS: u64 = 4_000;
const RIGHT_EDGE_GUARD_MS: u64 = 1_250;
const WORD_MATCH_TOLERANCE_MS: u64 = 220;
const CANDIDATE_MATCH_TOLERANCE_MS: u64 = 200;
const WORD_POSITION_GAP_TOLERANCE_MS: u64 = 80;
const STABLE_WINDOW_COUNT: u8 = 3;
const TRACK_MAX_GAP_TICKS: u64 = 2;
const BOUNDARY_SEARCH_BACK_MS: usize = 200;
const BOUNDARY_WINDOW_MS: usize = 10;
const BOUNDARY_HOP_MS: usize = 5;

fn audio_profile(kirtan_mode: bool) -> (usize, usize, usize) {
    if kirtan_mode {
        (KIRTAN_WINDOW_MS, MINIMUM_WINDOW_MS, KIRTAN_REFRESH_MS)
    } else {
        (PAATH_WINDOW_MS, MINIMUM_WINDOW_MS, PAATH_REFRESH_MS)
    }
}

fn retained_audio_ms(sliding_window_ms: usize) -> usize {
    sliding_window_ms
        .saturating_add(LEFT_CONTEXT_MS as usize)
        .saturating_add(BOUNDARY_SEARCH_BACK_MS)
}

#[derive(Debug, Clone, Serialize)]
pub struct OfflineTranscriptEvent {
    pub provider: &'static str,
    #[serde(rename = "final")]
    pub final_text: String,
    pub partial: String,
    pub end_ms: u64,
    /// Words that have crossed the live commit boundary.
    pub word_timings: Vec<WordTiming>,
    /// Current rolling hypothesis, replaced on each decode update.
    pub partial_word_timings: Vec<WordTiming>,
}

pub struct OfflineAsrStream {
    shutdown: watch::Sender<bool>,
    task: JoinHandle<()>,
}

pub async fn start_offline_asr_stream_with_model(
    app: AppHandle,
    mut model: OfflineAsrModel,
    input_rate: u32,
    channels: u16,
    kirtan_mode: bool,
    bus: AudioBus,
) -> Result<OfflineAsrStream, String> {
    let mut receiver = bus.subscribe();
    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

    let task = tauri::async_runtime::spawn(async move {
        let (max_window_ms, minimum_window_ms, refresh_ms) = audio_profile(kirtan_mode);
        println!(
            "Offline ASR profile={} window={}ms refresh={}ms",
            if kirtan_mode { "kirtan" } else { "paath" },
            max_window_ms,
            refresh_ms,
        );
        let mut window =
            RollingAudioWindow::with_millis(retained_audio_ms(max_window_ms), refresh_ms);
        let mut last_partial = String::new();
        let mut last_speech_end_ms: Option<u64> = None;
        let mut total_target_samples: u64 = 0;
        let mut full_audio = Vec::new();
        let mut word_finalizer = StableWordFinalizer::default();

        let transcribe_audio =
            |model: &mut OfflineAsrModel, audio: &[f32], window_start_ms: u64| {
                if kirtan_mode {
                    model.transcribe_kirtan(audio, window_start_ms)
                } else {
                    model.transcribe_speech(audio, window_start_ms)
                }
            };

        loop {
            tokio::select! {
                _ = shutdown_rx.changed() => {
                    break;
                }
                maybe_chunk = receiver.recv() => {
                    let Some(chunk) = maybe_chunk else { break; };

                    push_audio_chunk(
                        &chunk,
                        input_rate,
                        channels,
                        &mut window,
                        &mut full_audio,
                        &mut total_target_samples,
                        &mut last_speech_end_ms,
                    );

                    let minimum_ready_samples =
                        TARGET_SAMPLE_RATE as usize * minimum_window_ms / 1000;
                    if window.should_decode_every_ms(refresh_ms)
                        && window.len() >= minimum_ready_samples
                    {
                        // Inference can take longer than one microphone chunk. Catch the
                        // rolling window up to the newest queued audio before decoding so
                        // hypotheses do not trail playback by the entire channel backlog.
                        while let Ok(queued_chunk) = receiver.try_recv() {
                            push_audio_chunk(
                                &queued_chunk,
                                input_rate,
                                channels,
                                &mut window,
                                &mut full_audio,
                                &mut total_target_samples,
                                &mut last_speech_end_ms,
                            );
                        }
                        window.consume_decode_tick();
                        let now_ms = samples_to_ms(total_target_samples);
                        let audio = anchored_audio(
                            &window,
                            total_target_samples,
                            max_window_ms,
                            word_finalizer.next_unstable_start_ms(),
                        );
                        let window_start_ms = samples_to_ms(
                            total_target_samples.saturating_sub(audio.len() as u64),
                        );
                        let result = transcribe_audio(&mut model, &audio, window_start_ms);
                        match result {
                            Ok(transcript) if !transcript.text.is_empty() => {
                                let newly_final = word_finalizer.observe(&transcript.words, now_ms, refresh_ms);
                                let mut word_timings = newly_final.clone();
                                normalize_word_timings(&mut word_timings);
                                let mut partial_word_timings = word_finalizer.uncommitted_words(&transcript.words);
                                normalize_word_timings(&mut partial_word_timings);
                                let final_text = words_for_final_event(&newly_final);
                                let partial = words_as_text(&partial_word_timings);
                                let partial_changed = partial != last_partial;
                                if !final_text.is_empty() || partial_changed {
                                    last_partial = partial.clone();
                                    let _ = app.emit("offline_transcript", OfflineTranscriptEvent {
                                        provider: "offline",
                                        final_text,
                                        partial,
                                        end_ms: samples_to_ms(total_target_samples),
                                        word_timings,
                                        partial_word_timings,
                                    });
                                }
                            }
                            Ok(_) => {}
                            Err(error) => eprintln!("Offline partial inference error: {error}"),
                        }
                    }

                    let now_ms = samples_to_ms(total_target_samples);
                    let endpoint_reached = last_speech_end_ms
                        .map(|speech_end_ms| now_ms.saturating_sub(speech_end_ms) >= ENDPOINT_SILENCE.as_millis() as u64)
                        .unwrap_or(false);

                    if endpoint_reached && !full_audio.is_empty() {
                        emit_full_transcript(
                            &app,
                            &mut model,
                            &transcribe_audio,
                            &mut word_finalizer,
                            &full_audio,
                            total_target_samples,
                        );

                        window.clear();
                        full_audio.clear();
                        last_partial.clear();
                        word_finalizer.clear();
                        last_speech_end_ms = None;
                    }
                }
            }
        }

        while let Ok(queued_chunk) = receiver.try_recv() {
            push_audio_chunk(
                &queued_chunk,
                input_rate,
                channels,
                &mut window,
                &mut full_audio,
                &mut total_target_samples,
                &mut last_speech_end_ms,
            );
        }

        if !full_audio.is_empty() {
            emit_full_transcript(
                &app,
                &mut model,
                &transcribe_audio,
                &mut word_finalizer,
                &full_audio,
                total_target_samples,
            );
        }
    });

    Ok(OfflineAsrStream {
        shutdown: shutdown_tx,
        task,
    })
}

pub async fn stop_offline_asr_stream(stream: OfflineAsrStream) {
    let _ = stream.shutdown.send(true);
    let _ = stream.task.await;
}

fn samples_to_ms(samples: u64) -> u64 {
    samples.saturating_mul(1000) / TARGET_SAMPLE_RATE as u64
}

fn push_audio_chunk(
    chunk: &[f32],
    input_rate: u32,
    channels: u16,
    window: &mut RollingAudioWindow,
    full_audio: &mut Vec<f32>,
    total_target_samples: &mut u64,
    last_speech_end_ms: &mut Option<u64>,
) {
    let mono = to_mono(chunk, channels);
    let resampled = resample_to_16k(&mono, input_rate);
    if resampled.is_empty() {
        return;
    }

    *total_target_samples = total_target_samples.saturating_add(resampled.len() as u64);
    window.push(&resampled);
    let speech_chunk = rms(&resampled) >= SPEECH_RMS_THRESHOLD;
    if speech_chunk && last_speech_end_ms.is_none() {
        full_audio.clear();
    }
    if speech_chunk || last_speech_end_ms.is_some() {
        full_audio.extend_from_slice(&resampled);
    }
    if speech_chunk {
        *last_speech_end_ms = Some(samples_to_ms(*total_target_samples));
    }
}

fn emit_full_transcript<F>(
    app: &AppHandle,
    model: &mut OfflineAsrModel,
    transcribe_audio: &F,
    word_finalizer: &mut StableWordFinalizer,
    audio: &[f32],
    total_target_samples: u64,
) where
    F: Fn(&mut OfflineAsrModel, &[f32], u64) -> Result<super::model::TimedTranscript, String>,
{
    if samples_to_ms(audio.len() as u64) < MIN_FINAL_AUDIO_MS as u64 {
        return;
    }

    let window_start_sample = total_target_samples.saturating_sub(audio.len() as u64);
    let window_start_ms = samples_to_ms(window_start_sample);
    match transcribe_audio(model, audio, window_start_ms) {
        Ok(transcript) => {
            let newly_final =
                word_finalizer.finish(&transcript.words, samples_to_ms(total_target_samples));
            let final_text = words_for_final_event(&newly_final);
            let mut word_timings = newly_final;
            normalize_word_timings(&mut word_timings);
            if !final_text.is_empty() {
                let _ = app.emit(
                    "offline_transcript",
                    OfflineTranscriptEvent {
                        provider: "offline",
                        final_text,
                        partial: String::new(),
                        end_ms: samples_to_ms(total_target_samples),
                        word_timings,
                        partial_word_timings: Vec::new(),
                    },
                );
            }
        }
        Err(error) => eprintln!("Offline final inference error: {error}"),
    }
}

/// Keep committed context before the first unsettled word, like the Python
/// live decoder. The moving boundary can snap to a waveform valley so the
/// unstable word remains intact when the window advances.
fn anchored_audio(
    window: &RollingAudioWindow,
    total_samples: u64,
    max_window_ms: usize,
    next_unstable_start_ms: Option<u64>,
) -> Vec<f32> {
    let retained = window.snapshot();
    let retained_start = total_samples.saturating_sub(retained.len() as u64);
    let now_ms = samples_to_ms(total_samples);
    let context_floor_ms = now_ms.saturating_sub(
        max_window_ms
            .saturating_add(LEFT_CONTEXT_MS as usize)
            .saturating_add(BOUNDARY_SEARCH_BACK_MS) as u64,
    );
    let preferred_start_ms = next_unstable_start_ms
        .map(|unstable_start_ms| unstable_start_ms.saturating_sub(LEFT_CONTEXT_MS))
        .unwrap_or_else(|| now_ms.saturating_sub(max_window_ms as u64));
    let start_ms = preferred_start_ms
        .max(context_floor_ms)
        .max(samples_to_ms(retained_start));
    let start_sample = (start_ms as u128 * TARGET_SAMPLE_RATE as u128 / 1000) as u64;
    let minimum_start_sample =
        (context_floor_ms as u128 * TARGET_SAMPLE_RATE as u128 / 1000) as u64;
    let minimum_offset = minimum_start_sample
        .max(retained_start)
        .saturating_sub(retained_start)
        .min(retained.len() as u64) as usize;
    let mut skip = start_sample
        .saturating_sub(retained_start)
        .min(retained.len() as u64) as usize;

    // A word timestamp can land anywhere inside its waveform. When advancing
    // the anchor, snap backward to a clear local energy valley if one is nearby.
    // Keep the timestamp itself when the audio has no convincing dip.
    if next_unstable_start_ms.is_some() {
        skip = preceding_energy_valley(&retained, skip, minimum_offset);
    }

    retained.into_iter().skip(skip).collect()
}

fn preceding_energy_valley(samples: &[f32], desired: usize, minimum: usize) -> usize {
    let window = TARGET_SAMPLE_RATE as usize * BOUNDARY_WINDOW_MS / 1000;
    let hop = TARGET_SAMPLE_RATE as usize * BOUNDARY_HOP_MS / 1000;
    let lookback = TARGET_SAMPLE_RATE as usize * BOUNDARY_SEARCH_BACK_MS / 1000;
    let flank = TARGET_SAMPLE_RATE as usize * 40 / 1000;
    let first = desired.saturating_sub(lookback).max(minimum).max(flank);
    let last = desired.min(samples.len().saturating_sub(window));
    if last < first || last + window + flank > samples.len() {
        return desired.min(samples.len());
    }

    // Search from the word onset toward earlier audio so the selected dip is
    // the nearest usable boundary and cannot skip into the unsettled word.
    let mut offset = last - (last - first) % hop;
    loop {
        let before = rms(&samples[offset - flank..offset]);
        let center = rms(&samples[offset..offset + window]);
        let after = rms(&samples[offset + window..offset + window + flank]);
        let neighboring_level = before.max(after);
        if neighboring_level > SPEECH_RMS_THRESHOLD && center <= neighboring_level * 0.35 {
            return offset;
        }

        if offset < first + hop {
            break;
        }
        offset -= hop;
    }

    desired.min(samples.len())
}

#[derive(Debug, Clone)]
struct StableWordCandidate {
    timing: WordTiming,
    stable_windows: u8,
    last_seen_tick: u64,
}

#[derive(Debug, Default)]
struct StableWordFinalizer {
    tick: u64,
    pending: Vec<StableWordCandidate>,
    finalized: Vec<WordTiming>,
    last_hypothesis: Vec<WordTiming>,
}

impl StableWordFinalizer {
    /// Match the same timed word in three recent hypotheses. Keep the
    /// finalization edge behind the live audio so the newest word can settle.
    fn observe(
        &mut self,
        words: &[WordTiming],
        now_ms: u64,
        _refresh_ms: usize,
    ) -> Vec<WordTiming> {
        self.tick = self.tick.saturating_add(1);
        self.last_hypothesis = self.uncommitted_words(words);
        let mut matched = vec![false; self.pending.len()];

        for word in words {
            if self.is_finalized_position(word) || self.is_behind_finalized_frontier(word) {
                continue;
            }

            let candidate_index = self
                .pending
                .iter()
                .enumerate()
                .filter(|(index, candidate)| {
                    !matched[*index] && same_word_candidate(&candidate.timing, word)
                })
                .min_by_key(|(_, candidate)| candidate.timing.start_ms.abs_diff(word.start_ms))
                .map(|(index, _)| index);

            if let Some(index) = candidate_index {
                matched[index] = true;
                let candidate = &mut self.pending[index];
                let tick_gap = self.tick.saturating_sub(candidate.last_seen_tick);
                if normalize_asr_word(&candidate.timing.word) == normalize_asr_word(&word.word)
                    && tick_gap == 1
                {
                    candidate.stable_windows = candidate
                        .stable_windows
                        .saturating_add(1)
                        .min(STABLE_WINDOW_COUNT);
                } else {
                    candidate.stable_windows = 1;
                }
                candidate.timing = word.clone();
                candidate.last_seen_tick = self.tick;
            } else {
                self.pending.push(StableWordCandidate {
                    timing: word.clone(),
                    stable_windows: 1,
                    last_seen_tick: self.tick,
                });
                matched.push(true);
            }
        }

        self.pending
            .sort_by_key(|candidate| candidate.timing.start_ms);
        let newly_final = self.finalize_ready(now_ms);
        self.last_hypothesis = self.uncommitted_words(words);
        newly_final
    }

    fn uncommitted_words(&self, words: &[WordTiming]) -> Vec<WordTiming> {
        words
            .iter()
            .filter(|word| {
                !self.is_finalized_position(word) && !self.is_behind_finalized_frontier(word)
            })
            .cloned()
            .collect()
    }

    fn is_finalized_position(&self, word: &WordTiming) -> bool {
        self.finalized
            .iter()
            .any(|finalized| same_word_position(finalized, word))
    }

    fn is_behind_finalized_frontier(&self, word: &WordTiming) -> bool {
        self.finalized
            .iter()
            .map(|finalized| finalized.start_ms)
            .max()
            .is_some_and(|frontier| word.start_ms < frontier)
    }

    fn next_unstable_start_ms(&self) -> Option<u64> {
        self.pending
            .iter()
            .filter(|candidate| {
                self.tick.saturating_sub(candidate.last_seen_tick) <= TRACK_MAX_GAP_TICKS
            })
            .map(|candidate| candidate.timing.start_ms)
            .min()
            .or_else(|| self.last_hypothesis.iter().map(|word| word.start_ms).min())
    }

    fn finalize_ready(&mut self, now_ms: u64) -> Vec<WordTiming> {
        let mut ready = Vec::new();
        let mut remaining = Vec::with_capacity(self.pending.len());
        let mut blocked_by_earlier_word = false;
        let trailing_start_ms = self
            .pending
            .iter()
            .map(|candidate| candidate.timing.start_ms)
            .max();
        for candidate in self.pending.drain(..) {
            let stale = self.tick.saturating_sub(candidate.last_seen_tick) > TRACK_MAX_GAP_TICKS;
            let is_trailing_word = trailing_start_ms == Some(candidate.timing.start_ms);
            // Keep the newest word provisional until a later word gives us a
            // timestamped boundary. Silence is handled by finish(), which uses
            // the full utterance decode to flush this tail.
            let mature = !is_trailing_word
                && candidate.stable_windows >= STABLE_WINDOW_COUNT
                && now_ms.saturating_sub(candidate.timing.end_ms.max(candidate.timing.start_ms))
                    >= RIGHT_EDGE_GUARD_MS;

            if mature && !blocked_by_earlier_word {
                ready.push(candidate.timing);
            } else if !stale || is_trailing_word || candidate.stable_windows >= STABLE_WINDOW_COUNT
            {
                blocked_by_earlier_word = true;
                remaining.push(candidate);
            }
        }

        self.pending = remaining;
        self.finalized.extend(ready.iter().cloned());
        ready
    }

    /// Flush just the not-yet-final suffix at silence; stable words are never
    /// appended a second time from the final rolling-window decode.
    fn finish(&mut self, last_words: &[WordTiming], now_ms: u64) -> Vec<WordTiming> {
        let mut source = if last_words.is_empty() {
            self.last_hypothesis.clone()
        } else {
            last_words.to_vec()
        };
        // A stable live candidate can disappear or be revised at the final
        // edge. Retain that evidence and merge it with the tail hypothesis
        // by timed audio position before flushing.
        source.extend(
            self.pending
                .iter()
                .filter(|candidate| {
                    candidate.stable_windows >= STABLE_WINDOW_COUNT
                        && now_ms
                            .saturating_sub(candidate.timing.end_ms.max(candidate.timing.start_ms))
                            >= RIGHT_EDGE_GUARD_MS
                })
                .map(|candidate| candidate.timing.clone()),
        );
        let mut newly_final: Vec<WordTiming> = Vec::new();
        for word in source {
            if self.is_finalized_position(&word) || self.is_behind_finalized_frontier(&word) {
                continue;
            }
            if let Some(existing) = newly_final
                .iter_mut()
                .find(|existing| same_word_position(existing, &word))
            {
                *existing = word;
            } else {
                newly_final.push(word);
            }
        }
        newly_final.sort_by_key(|word| word.start_ms);
        self.finalized.extend(newly_final.iter().cloned());
        newly_final
    }

    fn clear(&mut self) {
        *self = Self::default();
    }
}

fn same_word_position(left: &WordTiming, right: &WordTiming) -> bool {
    let start_distance = left.start_ms.abs_diff(right.start_ms);
    let same_word = normalize_asr_word(&left.word) == normalize_asr_word(&right.word);
    if same_word && start_distance <= WORD_MATCH_TOLERANCE_MS {
        return true;
    }

    let left_duration = left.end_ms.saturating_sub(left.start_ms);
    let right_duration = right.end_ms.saturating_sub(right.start_ms);
    let overlap_ms = left
        .end_ms
        .min(right.end_ms)
        .saturating_sub(left.start_ms.max(right.start_ms));
    let shorter_duration = left_duration.min(right_duration);
    let gap_ms = if left.end_ms < right.start_ms {
        right.start_ms - left.end_ms
    } else if right.end_ms < left.start_ms {
        left.start_ms - right.end_ms
    } else {
        0
    };
    // Timing identifies the audio position: if the model revises a token at
    // the same strongly overlapping interval (for example ਓਟ -> ਕੋਟ), or
    // emits a tiny fragment immediately after the stable word, keep it
    // attached to that anchor instead of appending a duplicate.
    (shorter_duration > 0
        && shorter_duration <= 1_800
        && overlap_ms.saturating_mul(5) >= shorter_duration.saturating_mul(2))
        || (gap_ms <= WORD_POSITION_GAP_TOLERANCE_MS
            && shorter_duration > 0
            && shorter_duration <= 250)
}

fn same_word_candidate(left: &WordTiming, right: &WordTiming) -> bool {
    if normalize_asr_word(&left.word) == normalize_asr_word(&right.word) {
        left.start_ms.abs_diff(right.start_ms) <= CANDIDATE_MATCH_TOLERANCE_MS
            || left.end_ms.abs_diff(right.end_ms) <= CANDIDATE_MATCH_TOLERANCE_MS
    } else {
        // A changed spelling at the same audio position resets stability as a
        // revision of the same word rather than becoming a duplicate token.
        same_word_position(left, right)
    }
}

fn normalize_asr_word(word: &str) -> String {
    word.trim_matches(|character: char| {
        matches!(character, ',' | '.' | ';' | ':' | '!' | '?' | '।' | '॥')
    })
    .to_lowercase()
}

fn words_as_text(words: &[WordTiming]) -> String {
    words
        .iter()
        .map(|word| word.word.as_str())
        .collect::<Vec<_>>()
        .join(" ")
}

fn words_for_final_event(words: &[WordTiming]) -> String {
    let text = words_as_text(words);
    if text.is_empty() {
        text
    } else {
        format!("{text} ")
    }
}

fn normalize_word_timings(words: &mut [WordTiming]) {
    words.sort_by_key(|word| (word.start_ms, word.end_ms));
    for index in 0..words.len().saturating_sub(1) {
        let next_start = words[index + 1].start_ms;
        if words[index].end_ms > next_start {
            words[index].end_ms = next_start.max(words[index].start_ms);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn timed_word(word: &str, start_ms: u64, end_ms: u64) -> WordTiming {
        WordTiming {
            word: word.to_string(),
            start_ms,
            end_ms,
        }
    }

    #[test]
    fn trailing_word_waits_for_a_following_word_before_finalizing() {
        let mut finalizer = StableWordFinalizer::default();
        let word = timed_word("ਪੂਰਾ", 1_000, 1_400);
        let following_word = timed_word("ਨਾਮ", 2_900, 3_300);

        assert!(finalizer
            .observe(std::slice::from_ref(&word), 1_700, 400)
            .is_empty());
        assert!(finalizer
            .observe(std::slice::from_ref(&word), 1_800, 400)
            .is_empty());
        assert!(finalizer
            .observe(std::slice::from_ref(&word), 2_300, 400)
            .is_empty());
        assert!(finalizer.finalized.is_empty());

        assert!(finalizer
            .observe(std::slice::from_ref(&word), 2_400, 400)
            .is_empty());
        assert!(finalizer
            .observe(std::slice::from_ref(&word), 2_800, 400)
            .is_empty());
        assert!(finalizer.finalized.is_empty());

        let newly_final = finalizer.observe(&[word, following_word], 3_400, 400);
        assert_eq!(words_as_text(&newly_final), "ਪੂਰਾ");
        assert_eq!(finalizer.finalized[0].end_ms, 1_400);
    }

    #[test]
    fn finalization_does_not_append_a_committed_word_twice() {
        let mut finalizer = StableWordFinalizer::default();
        let word = timed_word("ਹਰਿ", 1_000, 1_200);
        let next_word = timed_word("ਨਾਮ", 1_300, 1_500);

        finalizer.observe(std::slice::from_ref(&word), 1_500, 400);
        finalizer.observe(std::slice::from_ref(&word), 1_600, 400);
        assert!(finalizer
            .observe(&[word.clone(), next_word.clone()], 2_100, 400)
            .is_empty());
        let committed = finalizer.observe(&[word.clone(), next_word.clone()], 2_500, 400);
        assert_eq!(committed.len(), 1);

        let newly_final = finalizer.observe(&[word.clone(), next_word.clone()], 2_900, 400);
        assert!(
            newly_final.is_empty(),
            "the newest word must remain provisional"
        );
        assert_eq!(
            words_as_text(&finalizer.finish(&[word, next_word], 2_900)),
            "ਨਾਮ"
        );
    }

    #[test]
    fn silence_flushes_only_the_uncommitted_tail() {
        let mut finalizer = StableWordFinalizer::default();
        let committed = timed_word("ਹਰਿ", 1_000, 1_200);
        let tail = timed_word("ਨਾਮ", 1_500, 1_700);
        finalizer.observe(&[committed.clone(), tail.clone()], 1_500, 400);
        finalizer.observe(&[committed.clone(), tail.clone()], 1_600, 400);
        finalizer.observe(&[committed.clone(), tail.clone()], 2_600, 400);

        let newly_final = finalizer.finish(&[committed, tail.clone()], 2_600);

        assert_eq!(newly_final, vec![tail]);
        assert_eq!(words_for_final_event(&newly_final), "ਨਾਮ ");
    }

    #[test]
    fn quick_repetitions_at_distinct_times_are_tracked_separately() {
        let mut finalizer = StableWordFinalizer::default();
        let first = timed_word("ਹਰਿ", 1_000, 1_180);
        let second = timed_word("ਹਰਿ", 1_450, 1_620);
        let words = [first, second];

        finalizer.observe(&words, 1_900, 400);
        finalizer.observe(&words, 2_000, 400);
        let newly_final = finalizer.observe(&words, 2_500, 400);

        assert_eq!(newly_final.len(), 1);
        assert_eq!(words_as_text(&newly_final), "ਹਰਿ");
        assert_eq!(words_as_text(&finalizer.finish(&words, 2_500)), "ਹਰਿ");
    }

    #[test]
    fn same_word_with_shifted_timing_merges_when_audio_intervals_overlap() {
        let earlier = timed_word("ਪੂਰਨ", 12_085, 13_002);
        let shifted = timed_word("ਪੂਰਨ", 12_713, 13_067);
        assert!(same_word_position(&earlier, &shifted));
    }

    #[test]
    fn timestamp_overlap_merges_a_revision_at_the_same_audio_position() {
        let left = timed_word("ਓਟ", 12_085, 13_002);
        let revision = timed_word("ਕੋਟ", 12_713, 13_067);
        let following_word = timed_word("ਪੂਰਨ", 13_100, 13_600);
        assert!(same_word_position(&left, &revision));
        assert!(!same_word_position(&left, &following_word));

        let shifted_edge = timed_word("ਕੋਟ", 12_950, 13_307);
        assert!(same_word_position(
            &timed_word("ਓਟ", 12_562, 13_118),
            &shifted_edge
        ));
        assert!(same_word_position(
            &timed_word("ਓਟ", 45_451, 46_007),
            &timed_word("ਕੋਟ", 46_051, 46_250)
        ));
    }

    #[test]
    fn target_samples_convert_to_expected_time() {
        assert_eq!(samples_to_ms(16_000), 1_000);
        assert_eq!(samples_to_ms(65_563), 4_097);
    }

    #[test]
    fn profiles_share_refresh_and_minimum_window_settings() {
        assert_eq!(audio_profile(true), (6_000, 2_000, 720));
        assert_eq!(audio_profile(false), (3_000, 2_000, 480));
    }

    #[test]
    fn anchored_window_moves_to_the_first_unstable_word() {
        let (max_window_ms, _minimum_window_ms, refresh_ms) = audio_profile(true);
        let mut window =
            RollingAudioWindow::with_millis(retained_audio_ms(max_window_ms), refresh_ms);
        window.push(&vec![0.1; TARGET_SAMPLE_RATE as usize * 4]);
        let startup = anchored_audio(&window, TARGET_SAMPLE_RATE as u64 * 4, max_window_ms, None);
        assert_eq!(startup.len(), TARGET_SAMPLE_RATE as usize * 4);

        window.push(&vec![0.1; TARGET_SAMPLE_RATE as usize * 4]);
        let total = TARGET_SAMPLE_RATE as u64 * 8;

        let initial = anchored_audio(&window, total, max_window_ms, None);
        assert_eq!(initial.len(), TARGET_SAMPLE_RATE as usize * 6);

        let waiting = anchored_audio(&window, total, max_window_ms, Some(2_000));
        assert_eq!(waiting.len(), TARGET_SAMPLE_RATE as usize * 8);

        // Preserve four seconds before the unsettled word as left context.
        let caught_up = anchored_audio(&window, total, max_window_ms, Some(7_500));
        assert_eq!(
            caught_up.len(),
            TARGET_SAMPLE_RATE as usize * 4 + TARGET_SAMPLE_RATE as usize / 2
        );
    }

    #[test]
    fn moving_boundary_snaps_back_to_a_short_waveform_valley() {
        let rate = TARGET_SAMPLE_RATE as usize;
        let total_samples = rate * 12;
        let mut samples = vec![0.1; total_samples];
        samples[rate * 4 - rate / 100..rate * 4].fill(0.0);
        let mut window = RollingAudioWindow::with_millis(retained_audio_ms(4_000), 500);
        window.push(&samples);

        let audio = anchored_audio(&window, total_samples as u64, 4_000, Some(8_000));

        assert!(audio[0].abs() < 0.001, "boundary did not land in valley");
        assert_eq!(audio.len(), rate * 12 - (rate * 4 - rate / 100));
    }

    #[test]
    fn emitted_word_timings_are_sorted_and_non_overlapping() {
        let mut words = vec![timed_word("ਅਗਲਾ", 200, 400), timed_word("ਪਹਿਲਾ", 100, 250)];

        normalize_word_timings(&mut words);

        assert_eq!(words[0], timed_word("ਪਹਿਲਾ", 100, 200));
        assert_eq!(words[1], timed_word("ਅਗਲਾ", 200, 400));
        assert_eq!(overlapping_word_pairs(&words), 0);
    }

    fn decode_mp3(path: &std::path::Path) -> Vec<f32> {
        use std::process::Command;

        let decoded = Command::new("ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(path)
            .args(["-f", "f32le", "-ac", "1", "-ar", "16000", "pipe:1"])
            .output()
            .expect("run ffmpeg to decode the checked-in MP3 fixture");
        assert!(
            decoded.status.success(),
            "could not decode {}",
            path.display()
        );
        decoded
            .stdout
            .chunks_exact(4)
            .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap()))
            .collect()
    }

    fn word_error_rate(reference: &[WordTiming], hypothesis: &[WordTiming]) -> f64 {
        let reference: Vec<_> = reference
            .iter()
            .map(|word| normalize_asr_word(&word.word))
            .collect();
        let hypothesis: Vec<_> = hypothesis
            .iter()
            .map(|word| normalize_asr_word(&word.word))
            .collect();
        let mut previous: Vec<usize> = (0..=hypothesis.len()).collect();
        for (row, reference_word) in reference.iter().enumerate() {
            let mut current = vec![row + 1; hypothesis.len() + 1];
            for (column, hypothesis_word) in hypothesis.iter().enumerate() {
                current[column + 1] = (previous[column + 1] + 1)
                    .min(current[column] + 1)
                    .min(previous[column] + usize::from(reference_word != hypothesis_word));
            }
            previous = current;
        }
        previous[hypothesis.len()] as f64 / reference.len().max(1) as f64
    }

    fn overlapping_word_pairs(words: &[WordTiming]) -> usize {
        words
            .windows(2)
            .filter(|pair| pair[1].start_ms < pair[0].end_ms)
            .count()
    }

    fn run_live_decode(
        model: &mut OfflineAsrModel,
        samples: &[f32],
        kirtan_mode: bool,
        window_ms: usize,
    ) -> (Vec<WordTiming>, Duration) {
        let refresh_ms = audio_profile(kirtan_mode).2;
        let minimum_samples = TARGET_SAMPLE_RATE as usize * MINIMUM_WINDOW_MS / 1_000;
        let mut window = RollingAudioWindow::with_millis(retained_audio_ms(window_ms), refresh_ms);
        let mut finalizer = StableWordFinalizer::default();
        let mut finalized = Vec::new();
        let mut total_samples = 0_u64;
        let step_samples = TARGET_SAMPLE_RATE as usize * refresh_ms / 1_000;
        let started = std::time::Instant::now();

        for chunk in samples.chunks(step_samples) {
            window.push(chunk);
            total_samples = total_samples.saturating_add(chunk.len() as u64);
            if !window.should_decode_every_ms(refresh_ms) || window.len() < minimum_samples {
                continue;
            }
            window.consume_decode_tick();
            let now_ms = samples_to_ms(total_samples);
            let audio = anchored_audio(
                &window,
                total_samples,
                window_ms,
                finalizer.next_unstable_start_ms(),
            );
            let start_ms = samples_to_ms(total_samples.saturating_sub(audio.len() as u64));
            let transcript = if kirtan_mode {
                model.transcribe_kirtan(&audio, start_ms)
            } else {
                model.transcribe_speech(&audio, start_ms)
            }
            .expect("transcribe live rolling window");
            finalized.extend(finalizer.observe(&transcript.words, now_ms, refresh_ms));
        }

        let tail = window.snapshot();
        let tail_start_ms = samples_to_ms(total_samples.saturating_sub(tail.len() as u64));
        let tail_transcript = if kirtan_mode {
            model.transcribe_kirtan(&tail, tail_start_ms)
        } else {
            model.transcribe_speech(&tail, tail_start_ms)
        }
        .expect("transcribe final live window");
        finalized.extend(finalizer.finish(&tail_transcript.words, samples_to_ms(total_samples)));
        (finalized, started.elapsed())
    }

    #[test]
    #[ignore = "runs full and rolling RNNT decode comparisons on all MP3 fixtures; requires ffmpeg"]
    fn live_windows_compare_with_full_transcripts_for_all_fixtures() {
        use std::path::Path;

        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        let fixtures = manifest.join("../test_audios");
        let mut model = OfflineAsrModel::load(&manifest.join("resources/offline_asr"))
            .expect("load bundled offline model");

        for (name, kirtan_mode, candidates) in [
            ("darbar_sahib_kirtan.mp3", true, vec![6_000]),
            ("asa_ki_vaar_kirtan.mp3", true, vec![6_000]),
            ("fast_akhand_paath.mp3", false, vec![3_000]),
            ("sukhmani_sahib_paath.mp3", false, vec![3_000]),
        ] {
            if std::env::var("BANI_TEST_FIXTURE").is_ok_and(|only| only != name) {
                continue;
            }
            let path = fixtures.join(name);
            let samples = decode_mp3(&path);
            let full_started = std::time::Instant::now();
            let full = if kirtan_mode {
                model.transcribe_kirtan(&samples, 0)
            } else {
                model.transcribe_speech(&samples, 0)
            }
            .unwrap_or_else(|error| panic!("{} full decode failed: {error}", path.display()));
            let full_elapsed = full_started.elapsed();
            println!("FULL[{name}] {}", full.text);

            for window_ms in candidates.iter().copied() {
                let (live_words, live_elapsed) =
                    run_live_decode(&mut model, &samples, kirtan_mode, window_ms);
                let mut live_words = live_words;
                normalize_word_timings(&mut live_words);
                let live_text = words_as_text(&live_words);
                let wer = word_error_rate(&full.words, &live_words);
                let overlap_count = overlapping_word_pairs(&live_words);
                let audio_duration =
                    Duration::from_secs_f64(samples.len() as f64 / TARGET_SAMPLE_RATE as f64);
                println!(
                    "WINDOW_RESULT fixture={name} mode={} window_ms={window_ms} full_words={} live_words={} wer={wer:.4} overlaps={overlap_count} full_rtf={:.3} live_rtf={:.3}",
                    if kirtan_mode { "kirtan" } else { "paath" },
                    full.words.len(),
                    live_words.len(),
                    full_elapsed.as_secs_f64() / audio_duration.as_secs_f64(),
                    live_elapsed.as_secs_f64() / audio_duration.as_secs_f64(),
                );
                println!("LIVE[{name}][{window_ms}ms] {live_text}");
                println!("LIVE_TIMINGS[{name}][{window_ms}ms] {live_words:?}");
                assert!(!live_words.is_empty(), "no live words for {name}");
                assert_eq!(overlap_count, 0, "overlapping live words for {name}");
            }
        }
    }

    #[test]
    #[ignore = "runs the bundled RNNT model over the full Darbar Sahib Kirtan MP3; requires ffmpeg"]
    fn darbar_sahib_kirtan_finalizes_words_while_the_six_second_window_advances() {
        use std::path::Path;
        use std::process::Command;

        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        let path = manifest.join("../test_audios/darbar_sahib_kirtan.mp3");
        let decoded = Command::new("ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(&path)
            .args(["-f", "f32le", "-ac", "1", "-ar", "16000", "pipe:1"])
            .output()
            .expect("run ffmpeg to decode Darbar Sahib Kirtan MP3");
        assert!(
            decoded.status.success(),
            "could not decode {}",
            path.display()
        );
        let samples: Vec<f32> = decoded
            .stdout
            .chunks_exact(4)
            .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap()))
            .collect();

        let (max_window_ms, minimum_window_ms, refresh_ms) = audio_profile(true);
        let mut window =
            RollingAudioWindow::with_millis(retained_audio_ms(max_window_ms), refresh_ms);
        let mut model = OfflineAsrModel::load(&manifest.join("resources/offline_asr"))
            .expect("load bundled offline model");
        let full_transcript = model
            .transcribe_kirtan(&samples, 0)
            .expect("transcribe the complete Darbar Sahib recording");
        let mut finalizer = StableWordFinalizer::default();
        let mut final_words = Vec::new();
        let step_samples = TARGET_SAMPLE_RATE as usize * refresh_ms / 1_000;
        let minimum_samples = TARGET_SAMPLE_RATE as usize * minimum_window_ms / 1_000;
        let mut total_samples = 0_u64;

        for chunk in samples.chunks(step_samples) {
            window.push(chunk);
            total_samples = total_samples.saturating_add(chunk.len() as u64);
            if !window.should_decode_every_ms(refresh_ms) || window.len() < minimum_samples {
                continue;
            }
            window.consume_decode_tick();

            let now_ms = samples_to_ms(total_samples);
            let base_audio = anchored_audio(
                &window,
                total_samples,
                max_window_ms,
                finalizer.next_unstable_start_ms(),
            );
            let base_start_ms =
                samples_to_ms(total_samples.saturating_sub(base_audio.len() as u64));
            let result = model
                .transcribe_kirtan(&base_audio, base_start_ms)
                .expect("transcribe rolling Kirtan window");

            final_words.extend(finalizer.observe(&result.words, now_ms, refresh_ms));
        }

        // Stop behaves like silence finalization: the full capture transcript
        // provides the final evidence for the last word that was held at the
        // rolling window's right edge.
        final_words.extend(finalizer.finish(&full_transcript.words, samples_to_ms(total_samples)));
        normalize_word_timings(&mut final_words);

        let transcript = words_as_text(&final_words);
        let full_text = words_as_text(&full_transcript.words);
        let wer = word_error_rate(&full_transcript.words, &final_words);
        println!("[darbar-sahib-full]: {full_text}");
        println!("[darbar-sahib-live-final]: {transcript}");
        println!("[darbar-sahib-live-wer]: {wer:.4}");
        assert_eq!(
            wer, 0.0,
            "live final must agree with the full recording decode"
        );
        assert!(
            !transcript.contains("ਗੋਪਾਲ ਪ ਆ ਛਾਡ"),
            "the sliding transcript kept the unstable tail as fragments: {transcript}"
        );
        assert!(!transcript.is_empty(), "the finalizer emitted no words");
        assert!(
            transcript.matches("ਕਰ ਕਿਰਪਾ ਪ੍ਰਭ ਦੀਨ").count() >= 3,
            "the three sung opening phrases were not retained: {transcript}"
        );
        assert!(
            transcript.matches("ਤੇਰੀ ਓਟ ਪੂਰਨ").count() >= 4,
            "the refrain and trailing repeat were not retained: {transcript}"
        );
    }
}
