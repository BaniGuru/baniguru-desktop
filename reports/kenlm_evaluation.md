# KenLM integration and evaluation status

The supplied 28,011,615-byte 3-gram binary was downloaded through Git LFS and
verified against SHA256
`91d2a25db0cc5d8c2b292bd7b45eed241df5673f9b68331ed004f96a618e25c6`.
The runtime now uses a four-hypothesis RNNT beam, completed-word KenLM scoring,
and cached split predictor/joint graphs. Greedy and beam-only modes remain
available for comparisons. No evaluation reference enters the decoder.

## Resource-constrained local runs

Runs used CPU affinity 0–3 and a 16 GiB address-space limit. The actual CPU is
an AMD EPYC 9V74; affinity does not emulate Intel i5 performance. The virtual
memory cap is stricter than a 16 GiB resident-memory allowance. Audio is decoded
at 16 kHz and fed at the application's 680/340 ms cadence. These are file-replay
tests, not microphone-to-screen latency measurements.

All four complete local MP3s passed the no-overlap, cache isolation and bounded
word-hold checks. Measurements are in `kenlm_local_validation.json`:

| Recording | Processing/audio time | 95th-percentile update |
| --- | ---: | ---: |
| Darbar Sahib kirtan | 0.283 | 286 ms |
| Asa Ki Vaar kirtan | 0.296 | 303 ms |
| Sukhmani Sahib paath | 0.583 | 321 ms |
| Fast Akhand paath | 0.581 | 323 ms |

Those JSON WER/CER values compare live and batch output from the same model;
they are consistency measures, not manual-reference error rates. Asa Ki Vaar's
live/batch difference remains substantial (39.6% WER).

`kenlm_darbar_comparison.json` separately compares the local Darbar clip with
the expected transcript supplied by the user earlier in this conversation.
NFC and punctuation/whitespace normalization are applied; vowel marks remain.
This is supplemental evidence, not one of the requested Hugging Face tests.

| Decoder | WER | CER | Processing/audio time |
| --- | ---: | ---: | ---: |
| Greedy | 32.26% | 20.66% | 0.259 |
| Beam, without LM | 19.35% | 8.26% | 0.268 |
| Beam + KenLM | 19.35% | 8.26% | 0.276 |

Beam search improved this clip. KenLM produced the same words as beam-only
here, so this sample does not establish an additional LM accuracy gain. Peak
resident memory was below 0.8 GiB in all three comparison runs. Full hypotheses,
reference text, CPU identity, address-space limits and memory readings are saved.

## Search and Pankti regressions

The full 141,267-line `additional_assets/bani.db` was used for integration tests:

- Asa Ki Vaar is identified by distinct Panktis across multiple Shabads, with
  duplicate database copies of a line counted once.
- Asa Ki Vaar advances on completion in kirtan mode; ordinary kirtan waits for
  evidence from the next line.
- Sehaj paath continues through page 25 beyond 40 transcript words and across
  Shabads. Evidence positions remain absolute when the matching window slides.
- The Darbar Sahib Shabad BMK is distinguished from other Shabads that share
  “ਕਰਿ ਕਿਰਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ”.
- Global offline search uses a word index to shortlist 1,200 candidates before
  literal fuzzy matching. Cross-Pankti queries no longer require every word
  to occur in one database line. Loaded-Pankti progression uses JavaScript.

These database tests use canonical text; they do not replace end-to-end ASR
tests on the requested recordings.

## Original Hugging Face datasets: access blocked

After the user published the network changes, the saved configuration was
verified to include Hugging Face and its download hosts, with no pending draft.
Requests from this running session still receive
`Tunnel connection failed: 403 Forbidden` before reaching Hugging Face. The
same read was denied outside the filesystem sandbox as well; GitHub returned
HTTP 200 in the control check. This remains an active-session proxy access
blocker, not an unpublished configuration or a missing Hugging Face token.
At the time of that check, none of the following Hugging Face datasets had
been downloaded or evaluated:

1. `sikhnet/01_-_Bhai_Kamaljeet_Singh_-_Asa_Ki_Vaar_-live_darbar_sahib`
2. `speech-data-sehaj-paath/akhand_paath_sahib_akj_2019_04_15_part_1`
3. `speech-data-sehaj-paath/sggs_giani_mehnga_singh_ang_by_ang/SGGS_Ang_0025 - Giani Mehnga Singh`
4. `speech-data-darbar-sahib/Bhai Agyakar Singh (1.10pm to 2.20pm) 27-11-2025`

The user subsequently supplied accessible GitHub replacements for Ang 0016
sehaj paath and the complete Bhai Agyakar Singh kirtan recording. Those two
recordings have now been evaluated in full with manual references and
partial/final-event pankti replays. See
[the GitHub evaluation report](github_recordings/README.md) for all six decoder
comparisons, timing, remaining alignment misses and source hashes. KenLM gives
3.50% WER / 0.90% CER on paath and 11.57% WER / 7.73% CER on full kirtan output.
The other original Asa Ki Vaar and paath recordings remain outstanding; the
GitHub tests do not validate those different recordings.

## Reproduce

With the native ONNX Runtime library on the link/runtime library paths:

```sh
cargo test --manifest-path src-tauri/Cargo.toml streaming_asr:: -- --include-ignored --test-threads=1
BANI_TEST_DB="$PWD/additional_assets/bani.db" npm test -- --run src/components/SoundSearch/offlineDatabaseReplay.test.ts src/components/SoundSearch/offlinePanktiMatch.test.ts src/components/SoundSearch/offlineTimedTranscript.test.ts
bash scripts/evaluate_streaming_asr.sh MANIFEST.json REPORT.json kenlm
```

The Linux evaluation runner caps the executable to four allowed CPUs and 16 GiB
of virtual address space. Set `BANI_EVAL_CPUS` to override the affinity. It
requires Cargo, a C++ compiler for KenLM, Python 3, FFmpeg, `taskset` and `prlimit`.

The manifest is a JSON array of complete clips:

```json
[{"id":"clip-1","audio":"/absolute/path/audio.mp3","reference":"manual Gurmukhi transcript","kirtan":true,"source":"original reference URL"}]
```

Use the supplied human JSON transcripts to prepare these entries once access
is available. The evaluator runs the streaming decoder directly, records final
and partial events, and scores against the manual reference without generating
a batch transcript. Repeat with `greedy` and `beam` for controlled comparisons.
