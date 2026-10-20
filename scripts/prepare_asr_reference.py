#!/usr/bin/env python3
"""Prepare one complete audio/manual-JSON evaluation without decoding a reference."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def prepare(audio, transcript, clip_id, source, kirtan, output):
    data = json.loads(transcript.read_text())
    if data["audio_file"] != audio.name:
        raise ValueError("The manual JSON names a different audio file")
    sections = data["sections"]
    duration = float(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(audio)
    ], text=True).strip())
    if not sections or any(not s["transcript"].strip() or not 0 <= s["start_time"] < s["end_time"] <= duration + 1 for s in sections):
        raise ValueError("Missing reference text or timestamps outside the recording")
    starts = [s["start_time"] for s in sections]
    if starts != sorted(starts):
        raise ValueError("Reference sections must be chronological")
    output.mkdir(parents=True, exist_ok=True)
    manifest = [dict(id=clip_id, audio=str(audio.resolve()), kirtan=kirtan,
                     reference=" ".join(s["transcript"] for s in sections), sections=sections, source=source)]
    provenance = dict(audio_file=audio.name, sections=len(sections), source=source,
                      container_duration_seconds=duration,
                      audio_sha256=hashlib.file_digest(audio.open("rb"), "sha256").hexdigest(),
                      transcript_sha256=hashlib.file_digest(transcript.open("rb"), "sha256").hexdigest())
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    (output / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--transcript", type=Path, required=True)
    parser.add_argument("--id", required=True)
    parser.add_argument("--source", default="user-supplied manual reference")
    parser.add_argument("--kirtan", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.audio, args.transcript, args.id, args.source, args.kirtan, args.output)
