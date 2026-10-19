use std::{fs, path::Path, time::Instant};

use ndarray::ArrayD;
use ndarray_npy::read_npy;
use ort::{session::Session, value::Tensor};
use sentencepiece_rs::SentencePieceProcessor;
use serde::Deserialize;

use super::beam::BeamDecoder;
use super::float_mode::CpuFloatMode;
use crate::offline_asr::model::{log_mel_frames, RuntimeConfig, WordTiming};

#[derive(Default)]
struct RunningFeatureNorm {
    sums: Vec<f64>,
    squares: Vec<f64>,
    frames: usize,
}

impl RunningFeatureNorm {
    fn extend(&mut self, values: &[f32], channels: usize, frames: usize) {
        self.sums.resize(channels, 0.0);
        self.squares.resize(channels, 0.0);
        for channel in 0..channels {
            for value in &values[channel * frames..(channel + 1) * frames] {
                let value = f64::from(*value);
                self.sums[channel] += value;
                self.squares[channel] += value * value;
            }
        }
        self.frames += frames;
    }

    fn normalize(&self, values: &mut [f32], frames: usize) {
        if self.frames == 0 {
            return;
        }
        for channel in 0..self.sums.len() {
            let mean = self.sums[channel] / self.frames as f64;
            let variance = if self.frames > 1 {
                ((self.squares[channel] - self.sums[channel] * mean) / (self.frames - 1) as f64)
                    .max(0.0)
            } else {
                0.0
            };
            let scale = variance.sqrt() as f32 + 1e-5;
            for value in &mut values[channel * frames..(channel + 1) * frames] {
                *value = (*value - mean as f32) / scale;
            }
        }
    }
}

#[derive(Clone, Deserialize)]
struct StreamingConfig {
    #[serde(flatten)]
    frontend: RuntimeConfig,
    format_version: u32,
    architecture: String,
    source_sha256: String,
    attention_cache_format: String,
    online_normalization: String,
    predictor_hidden_size: usize,
    encoder_hidden_size: usize,
    feature_left_context: usize,
    chunk_feature_frames: usize,
    encoded_frame_ms: u64,
    trained_right_context_ms: u64,
    cache_last_channel_shape: [usize; 4],
    cache_last_time_shape: [usize; 4],
}

#[derive(Clone)]
struct EncoderCache {
    channel: Vec<f32>,
    time: Vec<f32>,
    length: i64,
}

#[derive(Clone)]
pub(super) struct PredictorState {
    pub h: Vec<f32>,
    pub c: Vec<f32>,
    pub label: i64,
}

#[derive(Clone, Debug)]
pub(super) struct TimedToken {
    pub id: usize,
    pub time_ms: u64,
}

pub(super) struct EncodedChunk {
    pub values: Vec<f32>,
    pub stride: usize,
    pub frames: usize,
}

