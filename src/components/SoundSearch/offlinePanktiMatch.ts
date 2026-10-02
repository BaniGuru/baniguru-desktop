import levenshtein from "fast-levenshtein";

export type OfflineCandidate = { id: string; gurmukhi_speech: string };
export type OfflineMatch = OfflineCandidate & { score: number };

export const normalizeOfflineText = (text: string) =>
  text
    .replace(/[,.|;:!?।॥]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const scoreOfflinePankti = (speech: string, pankti: string) => {
  const a = normalizeOfflineText(speech);
  const b = normalizeOfflineText(pankti);
  if (!a || !b) return 0;
  if (a === b) return 1;

  // Partial ASR should still match the start/middle of a canonical pankti.
  if (b.includes(a) && a.split(" ").length >= 2) {
    return Math.min(0.98, 0.82 + 0.16 * (a.length / b.length));
  }

  const maxLen = Math.max(a.length, b.length);
  return Math.max(0, 1 - levenshtein.get(a, b) / maxLen);
};

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
  minScore = 0.72,
  minMargin = 0.06,
): OfflineMatch | null => {
  if (normalizeOfflineText(speech).split(" ").filter(Boolean).length < 2) return null;
  const ranked = rankOfflinePanktis(speech, candidates);
  const best = ranked[0];
  if (!best || best.score < minScore) return null;
  const second = ranked[1];
  if (second && best.score - second.score < minMargin) return null;
  return best;
};
