import { DB } from "./DB";
import { Pankti } from "../models/Pankti";
import { formatPanktis } from "./shabadUtil";

export async function loadBaniPanktis(baniId: number): Promise<Pankti[]> {
  if (!Number.isInteger(baniId) || baniId <= 0) return [];

  const db = await DB.getInstance();
  const rows: any[] = await db.select(`
    SELECT
      lines.*,
      panktis.gurmukhi_speech,
      panktis.vishraam_idx,
      panktis.vishraam_ridx,
      panktis.gurmukhi_words,
      panktis.gurmukhi_rwords,
      bani_lines.line_id,
      bani_lines.bani_id,
      bani_lines.line_group,
      punjabi.translation AS punjabi_translation,
      english.translation AS english_translation,
      bani_lines.show_group,
      bani_lines.show_translation,
      bani_lines.join_next,
      bani_lines.speech_group,
      bani_lines.auto_next
    FROM bani_lines
    INNER JOIN panktis ON panktis.id = bani_lines.line_id
    INNER JOIN lines ON lines.id = panktis.id
    LEFT JOIN translations AS punjabi ON lines.id = punjabi.line_id AND (
      (panktis.source_id = 1 AND punjabi.translation_source_id = 6) OR
      (panktis.source_id != 1 AND punjabi.translation_source_id IN (8, 11, 13, 15, 17, 19, 21))
    )
    LEFT JOIN translations AS english ON lines.id = english.line_id AND (
      (panktis.source_id = 1 AND english.translation_source_id = 1) OR
      (panktis.source_id != 1 AND english.translation_source_id IN (7, 9, 10, 12, 14, 16, 18, 20, 22))
    )
    WHERE bani_lines.bani_id = ${baniId}
    ORDER BY bani_lines.line_group, lines.order_id
  `);

  return formatPanktis(rows).map((line: any) => ({
    ...line,
    id: line.line_id,
    bani_id: Number(line.bani_id),
    visited: false,
    show_translation: line.show_translation === 1,
    join_next: line.join_next === 1,
    auto_next: line.auto_next === 1,
  })) as Pankti[];
}
