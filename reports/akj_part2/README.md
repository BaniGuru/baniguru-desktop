# Sehaj paath: AKJ 2019, part 2

The user supplied the MP3 and its `aligned_transcript.json` after the requested
Hugging Face URL returned a proxy 403. The JSON contains 261 human-transcribed
sections. The complete recording is evaluated with the production streaming
KenLM decoder in paath mode (340 ms refresh); the reference is never supplied
to decoding or automatic matching. Source and attachment hashes are saved in
[provenance.json](provenance.json).

## Complete-audio results

| Measurement | Result |
| --- | ---: |
| Decoded audio | 1,784.607 seconds (29 min 44.6 s) |
| Reference words | 3,714 |
| Word error rate | **32.23%** (1,197 word edits) |
| Character error rate | **14.94%** (2,133 character edits) |
| Processing/audio time | 0.544 |
| 95th-percentile update | 299.9 ms |
| Peak decoder process RSS | 1.011 GiB |
| Overlapping final word timestamps | 0 |

The full recording completed in 971.45 seconds of processing. The primary
scores are substantially worse than on the previously tested Ang 0016 clip;
this change does not fix this recording's ASR spelling, insertion and deletion
errors. Upcoming canonical text is visible independently of the highlight,
and matching uses its existing matra-tolerant normalization to handle some noise.
Zero overlapping timestamps does not mean zero duplicated or missing words.

Restricting the hypothesis to the supplied annotated intervals gives 33.14%
WER / 16.34% CER. There are 129 predicted words outside those intervals; many
occur at section boundaries, and they are not automatically classified as
hallucinations. [asr_results.json](asr_results.json) includes the complete
reference, hypothesis, per-section differences and machine measurements.

The actual ASR-event replay reaches **250/251 mappable sections (99.60%)**
across all **37 Shabads**, continuing through Ang 24 at the end of the clip.
Its maximum transition is two lines forward or backward. Two nearby backward
corrections occur at 300.566 and 579.706 seconds; no distant jump or permanent
stall occurs in this replay. The remaining mapped miss is section 231,
`ਵਣਜੁ ਕਰਹੁ ਵਣਜਾਰਿਹੋ ਵਖਰੁ ਲੇਹੁ ਸਮਾਲਿ`.

Strict time-weighted candidate agreement is **69.93%**, so reaching almost all
sections does not establish timely highlighting throughout them. Upcoming
rows remain visible independently. Initial acquisition takes 4.426 seconds;
four global searches occur before acquisition, with subsequent progression
using local matching and canonical preloading. Ten reference sections cannot
be mapped confidently. [pilot_results.json](pilot_results.json) includes the
full transition timeline, approximate expected IDs, corrections and misses.

## Scrolling reader

When the kirtan flag is off, the main display now shows Gurmukhi, Punjabi meaning
and English translation in adjacent columns. Upcoming lines are already visible
before ASR confirms their highlight, so readers do not need to wait for the next
single-line screen. Punjabi and English columns follow the visibility settings.

The reader keeps the preceding ang, the active ang and upcoming angs ready,
with a maximum of four adjacent angs in its page cache and rendered document.
Scrolling toward the bottom loads more and evicts older pages, preserving the
visible row's position. Manual wheel, touch and keyboard scrolling pauses
following; **Follow paath** returns to the active line. Selecting a row moves
the active pankti. Loading failures expose Retry and retain a bounded fallback
around the current line. The kirtan display keeps its existing presentation.

[paath-reader.png](paath-reader.png) shows the three-column reader using actual
database text and translations. [ui-smoke.json](ui-smoke.json) records a Chromium
functional check with four-page loading, forward eviction, row selection,
manual browsing and return to following, language visibility, keyboard-event
isolation and recovery from an injected database failure. The test uses the
production reader with fixture-backed page I/O, rather than a Tauri WebView.
The largest measured shift of a retained visible row during eviction is 0.5 px.
It verifies bounded retained pages and DOM rows, not a heap-leak profile.

## Matching safeguards

- Paath matches only two lines behind through three lines ahead of the cursor.
  A jump past an intermediate line requires at least three exact normalized
  words. Old transcript evidence cannot cause another advance.
