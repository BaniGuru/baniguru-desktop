use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use ndarray::{Array1, ArrayD};
use ndarray_npy::read_npy;
use ort::{session::Session, value::Tensor};
use rustfft::{num_complex::Complex32, FftPlanner};
use sentencepiece_rs::SentencePieceProcessor;
use serde::Deserialize;
use serde::Serialize;

const LOG_ZERO_GUARD_DEFAULT: f32 = 5.960_464_5e-8;
const NORMALIZE_EPSILON: f32 = 1e-5;
const RNNT_HIDDEN_SIZE: usize = 640;

#[derive(Debug, Clone, Deserialize)]
pub struct RuntimeConfig {
    #[serde(default = "default_sample_rate")]
    pub sample_rate: u32,
    #[serde(default = "default_n_fft")]
    pub n_fft: usize,
    #[serde(default = "default_win_length")]
    pub win_length: usize,
    #[serde(default = "default_hop_length")]
    pub hop_length: usize,
    #[serde(default = "default_n_mels", alias = "nfilt")]
    pub n_mels: usize,
    #[serde(default = "default_preemph")]
    pub preemph: f32,
    #[serde(default = "default_log_zero_guard")]
    pub log_zero_guard_value: f32,
    #[serde(default = "default_local_vocab", alias = "vocab_per_language")]
    pub local_vocab_size: usize,
    #[serde(default = "default_joint_blank")]
    pub joint_blank_id: usize,
    #[serde(default = "default_predictor_start", alias = "predictor_blank_id")]
    pub predictor_start_id: i32,
    #[serde(default = "default_max_symbols")]
    pub max_symbols_per_step: usize,
    pub encoder: String,
    pub decoder_joint: String,
    pub tokenizer: String,
    pub mel_filterbank: String,
    pub stft_window: String,
}

fn default_sample_rate() -> u32 { 16_000 }
fn default_n_fft() -> usize { 512 }
fn default_win_length() -> usize { 400 }
fn default_hop_length() -> usize { 160 }
fn default_n_mels() -> usize { 80 }
fn default_preemph() -> f32 { 0.97 }
fn default_log_zero_guard() -> f32 { LOG_ZERO_GUARD_DEFAULT }
fn default_local_vocab() -> usize { 256 }
fn default_joint_blank() -> usize { 256 }
fn default_predictor_start() -> i32 { 5632 }
fn default_max_symbols() -> usize { 5 }

