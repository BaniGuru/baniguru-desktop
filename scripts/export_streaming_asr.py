#!/usr/bin/env python3
"""Export the Indic multilingual NeMo checkpoint as a Punjabi cache-aware RNNT.

The checkpoint uses a custom multilingual joint head. Restore the stock NeMo
encoder strictly, and export the Punjabi head with the shared predictor weights.
See scripts/streaming_asr_requirements.txt for the CPU export environment.
"""

import argparse
import hashlib
import json
from pathlib import Path
import sys
import tarfile
import types

import numpy as np
import onnx
import onnxruntime as ort
import torch
from torch import nn
import yaml


def encoder_class():
    """Import inference modules without NeMo's unrelated training/data imports.

    NeMo 1.23's ASR package initializer loads every trainer and dataset. The
    original Indic checkpoint also has custom model classes unavailable in the
    upstream wheel. Only the unchanged Conformer implementation is needed here.
    """
    import nemo

    root = Path(nemo.__file__).parent
    for name in (
        "nemo.collections.common",
        "nemo.collections.asr", "nemo.collections.asr.models",
        "nemo.collections.asr.modules", "nemo.collections.asr.parts",
        "nemo.collections.asr.parts.mixins", "nemo.collections.asr.parts.utils",
    ):
        module = types.ModuleType(name)
        module.__path__ = [str(root.joinpath(*name.split(".")[1:]))]
        sys.modules[name] = module
    config_module = types.ModuleType("nemo.collections.asr.models.configs")

    class CacheAwareStreamingConfig:
        valid_out_len = 0
        drop_extra_pre_encoded = 0

    config_module.CacheAwareStreamingConfig = CacheAwareStreamingConfig
    sys.modules[config_module.__name__] = config_module
    from nemo.collections.asr.modules.conformer_encoder import ConformerEncoder
    return ConformerEncoder


class Encoder(nn.Module):
    def __init__(self, encoder):
        super().__init__()
        self.encoder = encoder

    def forward(self, audio_signal, length, cache_last_channel, cache_last_time, cache_last_channel_len):
        encoded, lengths, channels, times, cache_lengths = self.encoder.forward_internal(
            audio_signal, length, cache_last_channel, cache_last_time, cache_last_channel_len
        )
        return (
            encoded, lengths,
            channels[:, :, -self.encoder.streaming_cfg.last_channel_cache_size:, :],
            times, cache_lengths,
        )


class DecoderJoint(nn.Module):
    def __init__(self, weights, offset, local_vocab, aggregate_vocab, hidden, encoder_hidden):
        super().__init__()
        self.offset, self.blank, self.start = offset, local_vocab, aggregate_vocab
        self.embedding = nn.Embedding(aggregate_vocab + 1, hidden)
        self.lstm = nn.LSTM(hidden, hidden, num_layers=1)
        self.enc = nn.Linear(encoder_hidden, hidden)
        self.pred = nn.Linear(hidden, hidden)
        self.joint = nn.Linear(hidden, local_vocab + 1)
        self.embedding.weight.data.copy_(weights["decoder.prediction.embed.weight"])
        self.lstm.load_state_dict({
            key.removeprefix("decoder.prediction.dec_rnn.lstm."): value
            for key, value in weights.items() if key.startswith("decoder.prediction.dec_rnn.lstm.")
        })
        for name in ("enc", "pred"):
            getattr(self, name).load_state_dict({
                key.removeprefix(f"joint.{name}."): value
                for key, value in weights.items() if key.startswith(f"joint.{name}.")
            })
        self.joint.load_state_dict({
            key.removeprefix("joint.joint_net.2.pa."): value
            for key, value in weights.items() if key.startswith("joint.joint_net.2.pa.")
        })

    def forward(self, encoder_outputs, targets, input_states_1, input_states_2):
        # Public targets remain Punjabi-local IDs. Only the shared embedding
        # sees multilingual IDs; the local blank maps to its global blank row.
        labels = torch.where(targets == self.blank, self.start, targets + self.offset)
        predicted, (h, c) = self.lstm(self.embedding(labels).transpose(0, 1), (input_states_1, input_states_2))
        encoded = self.enc(encoder_outputs.transpose(1, 2)).unsqueeze(2)
        predicted = self.pred(predicted.transpose(0, 1)).unsqueeze(1)
        return self.joint(torch.relu(encoded + predicted)), h, c


def describe(path):
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    session = ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])
    return {kind: [dict(name=value.name, shape=value.shape, type=value.type) for value in values]
            for kind, values in (("inputs", session.get_inputs()), ("outputs", session.get_outputs()))}


