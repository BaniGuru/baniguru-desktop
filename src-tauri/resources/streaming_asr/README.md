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
dimensions use `[layers, batch, time, channels]` for attention and
`[layers, batch, channels, time]` for convolution. Batch size is one.

`decoder_joint.onnx` contains the original shared embedding/LSTM, the encoder
and predictor projections, and the original Punjabi language head. Targets are
Punjabi-local IDs (0–255); ID 256 starts the predictor. The graph maps these to
the correct multilingual embedding rows. Blank output 256 advances an encoder
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
