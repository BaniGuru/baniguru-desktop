#!/usr/bin/env python3
"""Prepare the two requested recordings without regenerating their references."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from urllib.parse import quote


def prepare(root, relative, name, repository, kirtan, output):
    transcript = root / relative / "aligned_transcript.json"
    data = json.loads(transcript.read_text())
    audio = (transcript.parent / data["audio_file"]).resolve()
    if not audio.is_relative_to(transcript.parent.resolve()):
        raise ValueError("Audio path escapes the selected recording folder")
    sections = data["sections"]
    if not sections or any(not s["transcript"].strip() or s["end_time"] <= s["start_time"] for s in sections):
        raise ValueError("Missing or invalid supplied manual references")
    commit = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    source = f"https://github.com/{repository}/blob/{commit}/{quote(transcript.relative_to(root).as_posix())}"
    manifest = [dict(id=name, audio=str(audio), reference=" ".join(s["transcript"].strip() for s in sections),
                     kirtan=kirtan, source=source, sections=sections)]
    provenance = dict(repository=repository, commit=commit, transcript_path=transcript.relative_to(root).as_posix(),
                      audio_sha256=hashlib.file_digest(audio.open("rb"), "sha256").hexdigest(),
                      transcript_sha256=hashlib.file_digest(transcript.open("rb"), "sha256").hexdigest(), sections=len(sections))
    for suffix, value in (("manifest", manifest), ("provenance", provenance)):
        (output / f"{name}.{suffix}.json").write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sehaj-root", type=Path, required=True)
    parser.add_argument("--kirtan-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    prepare(args.sehaj_root.resolve(), "sggs_giani_mehnga_singh_ang_by_ang/SGGS_Ang_0016 - Giani Mehnga Singh",
            "sehaj-ang16", "BaniGuru/speech-data-sehaj-paath", False, args.output)
    prepare(args.kirtan_root.resolve(), "Bhai Agyakar Singh (1.10pm to 2.20pm) 27-11-2025",
            "agyakar-kirtan", "BaniGuru/speech-data-darbar-sahib-part-1", True, args.output)
