import type { Pankti } from "../models/Pankti";
import type { PaathAng } from "./paathAngs";

export type PaathDisplayPage = { ang: number; rows: Pankti[][] };

// Numbered endings are punctuation, even when attached to the final word or
// chained (]1]3], ॥੧॥੩॥). Keep their display text, but exclude them from counts.
const numberedEnding = /(?:[\]॥।|]+\s*[0-9੦-੯]+\s*)+[\]॥।|]+/gu;

export const paathWordCount = (text: string) => text
  .replace(numberedEnding," ")
  .replace(/[\[\];,.|।॥]/g," ")
  .split(/\s+/)
  .filter(word => /\p{L}|ੴ/u.test(word) || word === "<>").length;

const endsParagraph = (pankti:Pankti) =>
  Boolean(pankti.gurmukhi.match(numberedEnding)) || /rhwau|ਰਹਾਉ|ਰਹਾੳੁ/u.test(pankti.gurmukhi);

/** Canonical paragraph slots are assigned by the loader across ang boundaries.
 * Pair slots (1,2), (3,4), etc. only when they contain at most twelve words.
 * If a slot is too long, both lines stay single: the second cannot drift into
 * the next couplet. The fallback follows the same rule for unannotated rows.
 */
export function paathDisplayRows(pages: PaathAng[]): PaathDisplayPage[] {
  let pending: Pankti[] | undefined;
  return pages.map(page => {
    const rows: Pankti[][] = [];
    for (const pankti of page.panktis) {
      const first = pending?.[0];
      const eligible = pankti.type_id >= 3 && !pankti.paath_keep_single;
      const sameParagraphSlot = first && (first.paath_pair_id || pankti.paath_pair_id
        ? Boolean(first.paath_pair_id && first.paath_pair_id === pankti.paath_pair_id)
        : first.shabad_id === pankti.shabad_id && first.source_id === pankti.source_id);
      if (eligible && pending && sameParagraphSlot) {
        const firstWords = paathWordCount(first!.gurmukhi);
        const secondWords = paathWordCount(pankti.gurmukhi);
        if (firstWords > 0 && secondWords > 0 && firstWords + secondWords <= 12) {
          pending.push(pankti);
        } else rows.push([pankti]);
        pending = undefined;
      } else {
        const row = [pankti];
        rows.push(row);
        pending = eligible && !endsParagraph(pankti) ? row : undefined;
      }
    }
    return { ang: page.ang, rows };
  });
}

export const joinedPaathTranslation = (row: Pankti[], language: "punjabi_translation" | "english_translation") =>
  row.map(pankti => pankti[language]?.trim()).filter(Boolean).join(" ") || "—";