- A nearby backward correction requires three exact normalized words observed
  on two distinct audio updates. Re-rendering one update does not count twice.
- Fresh supported words outrank older forward matches, allowing correction of
  an overshoot rather than remaining trapped by stale evidence.
- On completion of a line, the existing final-word confirmation can anticipate
  the next line. The reader exposes upcoming lines independently of this timing.
- Automatic continuous-paath acquisition loads the canonical Shabad, rather
  than choosing a Bani merely because the matched line belongs to an anthology.
  Explicitly selected Banis remain supported. Next Shabads are preloaded.

The transcript-only diagnostic originally acquired Rehras Sahib (Bani 7) from
the opening SGGS line. That anthology branches away from the Ang being read and
the control stalled around three minutes. Canonical source acquisition lets
the control follow Angs 11–24 across 37 Shabads and reach all 251 mappable
reference sections. See [manual_control_diagnostic.json](manual_control_diagnostic.json).
This diagnostic uses manual text and must not be interpreted as ASR accuracy.

## Scoring and limits

WER and CER use exact Levenshtein distance after NFC and punctuation/whitespace
normalization, preserving vowel marks; CER excludes spaces. Complete final text
is compared with the supplied manual transcript. Separate annotated-interval
scores account for gaps in the manual sections. Per-section boundary scores
are sensitive to timestamp assignment.

The JSON does not contain database line IDs, and several sections span multiple
panktis. Replay labels are approximate database candidates sharing reference
trigrams; unmappable sections are excluded. Section coverage means a candidate
was reached within the section interval, with a one-second lead/two-second lag
tolerance. Strict time-weighted agreement has no such tolerance and does not
measure how much upcoming text was visible in the scrolling reader. Neither
metric is human-verified word-level highlight timing.

The CPU is AMD EPYC 9V74, with decoder affinity restricted to four CPUs and a
16 GiB virtual-address limit. It is not an Intel i5 benchmark. Other validation
work ran concurrently. File-replay processing speed excludes microphone,
rendering and asynchronous database latency; the existing acoustic right
context and word-finalization hold still apply.

## Reproduce

With the existing native ONNX Runtime, Cargo/C++ dependencies, Python, FFmpeg,
taskset and prlimit configured:

```sh
python3 scripts/prepare_asr_reference.py \
  --audio /path/to/akhand_paath_sahib_akj_2019_04_15_part_2.mp3 \
  --transcript /path/to/aligned_transcript.json \
  --id akj-part2 --output /tmp/akj-part2
bash scripts/evaluate_streaming_asr.sh /tmp/akj-part2/manifest.json /tmp/akj-part2/kenlm.json kenlm
python3 scripts/analyze_asr_reference_results.py /tmp/akj-part2/kenlm.json --output /tmp/akj-part2/asr_results.json

BANI_TEST_DB="$PWD/additional_assets/bani.db" \
BANI_RECORDING_REPLAY=/tmp/akj-part2/kenlm.json \
BANI_RECORDING_REPLAY_OUTPUT=/tmp/akj-part2/pilot.json \
npm test -- --run src/components/SoundSearch/offlineRecordingReplay.test.ts
python3 scripts/analyze_offline_pilot_replay.py /tmp/akj-part2/pilot.json --output /tmp/akj-part2/pilot_results.json
```

The manifest can also be passed to `BANI_RECORDING_REPLAY` for the separate
manual-text control. Ordinary matching, page-loading, cache and real-database
checks run with `BANI_TEST_DB="$PWD/additional_assets/bani.db" npm test -- --run`.
Raw decoder events, logs and the temporary browser harness are retained under
`/workspace/scratch/akj-part2-evaluation` in this workspace.

Validation passed: the complete native audio evaluation; 61 frontend tests
including the separate Ang 0016 replay (40/40 exact manual line IDs), real
SQLite ang/translation loading and cache traversal through all 1,430 angs;
the full part-2 matching replay; Chromium functional checks; and the production
frontend build. The ordinary suite can also include the full part-2 replay by
setting `BANI_RECORDING_REPLAY` to its raw decoder report.
