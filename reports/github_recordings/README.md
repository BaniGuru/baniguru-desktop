# Full-recording GitHub evaluation

Both recordings requested by the user were replayed completely through the
streaming Rust decoder, using the supplied `aligned_transcript.json` as the
reference. No batch-generated transcript or reference text enters decoding.

| Recording | Decoded duration | Reference sections |
| --- | ---: | ---: |
| Giani Mehnga Singh, SGGS Ang 0016 | 214.848 s | 40 |
| Bhai Agyakar Singh, 27 November 2025 | 3,971.187 s (66 min) | 263 |

[provenance.json](provenance.json) pins both source repositories, commits and
audio/transcript SHA256 hashes. These are the user-selected GitHub replacements;
the original Hugging Face Asa Ki Vaar and other paath recordings remain untested.

## Transcription accuracy

Every row below is a complete streaming run of the recording. Beam width is
four; KenLM weight is 0.3. All other model, feature, refresh and endpoint settings
are shared. Refresh is 340 ms for paath and 680 ms for kirtan.

| Recording | Decoder | WER | CER |
| --- | --- | ---: | ---: |
| Sehaj paath | Greedy | 16.08% | 4.30% |
| Sehaj paath | Beam without LM | 8.04% | 2.24% |
| Sehaj paath | Beam + KenLM | **3.50%** | **0.90%** |
| Kirtan | Greedy | 15.16% | 9.86% |
| Kirtan | Beam without LM | 12.26% | 8.11% |
| Kirtan | Beam + KenLM | **11.57%** | **7.73%** |

WER and CER are exact unit-cost Levenshtein distances after NFC and
punctuation/whitespace normalization; vowel marks remain significant. CER
excludes spaces. An independent Python scorer verifies the Rust scores.
[asr_results.json](asr_results.json) contains all references, hypotheses,
per-section errors, performance and memory measurements for all six runs.

The kirtan JSON annotates 3,039.473 seconds, approximately 76.5% of the audio.
It is not an exhaustive annotation of every interval. Restricting the KenLM
hypothesis to annotated intervals gives **10.75% WER / 6.85% CER**. Its 29
predicted words outside those intervals are saved separately; they are not
automatically classified as hallucinations. All six runs have **zero overlapping
final word timestamps**. This check alone does not prove the absence of every
lexical insertion or deletion; those are reflected in WER.

## Search and pankti progression

The actual KenLM partial/final events were replayed against all 141,267 lines
of `additional_assets/bani.db`, using the same pure search-decision and cursor
functions as the desktop hooks. The replay supplies neither the expected
line ID nor the reference text to matching. Expected labels are used only for
scoring afterward.

| Recording | Sections reached | Strict time-weighted display agreement |
| --- | ---: | ---: |
| Sehaj paath | **40/40** exact manual line IDs | **92.99%** |
| Kirtan | **231/235** mapped sections | **81.05%** |

“Reached” means a candidate line was displayed within the supplied section
interval, allowing one second before and two seconds after. It does not mean
that line remained displayed throughout the section. The stricter agreement
column measures the fraction of annotated time displaying an expected line,
without that tolerance. Early paath anticipation also counts as disagreement.
It excludes rendering, asynchronous database I/O and microphone latency.

Kirtan has no manual database IDs. Its expected IDs are approximate candidates
sharing reference trigrams with database lines; 28 of the 263 sections cannot
be mapped confidently and are excluded from matching coverage. Coverage is
therefore not independently human-verified pankti accuracy. First acquisition
occurs at 3.746 seconds for paath and 40.132 seconds for kirtan, which begins
with repeated chanting. The kirtan replay selects 13 distinct shabads and makes
219 global searches across the full recording; loaded-pankti progression uses
local JavaScript matching.

Changes prompted by the replay:

- Preserve absolute evidence positions as transcript history slides.
- Preload canonical next shabads in paath and retain repeated next headings.
- Prefer fresh line evidence over longer old matches; permit confirmed repeat
  lines in ordinary kirtan while preserving canonical paath and Asa progression.
- Confirm unique two-word kirtan repeats over two audio observations; this
  improved time agreement from 77.36% to 81.05% with unchanged section coverage.
- Deliver unchanged hypotheses on new audio observations without duplicating
  text, so held words can supply a second confirmation.
