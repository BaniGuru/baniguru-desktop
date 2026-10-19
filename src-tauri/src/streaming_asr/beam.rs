use std::{collections::HashMap, path::Path, sync::Arc};

use ort::{session::Session, value::Tensor};
use sentencepiece_rs::SentencePieceProcessor;

use super::{
    language_model::LanguageModel,
    model::{EncodedChunk, PredictorState, TimedToken},
};

#[derive(Clone)]
struct Prediction {
    projected: Vec<f32>,
    h: Vec<f32>,
    c: Vec<f32>,
}

#[derive(Clone)]
struct Hypothesis {
    tokens: Vec<TimedToken>,
    predictor: PredictorState,
    prediction: Option<Arc<Prediction>>,
    score: f64,
    context: Vec<String>,
    unfinished: Vec<usize>,
    suppress: bool,
}

type Key = (Vec<usize>, Vec<String>, Vec<usize>, bool);

impl Hypothesis {
    fn key(&self) -> Key {
        (
            self.tokens.iter().map(|t| t.id).collect(),
            self.context.clone(),
            self.unfinished.clone(),
            self.suppress,
        )
    }
}

pub(super) struct BeamDecoder {
    predictor: Session,
    joint: Session,
    lm: Option<LanguageModel>,
    tokenizer: SentencePieceProcessor,
    starts: Vec<bool>,
    beams: Vec<Hypothesis>,
    preview: Option<Vec<Hypothesis>>,
    hidden: usize,
    encoder_hidden: usize,
    blank: usize,
    width: usize,
    weight: f64,
    max_symbols: usize,
    frame_ms: u64,
    greedy: bool,
}

impl BeamDecoder {
    pub fn load(
        directory: &Path,
        hidden: usize,
        encoder_hidden: usize,
        blank: usize,
        max_symbols: usize,
        frame_ms: u64,
    ) -> Result<Self, String> {
        let mode = std::env::var("BANI_ASR_DECODING").unwrap_or_else(|_| "kenlm".into());
        if !["greedy", "beam", "kenlm"].contains(&mode.as_str()) {
            return Err("Invalid BANI_ASR_DECODING".into());
        }
        let width = std::env::var("BANI_ASR_BEAM_WIDTH")
            .ok()
            .map(|v| v.parse::<usize>())
            .transpose()
            .map_err(|e| e.to_string())?
            .unwrap_or(4)
            .clamp(1, 8);
        let weight = std::env::var("BANI_ASR_LM_WEIGHT")
            .ok()
            .map(|v| v.parse::<f64>())
            .transpose()
            .map_err(|e| e.to_string())?
            .unwrap_or(0.3);
        if !weight.is_finite() || !(0.0..=1.0).contains(&weight) {
            return Err("LM weight must be between zero and one".into());
        }
        let session = |name: &str| -> Result<Session, String> {
            Session::builder()
                .map_err(|e| e.to_string())?
                .with_intra_threads(1)
                .map_err(|e| e.to_string())?
                .with_intra_op_spinning(false)
                .map_err(|e| e.to_string())?
                .with_flush_to_zero()
                .map_err(|e| e.to_string())?
                .commit_from_file(directory.join(name))
                .map_err(|e| e.to_string())
        };
        let tokenizer = SentencePieceProcessor::open(directory.join("tokenizer.model"))
            .map_err(|e| e.to_string())?;
        let starts = (0..blank)
            .map(|id| tokenizer.id_to_piece(id).map(|p| p.starts_with('▁')))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let mut result = Self {
            predictor: session("predictor.onnx")?,
            joint: session("joint.onnx")?,
            lm: if mode == "kenlm" {
                Some(LanguageModel::load(&directory.join("gurbani_3gram.bin"))?)
            } else {
                None
            },
            tokenizer,
            starts,
            beams: Vec::new(),
            preview: None,
            hidden,
            encoder_hidden,
            blank,
            width,
            weight,
            max_symbols,
            frame_ms,
            greedy: mode == "greedy",
        };
        result.reset();
        Ok(result)
    }

    pub fn reset(&mut self) {
        self.preview = None;
        self.beams = vec![Hypothesis {
            tokens: Vec::new(),
            predictor: PredictorState {
                h: vec![0.0; self.hidden],
                c: vec![0.0; self.hidden],
                label: self.blank as i64,
            },
            prediction: None,
            score: 0.0,
            context: Vec::new(),
            unfinished: Vec::new(),
            suppress: false,
        }];
    }

