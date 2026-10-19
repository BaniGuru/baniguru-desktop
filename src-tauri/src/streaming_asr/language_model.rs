use std::{collections::HashMap, path::Path};

use kenlm::{Config, Model};
use unicode_normalization::UnicodeNormalization;

/// A bounded, completed-word prior. It cannot rewrite an acoustic transcript
/// afterwards or reward a fragment before the next word boundary arrives.
pub(super) struct LanguageModel {
    model: Model,
    scores: HashMap<(Vec<String>, String), f64>,
}

impl LanguageModel {
    pub fn load(path: &Path) -> Result<Self, String> {
        let model = Model::with_config(
            path,
            Config {
                show_progress: false,
                ..Config::default()
            },
        )
        .map_err(|e| format!("Load Gurbani KenLM: {e}"))?;
        if model.order() != 3 {
            return Err(format!(
                "Expected Gurbani 3-gram, got order {}",
                model.order()
            ));
        }
        Ok(Self {
            model,
            scores: HashMap::new(),
        })
    }

    pub fn complete(&mut self, context: &mut Vec<String>, text: &str) -> Result<f64, String> {
        let mut score = 0.0;
        for word in words(text) {
            score += self.evidence(context, &word)?;
            context.push(word);
            if context.len() > 2 {
                context.remove(0);
            }
        }
        Ok(score)
    }

    fn evidence(&mut self, context: &[String], word: &str) -> Result<f64, String> {
        // Short context and unknown words must remain acoustic. In particular,
        // a backed-off unigram must not masquerade as trigram evidence.
        if context.len() < 2 || !self.model.contains(word).map_err(|e| e.to_string())? {
            return Ok(0.0);
        }
        let key = (context.to_vec(), word.to_string());
        if let Some(score) = self.scores.get(&key) {
            return Ok(*score);
        }
        let mut state = self.model.null_context_state();
        for token in context {
            let mut next = self.model.null_context_state();
            self.model
                .base_score(
                    &state,
                    self.model.index(token).map_err(|e| e.to_string())?,
                    &mut next,
                )
                .map_err(|e| e.to_string())?;
            state = next;
        }
        let index = self.model.index(word).map_err(|e| e.to_string())?;
        let mut next = self.model.null_context_state();
        let conditional = self
            .model
            .base_full_score(&state, index, &mut next)
            .map_err(|e| e.to_string())?;
        let score = if conditional.ngram_length < 3 {
            0.0
        } else {
            let unigram = self
                .model
                .base_score(&self.model.null_context_state(), index, &mut next)
                .map_err(|e| e.to_string())?;
            let ratio =
                (f64::from(conditional.log_prob - unigram) * std::f64::consts::LN_10).min(30.0);
            (0.2 + 0.8 * ratio.exp()).ln().min(3.0)
        };
        if self.scores.len() >= 8_192 {
            self.scores.clear();
        }
        self.scores.insert(key, score);
        Ok(score)
    }
}

fn words(text: &str) -> Vec<String> {
    text.nfc()
        .map(|c| {
            if c.is_alphabetic() || ('\u{0A00}'..='\u{0A75}').contains(&c) {
                c
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .map(str::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supplied_binary_only_scores_completed_in_vocabulary_trigrams() {
        let path =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/streaming_asr/gurbani_3gram.bin");
        let mut lm = LanguageModel::load(&path).unwrap();
        assert_eq!(lm.complete(&mut Vec::new(), "ਕਰਿ").unwrap(), 0.0);
        assert_eq!(lm.complete(&mut vec!["ਕਰਿ".into()], "ਕਿਰਪਾ").unwrap(), 0.0);
        let mut context = vec!["ਕਰਿ".into(), "ਕਿਰਪਾ".into()];
        assert!(lm.complete(&mut context, "ਪ੍ਰਭ").unwrap() > 0.0);
        assert_eq!(context, vec!["ਕਿਰਪਾ", "ਪ੍ਰਭ"]);
        assert_eq!(lm.complete(&mut context, "unseenwordxyz").unwrap(), 0.0);
    }
}