#[derive(Debug)]
struct HypothesisWord {
    timing: WordTiming,
    token_end: usize,
    following_committed_word: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct StreamingProfile {
    pub refresh_ms: usize,
    pub right_context_ms: u64,
    pub edge_context_ms: u64,
}

impl StreamingProfile {
    pub fn for_kirtan(kirtan: bool) -> Self {
        Self {
            refresh_ms: if kirtan { 680 } else { 340 },
            right_context_ms: 2_000,
            edge_context_ms: if kirtan { 6_000 } else { 3_000 },
        }
    }
}

#[derive(Default, Debug)]
pub struct StreamingUpdate {
    pub finalized: Vec<WordTiming>,
    pub partial: Vec<WordTiming>,
    pub end_ms: u64,
}

#[derive(Default, Debug)]
struct StageTimings {
    frontend_ms: f64,
    encoder_ms: f64,
    decoder_ms: f64,
}

/// The acoustic cache advances only over complete trained chunks. A preview
/// starts from that checkpoint, so repeated refreshes cannot append duplicates
/// or mutate the committed encoder/predictor prefix.
pub struct StreamingAsrModel {
    config: StreamingConfig,
    encoder: Session,
    decoder: Session,
    tokenizer: SentencePieceProcessor,
    mel: Vec<f32>,
    stft_window: Vec<f32>,
    cache: EncoderCache,
    predictor: PredictorState,
    tokens: Vec<TimedToken>,
    suppress_continuation: bool,
    audio: Vec<f32>,
    audio_start_sample: usize,
    log_mel: Vec<Vec<f32>>,
    log_mel_start_frame: usize,
    extracted_feature_frames: usize,
    segment_samples: usize,
    segment_start_samples: u64,
    committed_feature_frames: usize,
    pub committed_chunks: usize,
    timings: StageTimings,
    normalizer: RunningFeatureNorm,
    beam: Option<BeamDecoder>,
}

impl StreamingAsrModel {
    pub fn load(directory: &Path) -> Result<Self, String> {
        let _float_mode = CpuFloatMode::enter();
        let config: StreamingConfig = serde_json::from_slice(
            &fs::read(directory.join("runtime.json"))
                .map_err(|e| format!("Streaming runtime.json: {e}"))?,
        )
        .map_err(|e| format!("Invalid streaming runtime.json: {e}"))?;
        if config.format_version != 2
            || config.architecture != "cache_aware_conformer_rnnt"
            || config.attention_cache_format != "projected_key_value_concat"
            || config.online_normalization != "running_per_feature"
            || config.frontend.sample_rate != 16_000
            || config.trained_right_context_ms != 2_000
            || config.chunk_feature_frames == 0
            || config.feature_left_context % 4 != 0
            || config.cache_last_channel_shape[1] != 1
            || config.cache_last_time_shape[1] != 1
            || config.cache_last_channel_shape[3] != 2 * config.encoder_hidden_size
        {
            return Err("Unsupported streaming ASR tensor/context configuration".into());
        }
        let mel: ArrayD<f32> = read_npy(directory.join(&config.frontend.mel_filterbank))
            .map_err(|e| format!("Streaming mel filterbank: {e}"))?;
        let window: ArrayD<f32> = read_npy(directory.join(&config.frontend.stft_window))
            .map_err(|e| format!("Streaming STFT window: {e}"))?;
        if mel.len() != config.frontend.n_mels * (config.frontend.n_fft / 2 + 1)
            || window.len() != config.frontend.win_length
        {
            return Err("Streaming frontend arrays do not match runtime.json".into());
        }
        let encoder = Session::builder()
            .map_err(|e| e.to_string())?
            .with_intra_threads(1)
            .map_err(|e| e.to_string())?
            .with_intra_op_spinning(false)
            .map_err(|e| e.to_string())?
            .with_flush_to_zero()
            .map_err(|e| e.to_string())?
            .commit_from_file(directory.join(&config.frontend.encoder))
            .map_err(|e| format!("Load streaming encoder: {e}"))?;
        let decoder = Session::builder()
            .map_err(|e| e.to_string())?
            .with_intra_threads(1)
            .map_err(|e| e.to_string())?
            .with_intra_op_spinning(false)
            .map_err(|e| e.to_string())?
            .with_flush_to_zero()
            .map_err(|e| e.to_string())?
            .commit_from_file(directory.join(&config.frontend.decoder_joint))
            .map_err(|e| format!("Load streaming decoder: {e}"))?;
        let tokenizer = SentencePieceProcessor::open(directory.join(&config.frontend.tokenizer))
            .map_err(|e| format!("Load streaming tokenizer: {e}"))?;
        let cache = EncoderCache {
            channel: vec![0.0; config.cache_last_channel_shape.iter().product()],
            time: vec![0.0; config.cache_last_time_shape.iter().product()],
            length: 0,
        };
        let predictor = PredictorState {
            h: vec![0.0; config.predictor_hidden_size],
            c: vec![0.0; config.predictor_hidden_size],
            label: i64::from(config.frontend.predictor_start_id),
        };
        let log_mel = vec![Vec::new(); config.frontend.n_mels];
        let beam = Some(BeamDecoder::load(
            directory,
            config.predictor_hidden_size,
            config.encoder_hidden_size,
            config.frontend.joint_blank_id,
            config.frontend.max_symbols_per_step,
            config.encoded_frame_ms,
        )?);
        Ok(Self {
            beam,
            config,
            encoder,
            decoder,
            tokenizer,
            cache,
            predictor,
            mel: mel.into_raw_vec_and_offset().0,
            stft_window: window.into_raw_vec_and_offset().0,
            tokens: Vec::new(),
            suppress_continuation: false,
            audio: Vec::new(),
            audio_start_sample: 0,
            segment_samples: 0,
            segment_start_samples: 0,
            log_mel,
            log_mel_start_frame: 0,
            extracted_feature_frames: 0,
            committed_feature_frames: 0,
            committed_chunks: 0,
            timings: StageTimings::default(),
            normalizer: RunningFeatureNorm::default(),
        })
    }

    pub fn push_audio(&mut self, samples: &[f32]) {
        self.audio.extend_from_slice(samples);
        self.segment_samples = self.segment_samples.saturating_add(samples.len());
    }

    pub fn end_ms(&self) -> u64 {
        (self.segment_start_samples + self.segment_samples as u64) * 1_000
            / u64::from(self.config.frontend.sample_rate)
    }

    pub fn has_audio(&self) -> bool {
        self.segment_samples > 0
    }

    pub fn startup_delay_samples(&self) -> usize {
        // Align refreshes with complete centered-STFT feature frames. At
        // 16 kHz this adds 6 ms once, avoiding an almost-full preview followed
        // immediately by a second decode of the same complete 2.04 s chunk.
        (self.config.frontend.n_fft / 2).saturating_sub(self.config.frontend.hop_length)
    }