pub struct OfflineAsrModel {
    config: RuntimeConfig,
    encoder: Session,
    decoder: Session,
    tokenizer: SentencePieceProcessor,
    mel_filterbank: Vec<f32>,
    stft_window: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WordTiming {
    pub word: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

#[derive(Debug, Clone)]
pub struct TimedTranscript {
    pub text: String,
    pub words: Vec<WordTiming>,
}

impl OfflineAsrModel {
    pub fn load(resource_dir: &Path) -> Result<Self, String> {
        let runtime_path = resource_dir.join("runtime.json");
        let config: RuntimeConfig = serde_json::from_slice(
            &fs::read(&runtime_path)
                .map_err(|e| format!("Could not read {}: {e}", runtime_path.display()))?,
        )
        .map_err(|e| format!("Invalid runtime.json: {e}"))?;

        if config.sample_rate != 16_000 {
            return Err(format!(
                "Offline model expects {} Hz; desktop pipeline requires 16000 Hz",
                config.sample_rate
            ));
        }

        let encoder_path = checked_file(resource_dir.join(&config.encoder))?;
        let decoder_path = checked_file(resource_dir.join(&config.decoder_joint))?;
        let tokenizer_path = checked_file(resource_dir.join(&config.tokenizer))?;
        let mel_path = checked_file(resource_dir.join(&config.mel_filterbank))?;
        let window_path = checked_file(resource_dir.join(&config.stft_window))?;

        // NeMo's exported filterbank includes a leading singleton axis.
        // Accept both [1, n_mels, fft_bins] and legacy [n_mels, fft_bins].
        let mel: ArrayD<f32> = read_npy(&mel_path)
            .map_err(|e| format!("Could not load {}: {e}", mel_path.display()))?;
        let expected_bins = config.n_fft / 2 + 1;
        let mel_shape = mel.shape();
        let is_matrix = mel_shape == [config.n_mels, expected_bins];
        let has_singleton_channel = mel_shape == [1, config.n_mels, expected_bins];
        if !is_matrix && !has_singleton_channel {
            return Err(format!(
                "Unexpected mel filterbank shape {:?}; expected [{}, {}] or [1, {}, {}]",
                mel_shape, config.n_mels, expected_bins, config.n_mels, expected_bins
            ));
        }
        let mel_filterbank = mel.into_raw_vec_and_offset().0;

        let window: Array1<f32> = read_npy(&window_path)
            .map_err(|e| format!("Could not load {}: {e}", window_path.display()))?;
        if window.len() != config.win_length {
            return Err(format!(
                "Unexpected STFT window length {}; expected {}",
                window.len(), config.win_length
            ));
        }

        let encoder = Session::builder()
            .map_err(|e| format!("Could not create ONNX encoder session: {e}"))?
            .with_intra_threads(4)
            .map_err(|e| format!("Could not set ONNX encoder threads: {e}"))?
            .commit_from_file(&encoder_path)
            .map_err(|e| format!("Could not load {}: {e}", encoder_path.display()))?;

        let decoder = Session::builder()
            .map_err(|e| format!("Could not create ONNX decoder session: {e}"))?
            .with_intra_threads(4)
            .map_err(|e| format!("Could not set ONNX decoder threads: {e}"))?
            .commit_from_file(&decoder_path)
            .map_err(|e| format!("Could not load {}: {e}", decoder_path.display()))?;

        let tokenizer = SentencePieceProcessor::open(&tokenizer_path)
            .map_err(|e| format!("Could not load {}: {e}", tokenizer_path.display()))?;

        Ok(Self {
            config,
            encoder,
            decoder,
            tokenizer,
            mel_filterbank,
            stft_window: window.into_raw_vec_and_offset().0,
        })
    }

    pub fn transcribe_kirtan(
        &mut self,
        audio: &[f32],
        window_start_ms: u64,
    ) -> Result<TimedTranscript, String> {
        self.transcribe_window(audio, "kirtan", window_start_ms)
    }

    pub fn transcribe_speech(
        &mut self,
        audio: &[f32],
        window_start_ms: u64,
    ) -> Result<TimedTranscript, String> {
        self.transcribe_window(audio, "speech", window_start_ms)
    }

    fn transcribe_window(
        &mut self,
        audio: &[f32],
        profile: &str,
        window_start_ms: u64,
    ) -> Result<TimedTranscript, String> {
        let transcribe_start = Instant::now();
        if audio.is_empty() {
            return Ok(TimedTranscript { text: String::new(), words: Vec::new() });
        }
        let audio_duration = audio.len() as f64 / self.config.sample_rate as f64;

        let (features, feature_frames) = self.preprocess(audio)?;

        let feature_tensor = Tensor::<f32>::from_array((
            [1usize, self.config.n_mels, feature_frames],
            features.into_boxed_slice(),
        ))
        .map_err(|e| format!("Could not create encoder feature tensor: {e}"))?;

        let length_tensor = Tensor::<i64>::from_array((
            [1usize],
            vec![feature_frames as i64].into_boxed_slice(),
        ))
        .map_err(|e| format!("Could not create encoder length tensor: {e}"))?;

        // Keep the encoder borrow inside this scope.
        // Copy its output so it no longer borrows self.encoder afterwards.
        let (encoded, hidden, available_frames, frame_count) = {
            let encoder_result = self
                .encoder
                .run(ort::inputs! {
                    "audio_signal" => feature_tensor,
                    "length" => length_tensor,
                })
                .map_err(|e| format!("Encoder inference failed: {e}"))?;

            let (encoded_shape, encoded_values) = encoder_result["outputs"]
                .try_extract_tensor::<f32>()
                .map_err(|e| format!("Could not read encoder output: {e}"))?;

            let (_, encoded_length_values) = encoder_result["encoded_lengths"]
                .try_extract_tensor::<i64>()
                .map_err(|e| format!("Could not read encoded length: {e}"))?;

            let shape: &[i64] = encoded_shape;

            if shape.len() != 3 || shape[0] != 1 {
                return Err(format!(
                    "Unexpected encoder output shape: {shape:?}"
                ));
            }

            let hidden = shape[1].max(0) as usize;
            let available_frames = shape[2].max(0) as usize;

            let encoded_length = encoded_length_values
                .first()
                .copied()
                .unwrap_or(0)
                .max(0) as usize;

            let frame_count = encoded_length.min(available_frames);

            (
                encoded_values.to_vec(),
                hidden,
                available_frames,
                frame_count,
            )
        };

        // encoder_result is now dropped, so self.encoder is no longer borrowed.
        let timed_token_ids = self.rnnt_greedy_decode(
            &encoded,
            hidden,
            available_frames,
            frame_count,
        )?;

        if timed_token_ids.is_empty() {
            println!(
                "[ASR:{profile}] audio={audio_duration:.2}s | transcribe={:.3}s | no transcript",
                transcribe_start.elapsed().as_secs_f64(),
            );
            return Ok(TimedTranscript { text: String::new(), words: Vec::new() });
        }

        let token_ids: Vec<usize> = timed_token_ids.iter().map(|(id, _)| *id as usize).collect();

        let text = self.tokenizer
            .decode_ids(&token_ids)
            .map(|text| text.trim().to_string())
            .map_err(|e| format!("SentencePiece decode failed: {e}"))?;
        let words = self.align_words(
            &timed_token_ids,
            audio_duration,
            frame_count,
            window_start_ms
        )?;
        let elapsed = transcribe_start.elapsed().as_secs_f64();
        println!(
            "[ASR:{profile}] audio={audio_duration:.2}s | transcribe={elapsed:.3}s | realtime={:.2}x",
            audio_duration / elapsed.max(f64::EPSILON),
        );
        Ok(TimedTranscript { text, words })
    }

    // Greedy RNNT emits each non-blank token at an encoder frame. Keep that
    // alignment and project token prefixes through SentencePiece so word
    // boundaries follow the model's own alignment rather than an estimate.
    fn align_words(
        &self,
        timed_token_ids: &[(u32, usize)],
        audio_duration: f64,
        frame_count: usize,
        window_start_ms: u64,
    ) -> Result<Vec<WordTiming>, String> {
        let mut token_ids = Vec::with_capacity(timed_token_ids.len());
        let mut starts: Vec<u64> = Vec::new();
        let mut ends: Vec<u64> = Vec::new();
        let mut words: Vec<String> = Vec::new();

        // for (token_id, frame_index) in timed_token_ids {
        //     let relative_time_ms = (
        //         (*frame_index as f64 / frame_count.max(1) as f64)
        //         * audio_duration
        //         * 1000.0
        //     ) as u64;

        //     let time_ms = window_start_ms + relative_time_ms;

        //     let token_text = self
        //         .tokenizer
        //         .decode_ids(&[*token_id as usize])
        //         .unwrap_or_else(|_| "?".to_string());

        //     println!(
        //         "window_start={}ms token_id={} token={:?} frame={} relative={}ms absolute={}ms",
        //         window_start_ms,
        //         token_id,
        //         token_text,
        //         frame_index,
        //         relative_time_ms,
        //         time_ms,
        //     );
        // }

        for (token_id, frame_index) in timed_token_ids {
            token_ids.push(*token_id as usize);
            let decoded = self.tokenizer.decode_ids(&token_ids)
                .map_err(|e| format!("SentencePiece alignment decode failed: {e}"))?;
            let current_words: Vec<String> = decoded.split_whitespace().map(str::to_string).collect();
            let relative_time_ms = (
                (*frame_index as f64 / frame_count.max(1) as f64)
                * audio_duration
                * 1000.0
            ) as u64;

            let token_time_ms = window_start_ms + relative_time_ms;

            if current_words.len() > words.len() {
                while words.len() < current_words.len() {
                    starts.push(token_time_ms);
                    ends.push(token_time_ms);
                    words.push(current_words[words.len()].clone());
                }
            } else {
                for (word, current) in words.iter_mut().zip(current_words.iter()) {
                    *word = current.clone();
                }
                if let Some(end) = ends.last_mut() {
                    *end = token_time_ms;
                }
            }
        }

        let mut aligned = Vec::with_capacity(words.len());
        for index in 0..words.len() {
            let end_ms = ends[index];
            let start_ms = starts[index].min(end_ms);
            aligned.push(WordTiming {
                word: words[index].clone(),
                start_ms,
                end_ms: end_ms.max(start_ms),
            });
        }

        println!("--------------------------");
        println!(
            "window {}ms -> {}ms",
            window_start_ms,
            window_start_ms + (audio_duration * 1000.0) as u64,
        );

        for word in &aligned {
            println!(
                "[{:>6} - {:>6}] {}",
                word.start_ms,
                word.end_ms,
                word.word,
            );
        }

        println!("--------------------------");

        Ok(aligned)
    }

    fn rnnt_greedy_decode(
        &mut self,
        encoded: &[f32],
        encoder_hidden: usize,
        encoder_stride: usize,
        frame_count: usize,
    ) -> Result<Vec<(u32, usize)>, String> {
        let mut current_h = vec![0.0_f32; RNNT_HIDDEN_SIZE];
        let mut current_c = vec![0.0_f32; RNNT_HIDDEN_SIZE];
        let mut current_label = self.config.predictor_start_id;
        let mut output = Vec::new();

        for frame_index in 0..frame_count {
            let mut encoder_frame = Vec::with_capacity(encoder_hidden);
            for hidden_index in 0..encoder_hidden {
                let index = hidden_index * encoder_stride.max(1) + frame_index;
                encoder_frame.push(*encoded.get(index).unwrap_or(&0.0));
            }

            let mut symbols_this_frame = 0usize;
            while symbols_this_frame < self.config.max_symbols_per_step {
                let encoder_tensor = Tensor::<f32>::from_array((
                    [1usize, encoder_hidden, 1usize],
                    encoder_frame.clone().into_boxed_slice(),
                ))
                .map_err(|e| format!("Could not create decoder encoder tensor: {e}"))?;

                let target_tensor = Tensor::<i32>::from_array((
                    [1usize, 1usize],
                    vec![current_label].into_boxed_slice(),
                ))
                .map_err(|e| format!("Could not create decoder target tensor: {e}"))?;

                let target_length_tensor = Tensor::<i32>::from_array((
                    [1usize],
                    vec![1_i32].into_boxed_slice(),
                ))
                .map_err(|e| format!("Could not create target length tensor: {e}"))?;

                let h_tensor = Tensor::<f32>::from_array((
                    [1usize, 1usize, RNNT_HIDDEN_SIZE],
                    current_h.clone().into_boxed_slice(),
                ))
                .map_err(|e| format!("Could not create predictor h tensor: {e}"))?;

                let c_tensor = Tensor::<f32>::from_array((
                    [1usize, 1usize, RNNT_HIDDEN_SIZE],
                    current_c.clone().into_boxed_slice(),
                ))
                .map_err(|e| format!("Could not create predictor c tensor: {e}"))?;

                let result = self
                    .decoder
                    .run(ort::inputs! {
                        "encoder_outputs" => encoder_tensor,
                        "targets" => target_tensor,
                        "target_length" => target_length_tensor,
                        "input_states_1" => h_tensor,
                        "input_states_2" => c_tensor,
                    })
                    .map_err(|e| format!("RNNT decoder inference failed: {e}"))?;

                let (_, logits) = result["outputs"]
                    .try_extract_tensor::<f32>()
                    .map_err(|e| format!("Could not read RNNT logits: {e}"))?;

                let local_token = argmax_last_dimension(logits)
                    .ok_or_else(|| "RNNT decoder returned no logits".to_string())?;

                if local_token == self.config.joint_blank_id {
                    break;
                }

                if local_token >= self.config.local_vocab_size {
                    return Err(format!(
                        "RNNT emitted invalid local token {local_token}; vocabulary size is {}",
                        self.config.local_vocab_size
                    ));
                }

                let (_, candidate_h) = result["output_states_1"]
                    .try_extract_tensor::<f32>()
                    .map_err(|e| format!("Could not read predictor h state: {e}"))?;
                let (_, candidate_c) = result["output_states_2"]
                    .try_extract_tensor::<f32>()
                    .map_err(|e| format!("Could not read predictor c state: {e}"))?;

                current_h.clear();
                current_h.extend_from_slice(candidate_h);
                current_c.clear();
                current_c.extend_from_slice(candidate_c);

                output.push((local_token as u32, frame_index));
                current_label = local_token as i32;
                symbols_this_frame += 1;
            }
        }

        Ok(output)
    }

    pub(crate) fn preprocess(&self, audio: &[f32]) -> Result<(Vec<f32>, usize), String> {
        if audio.is_empty() {
            return Err("Audio is empty".into());
        }

        let mut emphasized = vec![0.0_f32; audio.len()];
        emphasized[0] = audio[0];
        for i in 1..audio.len() {
            emphasized[i] = audio[i] - self.config.preemph * audio[i - 1];
        }

        let pad = self.config.n_fft / 2;
        let padded = center_pad(&emphasized, pad);
        let frame_count = if padded.len() < self.config.n_fft {
            1
        } else {
            (padded.len() - self.config.n_fft) / self.config.hop_length + 1
        };

        let mut fft_window = vec![0.0_f32; self.config.n_fft];
        let start = (self.config.n_fft - self.config.win_length) / 2;
        fft_window[start..start + self.config.win_length]
            .copy_from_slice(&self.stft_window);

        let fft = FftPlanner::<f32>::new().plan_fft_forward(self.config.n_fft);
        let fft_bins = self.config.n_fft / 2 + 1;
        let mut mel_by_time = vec![0.0_f32; self.config.n_mels * frame_count];

        for frame_index in 0..frame_count {
            let offset = frame_index * self.config.hop_length;
            let mut frame = vec![Complex32::new(0.0, 0.0); self.config.n_fft];

            for sample_index in 0..self.config.n_fft {
                let sample = *padded.get(offset + sample_index).unwrap_or(&0.0);
                frame[sample_index].re = sample * fft_window[sample_index];
            }

            fft.process(&mut frame);

            let mut power = vec![0.0_f32; fft_bins];
            for bin in 0..fft_bins {
                power[bin] = frame[bin].norm_sqr();
            }

            for mel_index in 0..self.config.n_mels {
                let filter_offset = mel_index * fft_bins;
                let mut energy = 0.0_f32;
                for bin in 0..fft_bins {
                    energy += power[bin] * self.mel_filterbank[filter_offset + bin];
                }

                mel_by_time[mel_index * frame_count + frame_index] =
                    (energy + self.config.log_zero_guard_value).ln();
            }
        }

        normalize_per_feature(&mut mel_by_time, self.config.n_mels, frame_count);
        Ok((mel_by_time, frame_count))
    }
}

fn checked_file(path: PathBuf) -> Result<PathBuf, String> {
    if path.is_file() {
        Ok(path)
    } else {
        Err(format!("Required offline ASR asset not found: {}", path.display()))
    }
}

fn argmax_last_dimension(values: &[f32]) -> Option<usize> {
    values
        .iter()
        .copied()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(index, _)| index)
}

fn normalize_per_feature(values: &mut [f32], features: usize, frames: usize) {
    if frames == 0 {
        return;
    }

    for feature in 0..features {
        let start = feature * frames;
        let end = start + frames;
        let row = &mut values[start..end];
        let mean = row.iter().copied().sum::<f32>() / frames as f32;
        let variance = if frames > 1 {
            row.iter()
                .map(|value| {
                    let delta = *value - mean;
                    delta * delta
                })
                .sum::<f32>()
                / (frames - 1) as f32
        } else {
            0.0
        };
        let std = variance.sqrt();

        for value in row.iter_mut() {
            *value = (*value - mean) / (std + NORMALIZE_EPSILON);
        }
    }
}

fn center_pad(audio: &[f32], pad: usize) -> Vec<f32> {
    let mut output = Vec::with_capacity(audio.len() + pad * 2);

    if audio.len() > pad {
        for index in (1..=pad).rev() {
            output.push(audio[index.min(audio.len() - 1)]);
        }
        output.extend_from_slice(audio);
        for index in 0..pad {
            let source = audio.len().saturating_sub(2 + index);
            output.push(audio[source]);
        }
    } else {
        output.resize(pad, 0.0);
        output.extend_from_slice(audio);
        output.resize(output.len() + pad, 0.0);
    }

    if output.len() < 512 {
        output.resize(512, 0.0);
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feature_normalization_centers_each_mel_bin() {
        let mut data = vec![1.0, 2.0, 3.0, 10.0, 20.0, 30.0];
        normalize_per_feature(&mut data, 2, 3);

        let first_mean = data[..3].iter().sum::<f32>() / 3.0;
        let second_mean = data[3..].iter().sum::<f32>() / 3.0;
        assert!(first_mean.abs() < 1e-5);
        assert!(second_mean.abs() < 1e-5);
    }

    #[test]
    fn argmax_returns_largest_logit() {
        assert_eq!(argmax_last_dimension(&[-1.0, 3.0, 2.5]), Some(1));
    }

    #[test]
    fn reflect_padding_keeps_audio_centered() {
        let padded = center_pad(&[1.0, 2.0, 3.0, 4.0], 2);
        assert_eq!(&padded[2..6], &[1.0, 2.0, 3.0, 4.0]);
    }
}
