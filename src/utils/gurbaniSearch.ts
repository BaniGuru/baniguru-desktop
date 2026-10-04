import Fuse from "fuse.js";
import { DB } from "../utils/DB";
import { removeMatras } from "../components/SoundSearch/SpeechHelper";

type PanktiRow = {
  id: string;
  gurmukhi_speech: string;
  normalized?: string;
};

class GurbaniSearch {
  private fuse: Fuse<PanktiRow> | null = null;
  private searchFuse: Fuse<PanktiRow> | null = null;
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
      gurmukhi_speech: row.gurmukhi_speech,
      gurmukhi_nomatra: removeMatras(row.gurmukhi_speech),
    }));

    this.fuse = new Fuse(this.data, {
      keys: ["gurmukhi_speech"],
      includeScore: true,
      threshold: 0.4,
      ignoreLocation: true,
      minMatchCharLength: 0,
      useExtendedSearch: true
    });

    this.searchFuse = new Fuse(this.data, {
      keys: ["gurmukhi_nomatra"],
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
  async search(queries: string[], type: "shabad"|"search" = "shabad"): Promise<PanktiRow[]> {
    if (!this.initialized) {
      await this.init();
    }

    console.log('search queries: ', queries);

    if (!this.fuse || queries.length === 0) return [];

    const map = new Map<string, { item: PanktiRow; score: number }>();

    for (const query of queries) {
      let queryResults;
      if (type === "search" && this.searchFuse) {
        // The search index is built from matra-normalized Gurbani. Normalize
        // the live ASR query the same way before comparing it to that index.
        queryResults = this.searchFuse.search(removeMatras(query.trim()));
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
