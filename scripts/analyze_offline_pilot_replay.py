#!/usr/bin/env python3
"""Add time-weighted display agreement to a timestamped Auto Pilot replay."""
import argparse
import json
from pathlib import Path


def analyze(replay):
    transitions = replay["transitions"]
    times = [t["at"] for t in transitions]
    if times != sorted(times):
        raise ValueError("Nonchronological display transitions")
    end = max(s["end"] for s in replay["section_results"])
    intervals = [(0, times[0] if times else end, None)]
    intervals.extend((t["at"], transitions[i + 1]["at"] if i + 1 < len(transitions) else end, t.get("id"))
                     for i, t in enumerate(transitions))
    matched_seconds, eligible_seconds = 0.0, 0.0
    for section in replay["section_results"]:
        ids = set(section["expected_ids"])
        if not ids:
            continue
        duration = section["end"] - section["start"]
        correct = sum(max(0, min(b, section["end"]) - max(a, section["start"]))
                      for a, b, identifier in intervals if identifier in ids)
        section["display_agreement_seconds"] = correct
        section["display_agreement_fraction"] = correct / duration
        eligible_seconds += duration
        matched_seconds += correct
    replay["eligible_seconds"] = eligible_seconds
    replay["display_agreement_seconds"] = matched_seconds
    replay["display_agreement_fraction"] = matched_seconds / eligible_seconds if eligible_seconds else None
    replay["timing_note"] = ("Strict agreement during supplied section intervals, using replay decision times; "
                             "early next-line anticipation and delayed acquisition count as disagreement. "
                             "This excludes rendering, asynchronous database I/O and real microphone latency.")
    return replay


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("replays", nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    results = [analyze(item) for path in args.replays for item in json.loads(path.read_text())]
    args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
