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
  // Rank complete paragraphs, rather than resetting couplets at an ang
  // boundary. Headings and numbered endings anchor the next pair of verses.
  const rows: any[] = await db.select(`
    WITH paragraph_lines AS (
      SELECT verse.*,
        COALESCE(SUM(CASE WHEN verse.type_id < 3 OR
          verse.gurmukhi GLOB '*][0-9੦-੯]*]*' OR
          verse.gurmukhi_unicode GLOB '*॥[0-9੦-੯]*॥*' OR
          verse.gurmukhi LIKE '%rhwau%' THEN 1 ELSE 0 END)
          OVER (PARTITION BY verse.shabad_id ORDER BY verse.order_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS paragraph
      FROM lines verse
      WHERE verse.shabad_id IN (SELECT shabad_id FROM lines WHERE source_page = ${ang})
    ), verse_pairs AS (
      SELECT verse.id, verse.shabad_id || ':' || verse.paragraph || ':' ||
        ((ROW_NUMBER() OVER (PARTITION BY verse.shabad_id,verse.paragraph ORDER BY verse.order_id) - 1) / 2) AS pair_id
      FROM paragraph_lines verse
      WHERE verse.type_id IN (3,4) AND NOT EXISTS (
        SELECT 1 FROM bani_lines membership JOIN lines heading ON heading.shabad_id = verse.shabad_id
        WHERE membership.line_id = verse.id AND membership.bani_id = 12 AND heading.type_id = 2
          AND (heading.gurmukhi_unicode LIKE 'ਸਲੋਕ%' OR heading.gurmukhi LIKE 'slok%')
      )
    )
    SELECT lines.*, verse_pairs.pair_id AS paath_pair_id,
      (verse_pairs.id IS NULL AND EXISTS (
        SELECT 1 FROM bani_lines membership WHERE membership.line_id = lines.id AND membership.bani_id = 12
      )) AS paath_keep_single,
      panktis.source_id, panktis.gurmukhi_speech,
      panktis.vishraam_idx, panktis.vishraam_ridx,
      panktis.gurmukhi_words, panktis.gurmukhi_rwords, -1 AS line_group,
      (SELECT translation FROM translations WHERE line_id = lines.id AND
        translation_source_id IN (${sourceId === 1 ? "6" : "8,11,13,15,17,19,21,23"})
        ORDER BY translation_source_id LIMIT 1) AS punjabi_translation,
      (SELECT translation FROM translations WHERE line_id = lines.id AND
        translation_source_id IN (${sourceId === 1 ? "1" : "7,9,10,12,14,16,18,20,22,24"})
        ORDER BY translation_source_id LIMIT 1) AS english_translation
    FROM lines JOIN panktis ON panktis.id = lines.id
    LEFT JOIN verse_pairs ON verse_pairs.id = lines.id
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
