# BaniGuru desktop offline update

This archive contains only files added or modified for the offline ASR flow.
Extract it over the root of `baniguru-desktop`.

Before building, copy these existing offline model assets into:
`src-tauri/resources/offline_asr/`

- `encoder-baniguru_kirtan_v1_rnnt.onnx`
- `decoder_joint-baniguru_kirtan_v1_rnnt.onnx`
- `tokenizer.model`
- `mel_filterbank.npy`
- `stft_window.npy`

`runtime.json` is included in this update.

The Settings > Automation panel now contains `Offline`. When enabled the speech
flow invokes the local Tauri ONNX service instead of Soniox. Search mode uses
`useOfflineSearchPilot.tsx` and does not depend on the existing online search
pilot for automatic shabad selection.

Testing note: this environment did not have the Rust toolchain or installed npm
dependencies, so the rebuilt copy could not be compiled here. The pure matcher
test file and Rust unit tests are included so they run in the normal project
environment after dependencies/model assets are present.