    pub fn reset_segment(&mut self) {
        self.segment_start_samples += self.segment_samples as u64;
        self.segment_samples = 0;
        self.audio_start_sample = 0;
        self.committed_feature_frames = 0;
        self.extracted_feature_frames = 0;
        self.normalizer = RunningFeatureNorm::default();
        self.log_mel_start_frame = 0;
        for channel in &mut self.log_mel {
            channel.clear();
        }
        self.cache.channel.fill(0.0);
        self.cache.time.fill(0.0);
        self.cache.length = 0;
        self.predictor.h.fill(0.0);
        self.predictor.c.fill(0.0);
        self.predictor.label = i64::from(self.config.frontend.predictor_start_id);
        self.tokens.clear();
        self.audio.clear();
        self.suppress_continuation = false;
        if let Some(beam) = &mut self.beam {
            beam.reset();
        }
    }

    pub fn update(
        &mut self,
        profile: StreamingProfile,
        flush: bool,
    ) -> Result<StreamingUpdate, String> {
        let _float_mode = CpuFloatMode::enter();
        self.timings = StageTimings::default();
        let frontend_started = Instant::now();
        let mut hypothesis = self.tokens.clone();
        if !self.audio.is_empty() {
            let hop = self.config.frontend.hop_length;
            let total_available = if flush {
                self.segment_samples / hop + 1
            } else if self.segment_samples < self.config.frontend.n_fft / 2 {
                0
            } else {
                (self.segment_samples - self.config.frontend.n_fft / 2) / hop + 1
            };
            let new_frames = total_available.saturating_sub(self.extracted_feature_frames);
            if new_frames > 0 {
                let first = self.extracted_feature_frames - self.audio_start_sample / hop;
                let (new_values, count) = log_mel_frames(
                    &self.config.frontend,
                    &self.mel,
                    &self.stft_window,
                    &self.audio,
                    first,
                    new_frames,
                )?;
                if count != new_frames {
                    return Err("Streaming frontend is missing new feature frames".into());
                }
                self.normalizer
                    .extend(&new_values, self.config.frontend.n_mels, count);
                for (index, channel) in self.log_mel.iter_mut().enumerate() {
                    channel.extend_from_slice(&new_values[index * count..(index + 1) * count]);
                }
                self.extracted_feature_frames += count;
            }
            let feature_frames = self.log_mel[0].len();
            let feature_start = self.log_mel_start_frame;
            let mut features: Vec<_> = self.log_mel.iter().flatten().copied().collect();
            self.normalizer.normalize(&mut features, feature_frames);
            self.timings.frontend_ms = frontend_started.elapsed().as_secs_f64() * 1_000.0;
            let chunk_size = self.config.chunk_feature_frames;
            let committed_before = self.committed_chunks;
            while total_available.saturating_sub(self.committed_feature_frames) >= chunk_size {
                let start_ms = self.feature_time_ms(self.committed_feature_frames);
                let input =
                    self.feature_chunk(&features, feature_frames, feature_start, chunk_size)?;
                let encoded =
                    self.encode(input, chunk_size + self.config.feature_left_context, true)?;
                self.tokens = self.decode_hypothesis(&encoded, start_ms, true)?;
                self.committed_feature_frames += chunk_size;
                self.committed_chunks += 1;
            }
            hypothesis = self.tokens.clone();
            let remaining = total_available.saturating_sub(self.committed_feature_frames);
            let preview_step = profile.refresh_ms * self.config.frontend.sample_rate as usize
                / (1_000 * self.config.frontend.hop_length);
            if remaining > 0
                && (flush || self.committed_chunks == committed_before || remaining >= preview_step)
            {
                let input =
                    self.feature_chunk(&features, feature_frames, feature_start, remaining)?;
                let start_ms = self.feature_time_ms(self.committed_feature_frames);
                let encoded =
                    self.encode(input, remaining + self.config.feature_left_context, false)?;
                hypothesis = self.decode_hypothesis(&encoded, start_ms, false)?;
            }
        }
        if flush {
            if let Some(beam) = &mut self.beam {
                hypothesis = beam.finish()?;
            }
        }
        let words = self.words(&hypothesis)?;
        let now_ms = self.end_ms();
        let mut update = StreamingUpdate {
            end_ms: now_ms,
            ..Default::default()
        };
        let mut finalized_tokens = 0;
        for word in &words {
            let committed = word.token_end <= self.tokens.len()
                && hypothesis[..word.token_end]
                    .iter()
                    .zip(&self.tokens)
                    .all(|(a, b)| a.id == b.id);
            let age = now_ms.saturating_sub(word.timing.end_ms);
            let ready =
                flush || (committed && word_ready(age, word.following_committed_word, profile));
            if !ready {
                break;
            }
            update.finalized.push(word.timing.clone());
            finalized_tokens = word.token_end;
            if !flush && !word.following_committed_word && finalized_tokens == self.tokens.len() {
                // A bounded edge hold expired. Keep predictor continuity but do
                // not show late continuation pieces as a new duplicate word.
                self.suppress_continuation = true;
            }
        }
        update.partial = words
            .into_iter()
            .skip(update.finalized.len())
            .map(|word| word.timing)
            .collect();
        let settled = finalized_tokens.min(self.tokens.len());
        if let Some(beam) = &mut self.beam {
            if flush {
                beam.reset();
            } else {
                beam.settle(&self.tokens[..settled], self.suppress_continuation);
            }
        }
        self.tokens.drain(..settled);
        // Cache raw log-mel features for normalization; compute each FFT only
        // once. Retain only enough waveform for the next centered STFT frame.
        let retain_frame = self
            .committed_feature_frames
            .saturating_sub(self.config.feature_left_context);
        let drop_frames = retain_frame
            .saturating_sub(self.log_mel_start_frame)
            .min(self.log_mel[0].len());
        for channel in &mut self.log_mel {
            channel.drain(..drop_frames);
        }
        self.log_mel_start_frame += drop_frames;
        let retain_sample =
            self.extracted_feature_frames.saturating_sub(4) * self.config.frontend.hop_length;
        let drop_samples = retain_sample
            .saturating_sub(self.audio_start_sample)
            .min(self.audio.len());
        self.audio.drain(..drop_samples);
        self.audio_start_sample += drop_samples;
        Ok(update)
    }

