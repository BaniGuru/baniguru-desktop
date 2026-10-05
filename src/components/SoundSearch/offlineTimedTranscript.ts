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

const overlapsSameAudioPosition = (prior: OfflineTimedWord, next: OfflineTimedWord) => {
  const priorDuration = Math.max(1, prior.end_ms - prior.start_ms);
  const nextDuration = Math.max(1, next.end_ms - next.start_ms);
  const overlapMs = Math.max(
    0,
    Math.min(prior.end_ms, next.end_ms) - Math.max(prior.start_ms, next.start_ms),
  );
  return nextDuration <= 1_800 && overlapMs / Math.min(priorDuration, nextDuration) >= 0.5;
};

const isValidWord = (word: OfflineTimedWord) =>
  Boolean(word.word?.trim()) && Number.isFinite(word.start_ms) && Number.isFinite(word.end_ms);

/** Stable commits may be deduplicated, but a different token must never erase one. */
const mergeCommittedWords = (
  previous: OfflineTimedWord[],
  incoming: OfflineTimedWord[],
): OfflineTimedWord[] => {
  const merged = [...previous];
  for (const word of incoming) {
    if (!isValidWord(word)) continue;
    const normalized = normalizeWord(word.word);
    const duplicateIndex = merged.findIndex(prior =>
      normalizeWord(prior.word) === normalized &&
      Math.abs(prior.start_ms - word.start_ms) <= SAME_WORD_TIMING_JITTER_MS
    );
    if (duplicateIndex >= 0) merged[duplicateIndex] = word;
    else merged.push(word);
  }
  return merged.sort((left, right) =>
    left.start_ms - right.start_ms || left.end_ms - right.end_ms
  );
};

/** Merge successive rolling-window hypotheses without losing words that slid out of the window. */
export const mergeOfflineTimedWords = (
  previous: OfflineTimedWord[],
  incoming: OfflineTimedWord[],
): OfflineTimedWord[] => {
  const merged = [...previous];

  for (const word of incoming) {
    if (!isValidWord(word)) continue;

    const normalized = normalizeWord(word.word);
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < merged.length; index++) {
      const prior = merged[index];
      const distance = Math.abs(prior.start_ms - word.start_ms);
      if (distance >= bestDistance) continue;

      const sameWord = normalizeWord(prior.word) === normalized;
      const sameAudioPosition = overlapsSameAudioPosition(prior, word);
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
  const nextCommitted = mergeCommittedWords(committed, newlyCommitted);
  // A provisional changed token can revise another provisional token, but it
  // must not overwrite a committed word at the same inferred audio position.
  const safePartial = currentPartial.filter(word =>
    isValidWord(word) && !nextCommitted.some(prior =>
      normalizeWord(prior.word) !== normalizeWord(word.word) &&
      overlapsSameAudioPosition(prior, word)
    )
  );
  return {
    committed: nextCommitted,
    visible: mergeOfflineTimedWords(nextCommitted, safePartial),
  };
};
