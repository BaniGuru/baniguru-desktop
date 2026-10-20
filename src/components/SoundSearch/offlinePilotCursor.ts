import {
  findOfflinePanktiProgress, OfflineCandidate, PendingOfflinePanktiMatch,
  stabilizeOfflinePanktiMatch,
} from "./offlinePanktiMatch";

export type OfflinePilotCursor = { pending: PendingOfflinePanktiMatch; lastTokenEnd: number; observationMs?: number };

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
  const match = findOfflinePanktiProgress(panktis, transcript, current, kirtan, baniId, currentPanktis);
  if (match && match.panktiIdx !== current && match.tokenEndIndex <= cursor.lastTokenEnd) {
    return { currentIdx: current, pending: null, lastTokenEnd: cursor.lastTokenEnd, observationMs };
  }
  // A nearby paath overshoot may be corrected, but never on a single partial
  // hypothesis or on words that already caused the previous advance.
  if (!kirtan && match && match.panktiIdx < current) {
    const confirmations = cursor.pending?.panktiIdx === match.panktiIdx
      ? cursor.pending.confirmations + 1 : 1;
    if (confirmations < 2) return {currentIdx:current,
      pending:{panktiIdx:match.panktiIdx,confirmations}, lastTokenEnd:cursor.lastTokenEnd, observationMs};
    return {currentIdx:match.panktiIdx,pending:null,lastTokenEnd:match.tokenEndIndex,observationMs};
  }
  const next = stabilizeOfflinePanktiMatch(current, match, cursor.pending, 3, kirtan && baniId !== 13);
  return {
    ...next,
    observationMs,
    lastTokenEnd: next.currentIdx === current ? cursor.lastTokenEnd : match!.tokenEndIndex,
  };
};
