import {
  findOfflinePanktiProgress, findStrongOfflinePanktiMatch, normalizeOfflineText, OfflineCandidate, PendingOfflinePanktiMatch,
  stabilizeOfflinePanktiMatch,
} from "./offlinePanktiMatch";

export type OfflinePilotCursor = {
  pending: PendingOfflinePanktiMatch; lastTokenEnd: number; observationMs?: number;
  lastEvidenceMs?: number; lastEvidenceTokenEnd?: number;
  recovery?: {panktiIdx:number; confirmations:number};
};

/** Shared by the desktop hook and timestamped recording replays. */
export const advanceOfflinePilotCursor = (
  cursor: OfflinePilotCursor,
  panktis: Array<Pick<OfflineCandidate, "gurmukhi_speech">>,
  currentPanktis: typeof panktis,
  transcript: string,
  current: number,
  kirtan: boolean,
  baniId: number | null,
  observationMs = 0,
) => {
  if (observationMs > 0 && observationMs === cursor.observationMs) return {...cursor,currentIdx:current};
  if (!transcript.trim()) return { currentIdx: current, pending: null, lastTokenEnd: -1 };
  let match = findOfflinePanktiProgress(panktis, transcript, current, kirtan, baniId, currentPanktis);
  let evidenceMs = cursor.lastEvidenceMs ?? observationMs;
  let evidenceEnd = cursor.lastEvidenceTokenEnd ?? -1;
  let recovery: OfflinePilotCursor["recovery"];
  // Normal paath remains tightly bounded. After noisy lines have stalled it,
  // search a small forward corridor, requiring distinct audio observations of
  // a longer phrase before skipping anything. Never expand backwards.
  if (!kirtan && observationMs - evidenceMs >= 4_000 &&
      (!match || match.tokenEndIndex <= evidenceEnd)) {
    const ahead = findStrongOfflinePanktiMatch(panktis.slice(current + 1,current + 13),transcript,3);
    const words = normalizeOfflineText(transcript).split(" ");
    const edge = words.length - 3;
    if (ahead && ahead.exactWords >= 3 && ahead.tokenEndIndex >= edge &&
        new Set(words.slice(ahead.tokenEndIndex - ahead.matchedWords + 1,ahead.tokenEndIndex + 1)).size >= 3 &&
        ahead.tokenEndIndex > Math.max(cursor.lastTokenEnd,evidenceEnd)) {
      const panktiIdx = current + 1 + ahead.panktiIdx;
      const confirmations = cursor.recovery?.panktiIdx === panktiIdx ? cursor.recovery.confirmations + 1 : 1;
      recovery = {panktiIdx,confirmations};
      if (confirmations >= 2) match = {...ahead,panktiIdx};
    }
  }
  if (match && match.tokenEndIndex > evidenceEnd) {
    evidenceMs = observationMs;
    evidenceEnd = match.tokenEndIndex;
  }
  const health = {lastEvidenceMs:evidenceMs,lastEvidenceTokenEnd:evidenceEnd,recovery};
  if (match && match.panktiIdx !== current && match.tokenEndIndex <= cursor.lastTokenEnd) {
    return { ...health, currentIdx: current, pending: null, lastTokenEnd: cursor.lastTokenEnd, observationMs };
  }
  // A nearby paath overshoot may be corrected, but never on a single partial
  // hypothesis or on words that already caused the previous advance.
  if (!kirtan && match && match.panktiIdx < current) {
    const confirmations = cursor.pending?.panktiIdx === match.panktiIdx
      ? cursor.pending.confirmations + 1 : 1;
    if (confirmations < 2) return {...health,currentIdx:current,
      pending:{panktiIdx:match.panktiIdx,confirmations}, lastTokenEnd:cursor.lastTokenEnd, observationMs};
    return {...health,currentIdx:match.panktiIdx,pending:null,lastTokenEnd:match.tokenEndIndex,observationMs};
  }
  const next = stabilizeOfflinePanktiMatch(current, match, cursor.pending, 3, kirtan && baniId !== 13);
  return {
    ...health,
    ...next,
    observationMs,
    lastTokenEnd: next.currentIdx === current ? cursor.lastTokenEnd : match!.tokenEndIndex,
  };
};