    fn feature_time_ms(&self, frame: usize) -> u64 {
        (self.segment_start_samples + (frame * self.config.frontend.hop_length) as u64) * 1_000
            / u64::from(self.config.frontend.sample_rate)
    }

    fn feature_chunk(
        &self,
        values: &[f32],
        frames: usize,
        first: usize,
        count: usize,
    ) -> Result<Vec<f32>, String> {
        let left = self.config.feature_left_context;
        let width = left + count;
        let mut chunk = vec![0.0; self.config.frontend.n_mels * width];
        for channel in 0..self.config.frontend.n_mels {
            for position in 0..width {
                let absolute = self.committed_feature_frames as i64 + position as i64 - left as i64;
                if absolute < 0 {
                    continue;
                }
                let frame = (absolute as usize)
                    .checked_sub(first)
                    .ok_or("Streaming frontend discarded unprocessed features")?;
                if frame >= frames {
                    return Err("Streaming feature input exceeds available frames".into());
                }
                chunk[channel * width + position] = values[channel * frames + frame];
            }
        }
        Ok(chunk)
    }

    fn encode(
        &mut self,
        values: Vec<f32>,
        frames: usize,
        commit: bool,
    ) -> Result<EncodedChunk, String> {
        let started = Instant::now();
        let input = Tensor::<f32>::from_array((
            [1, self.config.frontend.n_mels, frames],
            values.into_boxed_slice(),
        ))
        .map_err(|e| e.to_string())?;
        let lengths = Tensor::<i64>::from_array(([1], vec![frames as i64].into_boxed_slice()))
            .map_err(|e| e.to_string())?;
        let channel = Tensor::<f32>::from_array((
            self.config.cache_last_channel_shape,
            self.cache.channel.clone().into_boxed_slice(),
        ))
        .map_err(|e| e.to_string())?;
        let time = Tensor::<f32>::from_array((
            self.config.cache_last_time_shape,
            self.cache.time.clone().into_boxed_slice(),
        ))
        .map_err(|e| e.to_string())?;
        let cache_len =
            Tensor::<i64>::from_array(([1], vec![self.cache.length].into_boxed_slice()))
                .map_err(|e| e.to_string())?;
        let result = self
            .encoder
            .run(ort::inputs! {
                "audio_signal" => input, "length" => lengths,
                "cache_last_channel" => channel, "cache_last_time" => time,
                "cache_last_channel_len" => cache_len,
            })
            .map_err(|e| format!("Streaming encoder inference: {e}"))?;
        let (shape, values) = result["outputs"]
            .try_extract_tensor::<f32>()
            .map_err(|e| e.to_string())?;
        if shape.len() != 3 || shape[0] != 1 || shape[1] != self.config.encoder_hidden_size as i64 {
            return Err(format!("Unexpected streaming encoder shape: {shape:?}"));
        }
        let stride = shape[2] as usize;
        let (_, length) = result["encoded_lengths"]
            .try_extract_tensor::<i64>()
            .map_err(|e| e.to_string())?;
        let encoded = EncodedChunk {
            values: values.to_vec(),
            stride,
            frames: (length[0].max(0) as usize).min(stride),
        };
        if commit {
            let (_, channel) = result["cache_last_channel_next"]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?;
            let (_, time) = result["cache_last_time_next"]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?;
            let (_, lengths) = result["cache_last_channel_next_len"]
                .try_extract_tensor::<i64>()
                .map_err(|e| e.to_string())?;
            if channel.len() != self.cache.channel.len() || time.len() != self.cache.time.len() {
                return Err("Streaming encoder returned incompatible caches".into());
            }
            self.cache.channel.copy_from_slice(channel);
            self.cache.time.copy_from_slice(time);
            self.cache.length = lengths[0];
        }
        self.timings.encoder_ms += started.elapsed().as_secs_f64() * 1_000.0;
        Ok(encoded)
    }

