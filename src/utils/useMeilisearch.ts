import { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { MeiliSearch } from 'meilisearch';
import { DB } from './DB';
import { AppContext } from '../state/providers/AppProvider';

// -------------------------
// Helper functions
// -------------------------
export const createPhoneticKey = (text: string) => {
  if (!text) return '';

  return text
    .toLowerCase()
    // velar group
    .replace(/kh|gh|g/g, 'k')
    // dental group
    .replace(/dh|th|d/g, 't')
    // labial group
    .replace(/bh|ph|b/g, 'p')
    // palatal group
    .replace(/chh|jh|j/g, 'ch')
    // remove vowels
    .replace(/[aeiou]/g, '')
    // remove duplicate letters
    .replace(/(.)\1+/g, '$1')
    .toUpperCase();
};

const gurmukhiToTranslitMap: Record<string, string> = {
  'ੳ': 'u', 'ਅ': 'a', 'ੲ': 'i',
  'ਕ': 'k', 'ਖ': 'kh', 'ਗ': 'g', 'ਘ': 'gh',
  'ਚ': 'ch', 'ਛ': 'chh', 'ਜ': 'j', 'ਝ': 'jh',
  'ਟ': 't', 'ਠ': 'th', 'ਡ': 'd', 'ਢ': 'dh',
  'ਤ': 't', 'ਥ': 'th', 'ਦ': 'd', 'ਧ': 'dh',
  'ਪ': 'p', 'ਫ': 'ph', 'ਬ': 'b', 'ਭ': 'bh',
  'ਮ': 'm', 'ਨ': 'n',
  'ਸ': 's', 'ਸ਼': 's', 'ਹ': 'h',
  'ਲ': 'l', 'ਰ': 'r',
  'ਵ': 'v', 'ੜ': 'r'
};

const transliterateQuery = (word: string) =>
  word.split('').map(c => gurmukhiToTranslitMap[c] || '').join('');

// -------------------------
// Meilisearch client
// -------------------------
const client = new MeiliSearch({
  host: 'http://localhost:7700',
});

// -------------------------
// Data interface
// -------------------------
interface Pankti {
  id: string;
  shabad_id: string;
  type_id: number | null;
  gurmukhi_speech: string;
  transliteration: string;
  phonetic: string;
}

// -------------------------
// Hook
// -------------------------
const useMeilisearch = (indexName: string) => {
  const { dbPath } = useContext(AppContext);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Pankti[]>([]);
  const indexRef = useRef<any>(null);

  // -------------------------
  // Initialize index & populate
  // -------------------------
  useEffect(() => {
    const initialize = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const indexInstance = client.index(indexName);

        // Create index if it does not exist
        try {
          await indexInstance.getSettings();
        } catch {
          await client.createIndex(indexName, { primaryKey: 'id' });
          console.log(`Index '${indexName}' created`);
        }

        indexRef.current = indexInstance;

        // Check if documents exist
        const stats = await indexInstance.getStats();
        if (stats.numberOfDocuments > 0) {
          console.log('Index already populated, skipping data insertion');
          return;
        }

        // -------------------------
        // Fetch data from SQLite
        // -------------------------
        const db = await DB.getInstance();
        const sql = `
          SELECT id, shabad_id, source_id, type_id, gurmukhi, first_letters, gurmukhi_no_matra,
                 gurmukhi_speech, transliteration
          FROM panktis
          LEFT JOIN transliterations ON line_id = panktis.id AND language_id = 1;
        `;
        const rows = await db.select<Pankti[]>(sql);
        console.log('Fetched rows:', rows.length);

        if (rows && rows.length > 0) {
          const enrichedRows = rows.map(r => ({
            ...r,
            phonetic: createPhoneticKey(r.transliteration || ''),
          }));

          // -------------------------
          // Batch insert
          // -------------------------
          const batchSize = 5000;
          for (let i = 0; i < enrichedRows.length; i += batchSize) {
            await indexInstance.addDocuments(enrichedRows.slice(i, i + batchSize));
            console.log(`Batch ${i / batchSize + 1} uploaded`);
          }

          // -------------------------
          // Update searchable attributes & ranking
          // -------------------------
          await indexInstance.updateSearchableAttributes(['gurmukhi_speech']);
          await indexInstance.updateRankingRules(['exactness','words','typo','proximity','attribute','sort']);
          console.log('Documents added to Meilisearch');
        }

      } catch (err) {
        console.error('Error initializing Meilisearch index:', err);
        setError('Error initializing Meilisearch index');
      } finally {
        setIsLoading(false);
      }
    };

    initialize();
  }, [dbPath, indexName]);

  // -------------------------
  // Search function
  // -------------------------
  const searchPankti = useCallback(async (query: string) => {
    if (!indexRef.current || !query.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      console.log('searching query: ', query);
      setResults([]);
      const searchResults = await indexRef.current.search(query);
      setResults(searchResults.hits);
    } catch (err) {
      console.error('Search error:', err);
      setError('Search error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { isLoading, error, results, searchPankti };
};

export default useMeilisearch;