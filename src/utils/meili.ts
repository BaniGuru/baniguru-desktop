import { Command } from '@tauri-apps/plugin-shell';
import { Meilisearch } from 'meilisearch';
import { DB } from './DB';
import { appDataDir, join } from '@tauri-apps/api/path';
import { mkdir } from '@tauri-apps/plugin-fs';
import { get as levenshtein } from 'fast-levenshtein';
import { Pankti } from '../models/Pankti';

const MEILI_HOST = 'http://127.0.0.1:7700';
const MEILI_KEY = 'baniguru-dev-key';
const PANKTI_INDEX = 'panktis';

let meiliStarted = false;
let meiliIndexed = false;
let meiliProcess: any = null;

type PanktiHit = {
  id: string;
  gurmukhi: string;
  gurmukhi_speech: string;
};

export const meiliClient = new Meilisearch({
  host: MEILI_HOST,
  apiKey: MEILI_KEY,
});

function normalizeSpeech(text: string) {
  return text
    .replace(/[।॥|,;.!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeGurmukhiSpeech(text: string) {
  return text
    .replace(/[।॥|,;.!?0-9]/g, ' ')

    // vowel normalization
    .replace(/ੵ/g, '')
    .replace(/ੈ/g, 'ੇ')
    .replace(/ੌ/g, 'ੋ')
    .replace(/[ੰਂੱ]/g, '')

    // vowel normalization
    .replace(/ਓਹੁ(?=\s|$)/g, 'ਓਹੋ') // first combined
    .replace(/ਹੁ(?=\s|$)/g, 'ੋ')   // ਕਰਹੁ -> ਕਰੋ

    .replace(/ਸ਼/g, 'ਸ')
    .replace(/ਹਉ(?=\s|$)/g, 'ਹੋ')
    .replace(/ਪਉ(?=\s|$)/g, 'ਪੋ')
    .replace(/ਕਉ(?=\s|$)/g, 'ਕੋ')  // ਕਉ -> ਕੋ
    .replace(/ਤਉ(?=\s|$)/g, 'ਤੋ')  // ਤਉ -> ਤੋ
    .replace(/ਾਉ(?=\s|$)/g, 'ਾਓ') // ਜਾਉ -> ਜਾਓ

    // remove final sihari/onkar
    .replace(/[ਿੁ](?=\s|$)/g, '')

    .replace(/\s+/g, ' ')
    .trim();
}

function getSpeechChunks(text: string) {
  const normalized = normalizeGurmukhiSpeech(
    normalizeSpeech(text)
  );

  const parts = normalized
    .split(/[,|]+/)
    .map((p) => normalizeGurmukhiSpeech(p))
    .filter(Boolean);

  const chunks: string[] = [];

  if (normalized) {
    chunks.push(normalized);
  }

  for (const part of parts) {
    const words = part.split(' ').filter(Boolean);

    chunks.push(part);

    for (const size of [8, 7, 6, 5, 4, 3, 2]) {
      for (let i = 0; i <= words.length - size; i++) {
        chunks.push(words.slice(i, i + size).join(' '));
      }
    }
  }

  return [...new Set(chunks)];
}

function wordDistanceScore(queryWord: string, textWord: string) {
  if (queryWord === textWord) {
    return 1;
  }

  if (queryWord.length <= 2 || textWord.length <= 2) {
    return 0;
  }

  const distance = levenshtein(queryWord, textWord);
  const maxLen = Math.max(queryWord.length, textWord.length);
  const ratio = distance / maxLen;

  if (ratio > 0.4) {
    return 0;
  }

  return 1 - ratio;
}

type MatchInfo = {
  score: number;
  matchedWords: string[];
  matchedWordCount: number;
  queryWordCount: number;
  matchRatio: number;
  longestRun: number;
  runRatio: number;
  hasContinuousMatch: boolean;
};

function normalizeCompareWord(word: string) {
  if (word.length <= 2) {
    return word.replace(/ਾ$/g, '');
  }

  return word;
}

function wordsEquivalent(a: string, b: string) {
  const aa = normalizeCompareWord(a);
  const bb = normalizeCompareWord(b);

  if (aa === bb) {
    return true;
  }

  if (aa.length <= 2 || bb.length <= 2) {
    return false;
  }

  return levenshtein(aa, bb) <= 1;
}

function longestConsecutiveMatch(
  qWords: string[],
  tWords: string[]
) {
  let best = 0;

  for (let qi = 0; qi < qWords.length; qi++) {
    for (let ti = 0; ti < tWords.length; ti++) {
      let len = 0;

      while (
        qi + len < qWords.length &&
        ti + len < tWords.length &&
        wordsEquivalent(
          qWords[qi + len],
          tWords[ti + len]
        )
      ) {
        len++;
      }

      best = Math.max(best, len);
    }
  }

  return best;
}

function scorePankti(query: string, text: string): MatchInfo {
  const qWords = normalizeGurmukhiSpeech(normalizeSpeech(query))
    .split(' ')
    .filter(Boolean);

  const tWords = normalizeGurmukhiSpeech(normalizeSpeech(text))
    .split(' ')
    .filter(Boolean);

  const normalizedText = normalizeGurmukhiSpeech(normalizeSpeech(text));

  if (qWords.length === 0) {
    return {
      score: 0,
      matchedWords: [],
      matchedWordCount: 0,
      queryWordCount: 0,
      matchRatio: 0,
      longestRun: 0,
      runRatio: 0,
      hasContinuousMatch: false,
    };
  }

  let distanceScore = 0;
  const matchedWords: string[] = [];

  for (const q of qWords) {
    let bestWordScore = 0;

    for (const t of tWords) {
      bestWordScore = Math.max(bestWordScore, wordDistanceScore(q, t));
    }

    if (bestWordScore > 0) {
      matchedWords.push(q);
      distanceScore += bestWordScore;
    }
  }

  const matchedWordCount = matchedWords.length;
  const matchRatio = matchedWordCount / qWords.length;
  const avgDistanceScore = distanceScore / qWords.length;

  const longestRun = longestConsecutiveMatch(qWords, tWords);
  const runRatio = longestRun / qWords.length;

  let phraseBonus = 0;

  for (let i = 0; i < qWords.length - 1; i++) {
    const pair = `${qWords[i]} ${qWords[i + 1]}`;

    if (normalizedText.includes(pair)) {
      phraseBonus += 0.25;
    }
  }

  if (qWords.length >= 4 && runRatio < 0.1) {
    return {
      score: 0,
      matchedWords,
      matchedWordCount,
      queryWordCount: qWords.length,
      matchRatio,
      longestRun,
      runRatio,
      hasContinuousMatch: false,
    };
  }

  const score =
    matchRatio * 2 +
    avgDistanceScore +
    phraseBonus +
    runRatio * 3;

  return {
    score,
    matchedWords,
    matchedWordCount,
    queryWordCount: qWords.length,
    matchRatio,
    longestRun,
    runRatio,
    hasContinuousMatch: longestRun >= 2,
  };
}

export async function searchPanktiHybrid(
  speechText: string
) {
  await ensurePanktiIndex();

  const index =
    meiliClient.index<PanktiHit>(PANKTI_INDEX);

  const chunks = getSpeechChunks(speechText);

  const candidates = new Map<
    string,
    PanktiHit & {
      matchedChunks: string[];
    }
  >();

  for (const chunk of chunks) {
  const result = await index.search<PanktiHit>(
      normalizeGurmukhiSpeech(chunk),
      {
        limit: 100,
        attributesToSearchOn: [
          'gurmukhi_speech',
        ],
      }
    );

    for (const hit of result.hits) {
      const existing = candidates.get(hit.id);

      if (existing) {
        existing.matchedChunks.push(chunk);
      } else {
        candidates.set(hit.id, {
          ...hit,
          matchedChunks: [chunk],
        });
      }
    }
  }

  const query = normalizeGurmukhiSpeech(
    normalizeSpeech(speechText)
  );

  return [...candidates.values()]
    .map((item) => {
      const matchInfo = scorePankti(query, item.gurmukhi_speech);

      return {
        ...item,
        score: matchInfo.score,
        matchInfo,
      };
    })
    // .filter((item) => item.score > 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

const isFullMatch = (
    searchText: string,
    panktiText: string,
    maxDistance = 2
) => {
    searchText = searchText.replaceAll(',', '');
    panktiText = panktiText.replaceAll(',', '');
    const searchWords = searchText.split(/\s+/);
    const panktiWords = panktiText.split(/\s+/);
    const windowSize = panktiWords.length;

    for (let i = 0; i <= searchWords.length - windowSize; i++) {
        const chunk = searchWords
            .slice(i, i + windowSize)
            .join(" ");

        if (levenshtein(chunk, panktiText) <= maxDistance) {
            return true;
        }
    }

    return false;
};

export function getAutoNavigateMatch(speechText: string, panktis: Pankti[]) {
  return panktis.filter(pankti => isFullMatch(speechText, pankti.gurmukhi_speech));
}

export async function startMeilisearch() {
  if (meiliStarted) {
    return;
  }

  if (await isMeiliRunning()) {
    meiliStarted = true;
    console.log('Meilisearch already running');
    return;
  }

  meiliStarted = true;

  try {
    const dataDir = await appDataDir();

    const meiliDbPath = await join(
      dataDir,
      'meili_data'
    );

    await mkdir(meiliDbPath, {
      recursive: true,
    });

    const command = Command.sidecar(
      'binaries/meilisearch',
      [
        '--http-addr',
        '127.0.0.1:7700',

        '--master-key',
        MEILI_KEY,

        '--db-path',
        meiliDbPath,

        '--log-level',
        'ERROR',
      ]
    );

    command.stderr.on('data', (line) => {
      const text = String(line);

      if (
        text.includes('ERROR') ||
        text.includes('error')
      ) {
        console.error('[meili]', text);
      }
    });

    meiliProcess = await command.spawn();

    await waitForMeili();

    console.log('Meilisearch ready');
  } catch (e) {
    meiliStarted = false;
    console.error(e);
  }
}

async function waitForTask(taskUid: number) {
  while (true) {
    const res = await fetch(`${MEILI_HOST}/tasks/${taskUid}`, {
      headers: {
        Authorization: `Bearer ${MEILI_KEY}`,
      },
    });

    const task = await res.json();

    if (task.status === 'succeeded') return;

    if (task.status === 'failed') {
      throw new Error(task.error?.message || 'Meili task failed');
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

export async function ensurePanktiIndex() {
  if (meiliIndexed) {
    return;
  }

  meiliIndexed = true;

  try {
    await startMeilisearch();

    const db = await DB.getInstance();

    const rows = await db.select<
      {
        id: string;
        gurmukhi_speech: string;
      }[]
    >(`
      SELECT
        id,
        gurmukhi_speech
      FROM panktis
      WHERE gurmukhi_speech IS NOT NULL
        AND gurmukhi_speech != ''
    `);

    const normalizedRows = rows.map((row) => ({
      ...row,

      gurmukhi_speech:
        normalizeGurmukhiSpeech(
          row.gurmukhi_speech
        ),
    }));

    try {
      await meiliClient.deleteIndex(PANKTI_INDEX);
    } catch {}

    const index =
      meiliClient.index(PANKTI_INDEX);

    const settingsTask = await index.updateSettings({
      searchableAttributes: [
        'gurmukhi_speech',
      ],

      displayedAttributes: [
        'id',
        'gurmukhi_speech',
      ],

      typoTolerance: {
        enabled: true,
      },

      synonyms: {
        'ਤਨ': ['ਧਨ'],
        'ਧਨ': ['ਤਨ'],
        'ਅਬਲ': ['ਅਵਲ'],
        'ਕੋਣ': ['ਕੋਣ', 'ਕਉਨ', 'ਕਉਣ'],
        'ਅਲਾ': ['ਅਲਾਹ', 'ਅਲਾ'],
        'ਨਿਭਹ': ['ਨਿਬਹੇ', 'ਨਿਭੇ'],
        'ਨਾ': ['ਨਾ', 'ਨਾਹ'],
        'ਸੁਣ': ['ਸੁਣ', 'ਸੁਨ'],
        'ਸੁਨ': ['ਸੁਣ', 'ਸੁਨ'],
        'ਏਕ ਲੜੀ': ['ਏਕਲੜੀ'],
        'ਮਾਹ': ['ਮਾਹੇ', 'ਮਾਹ'],
        'ਮੇ': ['ਮਹ', 'ਮੇ'],
        'ਤੂ ਹੀ': ['ਤੂਹੀ', 'ਤੂ ਹੀ'],
        'ਨਿਰਾ ਫਲ': ['ਨਿਰਾਫਲ'],
        'ਮਹਾ ਜਾਲ': ['ਮਹਾਜਾਲ', 'ਮਹਾ ਜਾਲ'],
        'ਗੁਰ ਸਬਦ': ['ਗੁਰਸਬਦ'],
        'ਜੀ': ["ਜੀ", "ਜੀਅ"],
        "ਪਿਨੀ": ["ਭਿਨੀ"],
        "ਰੇਨ ੜੀਐ": ["ਰੇਨੜੀਐ"],
        "ਰੇਨ ਲੜੀਐ": ["ਰੇਨੜੀਐ"],
        "ਚਮ ਕਣ": ["ਚਮਕਣ", "ਚਾਮਕਨ"],
        "ਕਲ ਮਲਾ": ["ਕਲਮਲਾ"],
        "ਜਾ ਕੇ": ["ਜਾਗੇ", "ਜਾ ਕੇ"],
      },
    });

    await waitForTask(settingsTask.taskUid);

    await index.addDocuments(
      normalizedRows,
      {
        primaryKey: 'id',
      }
    );

    console.log(
      `Indexed ${rows.length} panktis`
    );
  } catch (e) {
    meiliIndexed = false;

    console.error(
      'Failed to index panktis:',
      e
    );
  }
}

async function isMeiliRunning() {
  try {
    const res = await fetch(`${MEILI_HOST}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForMeili() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(
        `${MEILI_HOST}/health`
      );

      if (res.ok) {
        return;
      }
    } catch {}

    await new Promise((r) =>
      setTimeout(r, 500)
    );
  }

  throw new Error(
    'Meilisearch failed to start'
  );
}

export async function stopMeilisearch() {
  try {
    await meiliProcess?.kill();

    meiliProcess = null;
    meiliStarted = false;
  } catch (e) {
    console.error(
      'Failed to stop Meilisearch',
      e
    );
  }
}