    fn decode(
        &mut self,
        encoded: &EncodedChunk,
        start_ms: u64,
        state: &mut PredictorState,
    ) -> Result<Vec<TimedToken>, String> {
        let started = Instant::now();
        let hidden = self.config.predictor_hidden_size;
        let mut tokens = Vec::new();
        for frame in 0..encoded.frames {
            let values: Vec<_> = (0..self.config.encoder_hidden_size)
                .map(|channel| encoded.values[channel * encoded.stride + frame])
                .collect();
            for _ in 0..self.config.frontend.max_symbols_per_step {
                let input = Tensor::<f32>::from_array((
                    [1, self.config.encoder_hidden_size, 1],
                    values.clone().into_boxed_slice(),
                ))
                .map_err(|e| e.to_string())?;
                let target =
                    Tensor::<i64>::from_array(([1, 1], vec![state.label].into_boxed_slice()))
                        .map_err(|e| e.to_string())?;
                let h =
                    Tensor::<f32>::from_array(([1, 1, hidden], state.h.clone().into_boxed_slice()))
                        .map_err(|e| e.to_string())?;
                let c =
                    Tensor::<f32>::from_array(([1, 1, hidden], state.c.clone().into_boxed_slice()))
                        .map_err(|e| e.to_string())?;
                let result = self
                    .decoder
                    .run(ort::inputs! {
                        "encoder_outputs" => input, "targets" => target,
                        "input_states_1" => h, "input_states_2" => c,
                    })
                    .map_err(|e| format!("Streaming RNNT inference: {e}"))?;
                let (_, logits) = result["outputs"]
                    .try_extract_tensor::<f32>()
                    .map_err(|e| e.to_string())?;
                let label = logits
                    .iter()
                    .enumerate()
                    .max_by(|a, b| a.1.total_cmp(b.1))
                    .map(|(index, _)| index)
                    .ok_or("Empty RNNT logits")?;
                if label == self.config.frontend.joint_blank_id {
                    break;
                }
                if label >= self.config.frontend.local_vocab_size {
                    return Err("Invalid Punjabi RNNT label".into());
                }
                let (_, h) = result["output_states_1"]
                    .try_extract_tensor::<f32>()
                    .map_err(|e| e.to_string())?;
                let (_, c) = result["output_states_2"]
                    .try_extract_tensor::<f32>()
                    .map_err(|e| e.to_string())?;
                state.h.copy_from_slice(h);
                state.c.copy_from_slice(c);
                state.label = label as i64;
                tokens.push(TimedToken {
                    id: label,
                    time_ms: start_ms + frame as u64 * self.config.encoded_frame_ms,
                });
            }
        }
        self.timings.decoder_ms += started.elapsed().as_secs_f64() * 1_000.0;
        Ok(tokens)
    }

    fn decode_hypothesis(
        &mut self,
        encoded: &EncodedChunk,
        start_ms: u64,
        commit: bool,
    ) -> Result<Vec<TimedToken>, String> {
        if let Some(beam) = &mut self.beam {
            let started = Instant::now();
            let tokens = beam.advance(encoded, start_ms, commit)?;
            if commit {
                self.predictor = beam.best_predictor();
            }
            self.timings.decoder_ms += started.elapsed().as_secs_f64() * 1_000.0;
            return Ok(tokens);
        }
        // Retained as an independent reference for greedy split-graph parity.
        let mut predictor = self.predictor.clone();
        let fresh = self.decode(encoded, start_ms, &mut predictor)?;
        let mut tokens = self.tokens.clone();
        let mut suppress = self.suppress_continuation;
        append_tokens(&self.tokenizer, &mut tokens, fresh, &mut suppress)?;
        if commit {
            self.predictor = predictor;
            self.suppress_continuation = suppress;
        }
        Ok(tokens)
    }