- Reject generic repeated chants during global selection, reuse candidates for
  confirmations and search again when recent speech leaves the loaded shabad
  or an Asa Ki Vaar excerpt. Stale bani evidence no longer blocks a fresh shabad.

The four remaining mapped misses are sections 3 (`ਡੰਡਉਤਿ ਬੰਦਨ ਅਨਿਕ ਬਾਰ`),
13 (the long `ਧੰਨੁ ਧੰਨੁ…` greeting), 118 (`ਮੇਰਉ ਮੇਰਉ ਸਭੈ ਕਹਤ ਹੈ`) and
130 (`ਝੂਠੀ ਜੇ ਕੀ ਪ੍ਰੀਤ…`). Some other switches are delayed, as the time
agreement score shows. [pilot_results.json](pilot_results.json) saves every
transition, expected candidate, section result and timing fraction.

## CPU and memory limits

The machine is an **AMD EPYC 9V74**, not an Intel i5. Each executable was
restricted to CPUs 0–3 and a 16 GiB virtual-address-space limit, with one thread
per ONNX session. Runs overlapped on the same four-core CPU allocation, so
these are resource-constrained throughput measurements, not isolated i5
benchmarks or microphone-to-screen latency measurements.

| KenLM run | Processing/audio time | p95 update | Peak process RSS |
| --- | ---: | ---: | ---: |
| Sehaj paath | 0.744 | 439 ms | 0.783 GiB |
| Kirtan | 0.389 | 447 ms | 1.267 GiB |

Both average processing rates are faster than playback. The paath p95 exceeds
its 340 ms refresh, so this test does not establish that every update meets its
deadline. The model's acoustic context and word-finalization delay also remain
present regardless of processing speed.

## Reproduce

Clone the two repositories at the commits in `provenance.json` (a sparse
checkout of the selected folders is sufficient), then prepare references:

```sh
python3 scripts/prepare_github_asr_evaluation.py \
  --sehaj-root /path/to/speech-data-sehaj-paath \
  --kirtan-root /path/to/speech-data-darbar-sahib-part-1 \
  --output /tmp/github-asr-evaluation
```

With Cargo, a C++ compiler, Python, FFmpeg, taskset, prlimit and native ONNX
Runtime configured, run each manifest once per decoder:

```sh
bash scripts/evaluate_streaming_asr.sh /tmp/github-asr-evaluation/sehaj-ang16.manifest.json /tmp/sehaj-kenlm.json kenlm
bash scripts/evaluate_streaming_asr.sh /tmp/github-asr-evaluation/agyakar-kirtan.manifest.json /tmp/agyakar-kenlm.json kenlm
# Repeat with greedy and beam, giving each report a distinct output path.
python3 scripts/analyze_asr_reference_results.py /tmp/sehaj-kenlm.json /tmp/agyakar-kenlm.json --output /tmp/asr-results.json
```

The raw evaluator JSON includes every ASR event and timestamped final word.
Replay each raw KenLM report through the desktop matching code:

```sh
BANI_TEST_DB="$PWD/additional_assets/bani.db" \
BANI_RECORDING_REPLAY=/tmp/sehaj-kenlm.json \
BANI_RECORDING_REPLAY_OUTPUT=/tmp/sehaj-pilot.json \
npm test -- --run src/components/SoundSearch/offlineRecordingReplay.test.ts

BANI_TEST_DB="$PWD/additional_assets/bani.db" \
BANI_RECORDING_REPLAY=/tmp/agyakar-kenlm.json \
BANI_RECORDING_REPLAY_OUTPUT=/tmp/agyakar-pilot.json \
npm test -- --run src/components/SoundSearch/offlineRecordingReplay.test.ts

python3 scripts/analyze_offline_pilot_replay.py /tmp/sehaj-pilot.json /tmp/agyakar-pilot.json --output /tmp/pilot-results.json
```

All six complete ASR runs passed. Final verification also passed 51 frontend
unit/database/paath-replay tests, the separate full kirtan replay, 27 ordinary
Rust tests (six expensive tests excluded from that ordinary invocation), and
the production frontend build. Full raw reports and logs from this workspace
are under `/workspace/scratch/github-asr-evaluation`.
