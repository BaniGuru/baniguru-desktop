# Punjabi streaming RNNT

Exported from `raw_models/baniguru_kirtan_stream_v3.nemo` at repository commit
`959d300`. The source checkpoint SHA256 and the tensor contract are recorded in
`runtime.json` and `onnx_io.json`.

The encoder retains attention and causal convolution caches across committed
chunks. Its trained attention context is 204 frames left and 50 frames right,
with a 40 ms encoder frame interval. A complete chunk consumes 204 mel frames
(2.04 seconds), producing 51 encoder frames. Shorter inputs can be decoded
provisionally from a saved cache without committing their output caches.

Each input prepends eight mel frames for the subsampling convolution. At stream
start these frames are zeros. For later calls they come from the preceding
features. The graph drops the corresponding first two subsampled frames, so
output frame zero always refers to the first new feature frame. Encoder cache
dimensions use `[layers, batch, time, 2 * channels]` for attention and
`[layers, batch, channels, time]` for convolution. Batch size is one.

Attention cache entries concatenate the already projected keys and values.
Relative position projections are precomputed for the supported chunk sizes.
Both changes preserve the original full-precision attention calculation, masks
and context, while avoiding repeated matrix multiplications over cached history.
The exporter verifies sequential outputs against the unchanged NeMo encoder
before checking ONNX parity. Runtime format version 2 identifies this cache.

`decoder_joint.onnx` contains the original shared embedding/LSTM, the encoder
and predictor projections, and the original Punjabi language head. Targets are
Punjabi-local IDs (0–255); ID 256 starts the predictor. This checkpoint's custom
multisoftmax predictor uses local embedding rows for emitted labels; its start
label uses the aggregate blank row (5632). Applying the Punjabi aggregate offset
to predictor labels produces incorrect repeated fragments. Blank output 256 advances an encoder
frame without advancing the predictor state. Carry both LSTM states and the
last emitted label between calls.

The frontend uses the checkpoint's exact mel filterbank and Hann window. Input
audio is mono 16 kHz; FFT size is 512, window 400, hop 160, preemphasis 0.97,
and normalization is per feature. Dither is disabled for deterministic inference.

## Reproduce the export

Use a separate Python environment:

```sh
pip install torch==2.5.1+cpu torchaudio==2.5.1+cpu --index-url https://download.pytorch.org/whl/cpu
pip install --no-deps nemo_toolkit==1.23.0
pip install -r scripts/streaming_asr_requirements.txt
python scripts/export_streaming_asr.py raw_models/baniguru_kirtan_stream_v3.nemo
```

The exporter loads all encoder weights strictly, checks both ONNX graphs, and
compares PyTorch/ONNX outputs for full and partial chunks, populated encoder
caches, the predictor start label, and a Punjabi label with nonzero LSTM state.
The source uses a custom multilingual NeMo head; the exporter restores the
unchanged upstream Conformer and reconstructs that head directly from its
weights, avoiding unrelated training and tokenizer imports.

## Desktop behavior

Both offline Auto Pilot modes use this model. Kirtan refreshes every 680 ms and
sehaj paath every 340 ms. Completed words receive two seconds of right context.
A trailing word remains provisional until a following word boundary is known,
with a maximum hold of six seconds for kirtan and three seconds for paath. The
commit deadline reserves one refresh interval to stay within those bounds.

Complete acoustic chunks and predictor states are cached. Partial previews
replay only the unresolved chunk from the saved state and never change that
state. Text commits append once; the UI replaces the partial suffix without
using rolling-window duplicate heuristics. Each STFT frame is computed once.
Running per-feature sums and variances retain the utterance's normalization
statistics after older features leave memory. Only the subsampling overlap and
unresolved feature chunk remain in the frontend cache, and the waveform buffer
retains the overlap needed for the next FFT.

CPU sessions disable idle spinning. During synchronous inference on x86-64,
denormal flushing is enabled on the calling worker and its prior floating-point
mode is restored afterwards; the ONNX pool receives the same setting. This
avoids slow arithmetic on negligible values near zero while retaining FP32
weights and tensors.

Two seconds of silence flushes the final word and resets utterance caches.
Stopping Auto Pilot drains captured audio and flushes its remaining hypothesis.

## KenLM and RNNT beam search

The default decoder keeps four RNNT hypotheses and adds the supplied Gurbani
3-gram's evidence when a SentencePiece boundary completes a word. The binary
is `gurbani_3gram.bin`, from `BaniGuru/darbar-sahib-live/kirtan_stream_model`;
its SHA256 is recorded in `runtime.json`. Fetch it and all ONNX assets with
Git LFS. KenLM queries run in Rust through `kenlm-rs`'s native query-only C++
library; Python and a KenLM server are not needed by the application.

`predictor.onnx` contains the original embedding, LSTM and predictor projection.
`joint.onnx` contains the acoustic projection and Punjabi joint head. Their
weights and local-label convention match `decoder_joint.onnx`; the exporter
checks split/combined equivalence and ONNX parity at batch sizes one and four.
The runtime caches predictor outputs across blank frames and batches the joint
over the active beam. `decoder_joint.onnx` remains an independent greedy
reference used by the parity test.

Only completed words advance the language context. The unfinished edge word
remains acoustic and mutable. The scorer keeps the last two words, requires a
real trigram match, and applies a bounded conditional-versus-unigram score at
weight 0.3. Unknown words and short/backed-off contexts receive no LM reward.
Equivalent RNNT alignments sum their probabilities. Previews copy the beam;
final text prunes alternatives to the committed prefix so it cannot be revised.

For reproducible comparisons, set `BANI_ASR_DECODING` to `greedy`, `beam`, or
`kenlm` (default). `BANI_ASR_BEAM_WIDTH` accepts 1–8 (default 4) and
`BANI_ASR_LM_WEIGHT` accepts 0–1 (default 0.3). These are development overrides;
the application's kirtan/paath refresh and edge-context settings remain the same.

The encoder still uses its trained right context and cache tensor contract.
Do not substitute the other project's 202/100 encoder or CTC head: they use
a different context/cache contract and are not inputs to this RNNT decoder.
