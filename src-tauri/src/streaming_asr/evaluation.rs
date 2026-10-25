//! File-driven evaluation keeps references outside the recognizer. Each item
//! is a complete source clip, not a batch-generated recognition reference.
use std::{fs, path::Path, process::Command, time::Instant};

use serde::Deserialize;
use unicode_normalization::UnicodeNormalization;

use crate::streaming_asr::{
    model::{StreamingAsrModel, StreamingProfile},
    service::{push_chunk, ENDPOINT_SILENCE_MS},
};

#[derive(Deserialize)]
struct Item {
    id: String,
    audio: String,
    #[serde(default)]
    reference: String,
    kirtan: bool,
    #[serde(default)]
    source: String,
    #[serde(default)]
    sections: Vec<serde_json::Value>,
}

fn normalize(text: &str) -> String {
    text.nfc()
        .map(|c| {
            if c.is_alphanumeric() || ('\u{0A00}'..='\u{0A75}').contains(&c) {
                c
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn distance<T: Eq>(reference: &[T], hypothesis: &[T]) -> usize {
    let mut row: Vec<usize> = (0..=hypothesis.len()).collect();
    for (i, a) in reference.iter().enumerate() {
        let mut previous = row[0];
        row[0] = i + 1;
        for (j, b) in hypothesis.iter().enumerate() {
            let old = row[j + 1];
            row[j + 1] = (previous + usize::from(a != b))
                .min(row[j] + 1)
                .min(old + 1);
            previous = old;
        }
    }
    row[hypothesis.len()]
}

#[test]
#[ignore = "requires BANI_ASR_EVAL_MANIFEST containing accessible audio and manual references"]
fn evaluate_manual_reference_manifest() {
    let manifest = std::env::var("BANI_ASR_EVAL_MANIFEST").expect("BANI_ASR_EVAL_MANIFEST");
    let output = std::env::var("BANI_ASR_EVAL_REPORT").expect("BANI_ASR_EVAL_REPORT");
    let items: Vec<Item> = serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
    assert!(!items.is_empty(), "an empty manifest is not an evaluation");
    let mut reports = Vec::new();
    let mut word_totals = [0usize; 2];
    let mut char_totals = [0usize; 2];
    for item in items {
        let has_reference = !item.reference.trim().is_empty();
        assert!(
            has_reference || std::env::var_os("BANI_ASR_UNREFERENCED_REPLAY").is_some(),
            "missing manual reference: {}",
            item.id
        );
        let audio_path = Path::new(&item.audio);
        let decoded = Command::new("ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(audio_path)
            .args(["-f", "f32le", "-ac", "1", "-ar", "16000", "pipe:1"])
            .output()
            .unwrap();
        assert!(
            decoded.status.success(),
            "{}",
            String::from_utf8_lossy(&decoded.stderr)
        );
        let audio: Vec<f32> = decoded
            .stdout
            .chunks_exact(4)
            .map(|v| f32::from_le_bytes(v.try_into().unwrap()))
            .collect();
        assert!(!audio.is_empty());
        let mut model = StreamingAsrModel::load(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/streaming_asr"),
        )
        .unwrap();
        let profile = StreamingProfile::for_kirtan(item.kirtan);
        let step = 16_000 * profile.refresh_ms / 1_000;
        let mut last_speech = None;
        let mut position = 0;
        let mut first = true;
        let mut words = Vec::new();
        let mut events = Vec::new();
        let mut update_ms = Vec::new();
        let started = Instant::now();
        let mut progress_at = 60_000;
        while position < audio.len() {
            let count = step
                + if first {
                    model.startup_delay_samples()
                } else {
                    0
                };
            let end = (position + count).min(audio.len());
            push_chunk(
                &mut model,
                &audio[position..end],
                16_000,
                1,
                &mut last_speech,
            );
            position = end;
            if !model.has_audio() {
                first = true;
                continue;
            }
            first = false;
            let endpoint = last_speech
                .is_some_and(|end| model.end_ms().saturating_sub(end) >= ENDPOINT_SILENCE_MS);
            let tick = Instant::now();
            let update = model.update(profile, endpoint).unwrap();
            update_ms.push(tick.elapsed().as_secs_f64() * 1_000.0);
            words.extend(update.finalized.clone());
            events.push(serde_json::json!({"end_ms": update.end_ms, "final_words": update.finalized, "partial_words": update.partial}));
            if update.end_ms >= progress_at {
                println!(
                    "REFERENCE_PROGRESS {}",
                    serde_json::json!({
                        "id":item.id, "audio_seconds":update.end_ms as f64 / 1_000.0,
                        "processing_seconds":started.elapsed().as_secs_f64(), "final_words":words.len(),
                    })
                );
                progress_at += 60_000;
            }
            if endpoint {
                model.reset_segment();
                last_speech = None;
                first = true;
            }
        }
        let flushed = model.update(profile, true).unwrap();
        words.extend(flushed.finalized.clone());
        events.push(serde_json::json!({"end_ms":flushed.end_ms,"final_words":flushed.finalized,"partial_words":flushed.partial,"flush":true}));
        let seconds = started.elapsed().as_secs_f64();
        let hypothesis = words
            .iter()
            .map(|w| w.word.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        let reference_normalized = normalize(&item.reference);
        let hypothesis_normalized = normalize(&hypothesis);
        let rw: Vec<_> = reference_normalized.split_whitespace().collect();
        let hw: Vec<_> = hypothesis_normalized.split_whitespace().collect();
        let rc: Vec<_> = reference_normalized
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect();
        let hc: Vec<_> = hypothesis_normalized
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect();
        let we = distance(&rw, &hw);
        let ce = distance(&rc, &hc);
        if has_reference {
            word_totals[0] += we;
            word_totals[1] += rw.len();
            char_totals[0] += ce;
            char_totals[1] += rc.len();
        }
        update_ms.sort_by(f64::total_cmp);
        let report = serde_json::json!({
            "id": item.id, "source": item.source, "audio": item.audio,
            "profile": if item.kirtan {"kirtan"} else {"sehaj_paath"},
            "reference": item.reference, "hypothesis": hypothesis, "words": words,
            "has_manual_reference": has_reference,
            "word_errors": has_reference.then_some(we), "reference_words": rw.len(),
            "wer": has_reference.then_some(we as f64 / rw.len().max(1) as f64),
            "character_errors": has_reference.then_some(ce), "reference_characters": rc.len(),
            "cer": has_reference.then_some(ce as f64 / rc.len().max(1) as f64),
            "audio_seconds": audio.len() as f64 / 16_000.0, "processing_seconds": seconds,
            "rtf": seconds / (audio.len() as f64 / 16_000.0),
            "p95_update_ms": update_ms.get(update_ms.len().saturating_sub(1).min(update_ms.len() * 95 / 100)),
            "events": events,
            "reference_sections": item.sections,
        });
        println!(
            "REFERENCE_RESULT {}",
            serde_json::json!({"id":item.id,"wer":report["wer"],"cer":report["cer"],"rtf":report["rtf"]})
        );
        reports.push(report);
    }
    let status = fs::read_to_string("/proc/self/status").unwrap_or_default();
    let limits = fs::read_to_string("/proc/self/limits").unwrap_or_default();
    let cpu = fs::read_to_string("/proc/cpuinfo").unwrap_or_default();
    let report = serde_json::json!({
        "decoding": std::env::var("BANI_ASR_DECODING").unwrap_or_else(|_| "kenlm".into()),
        "normalization": "NFC, punctuation to spaces, whitespace folding; matras retained; CER excludes spaces",
        "manifest": manifest, "clips": reports,
        "aggregate_wer": (word_totals[1] > 0).then_some(word_totals[0] as f64 / word_totals[1].max(1) as f64),
        "aggregate_cer": (char_totals[1] > 0).then_some(char_totals[0] as f64 / char_totals[1].max(1) as f64),
        "memory_status": status.lines().filter(|line| line.starts_with("VmHWM:") || line.starts_with("VmRSS:") || line.starts_with("Cpus_allowed_list:")).collect::<Vec<_>>(),
        "cpu": cpu.lines().find(|line| line.starts_with("model name")),
        "address_space_limit": limits.lines().find(|line| line.starts_with("Max address space")),
        "beam_width": std::env::var("BANI_ASR_BEAM_WIDTH").unwrap_or_else(|_| "4".into()),
        "lm_weight": std::env::var("BANI_ASR_LM_WEIGHT").unwrap_or_else(|_| "0.3".into()),
    });
    fs::write(
        output,
        serde_json::to_string_pretty(&report).unwrap() + "\n",
    )
    .unwrap();
}
