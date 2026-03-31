import Fuse from "fuse.js";
import { DB } from "../utils/DB";
import { get } from "fast-levenshtein";

type PanktiRow = {
  id: string;
  gurmukhi_speech: string;
  normalized?: string;
};

const GURMUKHI_PHONETIC: Record<string, string> = {
  "ਣ": "ਨ",
  "ਵ": "ਬ",
  "ਭ": "ਪ",
};

function normalizePhonetic(str: string) {
  return str
    .split("")
    .map(ch => GURMUKHI_PHONETIC[ch] || ch)
    .join("");
}

function isOrderedFuzzyMatch(query: string, text: string, maxDistance = 1) {
  const queryWords = query.split(" ");
  const textWords = text.split(" ");

  let qIndex = 0;
  let mismatches = 0;

  for (let i = 0; i < textWords.length && qIndex < queryWords.length; i++) {
    const qNorm = normalizePhonetic(queryWords[qIndex]);
    const tNorm = normalizePhonetic(textWords[i]);

    if (get(tNorm, qNorm) <= maxDistance) {
      qIndex++;
    } else {
      if (qIndex > 0) {
        mismatches++;
        if (mismatches > maxDistance) return false;
      }
    }
  }

  return qIndex === queryWords.length;
}

class GurbaniSearch {
  private fuse: Fuse<PanktiRow> | null = null;
  private data: PanktiRow[] = [];
  private initialized = false;

  /**
   * Initialize once
   */
  async init() {
    if (this.initialized) return;

    // no db path yet
    if (! DB.getDbPath()) return;

    const db = await DB.getInstance();

    const rows: PanktiRow[] = await db.select(
      "SELECT id, gurmukhi_speech FROM panktis"
    );

    this.data = (rows || []).map(row => ({
      ...row,
      gurmukhi_speech: row.gurmukhi_speech
    }));

    this.fuse = new Fuse(this.data, {
      keys: ["gurmukhi_speech"],
      includeScore: true,
      threshold: 0.4,
      ignoreLocation: true,
      minMatchCharLength: 0,
      useExtendedSearch: true
    });

    this.initialized = true;

    console.log("GurbaniSearch index ready");
  }

  /**
   * Search
   */
  async search(queries: string[]): Promise<PanktiRow[]> {
    if (!this.initialized) {
      await this.init();
    }

    if (!this.fuse || queries.length === 0) return [];

    let results: PanktiRow[] = [];

    for (const query of queries) {
      const queryResults = this.fuse.search(query);

      const matches = queryResults.map(r => r.item);
      results.push(...matches);

    //   const ordered = queryResults
    //     .map(r => r.item)
    //     .filter(item =>
    //       isOrderedFuzzyMatch(query, item.gurmukhi_no_matra, 1)
    //     );

    //   results.push(...ordered);
    }

    return results;
  }
}

export const gurbaniSearch = new GurbaniSearch();