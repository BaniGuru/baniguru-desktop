use std::collections::VecDeque;

pub const TARGET_SAMPLE_RATE: u32 = 16_000;
pub const DEFAULT_WINDOW_SECONDS: usize = 12;
pub const DEFAULT_STEP_SECONDS: usize = 1;

pub fn to_mono(input: &[f32], channels: u16) -> Vec<f32> {
    let channels = channels.max(1) as usize;

    input
        .chunks(channels)
        .map(|frame| {
            if frame.is_empty() {
                0.0
            } else {
                frame.iter().copied().sum::<f32>() / frame.len() as f32
            }
        })
        .collect()
}

pub fn resample_to_16k(input: &[f32], input_rate: u32) -> Vec<f32> {
    if input.is_empty() || input_rate == 0 {
        return Vec::new();
    }

    if input_rate == TARGET_SAMPLE_RATE {
        return input.to_vec();
    }

    let ratio = TARGET_SAMPLE_RATE as f64 / input_rate as f64;
    let output_len = (input.len() as f64 * ratio).round() as usize;
    let mut output = Vec::with_capacity(output_len);

    for output_index in 0..output_len {
        let source_pos = output_index as f64 / ratio;
        let left = source_pos.floor() as usize;
        let fraction = (source_pos - left as f64) as f32;

        let left_sample = *input.get(left).unwrap_or(&0.0);
        let right_sample = *input.get(left + 1).unwrap_or(&left_sample);

        output.push(left_sample * (1.0 - fraction) + right_sample * fraction);
    }

    output
}

pub fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }

    let energy = samples.iter().map(|sample| sample * sample).sum::<f32>()
        / samples.len() as f32;

    energy.sqrt()
}

#[derive(Debug, Clone)]
pub struct RollingAudioWindow {
    samples: VecDeque<f32>,
    max_samples: usize,
    step_samples: usize,
    samples_since_decode: usize,
}

impl RollingAudioWindow {
    pub fn new(window_seconds: usize, step_seconds: usize) -> Self {
        Self::with_millis(window_seconds.saturating_mul(1000), step_seconds.saturating_mul(1000))
    }

    pub fn with_millis(window_ms: usize, step_ms: usize) -> Self {
        Self {
            samples: VecDeque::new(),
            max_samples: TARGET_SAMPLE_RATE as usize * window_ms / 1000,
            step_samples: (TARGET_SAMPLE_RATE as usize * step_ms / 1000).max(1),
            samples_since_decode: 0,
        }
    }

    pub fn push(&mut self, chunk: &[f32]) {
        if chunk.is_empty() {
            return;
        }

        self.samples.extend(chunk.iter().copied());
        self.samples_since_decode = self.samples_since_decode.saturating_add(chunk.len());

        if self.samples.len() > self.max_samples {
            let extra = self.samples.len() - self.max_samples;
            self.samples.drain(..extra);
        }
    }

    pub fn should_decode(&self) -> bool {
        self.samples_since_decode >= self.step_samples && !self.samples.is_empty()
    }

    pub fn should_decode_every_ms(&self, interval_ms: usize) -> bool {
        let interval_samples = (TARGET_SAMPLE_RATE as usize * interval_ms / 1000).max(1);
        self.samples_since_decode >= interval_samples && !self.samples.is_empty()
    }

    pub fn snapshot_for_decode(&mut self) -> Vec<f32> {
        self.samples_since_decode %= self.step_samples.max(1);
        self.samples.iter().copied().collect()
    }

    pub fn snapshot_last_ms(&self, window_ms: usize) -> Vec<f32> {
        let requested_samples = TARGET_SAMPLE_RATE as usize * window_ms / 1000;
        let skip_samples = self.samples.len().saturating_sub(requested_samples);
        self.samples.iter().skip(skip_samples).copied().collect()
    }

    pub fn consume_decode_tick(&mut self) {
        self.samples_since_decode = 0;
    }

    pub fn snapshot(&self) -> Vec<f32> {
        self.samples.iter().copied().collect()
    }

    pub fn clear(&mut self) {
        self.samples.clear();
        self.samples_since_decode = 0;
    }

    pub fn len(&self) -> usize {
        self.samples.len()
    }

    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }
}

impl Default for RollingAudioWindow {
    fn default() -> Self {
        Self::new(DEFAULT_WINDOW_SECONDS, DEFAULT_STEP_SECONDS)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stereo_is_mixed_without_dropping_frames() {
        let mono = to_mono(&[1.0, -1.0, 0.5, 0.5, -0.25, 0.75], 2);
        assert_eq!(mono, vec![0.0, 0.5, 0.25]);
    }

    #[test]
    fn resampling_preserves_expected_duration() {
        let input = vec![0.25_f32; 48_000];
        let output = resample_to_16k(&input, 48_000);
        assert!((output.len() as isize - 16_000).abs() <= 1);
    }

    #[test]
    fn rolling_window_is_capped_at_twelve_seconds() {
        let mut window = RollingAudioWindow::default();
        window.push(&vec![0.1; TARGET_SAMPLE_RATE as usize * 20]);
        assert_eq!(window.len(), TARGET_SAMPLE_RATE as usize * 12);
    }

    #[test]
    fn decode_cadence_keeps_partial_chunk_remainder() {
        let mut window = RollingAudioWindow::default();
        window.push(&vec![0.1; 8_000]);
        assert!(!window.should_decode());
        window.push(&vec![0.1; 8_256]);
        assert!(window.should_decode());
        let snapshot = window.snapshot_for_decode();
        assert_eq!(snapshot.len(), 16_256);
        assert!(!window.should_decode());
        window.push(&vec![0.1; 15_744]);
        assert!(window.should_decode());
    }

    #[test]
    fn speech_profiles_keep_normal_and_fast_inputs_within_their_caps() {
        let mut window = RollingAudioWindow::with_millis(4_000, 280);
        window.push(&vec![0.1; TARGET_SAMPLE_RATE as usize * 4]);

        assert_eq!(window.snapshot_last_ms(3_000).len(), TARGET_SAMPLE_RATE as usize * 3);
        assert_eq!(window.snapshot_last_ms(4_000).len(), TARGET_SAMPLE_RATE as usize * 4);
        assert_eq!(window.snapshot_last_ms(2_000).len(), TARGET_SAMPLE_RATE as usize * 2);
        assert_eq!(window.snapshot_last_ms(3_000).len(), TARGET_SAMPLE_RATE as usize * 3);
        assert_eq!(window.len(), TARGET_SAMPLE_RATE as usize * 4);

        let half_interval = TARGET_SAMPLE_RATE as usize * 280 / 1000;
        let mut cadence = RollingAudioWindow::with_millis(4_000, 280);
        cadence.push(&vec![0.1; half_interval]);
        assert!(!cadence.should_decode_every_ms(560));
        cadence.push(&vec![0.1; half_interval]);
        assert!(cadence.should_decode_every_ms(560));
        cadence.consume_decode_tick();
        cadence.push(&vec![0.1; half_interval]);
        assert!(!cadence.should_decode_every_ms(560));
        assert!(cadence.should_decode_every_ms(280));
    }
}
