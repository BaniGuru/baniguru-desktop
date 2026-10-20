import { Pankti } from "../models/Pankti";
import { DB } from "./DB";
import { formatPanktis } from "./shabadUtil";

export const MAX_PAATH_ANGS = 4;
export type PaathSource = { id: number; length: number; pageName: string };
export type PaathAng = { ang: number; panktis: Pankti[] };

export const paathAngRange = (ang: number, last: number) => {
  const start = Math.max(1, Math.min(Math.floor(ang) - 1, Math.max(1, last - MAX_PAATH_ANGS + 1)));
  return Array.from({length: Math.min(MAX_PAATH_ANGS, last - start + 1)}, (_, i) => start + i);
};

export async function getPaathSource(shabadId: string): Promise<PaathSource | null> {
  const db = await DB.getInstance();
  const rows: any[] = await db.select(`
    SELECT sources.id, sources.length, sources.page_name_english AS pageName
    FROM shabads JOIN sources ON sources.id = shabads.source_id
    WHERE shabads.id = '${shabadId.replaceAll("'", "''")}' LIMIT 1
  `);
  return rows[0] ? {id:Number(rows[0].id),length:Number(rows[0].length),pageName:rows[0].pageName} : null;
}

export async function loadPaathAng(sourceId: number, ang: number): Promise<Pankti[]> {
  if (!Number.isInteger(sourceId) || sourceId < 1 || !Number.isInteger(ang) || ang < 1) return [];
  const db = await DB.getInstance();
  const rows: any[] = await db.select(`
    SELECT lines.*, panktis.source_id, panktis.gurmukhi_speech,
      panktis.vishraam_idx, panktis.vishraam_ridx,
      panktis.gurmukhi_words, panktis.gurmukhi_rwords, -1 AS line_group,
      (SELECT translation FROM translations WHERE line_id = lines.id AND
        translation_source_id IN (${sourceId === 1 ? "6" : "8,11,13,15,17,19,21,23"})
        ORDER BY translation_source_id LIMIT 1) AS punjabi_translation,
      (SELECT translation FROM translations WHERE line_id = lines.id AND
        translation_source_id IN (${sourceId === 1 ? "1" : "7,9,10,12,14,16,18,20,22,24"})
        ORDER BY translation_source_id LIMIT 1) AS english_translation
    FROM lines JOIN panktis ON panktis.id = lines.id
    WHERE panktis.source_id = ${sourceId} AND lines.source_page = ${ang}
    ORDER BY lines.order_id
  `);
  return formatPanktis(rows);
}

/** Bound both retained pages and in-flight cache entries during long readings. */
export class PaathAngCache {
  private entries = new Map<number, Promise<Pankti[]>>();
  constructor(private load: (ang: number) => Promise<Pankti[]>) {}

  async window(angs: number[]): Promise<PaathAng[]> {
    if (angs.length > MAX_PAATH_ANGS) throw new Error("Paath window exceeds four angs");
    for (const ang of this.entries.keys()) if (!angs.includes(ang)) this.entries.delete(ang);
    const pages = angs.map(async ang => {
      let pending = this.entries.get(ang);
      if (!pending) {
        pending = this.load(ang);
        this.entries.set(ang, pending);
        const entry = pending;
        pending.catch(() => { if (this.entries.get(ang) === entry) this.entries.delete(ang); });
      }
      return {ang,panktis:await pending};
    });
    return Promise.all(pages);
  }

  get size() { return this.entries.size; }
}
