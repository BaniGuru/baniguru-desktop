import {
  buildOfflineSearchSegments, findStrongOfflinePanktiMatch, normalizeOfflineText,
  selectOfflineBaniFromSegments, selectOfflinePankti, selectOfflineShabadFromSegments,
} from "./offlinePanktiMatch";

export type OfflineSearchRow = { id: string; shabad_id: string; gurmukhi_speech: string; bani_ids?: number[] };
export type OfflineSearchContext = { shabadId: string | null; baniId: number | null; panktis: OfflineSearchRow[] };
export type PendingOfflineSearch = { key: string; confirmations: number; speech: string; observationMs?: number } | null;

export const hasOfflineSearchEvidence = (speech: string) => {
  const words = normalizeOfflineText(speech).split(" ").filter(Boolean);
  // Chanting two repeated words is not enough to identify a Shabad, even
  // when a database line contains the same chant many times.
  return words.length >= 4 && new Set(words).size >= 3;
};

export const needsOfflineSearch = (speech: string, context: OfflineSearchContext, kirtan: boolean) => {
  if (!hasOfflineSearchEvidence(speech)) return false;
  if (!context.panktis.length) return true;
  if (!kirtan) return false;
  const suffix = speech.split(/\s+/).slice(-12).join(" ");
  const latest = normalizeOfflineText(suffix).split(" ").length - 3;
  return !context.panktis.some(line => {
    const match = findStrongOfflinePanktiMatch([line], suffix, context.baniId == null ? 2 : 3);
    return match && match.tokenEndIndex >= latest;
  });
};

export const decideOfflineSearch = (
  speech: string, candidates: OfflineSearchRow[], context: OfflineSearchContext,
  kirtan: boolean, pending: PendingOfflineSearch,
  observationMs = 0,
) => {
  const none = { selection: null, pending: null };
  if (!hasOfflineSearchEvidence(speech)) return none;
  const segments = buildOfflineSearchSegments(speech);
  const bani = selectOfflineBaniFromSegments(segments, candidates);
  const shabad = selectOfflineShabadFromSegments(segments, candidates);
  const single = selectOfflinePankti(speech, candidates);
  const suffix = speech.split(/\s+/).slice(-12).join(" ");
  const normalized = normalizeOfflineText(suffix).split(" ");
  const latest = findStrongOfflinePanktiMatch(candidates, suffix, 4);
  const options = [
    {id:bani?.panktiId,baniId:bani?.baniId,multiple:true},
    {id:shabad?.panktiId,baniId:undefined,multiple:true},
    {id:single?.id,baniId:undefined,multiple:false},
    {id:latest ? candidates[latest.panktiIdx].id : undefined,baniId:undefined,multiple:false},
  ];
  for (const option of options) {
    const row = candidates.find(row => row.id === option.id);
    if (!row) continue;
    const fresh = findStrongOfflinePanktiMatch([row], suffix, 3);
    if (!fresh || fresh.tokenEndIndex < normalized.length - 2 ||
      new Set(normalized.slice(fresh.tokenEndIndex - fresh.matchedWords + 1, fresh.tokenEndIndex + 1)).size < (option.multiple ? 3 : 4)) continue;
    // Keep Bani evidence attached to the option that established it. Stale
    // Bani evidence must not override a fresh different Shabad at the edge.
    // Continuous Sehaj paath follows the source's canonical Shabads. A shared
    // SGGS line can also belong to Rehras/Aarti, whose anthology order leaves
    // the Ang being read and strands the cursor. Named Banis can still be
    // selected explicitly; automatic paath acquisition anchors a Shabad.
    const baniId = kirtan && option.baniId === 13 ? 13 : null;
    if (row.shabad_id === context.shabadId && baniId === context.baniId) continue;
    if (baniId != null && baniId === context.baniId) continue;
    const selection = {row,baniId};
    if (!context.panktis.length) return {selection,pending:null};

    if (fresh.matchedWords < (option.multiple ? 3 : 4) || fresh.exactWords < 3) continue;
    if ((option.multiple && fresh.exactWords >= 3) || fresh.exactWords >= 5) return {selection,pending:null};
    const key = `${baniId ?? "shabad"}:${row.shabad_id}`;
    const confirmations = pending?.key === key
      ? pending.confirmations + Number(observationMs > 0 ? pending.observationMs !== observationMs : pending.speech !== speech) : 1;
    if (confirmations < 2) return {selection:null,pending:{key,confirmations,speech,observationMs}};
    return {selection,pending:null};
  }
  return none;
};