    fn predict(&mut self, hypothesis: &Hypothesis) -> Result<Arc<Prediction>, String> {
        if let Some(prediction) = &hypothesis.prediction {
            return Ok(prediction.clone());
        }
        let hidden = self.hidden;
        let result = self.predictor.run(ort::inputs! {
            "targets" => Tensor::from_array(([1, 1], vec![hypothesis.predictor.label])) .map_err(|e| e.to_string())?,
            "input_states_1" => Tensor::from_array(([1, 1, hidden], hypothesis.predictor.h.clone())).map_err(|e| e.to_string())?,
            "input_states_2" => Tensor::from_array(([1, 1, hidden], hypothesis.predictor.c.clone())).map_err(|e| e.to_string())?,
        }).map_err(|e| e.to_string())?;
        Ok(Arc::new(Prediction {
            projected: result["predictor_outputs"]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?
                .1
                .to_vec(),
            h: result["output_states_1"]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?
                .1
                .to_vec(),
            c: result["output_states_2"]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?
                .1
                .to_vec(),
        }))
    }

    fn emit(
        &mut self,
        mut h: Hypothesis,
        prediction: &Prediction,
        id: usize,
        time_ms: u64,
    ) -> Result<Hypothesis, String> {
        if self.starts[id] && !h.unfinished.is_empty() {
            if let Some(lm) = &mut self.lm {
                let word = self
                    .tokenizer
                    .decode_ids(&h.unfinished)
                    .map_err(|e| e.to_string())?;
                h.score += self.weight * lm.complete(&mut h.context, &word)?;
            }
            h.unfinished.clear();
        }
        h.unfinished.push(id);
        if !h.suppress || self.starts[id] {
            h.suppress = false;
            h.tokens.push(TimedToken { id, time_ms });
        }
        h.predictor = PredictorState {
            h: prediction.h.clone(),
            c: prediction.c.clone(),
            label: id as i64,
        };
        h.prediction = None;
        Ok(h)
    }

    pub fn advance(
        &mut self,
        encoded: &EncodedChunk,
        start_ms: u64,
        commit: bool,
    ) -> Result<Vec<TimedToken>, String> {
        let mut beams = self.beams.clone();
        // A token prefix has the same predictor state under every alignment.
        // Keep its LSTM result across blank frames; cache is bounded to a call.
        let mut predictions = HashMap::<Key, Arc<Prediction>>::new();
        for frame in 0..encoded.frames {
            let acoustic: Vec<f32> = (0..self.encoder_hidden)
                .map(|channel| encoded.values[channel * encoded.stride + frame])
                .collect();
            let mut active = beams;
            let mut completed = HashMap::new();
            for symbols in 0..=self.max_symbols {
                if active.is_empty() {
                    break;
                }
                let mut projected = Vec::with_capacity(active.len() * self.hidden);
                for h in &mut active {
                    let key = h.key();
                    let prediction = match predictions.get(&key) {
                        Some(p) => p.clone(),
                        None => {
                            let p = self.predict(h)?;
                            predictions.insert(key, p.clone());
                            p
                        }
                    };
                    projected.extend_from_slice(&prediction.projected);
                    h.prediction = Some(prediction);
                }
                let batch = active.len();
                let values: Vec<f32> = (0..batch).flat_map(|_| acoustic.iter().copied()).collect();
                let result = self.joint.run(ort::inputs! {
                    "encoder_outputs" => Tensor::from_array(([batch, self.encoder_hidden, 1], values)).map_err(|e| e.to_string())?,
                    "predictor_outputs" => Tensor::from_array(([batch, 1, self.hidden], projected)).map_err(|e| e.to_string())?,
                }).map_err(|e| e.to_string())?;
                let logits = result["outputs"]
                    .try_extract_tensor::<f32>()
                    .map_err(|e| e.to_string())?
                    .1
                    .to_vec();
                drop(result);
                let mut expanded = HashMap::new();
                for (index, h) in active.into_iter().enumerate() {
                    let row = &logits[index * (self.blank + 1)..(index + 1) * (self.blank + 1)];
                    if self.greedy {
                        let label = row
                            .iter()
                            .enumerate()
                            .max_by(|a, b| a.1.total_cmp(b.1))
                            .unwrap()
                            .0;
                        if label == self.blank || symbols == self.max_symbols {
                            merge(&mut completed, h);
                        } else {
                            let prediction = h.prediction.as_ref().unwrap().clone();
                            let next = self.emit(
                                h,
                                &prediction,
                                label,
                                start_ms + frame as u64 * self.frame_ms,
                            )?;
                            merge(&mut expanded, next);
                        }
                        continue;
                    }
                    let maximum = row.iter().copied().fold(f32::NEG_INFINITY, f32::max) as f64;
                    let normalizer = maximum
                        + row
                            .iter()
                            .map(|v| (f64::from(*v) - maximum).exp())
                            .sum::<f64>()
                            .ln();
                    let mut blank = h.clone();
                    blank.score += f64::from(row[self.blank]) - normalizer;
                    merge(&mut completed, blank);
                    if symbols == self.max_symbols {
                        continue;
                    }
                    let best_completed = completed
                        .values()
                        .map(|h: &Hypothesis| h.score)
                        .fold(f64::NEG_INFINITY, f64::max);
                    let mut labels: Vec<_> = (0..self.blank).collect();
                    labels.sort_unstable_by(|a, b| row[*b].total_cmp(&row[*a]));
                    for label in labels.into_iter().take(self.width * 2) {
                        let score = h.score + f64::from(row[label]) - normalizer;
                        // A word boundary's bounded LM reward is <= 3*weight.
                        if score < best_completed - 6.0 - 3.0 * self.weight {
                            continue;
                        }
                        let prediction = h.prediction.as_ref().unwrap();
                        let mut next = self.emit(
                            h.clone(),
                            prediction,
                            label,
                            start_ms + frame as u64 * self.frame_ms,
                        )?;
                        next.score += f64::from(row[label]) - normalizer;
                        if next.score >= best_completed - 6.0 {
                            merge(&mut expanded, next);
                        }
                    }
                }
                active = prune(expanded, if self.greedy { 1 } else { self.width });
                // Paths already too weak to beat completed blanks cannot win
                // by emitting more low-probability pieces in this frame.
                let best = completed
                    .values()
                    .map(|h: &Hypothesis| h.score)
                    .fold(f64::NEG_INFINITY, f64::max);
                active.retain(|h| self.greedy || h.score >= best - 6.0);
            }
            beams = prune(completed, if self.greedy { 1 } else { self.width });
            if beams.is_empty() {
                return Err("RNNT beam search produced no blank path".into());
            }
            let best = beams[0].score;
            for h in &mut beams {
                h.score -= best;
            }
            if predictions.len() > 2_048 {
                predictions.clear();
            }
        }
        let tokens = beams[0].tokens.clone();
        if commit {
            self.beams = beams;
            self.preview = None;
        } else {
            self.preview = Some(beams);
        }
        Ok(tokens)
    }

