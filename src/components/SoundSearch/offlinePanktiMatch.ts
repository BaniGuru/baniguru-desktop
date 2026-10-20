import levenshtein from "fast-levenshtein";
import { removeMatras } from "./SpeechHelper";

export type OfflineCandidate = { id: string; gurmukhi_speech: string };
export type OfflineMatch = OfflineCandidate & { score: number };
export type OfflineWordMatch = {
  panktiIdx: number;
  matchedWords: number;
  exactWords: number;
  tokenEndIndex: number;
};
export type PendingOfflinePanktiMatch = { panktiIdx: number; confirmations: number } | null;
export type OfflineShabadCandidate = OfflineCandidate & {
  shabad_id?: string;
  order_id?: number;
};

export const normalizeOfflineText = (text: string) =>
  removeMatras(text.normalize("NFC").replace(/([ਕ-ਹ])ਿਰ/g, "$1੍ਰਿ"))
    .replace(/[,.|;:!?।॥]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const scoreBestSubstring = (query: string, candidate: string) => {
  const scorePhraseWithin = (phrase: string, text: string) => {
    const phraseWords = phrase.split(" ").filter(Boolean);
    const textWords = text.split(" ").filter(Boolean);
    let best = 0;

    for (let start = 0; start < textWords.length; start++) {
      for (let length = Math.max(1, phraseWords.length - 1); length <= phraseWords.length + 1; length++) {
        const segment = textWords.slice(start, start + length).join(" ");
        if (!segment) continue;
        const denominator = Math.max(phrase.length, segment.length);
        const score = 1 - levenshtein.get(phrase, segment) / denominator;
        best = Math.max(best, score);
      }
    }

    return best;
  };

  // ASR windows can contain several lines. Match both a short transcript inside
  // a longer pankti and a pankti inside a longer transcript window.
  return Math.max(
    scorePhraseWithin(query, candidate),
    scorePhraseWithin(candidate, query),
  );
};

const normalizedWordCache = new Map<string, string>();
const normalizedPanktiCache = new Map<string, string[]>();
const wordMatchCache = new Map<string, boolean>();

const cacheValue = <T,>(cache: Map<string, T>, key: string, create: () => T): T => {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const value = create();
  if (cache.size >= 2_048) cache.clear();
  cache.set(key, value);
  return value;
};

const normalizeOfflineWord = (word: string) =>
  cacheValue(normalizedWordCache, word, () => normalizeOfflineText(word));

const normalizeOfflinePankti = (speech: string) =>
  cacheValue(normalizedPanktiCache, speech, () =>
    normalizeOfflineText(speech).split(" ").filter(Boolean)
  );

const wordsMatchNormalizedOffline = (a: string, b: string) => {
  const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
  return cacheValue(wordMatchCache, key, () => {
    if (!a || !b) return false;
    if (a === b) return true;
    const shortest = Math.min(a.length, b.length);
    if (shortest < 3 || Math.abs(a.length - b.length) > 1) return false;
    // ASR often changes more than one code point in a longer Punjabi word, while
    // matra removal keeps small spelling differences cheap to compare.
    return levenshtein.get(a, b) <= (shortest >= 7 ? 2 : 1);
  });
};

const wordsMatchOffline = (left: string, right: string) => {
  return wordsMatchNormalizedOffline(normalizeOfflineWord(left), normalizeOfflineWord(right));
};

/** Do not let a shared opening header identify a different Shabad. */
export const buildOfflineShabadMatchSequence = <T extends Pick<OfflineCandidate, "gurmukhi_speech">>(
  currentPanktis: T[],
  nextPanktis: T[],
  includeSharedOpening = false,
) => {
  const currentOpening = currentPanktis[0]?.gurmukhi_speech;
  const nextOpening = nextPanktis[0]?.gurmukhi_speech;
  const skipNextOpening = Boolean(
    !includeSharedOpening && currentOpening && nextOpening &&
    normalizeOfflineText(currentOpening) === normalizeOfflineText(nextOpening)
  );

  return {
    panktis: [...currentPanktis, ...nextPanktis.slice(skipNextOpening ? 1 : 0)],
    skippedNextPanktis: skipNextOpening ? 1 : 0,
  };
};

/** Find a uniquely supported Pankti in a loaded Shabad using an ordered word run. */
export const findStrongOfflinePanktiMatch = (
  panktis: Array<Pick<OfflineCandidate, "gurmukhi_speech">>,
  transcript: string,
  minimumWords = 2,
  currentPanktiIdx = -1,
): OfflineWordMatch | null => {
  const allTokens = normalizeOfflineText(transcript).split(" ").filter(Boolean);
  const tokenOffset = Math.max(0, allTokens.length - 40);
  const tokens = allTokens.slice(tokenOffset).map(normalizeOfflineWord);
  if (tokens.length < minimumWords) return null;

  const matches: OfflineWordMatch[] = [];
  panktis.forEach((pankti, panktiIdx) => {
    const words = normalizeOfflinePankti(pankti.gurmukhi_speech);
    let best: OfflineWordMatch | null = null;

    for (let panktiStart = 0; panktiStart < words.length; panktiStart++) {
      for (let tokenStart = 0; tokenStart < tokens.length; tokenStart++) {
        let matchedWords = 0;
        let exactWords = 0;
        while (
          panktiStart + matchedWords < words.length &&
          tokenStart + matchedWords < tokens.length &&
          wordsMatchNormalizedOffline(words[panktiStart + matchedWords], tokens[tokenStart + matchedWords])
        ) {
          if (words[panktiStart + matchedWords] === tokens[tokenStart + matchedWords]) exactWords++;
          matchedWords++;
        }

        const current: OfflineWordMatch = {
          panktiIdx,
          matchedWords,
          exactWords,
          tokenEndIndex: tokenOffset + tokenStart + matchedWords - 1,
        };
        if (matchedWords < minimumWords) continue;
        if (
          !best ||
          current.tokenEndIndex > best.tokenEndIndex ||
          (current.tokenEndIndex === best.tokenEndIndex && current.matchedWords > best.matchedWords) ||
          (current.tokenEndIndex === best.tokenEndIndex && current.matchedWords === best.matchedWords && current.exactWords > best.exactWords)
        ) {
          best = current;
        }
      }
    }

    if (best && best.matchedWords >= minimumWords) matches.push(best);
  });

  matches.sort((left, right) =>
    // The newest supported line should become active even when an older line
    // has a longer matching phrase. Otherwise the tracker sticks to yesterday's
    // best score after the transcript has moved on to the next Pankti.
    right.tokenEndIndex - left.tokenEndIndex ||
    right.matchedWords - left.matchedWords ||
    right.exactWords - left.exactWords ||
    (currentPanktiIdx >= 0
      ? (left.panktiIdx <= currentPanktiIdx ? Number.MAX_SAFE_INTEGER : left.panktiIdx - currentPanktiIdx) -
        (right.panktiIdx <= currentPanktiIdx ? Number.MAX_SAFE_INTEGER : right.panktiIdx - currentPanktiIdx)
      : left.panktiIdx - right.panktiIdx)
  );
  let best = matches[0];
  if (!best) return null;

  // Paath is read in canonical order. A noisy one-word hypothesis at the live
  // edge must not hide a two-word match to a later line just behind it. Prefer
  // recent forward evidence when it contains at least two ordered words; the
  // caller stabilizes the match before changing the displayed line.
  if (currentPanktiIdx >= 0) {
    const forward = matches
      .filter(match =>
        match.panktiIdx > currentPanktiIdx &&
        match.matchedWords >= 2 &&
        (best.matchedWords < 2 || match.tokenEndIndex >= best.tokenEndIndex) &&
        match.tokenEndIndex >= allTokens.length - 8
      )
      .sort((left, right) =>
        right.tokenEndIndex - left.tokenEndIndex ||
        right.matchedWords - left.matchedWords ||
        right.exactWords - left.exactWords ||
        left.panktiIdx - right.panktiIdx
      );
    if (forward.length) best = forward[0];
  }

  // A lone word is only useful when it is exact, unique, and at the live
  // transcript edge. The caller requires another matching hypothesis before
  // moving on, which lets short distinctive words respond without random jumps.
  if (
    best.matchedWords === 1 &&
    (best.exactWords !== 1 || best.tokenEndIndex !== allTokens.length - 1)
  ) {
    return null;
  }

  const tied = matches.some(match =>
    match.panktiIdx !== best.panktiIdx &&
    match.tokenEndIndex === best.tokenEndIndex &&
    match.matchedWords === best.matchedWords &&
    match.exactWords === best.exactWords
  );
  if (!tied) return best;

  // Kirtan repeats canonical lines. When equally strong text matches both the
  // current line and a later line, prefer the nearest forward occurrence so
  // the display follows the Shabad's order instead of sticking behind.
  if (currentPanktiIdx >= 0) {
    const forwardTie = matches
      .filter(match =>
        match.panktiIdx > currentPanktiIdx &&
        match.tokenEndIndex === best.tokenEndIndex &&
        match.matchedWords === best.matchedWords &&
        match.exactWords === best.exactWords
      )
      .sort((left, right) => left.panktiIdx - right.panktiIdx)[0];
    if (forwardTie) return forwardTie;
  }
  return null;
};

/** Return forward evidence when the live suffix contains the current Pankti's final words. */
export const findCompletedOfflinePankti = (
  panktis: Array<Pick<OfflineCandidate, "gurmukhi_speech">>,
  transcript: string,
  currentPanktiIdx: number,
): OfflineWordMatch | null => {
  const pankti = panktis[currentPanktiIdx];
  if (!pankti || currentPanktiIdx + 1 >= panktis.length) return null;
  const lineWords = normalizeOfflinePankti(pankti.gurmukhi_speech);
  const transcriptWords = normalizeOfflineText(transcript).split(" ").filter(Boolean)
    .map(normalizeOfflineWord);
  if (lineWords.length < 2 || transcriptWords.length < 2) return null;

  // Two matching final words, currently at the audio suffix, show that the
  // line has completed. Prefer up to three words when available for stronger
  // confirmation before moving to the next canonical line.
  for (const span of [3, 2]) {
    if (lineWords.length < span || transcriptWords.length < span) continue;
    const lineTail = lineWords.slice(-span);
    const liveTail = transcriptWords.slice(-span);
    let exactWords = 0;
    const matched = lineTail.every((word, index) => {
      if (!wordsMatchOffline(word, liveTail[index])) return false;
      if (word === liveTail[index]) exactWords++;
      return true;
    });
    if (!matched || exactWords === 0) continue;
    return {
      panktiIdx: currentPanktiIdx + 1,
      matchedWords: span,
      exactWords,
      tokenEndIndex: transcriptWords.length - 1,
    };
  }
  return null;
};

export const findOfflinePanktiProgress = (
  panktis: Array<Pick<OfflineCandidate, "gurmukhi_speech">>,
  transcript: string,
  current: number,
  kirtan: boolean,
  baniId: number | null,
  currentPanktis = panktis,
) => {
  const advancesOnCompletion = !kirtan || baniId === 13; // Asa Ki Vaar
  const completed = advancesOnCompletion ? findCompletedOfflinePankti(currentPanktis, transcript, current) : null;
  if (completed) return completed;
  // Sehaj paath is continuous reading. Searching the entire Bani lets a short
  // common phrase match a line many pages ahead. Look nearby, including two
  // lines behind so a mistaken advance can recover on fresh speech evidence.
  const start = !kirtan ? Math.max(0, current - 2) : 0;
  const nearby = !kirtan ? panktis.slice(start, current + 4) : panktis;
  const local = findStrongOfflinePanktiMatch(nearby, transcript, 2,
    advancesOnCompletion ? current - start : -1);
  const match = local ? {...local, panktiIdx:local.panktiIdx + start} : null;
  if (!kirtan && match) {
    const tokens = normalizeOfflineText(transcript).split(" ").filter(Boolean);
    if (match.tokenEndIndex < tokens.length - 3) return null;
    if (Math.abs(match.panktiIdx - current) > 1 && match.exactWords < 3) return null;
    if (match.panktiIdx < current && match.exactWords < 3) return null;
  }
  if (advancesOnCompletion && match && match.panktiIdx > current && panktis[current]) {
    const currentEvidence = findStrongOfflinePanktiMatch([panktis[current]], transcript, 2);
    if (currentEvidence && currentEvidence.tokenEndIndex >= match.tokenEndIndex &&
      currentEvidence.matchedWords >= match.matchedWords) {
      return { ...currentEvidence, panktiIdx: current };
    }
  }
  return match;
};

/** Keep line changes in canonical order and require a second hypothesis for jumps. */
export const stabilizeOfflinePanktiMatch = (
  currentIdx: number,
  match: OfflineWordMatch | null,
  pending: PendingOfflinePanktiMatch,
  immediateMatchWords = 3,
  allowRepetition = false,
): { currentIdx: number; pending: PendingOfflinePanktiMatch } => {
  if (!match || match.panktiIdx === currentIdx) {
    return { currentIdx, pending: null };
  }

  // Paath remains monotonic. Ordinary kirtan may repeat an earlier line,
  // backed by a fresh transcript position in the caller's evidence clock.
  if (match.panktiIdx < currentIdx) {
    if (!allowRepetition || match.matchedWords < 2 || match.exactWords < 2) {
      return { currentIdx, pending: null };
    }
    if (match.matchedWords >= 4 && match.exactWords >= 4) {
      return { currentIdx: match.panktiIdx, pending: null };
    }
  }
  if (
    match.panktiIdx > currentIdx &&
    match.matchedWords >= immediateMatchWords &&
    match.exactWords >= immediateMatchWords
  ) {
    return { currentIdx: match.panktiIdx, pending: null };
  }

  const confirmations = pending?.panktiIdx === match.panktiIdx
    ? pending.confirmations + 1
    : 1;
  if (confirmations >= 2) {
    return { currentIdx: match.panktiIdx, pending: null };
  }
  return { currentIdx, pending: { panktiIdx: match.panktiIdx, confirmations } };
};

const calculateOfflinePanktiScore = (speech: string, pankti: string) => {
  const a = normalizeOfflineText(speech);
  const b = normalizeOfflineText(pankti);
  if (!a || !b) return 0;
  if (a === b) return 1;

  // Partial ASR should still match the start/middle of a canonical pankti.
  if (b.includes(a) && a.split(" ").length >= 2) {
    return Math.min(0.98, 0.82 + 0.16 * (a.length / b.length));
  }

  const maxLen = Math.max(a.length, b.length);
  const fullLineScore = Math.max(0, 1 - levenshtein.get(a, b) / maxLen);
  const partialLineScore = a.split(" ").length >= 2 && a.length >= 8
    ? scoreBestSubstring(a, b)
    : 0;
  return Math.max(fullLineScore, partialLineScore);
};

const phraseScoreCache = new Map<string, number>();
export const scoreOfflinePankti = (speech: string, pankti: string) =>
  cacheValue(phraseScoreCache, `${speech}\u0000${pankti}`, () => calculateOfflinePanktiScore(speech, pankti));

export const rankOfflinePanktis = (
  speech: string,
  candidates: OfflineCandidate[],
): OfflineMatch[] =>
  candidates
    .map(candidate => ({ ...candidate, score: scoreOfflinePankti(speech, candidate.gurmukhi_speech) }))
    .sort((a, b) => b.score - a.score);

export const selectOfflinePankti = (
  speech: string,
  candidates: OfflineCandidate[],
  minScore = 0.86,
  minMargin = 0.1,
): OfflineMatch | null => {
  if (normalizeOfflineText(speech).split(" ").filter(Boolean).length < 4) return null;
  const ranked = rankOfflinePanktis(speech, candidates);
  const best = ranked[0];
  if (!best || best.score < minScore) return null;
  const second = ranked[1];
  if (second && best.score - second.score < minMargin) return null;
  return best;
};

export const buildOfflineSearchSegments = (speech: string) => {
  const words = speech.split(/\s+/).filter(Boolean).slice(-32);
  if (words.length <= 8) return words.length ? [words.join(" ")] : [];

  const segments: string[] = [];
  for (let start = 0; start < words.length; start += 4) {
    const segment = words.slice(start, start + 8);
    if (segment.length >= 4) segments.push(segment.join(" "));
  }
  const suffix = words.slice(-8).join(" ");
  if (suffix && segments[segments.length - 1] !== suffix) segments.push(suffix);
  return [...new Set(segments)];
};

export const buildOfflineSearchQueries = (speech: string) => {
  const words = speech.split(/\s+/).filter(Boolean).slice(-32);
  return [...new Set([
    ...[4, 6, 8, 10, 12, 16].filter(length => length < words.length).map(length => words.slice(-length).join(" ")),
    ...buildOfflineSearchSegments(words.join(" ")),
    words.join(" "),
  ])].filter(Boolean);
};

/** Select a Shabad only when separate transcript segments support separate Panktis in it. */
export const selectOfflineShabadFromSegments = (
  segments: string[],
  candidates: OfflineShabadCandidate[],
  minLineScore = 0.86,
) => {
  type Evidence = { score: number; segmentIndex: number; orderId?: number };
  const byShabad = new Map<string, Map<string, Evidence>>();

  segments.forEach((segment, segmentIndex) => {
    const ranked = rankOfflinePanktis(segment, candidates);
    const bestScore = ranked[0]?.score ?? 0;
    if (bestScore < minLineScore) return;

    for (const row of ranked) {
      if (row.score < minLineScore || bestScore - row.score > 0.04) continue;
      const candidate = candidates.find(item => item.id === row.id);
      if (!candidate?.shabad_id) continue;
      const lines = byShabad.get(candidate.shabad_id) ?? new Map<string, Evidence>();
      const prior = lines.get(candidate.id);
      if (!prior || row.score > prior.score || segmentIndex > prior.segmentIndex) {
        lines.set(candidate.id, {
          score: row.score,
          segmentIndex,
          orderId: candidate.order_id,
        });
      }
      byShabad.set(candidate.shabad_id, lines);
    }
  });

  const rankedShabads = [...byShabad.entries()].map(([shabadId, lines]) => {
    const evidence = [...lines.entries()]
      .map(([panktiId, item]) => ({ panktiId, ...item }))
      .sort((left, right) => left.segmentIndex - right.segmentIndex);
    let orderedPairs = 0;
    for (let index = 1; index < evidence.length; index++) {
      const previous = evidence[index - 1];
      const current = evidence[index];
      if (
        current.segmentIndex > previous.segmentIndex &&
        (previous.orderId == null || current.orderId == null || current.orderId > previous.orderId)
      ) {
        orderedPairs++;
      }
    }
    return {
      shabadId,
      evidence,
      lastSegmentIndex: evidence.at(-1)?.segmentIndex ?? -1,
      score: orderedPairs * 2 + evidence.reduce((total, item) => total + item.score, 0),
    };
  }).filter(shabad => shabad.evidence.length >= 2);

  rankedShabads.sort((left, right) =>
    right.lastSegmentIndex - left.lastSegmentIndex ||
    right.evidence.length - left.evidence.length ||
    right.score - left.score
  );
  const best = rankedShabads[0];
  if (!best) return null;
  const second = rankedShabads[1];
  if (second && (
    second.lastSegmentIndex === best.lastSegmentIndex && (
      second.evidence.length === best.evidence.length ||
      best.score - second.score < 1
    )
  )) return null;

  const lastEvidence = best.evidence[best.evidence.length - 1];
  return { shabadId: best.shabadId, panktiId: lastEvidence.panktiId };
};

/** A Bani can span several Shabads: group evidence by membership, not Shabad. */
export const selectOfflineBaniFromSegments = (
  segments: string[],
  candidates: Array<OfflineShabadCandidate & { bani_ids?: number[] }>,
) => {
  const evidence = new Map<number, Map<string, { id: string; segment: number; score: number }>>();
  segments.forEach((segment, index) => {
    const ranked = rankOfflinePanktis(segment, candidates);
    const top = ranked[0]?.score ?? 0;
    if (top < 0.88) return;
    for (const row of ranked.filter(row => row.score >= 0.88 && top - row.score <= 0.03)) {
      const candidate = candidates.find(item => item.id === row.id)!;
      for (const baniId of candidate.bani_ids ?? []) {
        const lines = evidence.get(baniId) ?? new Map();
        // Database copies of a shared line cannot count as separate evidence.
        const key = normalizeOfflineText(candidate.gurmukhi_speech);
        const prior = lines.get(key);
        if (!prior || index > prior.segment) lines.set(key, { id: row.id, segment: index, score: row.score });
        evidence.set(baniId, lines);
      }
    }
  });
  const ranked = [...evidence.entries()].map(([baniId, lines]) => ({
    baniId, lines: [...lines.values()].sort((a, b) => a.segment - b.segment),
  })).filter(item => item.lines.length >= 2 && new Set(item.lines.map(line => line.segment)).size >= 2)
    .sort((a, b) => b.lines.length - a.lines.length || b.lines.at(-1)!.segment - a.lines.at(-1)!.segment);
  const best = ranked[0];
  if (!best || ranked[1]?.lines.length === best.lines.length) return null;
  return { baniId: best.baniId, panktiId: best.lines.at(-1)!.id };
};