def validate(module, path, names, examples):
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    session = ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])
    for example in examples:
        with torch.inference_mode():
            expected = module(*example)
        actual = session.run(None, {name: tensor.numpy() for name, tensor in zip(names, example)})
        for index, (reference, exported) in enumerate(zip(expected, actual)):
            np.testing.assert_allclose(exported, reference.numpy(), atol=2e-4, rtol=2e-3,
                                       err_msg=f"{path.name} output {index} parity")
    print(f"Validated {path.name}: {len(examples)} input/cache cases", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("model", type=Path)
    parser.add_argument("--output", type=Path, default=Path("src-tauri/resources/streaming_asr"))
    args = parser.parse_args()
    torch.set_num_threads(4)
    torch.manual_seed(7)
    output = args.output
    output.mkdir(parents=True, exist_ok=True)

    with tarfile.open(args.model) as archive:
        members = {member.name.removeprefix("./"): member for member in archive}
        config = yaml.safe_load(archive.extractfile(members["model_config.yaml"]))
        weights = torch.load(archive.extractfile(members["model_weights.ckpt"]), map_location="cpu", weights_only=True)
        tokenizer = config["tokenizer"]["langs"]["pa"]["model_path"].removeprefix("nemo:")
        (output / "tokenizer.model").write_bytes(archive.extractfile(members[tokenizer]).read())

    encoder_config = {key: value for key, value in config["encoder"].items() if not key.startswith("_")}
    encoder = encoder_class()(**encoder_config).eval()
    encoder.load_state_dict({key.removeprefix("encoder."): value for key, value in weights.items()
                             if key.startswith("encoder.")}, strict=True)
    encoder.requires_grad_(False)
    # Use one graph for first and subsequent chunks. The runtime prepends two
    # subsampled frames (8 mel frames), zero-filled at stream start.
    encoder.streaming_cfg.drop_extra_pre_encoded = 2
    wrapped = Encoder(encoder).eval()
    caches = encoder.get_initial_cache_state()
    names = ["audio_signal", "length", "cache_last_channel", "cache_last_time", "cache_last_channel_len"]
    output_names = ["outputs", "encoded_lengths", "cache_last_channel_next", "cache_last_time_next", "cache_last_channel_next_len"]
    example = (torch.randn(1, 80, 212), torch.tensor([212]), *caches)
    encoder_path = output / "encoder.onnx"
    torch.onnx.export(wrapped, example, str(encoder_path), input_names=names, output_names=output_names,
                      opset_version=17, dynamic_axes={"audio_signal": {2: "feature_frames"}, "outputs": {2: "encoder_frames"}})
    onnx.checker.check_model(str(encoder_path))
    with torch.inference_mode():
        next_caches = tuple(t.detach() for t in wrapped(*example)[2:])
    validate(wrapped, encoder_path, names, [example,
             (torch.randn(1, 80, 76), torch.tensor([76]), *next_caches),
             (torch.randn(1, 80, 144), torch.tensor([144]), *next_caches)])

    languages = list(config["tokenizer"]["langs"])
    local_vocab = weights["joint.joint_net.2.pa.bias"].numel() - 1
    aggregate_vocab = weights["decoder.prediction.embed.weight"].shape[0] - 1
    hidden = config["model_defaults"]["pred_hidden"]
    offset = languages.index("pa") * local_vocab
    decoder = DecoderJoint(weights, offset, local_vocab, aggregate_vocab, hidden, encoder.d_model).eval()
    decoder.requires_grad_(False)
    decoder_names = ["encoder_outputs", "targets", "input_states_1", "input_states_2"]
    decoder_example = (torch.randn(1, encoder.d_model, 1), torch.tensor([[local_vocab]], dtype=torch.int64),
                       torch.zeros(1, 1, hidden), torch.zeros(1, 1, hidden))
    decoder_path = output / "decoder_joint.onnx"
    torch.onnx.export(decoder, decoder_example, str(decoder_path), input_names=decoder_names,
                      output_names=["outputs", "output_states_1", "output_states_2"], opset_version=17)
    onnx.checker.check_model(str(decoder_path))
    validate(decoder, decoder_path, decoder_names, [decoder_example,
             (torch.randn(1, encoder.d_model, 1), torch.tensor([[42]], dtype=torch.int64),
              torch.randn(1, 1, hidden), torch.randn(1, 1, hidden))])

    for key, name in (("preprocessor.featurizer.fb", "mel_filterbank.npy"),
                      ("preprocessor.featurizer.window", "stft_window.npy")):
        np.save(output / name, weights[key].numpy())
    runtime = dict(
        format_version=1, architecture="cache_aware_conformer_rnnt", language="pa", sample_rate=16000,
        n_fft=512, win_length=400, hop_length=160, n_mels=80, preemph=0.97,
        log_zero_guard_value=2**-24, normalization="per_feature", subsampling_factor=4,
        local_vocab_size=local_vocab, aggregate_vocab_size=aggregate_vocab, punjabi_offset=offset,
        joint_blank_id=local_vocab, predictor_start_id=local_vocab, predictor_hidden_size=hidden,
        max_symbols_per_step=10, encoder="encoder.onnx", decoder_joint="decoder_joint.onnx",
        tokenizer="tokenizer.model", mel_filterbank="mel_filterbank.npy", stft_window="stft_window.npy",
        encoder_hidden_size=encoder.d_model, feature_left_context=8, chunk_feature_frames=204,
        encoded_frame_ms=40, trained_right_context_ms=2000,
        cache_last_channel_shape=list(caches[0].shape), cache_last_time_shape=list(caches[1].shape),
        attention_context=encoder_config["att_context_size"],
        source_checkpoint=args.model.name,
        source_sha256=hashlib.file_digest(args.model.open("rb"), "sha256").hexdigest(),
        nemo_version=config.get("nemo_version"), export_torch_version=torch.__version__,
    )
    (output / "runtime.json").write_text(json.dumps(runtime, indent=2) + "\n")
    (output / "frontend.json").write_text(json.dumps(config["preprocessor"], indent=2) + "\n")
    (output / "onnx_io.json").write_text(json.dumps({"encoder": describe(encoder_path), "decoder_joint": describe(decoder_path)}, indent=2) + "\n")
    print(f"Export complete: {output}", flush=True)


if __name__ == "__main__":
    main()
