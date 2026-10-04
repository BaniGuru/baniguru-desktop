use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{async_runtime::JoinHandle, AppHandle, Emitter};
use tokio::sync::watch;

use crate::audio_bus::AudioBus;

use super::audio::{resample_to_16k, rms, to_mono, RollingAudioWindow, TARGET_SAMPLE_RATE};
use super::model::{OfflineAsrModel, TimedTranscript, WordTiming};

const SPEECH_RMS_THRESHOLD: f32 = 0.0035;
const ENDPOINT_SILENCE: Duration = Duration::from_millis(1_500);
const MIN_FINAL_AUDIO_MS: usize = 500;
const KIRTAN_BASE_WINDOW_MS: usize = 4_000;
const KIRTAN_WINDOW_MS: usize = 8_000;
const KIRTAN_REFRESH_MS: usize = 400;
const WORD_EDGE_MS: u64 = 800;
const SPEECH_BASE_WINDOW_MS: usize = 3_000;
const SPEECH_MAX_WINDOW_MS: usize = 5_000;
const NORMAL_REFRESH_MS: usize = 450;
const FAST_REFRESH_MS: usize = 320;
const FAST_WORDS_PER_SECOND: f64 = 3.0;
const NORMAL_WORDS_PER_SECOND: f64 = 2.2;
const MIN_ROLLING_WINDOW_MS: usize = 2_000;
const WORD_FINAL_EDGE_HOLDBACK_MS: u64 = 800;
const WORD_MATCH_TOLERANCE_MS: u64 = 220;
const STABLE_WINDOW_COUNT: u8 = 3;
const TRACK_MAX_GAP_TICKS: u64 = 2;
const FINAL_CONTEXT_MS: u64 = 250;
const EXTENSION_CONTEXT_MS: u64 = 2_000;

