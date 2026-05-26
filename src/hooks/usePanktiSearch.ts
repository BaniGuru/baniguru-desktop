import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Fuse from "fuse.js";
import { DB } from "../utils/DB";
import { get } from "fast-levenshtein";

type PanktiRow = {
  id: string;
  gurmukhi_no_matra: string;
};

/**
 * Phonetic normalization map for Gurmukhi
 * Letters with the same sound are mapped to the same character
 */
const GURMUKHI_PHONETIC: Record<string, string> = {
  "ਣ": "ਨ",
  "ਵ": "ਬ",
  "ਭ": "ਪ",
};

/**
 * Normalize a string using the phonetic map
 */
function normalizePhonetic(str: string) {
  return str
    .split("")
    .map(ch => GURMUKHI_PHONETIC[ch] || ch)
    .join("");
}

export function usePanktiSearch() {
  const [data, setData] = useState<PanktiRow[]>([]);
  const [query, setQuery] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fuseRef = useRef<Fuse<PanktiRow> | null>(null);
  const loadedRef = useRef(false);

  const path = DB.getDbPath();

  /**
   * Load data ONCE
   */
  useEffect(() => {
    if (loadedRef.current) return;
    if (!path) return;

    async function load() {
      try {
        const db = await DB.getInstance();
        const rows: PanktiRow[] = await db.select(
          "SELECT id, gurmukhi_no_matra FROM panktis"
        );

        // normalize all data for phonetic matching
        const normalizedData = (rows || []).map(row => ({
          ...row,
          normalized: normalizePhonetic(row.gurmukhi_no_matra)
        }));

        setData(normalizedData);
        loadedRef.current = true;
      } catch (err) {
        console.error("DB error:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [path]);

  /**
   * Build Fuse.js index once
   */
  useEffect(() => {
    if (data.length === 0) return;
    if (fuseRef.current) return;

    fuseRef.current = new Fuse(data, {
      keys: ["normalized"],     // search on the normalized phonetic field
      includeScore: true,
      threshold: 0.4,           // allow small typos
      ignoreLocation: false,    // preserve order in search
      minMatchCharLength: 0,    // allow even single-letter queries
      useExtendedSearch: true
    });

    console.log("Fuse.js phonetic index completed");
  }, [data]);

  /**
   * Ordered fuzzy match function
   */
  function isOrderedFuzzyMatch(query: string, text: string, maxDistance = 1) {
    // Split the query and text into words
    const queryWords = query.split(' ');
    const textWords = text.split(' ');

    let qIndex = 0;
    let mismatches = 0;

    // Loop through the words in text
    for (let i = 0; i < textWords.length && qIndex < queryWords.length; i++) {
      const qNorm = normalizePhonetic(queryWords[qIndex]);
      const tNorm = normalizePhonetic(textWords[i]);

      // If the words match with allowable fuzziness
      if (get(tNorm, qNorm) <= 1) {
        qIndex++; // Move to the next query word
      } else {
        // Only count mismatches once the query word has started matching
        if (qIndex > 0) {
          mismatches++;
          if (mismatches > maxDistance) return false;
        }
      }
    }

    // Return true if all query words matched in order
    return qIndex === queryWords.length;
  }

  /**
   * Search
   */
  const search = useCallback(
    (q: string[]): PanktiRow[] => {
      if (q.length < 1 || !fuseRef.current) return []; // null check for fuseRef.current

      let results: any[] = [];

      // Iterate over each query in 'q' and search individually
      q.forEach(query => {
        const queryResults = fuseRef.current?.search(normalizePhonetic(query)); // Optional chaining here

        // If queryResults is null or undefined, skip to the next query
        if (!queryResults) return;

        // Filter for ordered fuzzy matches per query
        const ordered = queryResults
          .map(r => r.item)
          .filter(item => isOrderedFuzzyMatch(query, item.gurmukhi_no_matra, 1));

        results = [...results, ...ordered];
      });

      return results;
    },
    []
  );

  /**
   * Derived results
   */
  const results = useMemo(() => search(query), [query, search]);

  return {
    query,
    setQuery,
    results, // PanktiRow[]
    loading
  };
}