import type { Pankti } from "../models/Pankti";
import type { PaathAng } from "./paathAngs";

export type PaathDisplayPage = { ang: number; rows: Pankti[][] };

/** Pair canonical Sukhmani couplets, including those split across an ang,
 * and ordinary consecutive verses accepted by the reader's font measurement.
 * Each row belongs to its first pankti's ang, with the original panktis kept
 * intact so following either member tracks the same displayed row.
 */
export function paathDisplayRows(pages: PaathAng[], fits?: (first:Pankti,second:Pankti) => boolean): PaathDisplayPage[] {
  let previous: Pankti[] | undefined;
  return pages.map(page => {
    const rows: Pankti[][] = [];
    for (const pankti of page.panktis) {
      const first = previous?.[0];
      const canonicalPair = pankti.paath_pair_id && first?.paath_pair_id === pankti.paath_pair_id;
      const measuredPair = fits && previous?.length === 1 && first && !first.paath_pair_id && !pankti.paath_pair_id &&
        !first.paath_keep_single && !pankti.paath_keep_single && first.type_id >= 3 && pankti.type_id >= 3 &&
        first.shabad_id === pankti.shabad_id && first.source_page === pankti.source_page &&
        !/\]\s*[੦-੯0-9]+\s*\]|rhwau|॥\s*[੦-੯0-9]+\s*॥/.test(first.gurmukhi) && fits(first,pankti);
      if (previous?.length === 1 && (canonicalPair || measuredPair)) {
        previous.push(pankti);
      } else {
        previous = [pankti];
        rows.push(previous);
      }
    }
    return { ang: page.ang, rows };
  });
}

export const joinedPaathTranslation = (row: Pankti[], language: "punjabi_translation" | "english_translation") =>
  row.map(pankti => pankti[language]?.trim()).filter(Boolean).join(" ") || "—";
