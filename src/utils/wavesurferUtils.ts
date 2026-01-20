import type WaveSurfer from "wavesurfer.js";

export interface SilenceOptions {
  threshold?: number;
  minSilenceMs?: number;
  stepMs?: number;
  maxSearchMs?: number;
}

interface SilenceSamples {
  start: number;
  end: number;
  seek: number;
}

const DEFAULTS: Required<SilenceOptions> = {
  threshold: 0.02,
  minSilenceMs: 100,
  stepMs: 10,
  maxSearchMs: 1500
};

function getSilenceInDirection(
  waveSurfer: WaveSurfer,
  direction: 1 | -1,
  options: SilenceOptions
): SilenceSamples | null {
  const decoded = waveSurfer.getDecodedData();
  if (!decoded) return null;

  const channel = decoded.getChannelData(0);
  const sampleRate = decoded.sampleRate;

  const {
    threshold,
    minSilenceMs,
    stepMs,
    maxSearchMs
  } = { ...DEFAULTS, ...options };

  const currentSample = Math.floor(
    waveSurfer.getCurrentTime() * sampleRate
  );

  const stepSamples = Math.max(1, Math.floor(stepMs / 1000 * sampleRate));
  const minSilenceSamples = Math.floor(minSilenceMs / 1000 * sampleRate);
  const maxSearchSamples = Math.floor(maxSearchMs / 1000 * sampleRate);

  const isSilent = (i: number) =>
    i >= 0 && i < channel.length && Math.abs(channel[i]) < threshold;

  const snapToSilent = (
    center: number,
    start: number,
    end: number
  ): number | null => {
    if (isSilent(center)) return center;

    for (let d = 1; center - d >= start || center + d <= end; d++) {
      if (center - d >= start && isSilent(center - d)) return center - d;
      if (center + d <= end && isSilent(center + d)) return center + d;
    }

    return null;
  };

  let silenceStart: number | null = null;
  let silenceCount = 0;

  for (
    let i = currentSample;
    i >= 0 &&
    i < channel.length &&
    Math.abs(i - currentSample) <= maxSearchSamples;
    i += direction * stepSamples
  ) {
    if (isSilent(i)) {
      if (silenceStart === null) silenceStart = i;
      silenceCount += stepSamples;
      continue;
    }

    if (silenceStart !== null) {
      if (silenceCount >= minSilenceSamples) {
        const start = Math.min(silenceStart, i);
        const end = Math.max(silenceStart, i);

        const middle = Math.floor((start + end) / 2);
        const seek = snapToSilent(middle, start, end);

        if (seek !== null) {
          return { start, end, seek };
        }
      }

      silenceStart = null;
      silenceCount = 0;
    }
  }

  return null;
}

function getNearestSilenceSamples(
  waveSurfer: WaveSurfer,
  options: SilenceOptions = {}
): SilenceSamples | null {
  // 🔑 forward-first logic
  const forward = getSilenceInDirection(waveSurfer, 1, options);
  if (forward) return forward;

  return getSilenceInDirection(waveSurfer, -1, options);
}

export function seekToNearestSilence(
  waveSurfer: WaveSurfer | null | undefined,
  options: SilenceOptions = {}
): number | undefined {
  if (!waveSurfer) return;

  const silence = getNearestSilenceSamples(waveSurfer, options);

  // ❌ No silence forward or backward → stop
  if (!silence) {
    waveSurfer.pause();
    return;
  }

  const buffer = waveSurfer.getDecodedData();
  if (!buffer) return;

  const targetTime = silence.seek / buffer.sampleRate;

  waveSurfer.seekTo(targetTime / waveSurfer.getDuration());

  return targetTime;
}
