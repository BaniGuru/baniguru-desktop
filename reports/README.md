# Streaming ASR validation

`streaming_asr_validation.json` records complete runs of the four MP3 fixtures:
Darbar Sahib and Asa Ki Vaar in kirtan mode, and Sukhmani Sahib and fast Akhand
paath in sehaj paath mode. It includes the complete live and batch transcripts.

Run the checks from the repository root with FFmpeg on `PATH` and the ONNX
Runtime library available to the Rust `ort` dependency:

```sh
cargo test --manifest-path src-tauri/Cargo.toml streaming_asr::model::tests -- --include-ignored --nocapture --test-threads=1
```

Set `BANI_STREAMING_REPORT` to an absolute JSON output path to save results.
`BANI_TEST_FIXTURE` can select one fixture by filename. DSP dependencies and the
test package are optimized in `Cargo.toml`, because debug FFT timing does not
represent the shipped application. CPU inference uses one worker with spinning
disabled. Timings depend on the machine; this report was run with four CPUs
available in the cloud environment.

The tests check that partial previews leave committed encoder/predictor state
unchanged, that word timestamps do not overlap, and that raw waveform and
feature caches stay bounded. They also enforce the requested word hold limits
and check the repeated Darbar Sahib phrases and Sukhmani word retention.

`live_rtf` is processing time divided by audio duration; values below one mean
the workload is faster than playback. `p95_update_ms` measures each update's
inference work, excluding initial model loading. `maximum_final_lag_ms` is the
commit delay relative to RNNT word alignment, excluding explicit end-of-stream
and silence flushes. Partial text is published on the refresh cadence while
words are still awaiting their commit context.

`wer_vs_batch` and `cer_vs_batch` compare live output with the same model's
batch transcript. The comparison includes online feature normalization and
silence endpoint differences. These are consistency metrics, not error rates
against a manually verified Gurbani transcript.

## Measured limitations

On this CPU, kirtan processing took about 0.74 times the recording duration.
The fixed 340 ms paath replay took 1.25 times the Sukhmani duration and 1.86
times the fast Akhand duration, so this machine cannot sustain every requested
paath preview. The live service drains queued audio before inference and skips
obsolete refresh requests while preserving every captured sample. Its actual
publication cadence therefore depends on inference speed. The tests above
exercise every scheduled preview; they do not establish microphone-to-screen
wall-clock latency or guarantee a 340 ms publication interval.

Asa Ki Vaar also differs substantially from its batch reference (49.5% word
error rate). Full transcripts are included to make that remaining accuracy
limitation reviewable. Cache correctness and bounded hold tests passing do not
establish that every recognized Gurbani word is correct.
