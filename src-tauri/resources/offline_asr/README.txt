BaniGuru offline ASR assets

Copy the already-exported offline RNNT runtime files into this folder:

  encoder-baniguru_kirtan_v1_rnnt.onnx
  decoder_joint-baniguru_kirtan_v1_rnnt.onnx
  runtime.json
  tokenizer.model
  mel_filterbank.npy
  stft_window.npy

The desktop build bundles this folder as a Tauri resource. The model is the offline
RNNT pair, not the 224/27 cache-aware streaming encoder.
