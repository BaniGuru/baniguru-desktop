export type OfflineSearchResults<T> = {
  rows:T[]; publishedAt:number; challenger?:string; observationMs?:number; refreshAfter?:number;
};

/** Hold readable results while audio evolves; a different leading Shabad
 * needs evidence on a second audio update before replacing the list.
 */
export function stabilizeOfflineSearchResults<T extends {id:string;shabad_id:string}>(
  previous:OfflineSearchResults<T>, ranked:T[], observationMs:number,
):OfflineSearchResults<T> {
  if (!ranked.length) return previous;
  if (!previous.rows.length) return {rows:ranked,publishedAt:observationMs};
  const sameOrder = ranked.map(row => row.id).join() === previous.rows.map(row => row.id).join();
  if (observationMs - previous.publishedAt < 2_000) {
    return sameOrder ? previous : {...previous,refreshAfter:previous.publishedAt + 2_000};
  }
  const key = ranked[0].shabad_id;
  if (key !== previous.rows[0].shabad_id &&
      (previous.challenger !== key || previous.observationMs === observationMs)) {
    return {...previous,challenger:key,observationMs,refreshAfter:undefined};
  }
  // Preserve the relative positions of choices that remain relevant. Reading
  // and clicking a result must not race a re-sort on every recognizer update.
  const ids = new Set(ranked.map(row => row.id));
  const retained = previous.rows.filter(row => ids.has(row.id));
  const kept = new Set(retained.map(row => row.id));
  const rows = [...retained,...ranked.filter(row => !kept.has(row.id))].slice(0,8);
  if (rows.map(row => row.id).join() === previous.rows.map(row => row.id).join()) {
    return previous.challenger ? {rows:previous.rows,publishedAt:previous.publishedAt} : previous;
  }
  return {rows,publishedAt:observationMs};
}
