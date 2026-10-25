import {
  buildOfflineSearchSegments, findStrongOfflinePanktiMatch, normalizeOfflineText,
  selectOfflineBaniFromSegments, selectOfflinePankti, selectOfflineShabadFromSegments,
} from "./offlinePanktiMatch";

export type OfflineSearchRow = { id: string; shabad_id: string; gurmukhi_speech: string; bani_ids?: number[];
  order_id?: number; source_page?: number; source_id?: number; type_id?:number };
export type OfflineSearchContext = { shabadId: string | null; baniId: number | null; panktis: OfflineSearchRow[];
  current?:number; recovering?:boolean; relocating?:boolean };
export type PendingOfflineSearch = { key: string; confirmations: number; speech: string; observationMs?: number;
  orderId?:number; firstObservationMs?:number } | null;

const nearbyPaathCandidate = (row:OfflineSearchRow, context:OfflineSearchContext) => {
  const current = context.panktis[context.current ?? 0];
  if (context.baniId != null && !context.panktis.some(line => line.id === row.id)) return false;
  if (current?.source_id != null && row.source_id != null && current.source_id !== row.source_id) return false;
  return current?.order_id != null && row.order_id != null && row.order_id > current.order_id &&
    row.order_id <= current.order_id + 60 &&
    (current.source_page == null || row.source_page == null || row.source_page <= current.source_page + 1);
};

/** A different location needs two non-overlapping, canonical verse anchors;
 * a shared heading or reusing one matching phrase cannot establish the move.
 */
const hasRelocationSequence = (speech:string, row:OfflineSearchRow, candidates:OfflineSearchRow[]) => {
  const current = findStrongOfflinePanktiMatch([row],speech,4);
  if (!current || row.order_id == null) return false;
  const start = current.tokenEndIndex - current.matchedWords + 1;
  return candidates.some(previous => {
    if (previous.id === row.id || previous.order_id == null || previous.source_id !== row.source_id ||
        (previous.type_id != null && previous.type_id < 3) ||
        previous.order_id >= row.order_id! || previous.order_id < row.order_id! - 3) return false;
    const match = findStrongOfflinePanktiMatch([previous],speech,3);
    return match && match.exactWords >= 3 && match.tokenEndIndex < start;
  });
};

/** A global shortlist may contain the latest verse but omit its preceding
 * verse. Load those few Shabads so an ordered relocation can be verified. */
export const relocationShabadIds = (speech:string, candidates:OfflineSearchRow[]) => {
  const suffix = speech.split(/\s+/).slice(-12).join(" ");
  const edge = normalizeOfflineText(suffix).split(" ").length - 2;
  const ids = new Set<string>();
  for (const row of candidates) {
    if (row.type_id != null && row.type_id < 3) continue;
    const match = findStrongOfflinePanktiMatch([row],suffix,4);
    if (match && match.exactWords >= 3 && match.tokenEndIndex >= edge) ids.add(row.shabad_id);
    if (ids.size === 3) break;
  }
  return [...ids];
};

export const hasOfflineSearchEvidence = (speech: string) => {
  const words = normalizeOfflineText(speech).split(" ").filter(Boolean);
  // Chanting two repeated words is not enough to identify a Shabad, even
  // when a database line contains the same chant many times.
  return words.length >= 4 && new Set(words).size >= 3;
};

export const needsOfflineSearch = (speech: string, context: OfflineSearchContext, kirtan: boolean) => {
  if (!hasOfflineSearchEvidence(speech)) return false;
  if (!context.panktis.length) return true;
  if (!kirtan) return context.recovering === true;
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
  if (!kirtan && context.panktis.length) {
    if (!context.recovering) return none;
    const current = context.panktis[context.current ?? 0];
    // First recover nearby. After a prolonged loss, another ang can be
    // reacquired in either direction, using the stricter evidence below.
    candidates = candidates.filter(row => {
      return nearbyPaathCandidate(row,context) || (context.relocating && current?.source_id != null &&
        row.source_id === current.source_id && row.order_id != null && row.id !== current.id);
    });
  }
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
    const baniId = !kirtan && context.recovering
      ? (context.panktis.some(line => line.id === row.id) ? context.baniId : null)
      : kirtan && option.baniId === 13 ? 13 : null;
    if (!context.recovering && row.shabad_id === context.shabadId && baniId === context.baniId) continue;
    if (!context.recovering && baniId != null && baniId === context.baniId) continue;
    const selection = {row,baniId};
    if (!kirtan) {
      if (fresh.matchedWords < 4 || fresh.exactWords < 3) continue;
      // Reject equally strong live-edge evidence in another Shabad. Initial
      // acquisition needs a second audio observation, just like recovery.
      const ambiguous = candidates.some(other => {
        if (other.shabad_id === row.shabad_id) return false;
        const rival = findStrongOfflinePanktiMatch([other],suffix,4);
        return rival && rival.tokenEndIndex >= fresh.tokenEndIndex && rival.exactWords >= fresh.exactWords;
      });
      if (ambiguous) continue;
      if (context.panktis.length && !nearbyPaathCandidate(row,context)) {
        if (!context.relocating || observationMs <= 0) continue;
        const key = `relocate:${row.source_id}`;
        const related = pending?.key === key && pending.orderId != null && row.order_id != null &&
          row.order_id >= pending.orderId && row.order_id <= pending.orderId + 3;
        const confirmations = related ? pending.confirmations + Number(pending.observationMs !== observationMs) : 1;
        const firstObservationMs = related ? pending.firstObservationMs ?? observationMs : observationMs;
        const forwardEvidence = related && row.order_id! > pending.orderId! && pending.speech !== speech;
        const longPhrase = fresh.exactWords >= 6 && new Set(normalized.slice(
          fresh.tokenEndIndex - fresh.matchedWords + 1,fresh.tokenEndIndex + 1)).size >= 5 &&
          observationMs - firstObservationMs >= 680;
        const ordered = hasRelocationSequence(speech,row,candidates) || forwardEvidence;
        if (confirmations >= 2 && (ordered || longPhrase)) return {selection,pending:null};
        return {selection:null,pending:{key,confirmations,speech,observationMs,orderId:row.order_id,firstObservationMs}};
      }
      const key = `${baniId ?? "shabad"}:${row.shabad_id}`;
      const confirmations = pending?.key === key ? pending.confirmations +
        Number(observationMs > 0 ? pending.observationMs !== observationMs : pending.speech !== speech) : 1;
      if (confirmations < 2) return {selection:null,pending:{key,confirmations,speech,observationMs}};
      return {selection,pending:null};
    }
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
