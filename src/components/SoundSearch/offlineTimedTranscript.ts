export type OfflineTimedWord = {
  word: string;
  start_ms: number;
  end_ms: number;
};

// RNNT word timing can move slightly between overlapping windows. Keep this
// tolerance narrow so quick repetitions of the same word remain distinct.
const SAME_WORD_TIMING_JITTER_MS = 180;

const normalizeWord = (word: string) =>
  word.normalize("NFC").toLocaleLowerCase().replace(/[,.|;:!?।॥]/g, "");

/** Merge successive rolling-window hypotheses without losing words that slid out of the window. */
export const mergeOfflineTimedWords = (
  previous: OfflineTimedWord[],
  incoming: OfflineTimedWord[],
): OfflineTimedWord[] => {
  const merged = [...previous];

  for (const word of incoming) {
    if (!word.word?.trim() || !Number.isFinite(word.start_ms) || !Number.isFinite(word.end_ms)) {
      continue;
    }

    const normalized = normalizeWord(word.word);
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < merged.length; index++) {
      const prior = merged[index];
      const distance = Math.abs(prior.start_ms - word.start_ms);
      if (distance >= bestDistance) continue;

      const sameWord = normalizeWord(prior.word) === normalized;
      const priorDuration = Math.max(1, prior.end_ms - prior.start_ms);
      const nextDuration = Math.max(1, word.end_ms - word.start_ms);
      const overlapMs = Math.max(
        0,
        Math.min(prior.end_ms, word.end_ms) - Math.max(prior.start_ms, word.start_ms),
      );
      const overlapRatio = overlapMs / Math.min(priorDuration, nextDuration);
      const sameAudioPosition = nextDuration <= 1_800 && overlapRatio >= 0.5;
      if ((sameWord && distance <= SAME_WORD_TIMING_JITTER_MS) || sameAudioPosition) {
        bestIndex = index;
        bestDistance = distance;
      }
    }

    if (bestIndex >= 0) {
      merged[bestIndex] = word;
    } else {
      merged.push(word);
    }
  }

  return merged.sort((left, right) =>
    left.start_ms - right.start_ms || left.end_ms - right.end_ms
  );
};

/** Merge only newly committed words into history, then overlay the current partial. */
export const mergeOfflineTranscriptUpdate = (
  committed: OfflineTimedWord[],
  newlyCommitted: OfflineTimedWord[],
  currentPartial: OfflineTimedWord[],
) => {
  const nextCommitted = mergeOfflineTimedWords(committed, newlyCommitted);
  return {
    committed: nextCommitted,
    visible: mergeOfflineTimedWords(nextCommitted, currentPartial),
  };
};
