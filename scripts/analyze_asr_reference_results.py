#!/usr/bin/env python3
"""Score supplied reference intervals as well as the complete streaming output."""
import argparse
from bisect import bisect_right
import json
from pathlib import Path
import unicodedata


def normalize(text):
    text = unicodedata.normalize("NFC", text)
    return " ".join("".join(c if c.isalnum() or "\u0a00" <= c <= "\u0a75" else " " for c in text).split())


def distance(pattern, text):
    """Exact unit-cost Levenshtein distance using a bit-vector recurrence."""
    if len(pattern) > len(text):
        pattern, text = text, pattern
    length = len(pattern)
    if not length:
        return len(text)
    masks = {}
    for index, token in enumerate(pattern):
        masks[token] = masks.get(token, 0) | (1 << index)
    positive, negative, score = (1 << length) - 1, 0, length
    high, mask = 1 << (length - 1), (1 << length) - 1
    for token in text:
        equal = masks.get(token, 0)
        vertical = equal | negative
        horizontal = (((equal & positive) + positive) ^ positive) | equal
        plus = negative | ~(horizontal | positive)
        minus = positive & horizontal
        score += bool(plus & high) - bool(minus & high)
        plus, minus = (plus << 1) | 1, minus << 1
        positive = (minus | ~(vertical | plus)) & mask
        negative = (plus & vertical) & mask
    return score


def scores(reference, hypothesis):
    reference, hypothesis = normalize(reference), normalize(hypothesis)
    rw, hw = reference.split(), hypothesis.split()
    rc, hc = reference.replace(" ", ""), hypothesis.replace(" ", "")
    we, ce = distance(rw, hw), distance(rc, hc)
    return dict(word_errors=we, reference_words=len(rw), wer=we / max(1, len(rw)),
                character_errors=ce, reference_characters=len(rc), cer=ce / max(1, len(rc)))


def analyze(report):
    result = []
    for clip in report["clips"]:
        sections = clip["reference_sections"]
        starts = [s["start_time"] for s in sections]
        if starts != sorted(starts):
            raise ValueError("Manual sections must be chronological")
        assigned = [[] for _ in sections]
        unannotated = []
        for word in clip["words"]:
            midpoint = (word["start_ms"] + word["end_ms"]) / 2_000
            index = bisect_right(starts, midpoint) - 1
            if index >= 0 and midpoint <= sections[index]["end_time"]:
                assigned[index].append(word["word"])
            else:
                unannotated.append(word["word"])
        per_section = []
        for section, words in zip(sections, assigned):
            hypothesis = " ".join(words)
            per_section.append({**section, "hypothesis": hypothesis, **scores(section["transcript"], hypothesis)})
        reference = " ".join(s["transcript"] for s in sections)
        hypothesis = " ".join(w for words in assigned for w in words)
        # Independently verify that this scorer agrees with the Rust evaluator.
        whole = scores(clip["reference"], clip["hypothesis"])
        assert abs(whole["wer"] - clip["wer"]) < 1e-10
        assert abs(whole["cer"] - clip["cer"]) < 1e-10
        validation = []
        for previous, current in zip(clip["words"], clip["words"][1:]):
            if current["start_ms"] < previous["end_ms"]:
                validation.append({"previous": previous, "current": current})
        result.append(dict(id=clip["id"], decoding=report["decoding"], whole_recording=whole,
            reference=clip["reference"], hypothesis=clip["hypothesis"], source=clip["source"],
            annotated_regions=scores(reference, hypothesis), unannotated_word_count=len(unannotated),
            unannotated_hypothesis=" ".join(unannotated), sections=per_section,
            overlapping_final_words=validation, audio_seconds=clip["audio_seconds"],
            processing_seconds=clip["processing_seconds"], rtf=clip["rtf"], p95_update_ms=clip["p95_update_ms"],
            memory_status=report["memory_status"], cpu=report["cpu"], address_space_limit=report["address_space_limit"]))
    return result


def self_test():
    import random
    random.seed(7)
    for _ in range(300):
        a, b = ([random.choice("ਕਖਗab") for _ in range(random.randrange(20))] for _ in range(2))
        row = list(range(len(b) + 1))
        for i, left in enumerate(a):
            following = [i + 1]
            for j, right in enumerate(b):
                following.append(min(following[-1] + 1, row[j + 1] + 1, row[j] + (left != right)))
            row = following
        assert distance(a, b) == row[-1]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", type=Path, nargs="+")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    self_test()
    results = [item for path in args.reports for item in analyze(json.loads(path.read_text()))]
    args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