    pub fn finish(&mut self) -> Result<Vec<TimedToken>, String> {
        let mut hypotheses = self.preview.as_ref().unwrap_or(&self.beams).clone();
        if let Some(lm) = &mut self.lm {
            for h in &mut hypotheses {
                if !h.unfinished.is_empty() {
                    let word = self
                        .tokenizer
                        .decode_ids(&h.unfinished)
                        .map_err(|e| e.to_string())?;
                    h.score += self.weight * lm.complete(&mut h.context, &word)?;
                }
            }
        }
        hypotheses.sort_by(|a, b| {
            b.score
                .total_cmp(&a.score)
                .then_with(|| a.key().cmp(&b.key()))
        });
        Ok(hypotheses[0].tokens.clone())
    }

    pub fn settle(&mut self, prefix: &[TimedToken], suppress: bool) {
        self.beams.retain(|h| {
            h.tokens.len() >= prefix.len() && h.tokens.iter().zip(prefix).all(|(a, b)| a.id == b.id)
        });
        for h in &mut self.beams {
            h.tokens.drain(..prefix.len());
            if suppress && h.tokens.is_empty() {
                h.suppress = true;
            }
        }
        self.preview = None;
    }

    pub fn best_predictor(&self) -> PredictorState {
        self.beams[0].predictor.clone()
    }

    #[cfg(test)]
    pub fn use_greedy(&mut self) {
        self.greedy = true;
        self.lm = None;
    }
}

fn merge(map: &mut HashMap<Key, Hypothesis>, h: Hypothesis) {
    let key = h.key();
    match map.get_mut(&key) {
        Some(previous) => {
            let maximum = previous.score.max(h.score);
            let total =
                maximum + ((previous.score - maximum).exp() + (h.score - maximum).exp()).ln();
            if h.score > previous.score {
                *previous = h;
            }
            previous.score = total;
        }
        None => {
            map.insert(key, h);
        }
    }
}

fn prune(map: HashMap<Key, Hypothesis>, width: usize) -> Vec<Hypothesis> {
    let mut hypotheses: Vec<_> = map.into_values().collect();
    hypotheses.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then_with(|| a.key().cmp(&b.key()))
    });
    hypotheses.truncate(width);
    hypotheses
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equal_prefix_alignments_sum_probability_and_keep_the_best_timestamp() {
        let h = Hypothesis {
            tokens: vec![TimedToken {
                id: 42,
                time_ms: 100,
            }],
            predictor: PredictorState {
                h: vec![],
                c: vec![],
                label: 42,
            },
            prediction: None,
            score: 0.2f64.ln(),
            context: vec![],
            unfinished: vec![42],
            suppress: false,
        };
        let mut alternative = h.clone();
        alternative.tokens[0].time_ms = 140;
        alternative.score = 0.3f64.ln();
        let mut map = HashMap::new();
        merge(&mut map, h);
        merge(&mut map, alternative);
        assert_eq!(map.len(), 1);
        let best = map.values().next().unwrap();
        assert!((best.score.exp() - 0.5).abs() < 1e-9);
        assert_eq!(best.tokens[0].time_ms, 140);
    }
}