    fn words(&self, tokens: &[TimedToken]) -> Result<Vec<HypothesisWord>, String> {
        let mut groups = Vec::new();
        let mut start = 0;
        for (index, token) in tokens.iter().enumerate() {
            let piece = self
                .tokenizer
                .id_to_piece(token.id)
                .map_err(|e| e.to_string())?;
            if index > start && piece.starts_with('▁') {
                groups.push((start, index));
                start = index;
            }
        }
        if start < tokens.len() {
            groups.push((start, tokens.len()));
        }
        let mut words = Vec::new();
        for (start, end) in groups {
            let ids: Vec<_> = tokens[start..end].iter().map(|token| token.id).collect();
            let text = self.tokenizer.decode_ids(&ids).map_err(|e| e.to_string())?;
            let text = text.trim();
            if text.is_empty() {
                continue;
            }
            words.push(HypothesisWord {
                timing: WordTiming {
                    word: text.to_string(),
                    start_ms: tokens[start].time_ms,
                    end_ms: (tokens[end - 1].time_ms + self.config.encoded_frame_ms)
                        .min(self.end_ms()),
                },
                token_end: end,
                following_committed_word: false,
            });
        }
        for index in 0..words.len().saturating_sub(1) {
            words[index].timing.end_ms = words[index]
                .timing
                .end_ms
                .min(words[index + 1].timing.start_ms);
            words[index].following_committed_word = words[index].token_end < self.tokens.len();
        }
        Ok(words)
    }
}

fn append_tokens(
    tokenizer: &SentencePieceProcessor,
    tokens: &mut Vec<TimedToken>,
    incoming: Vec<TimedToken>,
    suppress: &mut bool,
) -> Result<(), String> {
    for token in incoming {
        if *suppress {
            if !tokenizer
                .id_to_piece(token.id)
                .map_err(|e| e.to_string())?
                .starts_with('▁')
            {
                continue;
            }
            *suppress = false;
        }
        tokens.push(token);
    }
    Ok(())
}

fn word_ready(age_ms: u64, following_word: bool, profile: StreamingProfile) -> bool {
    // Reserve one refresh interval so the word commits by the edge deadline.
    (following_word && age_ms >= profile.right_context_ms)
        || age_ms
            >= profile
                .edge_context_ms
                .saturating_sub(profile.refresh_ms as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{path::PathBuf, process::Command, time::Instant};

    #[test]
    fn running_normalization_keeps_batch_statistics_after_feature_history_is_discarded() {
        let mut norm = RunningFeatureNorm::default();
        norm.extend(&[1.0, 3.0, 10.0, 14.0], 2, 2);
        norm.extend(&[5.0, 7.0, 18.0, 22.0], 2, 2);
        let mut tail = vec![5.0, 7.0, 18.0, 22.0];
        norm.normalize(&mut tail, 2);
        let mut full = vec![1.0, 3.0, 5.0, 7.0, 10.0, 14.0, 18.0, 22.0];
        crate::offline_asr::model::normalize_per_feature(&mut full, 2, 4);
        for (actual, expected) in tail.iter().zip([full[2], full[3], full[6], full[7]]) {
            assert!((*actual - expected).abs() < 1e-5);
        }
    }

    fn resources() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/streaming_asr")
    }

    fn fixture(name: &str) -> Vec<f32> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../test_audios")
            .join(name);
        let decoded = Command::new("ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(path)
            .args(["-f", "f32le", "-ac", "1", "-ar", "16000", "pipe:1"])
            .output()
            .expect("ffmpeg");
        assert!(
            decoded.status.success(),
            "{}",
            String::from_utf8_lossy(&decoded.stderr)
        );
        decoded
            .stdout
            .chunks_exact(4)
            .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap()))
            .collect()
    }

    fn text(words: &[WordTiming]) -> String {
        words
            .iter()
            .map(|word| word.word.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn distance<T: Eq>(reference: &[T], hypothesis: &[T]) -> usize {
        let mut previous: Vec<usize> = (0..=hypothesis.len()).collect();
        for (row, expected) in reference.iter().enumerate() {
            let mut current = vec![row + 1; hypothesis.len() + 1];
            for (column, actual) in hypothesis.iter().enumerate() {
                current[column + 1] = (previous[column + 1] + 1)
                    .min(current[column] + 1)
                    .min(previous[column] + usize::from(expected != actual));
            }
            previous = current;
        }
        previous[hypothesis.len()]
    }

    #[test]
    #[ignore = "loads ONNX assets to compare cached split-graph greedy with the original combined graph"]
    fn cached_predictor_preserves_the_original_greedy_labels() {
        let samples = fixture("darbar_sahib_kirtan.mp3");
        let mut cached = StreamingAsrModel::load(&resources()).unwrap();
        cached.beam.as_mut().unwrap().use_greedy();
        let mut original = StreamingAsrModel::load(&resources()).unwrap();
        original.beam = None;
        let profile = StreamingProfile::for_kirtan(true);
        let count = 16_000 * 5;
        cached.push_audio(&samples[..count]);
        original.push_audio(&samples[..count]);
        let a = cached.update(profile, false).unwrap();
        let b = original.update(profile, false).unwrap();
        assert_eq!(text(&a.finalized), text(&b.finalized));
        assert_eq!(text(&a.partial), text(&b.partial));
        assert_eq!(cached.predictor.label, original.predictor.label);
        for (a, b) in cached.predictor.h.iter().zip(&original.predictor.h) {
            assert!((a - b).abs() < 1e-5);
        }
    }

    #[test]
    #[ignore = "loads the ONNX assets and verifies preview/commit state isolation; requires ffmpeg"]
    fn previews_do_not_change_the_committed_encoder_or_predictor_cache() {
        let mut previewed = StreamingAsrModel::load(&resources()).unwrap();
        let mut direct = StreamingAsrModel::load(&resources()).unwrap();
        let samples = fixture("darbar_sahib_kirtan.mp3");
        let profile = StreamingProfile::for_kirtan(true);
        let step = 16_000 * profile.refresh_ms / 1_000;
        for (index, chunk) in samples[..step * 4].chunks(step).enumerate() {
            previewed.push_audio(chunk);
            previewed.update(profile, false).unwrap();
            assert_eq!(previewed.committed_chunks, usize::from(index == 3));
        }
        direct.push_audio(&samples[..step * 4]);
        direct.update(profile, false).unwrap();
        for (left, right) in previewed.cache.channel.iter().zip(&direct.cache.channel) {
            assert!(
                (left - right).abs() <= 1e-5,
                "preview mutated encoder state"
            );
        }
        assert_eq!(previewed.predictor.label, direct.predictor.label);
        assert_eq!(previewed.predictor.h, direct.predictor.h);
        assert_eq!(previewed.predictor.c, direct.predictor.c);
        assert_eq!(
            previewed
                .tokens
                .iter()
                .map(|token| token.id)
                .collect::<Vec<_>>(),
            direct
                .tokens
                .iter()
                .map(|token| token.id)
                .collect::<Vec<_>>()
        );
        let clock = previewed.end_ms();
        previewed.reset_segment();
        assert_eq!(previewed.end_ms(), clock);
        assert!(previewed.cache.channel.iter().all(|value| *value == 0.0));
        assert_eq!(previewed.cache.length, 0);
        assert!(previewed.tokens.is_empty());
    }

    #[test]
    #[ignore = "transcribes every complete MP3 fixture with the production cache and endpoint path; requires ffmpeg"]
    fn full_recordings_stream_with_bounded_caches_and_append_only_final_text() {
        use crate::streaming_asr::service::{push_chunk, ENDPOINT_SILENCE_MS};
        let mut reports = Vec::new();
        for (name, kirtan) in [
            ("darbar_sahib_kirtan.mp3", true),
            ("asa_ki_vaar_kirtan.mp3", true),
            ("sukhmani_sahib_paath.mp3", false),
            ("fast_akhand_paath.mp3", false),
        ] {
            if std::env::var("BANI_TEST_FIXTURE").is_ok_and(|only| only != name) {
                continue;
            }
            let samples = fixture(name);
            let profile = StreamingProfile::for_kirtan(kirtan);
            let step = 16_000 * profile.refresh_ms / 1_000;
            let mut model = StreamingAsrModel::load(&resources()).unwrap();
            let mut final_words = Vec::new();
            let mut last_speech = None;
            let mut elapsed = Vec::new();
            let mut final_lags = Vec::new();
            let mut peak_features = 0;
            let mut stage_ms = [0.0; 3];
            let started = Instant::now();
            let mut position = 0;
            let mut first_refresh = true;
            while position < samples.len() {
                let count = step
                    + if first_refresh {
                        model.startup_delay_samples()
                    } else {
                        0
                    };
                let end = (position + count).min(samples.len());
                let chunk = &samples[position..end];
                position = end;
                push_chunk(&mut model, chunk, 16_000, 1, &mut last_speech);
                if !model.has_audio() {
                    first_refresh = true;
                    continue;
                }
                first_refresh = false;
                let endpoint = last_speech
                    .is_some_and(|end| model.end_ms().saturating_sub(end) >= ENDPOINT_SILENCE_MS);
                let update_start = Instant::now();
                let update = model.update(profile, endpoint).unwrap();
                stage_ms[0] += model.timings.frontend_ms;
                stage_ms[1] += model.timings.encoder_ms;
                stage_ms[2] += model.timings.decoder_ms;
                elapsed.push(update_start.elapsed().as_secs_f64() * 1_000.0);
                if !endpoint {
                    for word in &update.finalized {
                        let lag = update.end_ms.saturating_sub(word.end_ms);
                        assert!(
                            lag >= profile.right_context_ms,
                            "word finalized before its right context"
                        );
                        assert!(
                            lag <= profile.edge_context_ms,
                            "word exceeded its edge hold: {} lag={lag}",
                            word.word
                        );
                        final_lags.push(lag);
                    }
                }
                final_words.extend(update.finalized);
                let visible: Vec<_> = final_words.iter().chain(update.partial.iter()).collect();
                assert!(
                    visible
                        .windows(2)
                        .all(|pair| pair[1].start_ms >= pair[0].end_ms),
                    "overlapping streaming words in {name}: {visible:?}"
                );
                peak_features = peak_features.max(model.log_mel[0].len());
                assert!(
                    model.log_mel[0].len()
                        <= model.config.feature_left_context + model.config.chunk_feature_frames,
                    "unbounded frontend cache"
                );
                assert!(
                    model.audio.len() <= 1_280,
                    "old waveform was retained after feature extraction"
                );
                if endpoint {
                    model.reset_segment();
                    last_speech = None;
                    first_refresh = true;
                }
            }
            final_words.extend(model.update(profile, true).unwrap().finalized);
            let live_elapsed = started.elapsed().as_secs_f64();
            assert!(!final_words.is_empty(), "no transcript for {name}");
            assert!(final_words
                .windows(2)
                .all(|pair| pair[1].start_ms >= pair[0].end_ms));
            assert!(model.committed_chunks > 0, "encoder cache never advanced");
            let live = text(&final_words);
            let mut batch_model = StreamingAsrModel::load(&resources()).unwrap();
            batch_model.push_audio(&samples);
            let batch = text(&batch_model.update(profile, true).unwrap().finalized);
            let reference_words: Vec<_> = batch.split_whitespace().collect();
            let live_words: Vec<_> = live.split_whitespace().collect();
            let reference_chars: Vec<_> = batch.chars().filter(|c| !c.is_whitespace()).collect();
            let live_chars: Vec<_> = live.chars().filter(|c| !c.is_whitespace()).collect();
            elapsed.sort_by(f64::total_cmp);
            final_lags.sort_unstable();
            let report = serde_json::json!({
                "decoding": std::env::var("BANI_ASR_DECODING").unwrap_or_else(|_| "kenlm".into()),
                "beam_width": std::env::var("BANI_ASR_BEAM_WIDTH").unwrap_or_else(|_| "4".into()),
                "lm_weight": std::env::var("BANI_ASR_LM_WEIGHT").unwrap_or_else(|_| "0.3".into()),
                "checkpoint_sha256": model.config.source_sha256,
                "precision": "float32", "attention_cache": model.config.attention_cache_format,
                "online_normalization": model.config.online_normalization,
                "stage_seconds": {"frontend": stage_ms[0] / 1_000.0, "encoder": stage_ms[1] / 1_000.0, "decoder": stage_ms[2] / 1_000.0},
                "comparison": "live versus batch feature normalization through the same streaming ONNX model",
                "fixture": name, "profile": if kirtan { "kirtan" } else { "sehaj_paath" },
                "refresh_ms": profile.refresh_ms, "right_context_ms": profile.right_context_ms,
                "edge_max_ms": profile.edge_context_ms, "duration_s": samples.len() as f64 / 16_000.0,
                "live_seconds": live_elapsed, "live_rtf": live_elapsed / (samples.len() as f64 / 16_000.0),
                "p95_update_ms": elapsed.get((elapsed.len() * 95 / 100).min(elapsed.len().saturating_sub(1))),
                "maximum_final_lag_ms": final_lags.last(), "encoder_chunks": model.committed_chunks,
                "peak_cached_feature_frames": peak_features, "words": live_words.len(),
                "batch_words": reference_words.len(),
                "wer_vs_batch": distance(&reference_words, &live_words) as f64 / reference_words.len().max(1) as f64,
                "cer_vs_batch": distance(&reference_chars, &live_chars) as f64 / reference_chars.len().max(1) as f64,
                "transcript": live, "batch_transcript": batch,
            });
            println!("STREAMING_RESULT {report}");
            if name == "darbar_sahib_kirtan.mp3" {
                let normalized = live.replace("ਕ੍ਰਿਪਾ", "ਕਿਰਪਾ");
                assert!(
                    normalized.matches("ਕਿਰਪਾ ਪ੍ਰਭ").count() >= 2,
                    "Darbar Sahib repeated opening phrases were lost: {normalized}"
                );
                assert!(
                    normalized.matches("ਪੂਰਨ ਗੋਪਾਲ").count() >= 2,
                    "Darbar Sahib repeated refrain was lost: {normalized}"
                );
            }
            if name == "sukhmani_sahib_paath.mp3" {
                assert!(
                    live_words.len() >= 50,
                    "Sukhmani paath dropped most words: {live}"
                );
            }
            reports.push(report);
        }
        if let Ok(path) = std::env::var("BANI_STREAMING_REPORT") {
            if let Some(parent) = Path::new(&path).parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(path, serde_json::to_string_pretty(&reports).unwrap() + "\n").unwrap();
        }
    }

    #[test]
    fn normal_words_get_two_seconds_and_edge_holds_are_bounded_per_mode() {
        let kirtan = StreamingProfile::for_kirtan(true);
        let paath = StreamingProfile::for_kirtan(false);
        assert_eq!(kirtan.refresh_ms, 680);
        assert_eq!(paath.refresh_ms, 340);
        for profile in [kirtan, paath] {
            assert!(!word_ready(1_999, true, profile));
            assert!(word_ready(2_000, true, profile));
            assert!(!word_ready(2_000, false, profile));
            let deadline_refresh = profile.edge_context_ms - profile.refresh_ms as u64;
            assert!(!word_ready(deadline_refresh - 1, false, profile));
            assert!(word_ready(deadline_refresh, false, profile));
        }
    }
}
