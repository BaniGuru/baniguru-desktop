import Fuse from "fuse.js";
import { DB } from "../utils/DB";
import { removeMatras } from "../components/SoundSearch/SpeechHelper";

type PanktiRow = {
  id: string;
  gurmukhi_speech: string;
  normalized?: string;
  gurmukhi_nomatra?: string;
};

const searchWords = (text: string) => removeMatras(text.normalize("NFC"))
  .replace(/[,.|;:!?।॥]/g, " ").split(/\s+/).filter(word => word.length >= 2);

class GurbaniSearch {
  private fuse: Fuse<PanktiRow> | null = null;
  private wordIndex = new Map<string, number[]>();
  private data: PanktiRow[] = [];
  private initialized = false;
  private initializing: Promise<void> | null = null;

  /**
   * Initialize once
   */
  async init() {
    if (this.initialized) return;

    // no db path yet
    if (! DB.getDbPath()) return;

    if (this.initializing) return this.initializing;
    this.initializing = this.loadIndex();
    try { await this.initializing; } finally { this.initializing = null; }
  }

  private async loadIndex() {

    const db = await DB.getInstance();

    const rows: PanktiRow[] = await db.select(
      "SELECT id, gurmukhi_speech FROM panktis"
    );

    this.data = (rows || []).map(row => ({
      ...row,
      gurmukhi_speech: row.gurmukhi_speech,
      gurmukhi_nomatra: removeMatras(row.gurmukhi_speech.normalize("NFC")),
    }));

    this.fuse = new Fuse(this.data, {
      keys: ["gurmukhi_speech"],
      includeScore: true,
      threshold: 0.4,
      ignoreLocation: true,
      minMatchCharLength: 0,
      useExtendedSearch: true
    });

    this.data.forEach((row, index) => {
      for (const word of new Set(searchWords(row.gurmukhi_speech))) {
        const postings = this.wordIndex.get(word) ?? [];
        postings.push(index);
        this.wordIndex.set(word, postings);
      }
    });

    this.initialized = true;

    console.log("GurbaniSearch index ready");
  }

  /**
   * Search
   */
  async search(queries: string[], type: "shabad"|"search" = "shabad"): Promise<PanktiRow[]> {
    if (!this.initialized) {
      await this.init();
    }

    if (!this.fuse || queries.length === 0) return [];

    let searchFuse: Fuse<PanktiRow> | null = null;
    if (type === "search") {
      // Scanning every line for every cross-Pankti ASR phrase blocks the UI.
      // An inverted word index narrows all queries together. Rare shared
      // words carry more weight; an isolated ASR typo need not occur in the
      // corpus. Only the shortlist goes through the expensive fuzzy matcher.
      const scores = new Map<number, number>();
      for (const word of new Set(queries.flatMap(searchWords))) {
        const postings = this.wordIndex.get(word);
        if (!postings) continue;
        const weight = 1 / Math.log2(2 + postings.length);
        for (const index of postings) scores.set(index, (scores.get(index) ?? 0) + weight);
      }
      const shortlist = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .slice(0, 1_200).map(([index]) => this.data[index]);
      if (!shortlist.length) return [];
      searchFuse = new Fuse(shortlist, {
        keys: ["gurmukhi_nomatra"], includeScore: true, threshold: 0.4,
        ignoreLocation: true, useExtendedSearch: false,
      });
    }

    const map = new Map<string, { item: PanktiRow; score: number }>();

    for (const query of queries) {
      let queryResults;
      if (type === "search" && searchFuse) {
        // The search index is built from matra-normalized Gurbani. Normalize
        // the live ASR query the same way before comparing it to that index.
        queryResults = searchFuse.search(removeMatras(query.trim().normalize("NFC")));
      } else {
        queryResults = this.fuse.search(query.trim());
      }

      for (const r of queryResults) {
        const item = r.item;

        const score = r.score ?? 1;
        const current = map.get(item.id);
        if (!current || score < current.score) {
          map.set(item.id, { item, score });
        }
      }
    }

    return Array.from(map.values())
      .sort((left, right) => left.score - right.score)
      .map(result => result.item);
  }
}

export const gurbaniSearch = new GurbaniSearch();