#[derive(Debug, Clone, Serialize)]
pub struct OfflineTranscriptEvent {
    pub provider: &'static str,
    #[serde(rename = "final")]
    pub final_text: String,
    pub partial: String,
    pub end_ms: u64,
    pub word_timings: Vec<WordTiming>,
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
    kirtan_mode: bool,
    bus: AudioBus,
) -> Result<OfflineAsrStream, String> {
    let mut model = OfflineAsrModel::load(&resource_dir)?;
    let mut receiver = bus.subscribe();
    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

    let task = tauri::async_runtime::spawn(async move {
        let buffer_ms = if kirtan_mode {
            KIRTAN_WINDOW_MS
        } else {
            SPEECH_MAX_WINDOW_MS
        };
        let minimum_refresh_ms = if kirtan_mode { KIRTAN_REFRESH_MS } else { FAST_REFRESH_MS };
        println!(
            "Offline ASR profile={} window={}ms max_buffer={}ms refresh={}ms",
            if kirtan_mode { "kirtan" } else { "adaptive speech" },
            if kirtan_mode { KIRTAN_BASE_WINDOW_MS } else { SPEECH_MAX_WINDOW_MS },
            buffer_ms,
            minimum_refresh_ms,
        );
        let mut window = RollingAudioWindow::with_millis(buffer_ms, minimum_refresh_ms);
        let mut last_partial = String::new();
        let mut last_speech_at: Option<Instant> = None;
        let mut total_target_samples: u64 = 0;
        let mut pace_detector = SpeechPaceDetector::default();
        let mut word_finalizer = StableWordFinalizer::default();

        let transcribe_audio = |
            model: &mut OfflineAsrModel,
            audio: &[f32],
            window_start_ms: u64
        | {
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

                    let (base_window_ms, max_window_ms, refresh_ms) = if kirtan_mode {
                        (KIRTAN_BASE_WINDOW_MS, KIRTAN_WINDOW_MS, KIRTAN_REFRESH_MS)
                    } else if pace_detector.is_fast() {
                        (SPEECH_BASE_WINDOW_MS, SPEECH_MAX_WINDOW_MS, FAST_REFRESH_MS)
                    } else {
                        (SPEECH_BASE_WINDOW_MS + 500, SPEECH_MAX_WINDOW_MS, NORMAL_REFRESH_MS)
                    };
                    let minimum_ready_samples = TARGET_SAMPLE_RATE as usize * MIN_ROLLING_WINDOW_MS / 1000;
                    if window.should_decode_every_ms(refresh_ms)
                        && window.len() >= minimum_ready_samples
                    {
                        window.consume_decode_tick();
                        let now_ms = samples_to_ms(total_target_samples);
                        let base_audio = anchored_audio(
                            &window,
                            total_target_samples,
                            base_window_ms,
                            max_window_ms,
                            word_finalizer.finalized_through_ms(),
                        );
                        let base_start_ms = samples_to_ms(
                            total_target_samples.saturating_sub(base_audio.len() as u64),
                        );
                        let base_duration_ms = samples_to_ms(base_audio.len() as u64);
                        let base_result = transcribe_audio(&mut model, &base_audio, base_start_ms);
                        let should_extend = base_result.as_ref().is_ok_and(|transcript| {
                            word_near_window_edge(transcript, base_start_ms, base_duration_ms)
                        });
                        let result = if should_extend
                            && base_audio.len() < TARGET_SAMPLE_RATE as usize * max_window_ms / 1000
                        {
                            let extension_anchor = word_finalizer
                                .finalized_through_ms()
                                .map(|end_ms| end_ms.saturating_sub(EXTENSION_CONTEXT_MS));
                            let extended_audio = anchored_audio(
                                &window,
                                total_target_samples,
                                max_window_ms,
                                max_window_ms,
                                extension_anchor,
                            );
                            let extended_start_ms = samples_to_ms(
                                total_target_samples.saturating_sub(extended_audio.len() as u64),
                            );
                            println!(
                                "[ASR:window] extending {:.2}s -> {:.2}s to retain an edge word",
                                base_duration_ms as f64 / 1000.0,
                                extended_audio.len() as f64 / TARGET_SAMPLE_RATE as f64,
                            );
                            transcribe_audio(&mut model, &extended_audio, extended_start_ms)
                        } else {
                            base_result
                        };
                        match result {
                            Ok(transcript) if !transcript.text.is_empty() => {
                                if !kirtan_mode
                                    && pace_detector.observe(&transcript.words)
                                {
                                    println!(
                                        "[ASR:pace] switching to {} speech profile",
                                        if pace_detector.is_fast() { "fast" } else { "normal" },
                                    );
                                }
                                let newly_final = word_finalizer.observe(&transcript.words, now_ms);
                                let partial_words = word_finalizer.uncommitted_words(&transcript.words);
                                let mut word_timings = newly_final.clone();
                                word_timings.extend(partial_words.iter().cloned());
                                word_timings.sort_by_key(|word| word.start_ms);
                                let final_text = words_for_final_event(&newly_final);
                                let partial = words_as_text(&partial_words);
                                let partial_changed = partial != last_partial;
                                if !final_text.is_empty() || partial_changed {
                                    last_partial = partial.clone();
                                    let _ = app.emit("offline_transcript", OfflineTranscriptEvent {
                                        provider: "offline",
                                        final_text,
                                        partial,
                                        end_ms: samples_to_ms(total_target_samples),
                                        word_timings,
                                    });
                                }
                            }
                            Ok(_) => {}
                            Err(error) => eprintln!("Offline partial inference error: {error}"),
                        }
                    }

                    let endpoint_reached = last_speech_at
                        .map(|instant| instant.elapsed() >= ENDPOINT_SILENCE)
                        .unwrap_or(false);

                    if endpoint_reached && !window.is_empty() {
                        let final_max_window_ms = if kirtan_mode { KIRTAN_WINDOW_MS } else { SPEECH_MAX_WINDOW_MS };
                        let audio = anchored_audio(
                            &window,
                            total_target_samples,
                            final_max_window_ms,
                            final_max_window_ms,
                            word_finalizer.finalized_through_ms(),
                        );
                        if samples_to_ms(audio.len() as u64) >= MIN_FINAL_AUDIO_MS as u64 {
                            let window_start_sample =
                                total_target_samples
                                    .saturating_sub(audio.len() as u64);

                            let window_start_ms =
                                samples_to_ms(window_start_sample);

                            match transcribe_audio(
                                &mut model,
                                &audio,
                                window_start_ms,
                            ) {
                                Ok(transcript) => {
                                    let newly_final = word_finalizer.finish(&transcript.words);
                                    let final_text = words_for_final_event(&newly_final);
                                    let word_timings = newly_final;
                                    if !final_text.is_empty() {
                                        let _ = app.emit(
                                            "offline_transcript",
                                            OfflineTranscriptEvent {
                                                provider: "offline",
                                                final_text,
                                                partial: String::new(),
                                                end_ms: samples_to_ms(total_target_samples),
                                                word_timings,
                                            }
                                        );
                                    }
                                }
                                Err(error) => eprintln!("Offline final inference error: {error}"),
                            }
                        }

                        window.clear();
                        last_partial.clear();
                        word_finalizer.clear();
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

/// Keep a short, overlapping context before the last finalized word, then
/// include at least two seconds of fresh audio. This lets the recognizer move
/// forward as words become stable instead of repeatedly decoding a fixed-size
/// suffix from the beginning of the retained ring buffer.
fn anchored_audio(
    window: &RollingAudioWindow,
    total_samples: u64,
    base_window_ms: usize,
    max_window_ms: usize,
    finalized_through_ms: Option<u64>,
) -> Vec<f32> {
    let retained = window.snapshot();
    let retained_start = total_samples.saturating_sub(retained.len() as u64);
    let now_ms = samples_to_ms(total_samples);
    let max_start_ms = now_ms.saturating_sub(max_window_ms as u64);
    let min_start_ms = now_ms.saturating_sub(MIN_ROLLING_WINDOW_MS as u64);
    let preferred_start_ms = finalized_through_ms
        .map(|end_ms| end_ms.saturating_sub(FINAL_CONTEXT_MS))
        .unwrap_or_else(|| now_ms.saturating_sub(base_window_ms as u64));
    let start_ms = preferred_start_ms
        .min(min_start_ms)
        .max(max_start_ms)
        .max(samples_to_ms(retained_start));
    let start_sample = (start_ms as u128 * TARGET_SAMPLE_RATE as u128 / 1000) as u64;
    let skip = start_sample.saturating_sub(retained_start).min(retained.len() as u64) as usize;
    retained.into_iter().skip(skip).collect()
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
    /// Require the same word in three recent window hypotheses, then keep it
    /// provisional until it has moved away from the right edge of live audio.
    fn observe(&mut self, words: &[WordTiming], now_ms: u64) -> Vec<WordTiming> {
        self.tick = self.tick.saturating_add(1);
        self.last_hypothesis = self.uncommitted_words(words);
        let mut matched = vec![false; self.pending.len()];

        for word in words {
            if self.is_finalized_position(word) {
                continue;
            }

            let candidate_index = self.pending.iter().enumerate()
                .filter(|(index, candidate)| {
                    !matched[*index] && same_word_position(&candidate.timing, word)
                })
                .min_by_key(|(_, candidate)| candidate.timing.start_ms.abs_diff(word.start_ms))
                .map(|(index, _)| index);

            if let Some(index) = candidate_index {
                matched[index] = true;
                let candidate = &mut self.pending[index];
                let tick_gap = self.tick.saturating_sub(candidate.last_seen_tick);
                if normalize_asr_word(&candidate.timing.word) == normalize_asr_word(&word.word)
                    && tick_gap <= TRACK_MAX_GAP_TICKS
                {
                    candidate.stable_windows = candidate.stable_windows
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

        self.pending.sort_by_key(|candidate| candidate.timing.start_ms);
        self.finalize_ready(now_ms)
    }

    fn uncommitted_words(&self, words: &[WordTiming]) -> Vec<WordTiming> {
        words.iter()
            .filter(|word| !self.is_finalized_position(word))
            .cloned()
            .collect()
    }

    fn is_finalized_position(&self, word: &WordTiming) -> bool {
        self.finalized.iter().any(|finalized| same_word_position(finalized, word))
    }

    fn finalized_through_ms(&self) -> Option<u64> {
        self.finalized.iter().map(|word| word.end_ms.max(word.start_ms)).max()
    }

    fn finalize_ready(&mut self, now_ms: u64) -> Vec<WordTiming> {
        let mut ready = Vec::new();
        let mut remaining = Vec::with_capacity(self.pending.len());
        let mut blocked_by_earlier_word = false;

        for candidate in self.pending.drain(..) {
            let stale = self.tick.saturating_sub(candidate.last_seen_tick)
                > TRACK_MAX_GAP_TICKS;
            let mature = candidate.stable_windows >= STABLE_WINDOW_COUNT
                && now_ms.saturating_sub(candidate.timing.end_ms.max(candidate.timing.start_ms))
                    >= WORD_FINAL_EDGE_HOLDBACK_MS;

            if mature && !blocked_by_earlier_word {
                ready.push(candidate.timing);
            } else if !stale {
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
    fn finish(&mut self, last_words: &[WordTiming]) -> Vec<WordTiming> {
        let source = if last_words.is_empty() {
            self.last_hypothesis.clone()
        } else {
            last_words.to_vec()
        };
        let mut newly_final: Vec<_> = source.into_iter()
            .filter(|word| !self.is_finalized_position(word))
            .collect();
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
    if normalize_asr_word(&left.word) == normalize_asr_word(&right.word) {
        return start_distance <= WORD_MATCH_TOLERANCE_MS;
    }

    let left_duration = left.end_ms.saturating_sub(left.start_ms);
    let right_duration = right.end_ms.saturating_sub(right.start_ms);
    let overlap_ms = left.end_ms.min(right.end_ms)
        .saturating_sub(left.start_ms.max(right.start_ms));
    let shorter_duration = left_duration.min(right_duration);
    start_distance <= 100 || (
        shorter_duration > 0
            && shorter_duration <= 1_800
            && overlap_ms.saturating_mul(2) >= shorter_duration
    )
}

fn normalize_asr_word(word: &str) -> String {
    word.trim_matches(|character: char| {
        matches!(character, ',' | '.' | ';' | ':' | '!' | '?' | '।' | '॥')
    }).to_lowercase()
}

fn words_as_text(words: &[WordTiming]) -> String {
    words.iter().map(|word| word.word.as_str()).collect::<Vec<_>>().join(" ")
}

fn words_for_final_event(words: &[WordTiming]) -> String {
    let text = words_as_text(words);
    if text.is_empty() { text } else { format!("{text} ") }
}

fn word_near_window_edge(
    transcript: &TimedTranscript,
    window_start_ms: u64,
    duration_ms: u64,
) -> bool {
    transcript.words.last().is_some_and(|word| {
        let relative_start =
            word.start_ms.saturating_sub(window_start_ms);

        let relative_end =
            word.end_ms.saturating_sub(window_start_ms);

        relative_start.saturating_add(WORD_EDGE_MS)
            >= duration_ms
            || relative_end.saturating_add(300)
                >= duration_ms
    })
}

#[derive(Debug, Default)]
struct SpeechPaceDetector {
    fast: bool,
    fast_votes: u8,
    normal_votes: u8,
}

impl SpeechPaceDetector {
    fn is_fast(&self) -> bool {
        self.fast
    }

    fn observe(&mut self, timings: &[WordTiming]) -> bool {
        if timings.len() < 4 {
            return false;
        }

        let first = timings.first().map(|word| word.start_ms).unwrap_or(0);
        let last = timings.last().map(|word| word.start_ms).unwrap_or(first);
        let span_ms = last.saturating_sub(first);
        if span_ms == 0 {
            return false;
        }

        let previous = self.fast;
        let words_per_second = (timings.len() - 1) as f64 * 1000.0 / span_ms as f64;
        if words_per_second >= FAST_WORDS_PER_SECOND {
            self.fast_votes = self.fast_votes.saturating_add(1);
            self.normal_votes = 0;
            if self.fast_votes >= 2 {
                self.fast = true;
            }
        } else if words_per_second <= NORMAL_WORDS_PER_SECOND {
            self.normal_votes = self.normal_votes.saturating_add(1);
            self.fast_votes = 0;
            if self.normal_votes >= 3 {
                self.fast = false;
            }
        } else {
            self.fast_votes = 0;
            self.normal_votes = 0;
        }

        self.fast != previous
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
    fn word_is_final_after_three_stable_windows_and_edge_holdback() {
        let mut finalizer = StableWordFinalizer::default();
        let word = timed_word("ਪੂਰਾ", 1_000, 1_400);

        assert!(finalizer.observe(std::slice::from_ref(&word), 1_700).is_empty());
        assert!(finalizer.observe(std::slice::from_ref(&word), 1_800).is_empty());
        let newly_final = finalizer.observe(std::slice::from_ref(&word), 2_300);
        assert_eq!(words_as_text(&newly_final), "ਪੂਰਾ");
        assert!(finalizer.observe(&[word], 2_700).is_empty());
    }

    #[test]
    fn finalization_does_not_append_a_committed_word_twice() {
        let mut finalizer = StableWordFinalizer::default();
        let word = timed_word("ਹਰਿ", 1_000, 1_200);

        finalizer.observe(std::slice::from_ref(&word), 1_500);
        finalizer.observe(std::slice::from_ref(&word), 1_600);
        let committed = finalizer.observe(std::slice::from_ref(&word), 2_100);
        assert_eq!(committed.len(), 1);

        assert!(finalizer.observe(&[word.clone()], 2_500).is_empty());
        assert!(finalizer.finish(&[word]).is_empty());
    }

    #[test]
    fn silence_flushes_only_the_uncommitted_tail() {
        let mut finalizer = StableWordFinalizer::default();
        let committed = timed_word("ਹਰਿ", 1_000, 1_200);
        finalizer.observe(std::slice::from_ref(&committed), 1_500);
        finalizer.observe(std::slice::from_ref(&committed), 1_600);
        finalizer.observe(std::slice::from_ref(&committed), 2_100);

        let tail = timed_word("ਨਾਮ", 1_500, 1_700);
        let newly_final = finalizer.finish(&[committed, tail.clone()]);

        assert_eq!(newly_final, vec![tail]);
        assert_eq!(words_for_final_event(&newly_final), "ਨਾਮ ");
    }

    #[test]
    fn quick_repetitions_at_distinct_times_are_tracked_separately() {
        let mut finalizer = StableWordFinalizer::default();
        let first = timed_word("ਹਰਿ", 1_000, 1_180);
        let second = timed_word("ਹਰਿ", 1_450, 1_620);
        let words = [first, second];

        finalizer.observe(&words, 1_900);
        finalizer.observe(&words, 2_000);
        let newly_final = finalizer.observe(&words, 2_500);

        assert_eq!(newly_final.len(), 2);
        assert_eq!(words_as_text(&newly_final), "ਹਰਿ ਹਰਿ");
    }

    #[test]
    fn target_samples_convert_to_expected_time() {
        assert_eq!(samples_to_ms(16_000), 1_000);
        assert_eq!(samples_to_ms(65_563), 4_097);
    }

    #[test]
    fn anchored_decode_window_shrinks_after_final_words_but_keeps_two_seconds() {
        let mut window = RollingAudioWindow::with_millis(8_000, 400);
        window.push(&vec![0.1; TARGET_SAMPLE_RATE as usize * 8]);
        let total = TARGET_SAMPLE_RATE as u64 * 8;

        let initial = anchored_audio(&window, total, 4_000, 8_000, None);
        assert_eq!(initial.len(), TARGET_SAMPLE_RATE as usize * 4);

        let advanced = anchored_audio(&window, total, 4_000, 8_000, Some(6_000));
        assert_eq!(advanced.len(), TARGET_SAMPLE_RATE as usize * 2_250 / 1_000);

        let extended = anchored_audio(&window, total, 8_000, 8_000, Some(4_000));
        assert!(extended.len() > advanced.len());
        assert!(extended.len() < window.len());

        let caught_up = anchored_audio(&window, total, 4_000, 8_000, Some(8_000));
        assert_eq!(caught_up.len(), TARGET_SAMPLE_RATE as usize * MIN_ROLLING_WINDOW_MS / 1_000);
    }

    #[test]
    fn pace_detector_selects_fast_after_repeated_fast_windows() {
        let mut detector = SpeechPaceDetector::default();
        let fast_timings = fake_timings(10, 2_000);
        assert!(!detector.observe(&fast_timings));
        assert!(detector.observe(&fast_timings));
        assert!(detector.is_fast());
    }

    #[test]
    fn pace_detector_returns_to_normal_after_several_slow_windows() {
        let mut detector = SpeechPaceDetector::default();
        let fast_timings = fake_timings(10, 2_000);
        detector.observe(&fast_timings);
        detector.observe(&fast_timings);
        assert!(detector.is_fast());

        let normal_timings = fake_timings(6, 3_000);
        detector.observe(&normal_timings);
        detector.observe(&normal_timings);
        assert!(detector.observe(&normal_timings));
        assert!(!detector.is_fast());
    }

    fn fake_timings(count: usize, span_ms: u64) -> Vec<WordTiming> {
        (0..count).map(|index| WordTiming {
            word: format!("w{index}"),
            start_ms: index as u64 * span_ms / count as u64,
            end_ms: (index as u64 + 1) * span_ms / count as u64,
        }).collect()
    }
}
