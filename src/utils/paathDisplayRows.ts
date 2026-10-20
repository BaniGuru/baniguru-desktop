import type { Pankti } from "../models/Pankti";
import type { PaathAng } from "./paathAngs";

export type PaathDisplayPage = { ang: number; rows: Pankti[][] };

/** Pair canonical Sukhmani couplets, including those split across an ang.
 * Each row belongs to its first pankti's ang, with the original panktis kept
 * intact so following either member tracks the same displayed row.
 */
export function paathDisplayRows(pages: PaathAng[]): PaathDisplayPage[] {
  let previous: Pankti[] | undefined;
  return pages.map(page => {
    const rows: Pankti[][] = [];
    for (const pankti of page.panktis) {
      if (pankti.paath_pair_id && previous?.length === 1 &&
          previous[0].paath_pair_id === pankti.paath_pair_id) {
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
