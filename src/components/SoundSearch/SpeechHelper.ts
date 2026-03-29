import { get } from "fast-levenshtein";
import { Pankti } from "../../models/Pankti";
import { partial_ratio, ratio } from "fuzzball";

export type PanktiScore = {
    matches: string[];
    words: string[],
    tokenIdxs: number[],
    wordIdxs: number[],
    totalMatches: number;
    panktiStarted: boolean,
    vishraamStarted: boolean;
    panktiFinished: boolean,
    continueMatch: boolean,
    startingWordMatch: boolean,

    startFull: boolean,
    vishraamFull: boolean,
    fullMatch: boolean,
    panktiIdx: number;
    shabadId: string;
    panktiStartIdx: number;
    panktiEndIdx: number;
    firstMatchIdx: number;
    lastMatchIdx: number;
};

// const RAHAOH_PANKTI_TYPE_ID = 3;
// const SHABAD_PANKTI_TYPE_ID = 4;

export const getLatestPanktiPart = (token: string) => {
    if (token.trim() === '') {
        return [];
    }

    const parts = token.split(',').map(token => token.trim());

    const unique = Array.from(new Set(parts));

    // Remove partials (keep longer strings)
    const noPartials = unique.filter((item) =>
        !unique.some(
            (other) => other !== item && other.includes(item)
        )
    );

    // Sort by the LAST related occurrence (including partials)
    return noPartials.sort((a, b) => {
        const getLastRelatedIndex = (value: string): number => {
            return Math.max(
                ...parts
                    .map((item, index) =>
                        value.includes(item) ? index : -1
                    )
            );
        };

        return getLastRelatedIndex(a) - getLastRelatedIndex(b);
    });
};

export const getUnvisitedIdx = (panktis: Pankti[], currentIdx: number) => {
    const groups = [...new Set(panktis.map(pankti => pankti.group))];
    const groupShabad = groups.length > 1;

    if (!groupShabad) {
        return panktis.findIndex(
            p => !p.visited && p.type_id > 2 && p.gurmukhi_words.length > 2
        );
    }

    const currentGroup = panktis[currentIdx].group;
    const currentGroupIdxs = panktis
        .map((pankti, idx) => ({ pankti, idx }))
        .filter(
            ({ pankti }) =>
            currentGroup === pankti.group &&
            pankti.type_id > 2 &&
            pankti.gurmukhi_words.length > 2
        )
        .map(({ idx }) => idx);

    if (currentGroupIdxs.length > 3) {
        return panktis.findIndex(
            p => !p.visited && p.type_id > 2 && p.gurmukhi_words.length > 1 && p.group === currentGroup
        );
    }

    return panktis.findIndex(
        p => !p.visited && p.type_id > 2 && p.gurmukhi_words.length > 2
    );
};

export const getAllowedNextPanktiIdxs = (panktis: Pankti[], homeIdx: number, currentIdx: number) => {
    const groups = [...new Set(panktis.map(pankti => pankti.group))];
    const groupShabad = groups.length > 1;
    let unvisitedPanktis: number[] = [];

    // Step 1: Find first valid unvisited pankti
    const firstUnvisitedIndex = panktis.findIndex(
        p => !p.visited && p.type_id > 2 && p.gurmukhi_words.length > 1
    );

    if (firstUnvisitedIndex === -1) {
        // all finished, allow within home group
        if (groupShabad) {
            return [
                ...panktis.filter(pankti => panktis[homeIdx].group === pankti.group && pankti.type_id > 2 && pankti.gurmukhi_words.length > 1)
                .map((_, index) => index),
                currentIdx
            ];
        }

        return [currentIdx, homeIdx, currentIdx - 1];
    }

    if (firstUnvisitedIndex !== -1) {
        const targetGroup = panktis[firstUnvisitedIndex].group;

        panktis.forEach((pankti, index) => {
            if (
            !pankti.visited &&
            pankti.type_id > 2 &&
            index !== homeIdx &&
            pankti.group === targetGroup
            ) {
                unvisitedPanktis.push(index);
            }
        });
    }

    let nextPanktiIdxs = [unvisitedPanktis[0], currentIdx];

    if (!groupShabad) {
        if (currentIdx === homeIdx) {
            nextPanktiIdxs = [unvisitedPanktis[0], currentIdx, currentIdx+1];
        } else {
            nextPanktiIdxs = [unvisitedPanktis[0], currentIdx, homeIdx];
            if (currentIdx > 0) {
                nextPanktiIdxs.push(currentIdx-1);
            }
        }
    } else {
        const currentGroup = panktis[currentIdx].group;
        const homeGroup = panktis[homeIdx].group;
        const currentGroupIdxs = panktis
            .map((pankti, idx) => ({ pankti, idx }))
            .filter(
                ({ pankti }) =>
                panktis[currentIdx].group === pankti.group &&
                pankti.type_id > 2 &&
                pankti.gurmukhi_words.length > 2
            )
            .map(({ idx }) => idx);

        const currentPanktiGroupIdx = currentGroupIdxs.find((idx) => idx === currentIdx) ?? -1;
        const prevIdx = (currentPanktiGroupIdx === -1 || currentPanktiGroupIdx === currentGroupIdxs[0])
            ? -1 : (currentPanktiGroupIdx - 1);
        const nextIdx = (
            currentPanktiGroupIdx === -1 || (currentPanktiGroupIdx == currentGroupIdxs[currentGroupIdxs.length-1])
        ) ? -1 :currentPanktiGroupIdx + 1;

        // long group, keep within group
        if (currentGroupIdxs.length > 3) {
            const groupUnvisitedIndex = panktis.findIndex(
                p => !p.visited && p.type_id > 2 && p.gurmukhi_words.length > 2 && p.group === currentGroup
            );
            if (groupUnvisitedIndex === -1) {
                return [currentIdx, homeIdx];
            }

            return [groupUnvisitedIndex, currentIdx, homeIdx];
        }

        if (currentGroup === homeGroup && currentGroupIdxs.length > 0) {
            return [unvisitedPanktis[0], ...currentGroupIdxs];
        }

        return [currentIdx, prevIdx, nextIdx, homeIdx].filter(index => index >= 0);
    }

    return nextPanktiIdxs;
};

export const findMatchingPankti = (panktis: Pankti[], tokens: string[], homeIdx: number, currentIdx: number) => {
    if (tokens.length < 1) {
        return [];
    }

    const nextPanktiIdxs = getAllowedNextPanktiIdxs(panktis, homeIdx, currentIdx);
    // console.log('next panktis: ', nextPanktiIdxs);
    let matchScores: PanktiScore[] = getPanktiScores(panktis, tokens);

    if (matchScores.length === 0) {
        return [];
    }

    // filter towards last match
    matchScores = findMatchTowardEnd(matchScores)

    // filter full matched ones
    const fullMatchScores = matchScores.filter(matchScore => matchScore.fullMatch);
    if (fullMatchScores.length === 1) {
        return fullMatchScores;
    }

    // filter full start or vishraam
    const fullStartOrVishraam = matchScores.filter(matchScore => matchScore.startFull || matchScore.vishraamFull);
    if (fullStartOrVishraam.length === 1) {
        return fullStartOrVishraam;
    }

    // allow next possible panktis only non visited
    matchScores = matchScores.filter((panktiScore) => nextPanktiIdxs.includes(panktiScore.panktiIdx)
        && (
            panktiScore.panktiStarted ||
            (panktiScore.vishraamStarted && panktiScore.panktiIdx === homeIdx) ||
            (panktiScore.panktiFinished && panktiScore.panktiIdx === homeIdx && panktiScore.totalMatches > 1) ||
            panktiScore.panktiIdx === currentIdx
        )
    );
    if (matchScores.length === 1) {
        return matchScores;
    }

    return [];
};

export const findBaniMatchingPankti = (panktis: Pankti[], tokens: string[], currentIdx: number, prefixIdx: number) => {
    if (tokens.length < 1) {
        return [];
    }

    let nextPanktiIdxs = [currentIdx, currentIdx+1];

    let i = 1;
    while (panktis[currentIdx+i]?.type_id <= 2 && i <= 5) {
        nextPanktiIdxs.push(currentIdx+i);
        i++;
    }

    let matchScores: PanktiScore[] = getPanktiScores(panktis, tokens, prefixIdx, true);

    if (matchScores.length === 0) {
        return [];
    }

    // filter towards last match
    matchScores = findMatchTowardEnd(matchScores);
    if (matchScores.length === 0) {
        return [];
    }

    // filter full matched ones
    const fullMatchScores = matchScores.filter(matchScore => matchScore.fullMatch &&
        (
            (matchScore.totalMatches > 1 && panktis[matchScore.panktiIdx]?.type_id > 2) ||
            nextPanktiIdxs.includes(matchScore.panktiIdx)
        )
    );
    if (fullMatchScores.length === 1) {
        return fullMatchScores;
    }

    // filter full start or vishraam
    const fullStartOrVishraam = matchScores.filter(matchScore => (matchScore.startFull || matchScore.vishraamFull)
        &&
        (
            matchScore.totalMatches > 1 ||
            nextPanktiIdxs.includes(matchScore.panktiIdx)
        )
    );
    if (fullStartOrVishraam.length === 1) {
        return fullStartOrVishraam;
    }

    // allow next possible panktis only non visited
    matchScores = matchScores.filter(
        (panktiScore) => (
            nextPanktiIdxs.includes(panktiScore.panktiIdx)) &&
            (
                panktiScore.panktiStarted ||
                panktiScore.panktiIdx === currentIdx
            )
    );
    if (matchScores.length === 1) {
        return matchScores;
    }

    return [];
};

export const findMatchTowardEnd = (scores: PanktiScore[]) => {
    // most matches with ending match
    const sorted = [...scores].sort((a, b) => {
        // Step 1: Ascending firstMatchIdx
        if (a.firstMatchIdx !== b.firstMatchIdx) {
            return a.firstMatchIdx - b.firstMatchIdx;
        }

        // Step 2: Descending lastMatchIdx
        return b.lastMatchIdx - a.lastMatchIdx;
    });

    // Get the pankti based on lastMatchIdx (due to reverse)
    const lastPankti = sorted[0];
    const latestStart = lastPankti.firstMatchIdx;
    const latestEnd = lastPankti.lastMatchIdx;

    // Filter: include if overlaps with the latest pankti (based on first and last match indexes)
    return sorted.filter(p => {
        const pStart = p.firstMatchIdx;
        const pEnd = p.lastMatchIdx;

        // pankti starting before or equal lastone but ending last
        return (pStart <= latestStart && pEnd == latestEnd)
    });
}

export const getPanktiScores = (panktis: Pankti[], tokens: string[], prefixIdx = 0, strictMatch: boolean = true) => {
    const rTokens = tokens.join(' ').split(' ').reverse();

    const matches = [];
    for (let i = 0; i < panktis.length; i++) {
        const matchScore = getPanktiScore(panktis[i], rTokens, strictMatch);

        if (matchScore == null) continue;

        matchScore.panktiIdx = i + prefixIdx;
        matchScore.shabadId = panktis[i].shabad_id;

        matches.push(matchScore);
    }

    return matches;
}

const isMatching = (word: string, token: string, strictMatch: boolean): boolean => {
    if (!word || !token) return false;

    word = word.replace('ਂ', '');
    token = token.replace('ਂ', '');

    if (word === token) return true;

    if ((token === 'ਇਕਓੰਕਾਰ' && word === 'ਇਕਓਅੰਕਾਰਿ') ||
        (token === 'ੴ' && word === 'ਇਕਓਅੰਕਾਰਿ')
    ) {
        return true;
    }

    if (!strictMatch) {
        return get(word, token) <= 1;
    }

    // allow last ੁ missing
    const lastChar = word.slice(-1);
    const lastTwoChars = word.slice(-2);
    const tokenLastChar = token[token.length - 1];
    const wordWithoutLastOne = word.slice(0, -1);
    const wordWithoutLastTwo = word.slice(0, -2);
    const tokenWithoutOne = token.slice(0, -1);

    // word with quiet similar matra match e.g. ੇ or ੈ
    if (tokenWithoutOne === wordWithoutLastOne && (
        (['ੈ', 'ੇ'].includes(lastChar) && ['ੈ', 'ੇ'].includes(tokenLastChar)) ||
        (['ੋ', 'ੌ', 'ੁ'].includes(lastChar) && ['ੋ', 'ੌ', 'ੁ'].includes(tokenLastChar))
    )) {
        return true;
    }

    if (
        tokenLastChar !== lastChar &&
        (   
            lastChar === 'ੁ' ||
            lastChar === 'ਿ' ||
            lastChar === 'ਂ'  ||
            lastChar === 'ਾ'
        ) &&
        wordWithoutLastOne === token
    ) {
        return true;
    }

    // haha or oora with onkar changed to hora or knora
    if (['ੋ', 'ੌ'].includes(tokenLastChar) &&
        (
            (
                (
                    lastChar === 'ਉ' &&
                    (
                        lastTwoChars != 'ਾਉ' &&
                        lastTwoChars != 'ਆਉ'
                    )
                ) &&
                (
                    wordWithoutLastOne === tokenWithoutOne
                )
            ) ||
            (
                lastTwoChars === 'ਹੁ' &&
                wordWithoutLastTwo === tokenWithoutOne
            )
        )
    ) {
        return true;
    }

    if (word.replaceAll('੍', '') === token.replaceAll('੍', '')) {
        return true;
    }

    // peri rara without last onkar
    if (
        word.replaceAll(/([ਕ-ਹ])੍ਰਿ/g, '$1ਿਰ')
        .replaceAll('੍', '')
        .replace(/ੁ$/, '') === token.replace(/ੁ$/, '')
    ) {
        return true;
    }

    return false;
};

export const getPanktiScore = (pankti: Pankti, tokens: string[], strictMatch: boolean) => {
    let matches: PanktiScore[] = [];
    const words = pankti.gurmukhi_rwords;
    const vishraam_idx = pankti.vishraam_ridx ? (pankti.vishraam_ridx - 1) : -1;

    for (let i = 0; i < words.length; i++) {
        for (let j = 0; j < tokens.length; j++) {
            
            let k = 0;
            let startingWordMatch = false;

            while (
                i + k < words.length &&
                j + k < tokens.length &&
                (
                    isMatching(words[i + k], tokens[j + k], strictMatch) ||
                    (
                        words[i+k].startsWith(tokens[j+k]) &&
                        (i+k+1) < words.length &&
                        (j+k+1) < tokens.length &&
                        isMatching(words[i + k + 1], tokens[j + k + 1], strictMatch)
                    )
                )
            ) {
                if (words[i + k] !== tokens[j + k] && words[i+k].startsWith(tokens[j+k])) {
                    startingWordMatch = true;
                }

                k++;
            }

            // only allow start match if atleast one match
            if ((k > 0 && !startingWordMatch) || k > 0) {
                const tokensIndexes = Array.from({ length: k }, (_, idx) => j + idx);
                const wordIdxs = Array.from({ length: k }, (_, idx) => i + idx);
                const matchedWords = tokens.slice(j, j + k);

                const vishraamStarted = wordIdxs.includes(vishraam_idx - 1);
                const panktiFinished = wordIdxs[0] === 0;
                const panktiStarted =
                    wordIdxs[wordIdxs.length - 1] === words.length - 1;

                const match: PanktiScore = {
                    matches: matchedWords,
                    words: words,
                    tokenIdxs: tokensIndexes,
                    wordIdxs,
                    totalMatches: k,
                    panktiStarted,
                    vishraamStarted,
                    panktiFinished,
                    continueMatch: true,
                    startFull: panktiStarted && wordIdxs[0] <= vishraam_idx,
                    vishraamFull: vishraamStarted && panktiFinished,
                    fullMatch: k === words.length,
                    panktiIdx: -1,
                    shabadId: '',
                    panktiStartIdx: i,
                    panktiEndIdx: wordIdxs[wordIdxs.length - 1],
                    firstMatchIdx: j,
                    lastMatchIdx: tokensIndexes[tokensIndexes.length - 1],
                    startingWordMatch,
                };

                matches.push(match);

                // console.log('i: ', i, ' j: ', j);
                // console.log('score match: ', match);

                break;
            }
        }
    }

     const sortedMatches = matches.sort((a, b) => {
        // Step 1: Ascending firstMatchIdx
        if (a.firstMatchIdx !== b.firstMatchIdx) {
            return a.firstMatchIdx - b.firstMatchIdx;
        }

        // Step 2: Descending lastMatchIdx
        if (b.lastMatchIdx != a.lastMatchIdx) {
            return b.lastMatchIdx - a.lastMatchIdx;
        }

        // Step3: Descending panktiEndIdx
        return b.panktiEndIdx - a.panktiEndIdx;
    });

    // console.log('sorted:');
    // console.log(sortedMatches);

    if (sortedMatches.length > 0) {
        return sortedMatches[0];
    }

    return null;
};

export function unifySearchText(text: string) {
  const parts = text
    .replaceAll("।", ",")
    .replaceAll(";", ",")
    .split(",")
    .map(p => p.trim())
    .filter(Boolean);

  const words = (s: string) => s.split(/\s+/);

  const isSubset = (small: string, big: string) => {
    const s = words(small);
    const b = words(big);

    for (let i = 0; i <= b.length - s.length; i++) {
      let match = true;

      for (let j = 0; j < s.length; j++) {
        const sw = s[j];
        const bw = b[i + j];

        if (j === s.length - 1) {
          if (!bw.startsWith(sw)) {
            match = false;
            break;
          }
        } else {
          if (get(bw, sw) > 1) {
            match = false;
            break;
          }
        }
      }

      if (match) return true;
    }

    return false;
  };

  // track last occurrence
  const lastIndex = new Map<string, number>();
  parts.forEach((p, i) => lastIndex.set(p, i));

  const unique = [...lastIndex.keys()];

  const filtered = unique.filter(a => {
    return !unique.some(
      b => a !== b && isSubset(a, b) && words(b).length >= words(a).length
    );
  });

  return filtered
    .sort((a, b) => lastIndex.get(a)! - lastIndex.get(b)!)
    .join(",").replaceAll('  ', ' ');
};

export function removeMatras(text: string) {
    // Array of Gurmukhi matras (diacritical marks)
    const matras = ['ਿ', 'ੀ', 'ੁ', 'ੂ', 'ੇ', 'ੈ', 'ੋ', 'ੌ', '੍', 'ਾ', 'ਂ', 'ੰ', 'ੱ'];

    // Split the text into an array of characters, filter out matras, and join back into a string
    return text.replaceAll('੍ਰ', '').split('')
            .map(char => char
                .replace('ਆ', 'ਅ')
                .replace('ਐ', 'ਅ')
                .replace('ਉ', 'ੳ')
                .replace('ਊ', 'ੳ')
                .replace('ਇ', 'ੲ')
                .replace('ਈ', 'ੲ')
                .replace('ਏ', 'ੲ')
            )
            .filter(char => !matras.includes(char))
               
               .join('');
}

interface MatchScore {
  matchLen: number;
  exactMatches: number;      // exact matches score higher than fuzzy
  totalDistance: number;     // lower is better
  hasStartingMatch: boolean;
}

function isBetterScore(a: MatchScore, b: MatchScore): boolean {
  if (a.matchLen !== b.matchLen) return a.matchLen > b.matchLen;
  if (a.exactMatches !== b.exactMatches) return a.exactMatches > b.exactMatches;
  if (a.totalDistance !== b.totalDistance) return a.totalDistance < b.totalDistance;
  if (a.hasStartingMatch !== b.hasStartingMatch) return !a.hasStartingMatch; // prefer no partial
  return false;
}

export function postProcessText(
  speechText: string,
  panktis: Pankti[]
): string {
  const rawFragments = speechText.split("।");

  // Dedup now also cleans internally — returns cleaned, unique fragments
  const uniqueFragments = deduplicateFuzzyFragments(rawFragments, panktis);

  const processedFragments = uniqueFragments.map(fragment => {
    if (!fragment.trim()) return "";

    // Tokenize words + commas
    const tokens = fragment.match(/[^,\s]+|[,]/g) || [];
    if (!tokens.length) return fragment;

    const fragWords = tokens.filter(t => t !== ",");

    // Find best matching Pankti window
    const bestWindow = findBestPanktiFragment(fragWords, panktis);

    // Typo correction ONLY
    const correctedWords = fragWords.map((w, idx) =>
      bestWindow[idx] && levenshteinDistance(w, bestWindow[idx]) <= 2
        ? bestWindow[idx]
        : w
    );

    // Reconstruct with commas preserved
    const reconstructed: string[] = [];
    let wordIdx = 0;
    for (const t of tokens) {
      if (t === ",") reconstructed.push(",");
      else reconstructed.push(correctedWords[wordIdx++]);
    }

    return reconstructed.join(" ");
  });

  return processedFragments
    .filter(Boolean)
    .map(f => f.trim().replace(/,\s*$/, ""))
    .join(" ।")
    .replace(/।\s*/g, "। ")
    .replace(/\s+,/g, ",")
    .replace(/,+/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function deduplicateFuzzyFragments(fragments: string[], panktis: Pankti[]): string[] {
  const seen: string[] = [];

  return fragments
    .map(fragment => {
      const trimmed = fragment.trim();
      if (!trimmed) return null;

      const cleaned = cleanFragmentFuzzy(trimmed, panktis); // ✅ pass panktis
      if (!cleaned) return null;

      const isDuplicate = seen.some(prev => fragmentsSimilar(prev, cleaned));
      if (isDuplicate) return null;

      seen.push(cleaned);
      return cleaned;
    })
    .filter((f): f is string => f !== null);
}

/**
 * Two fragments are "similar" if their word-level Levenshtein ratio is high.
 * Uses normalized total edit distance across aligned words.
 */
/**
 * Two fragments are "similar" if:
 * 1. Same length + fuzzy word match (existing logic), OR
 * 2. One is a fuzzy suffix/substring of the other
 */
function fragmentsSimilar(a: string, b: string): boolean {
  const wordsA = a.trim().split(/\s+/);
  const wordsB = b.trim().split(/\s+/);

  const longer  = wordsA.length >= wordsB.length ? wordsA : wordsB;
  const shorter = wordsA.length <  wordsB.length ? wordsA : wordsB;

  // Case 1: similar length — fuzzy word alignment (existing logic)
  if (longer.length - shorter.length <= 2) {
    let totalDist = 0;
    for (let i = 0; i < shorter.length; i++) {
      totalDist += levenshteinDistance(shorter[i], longer[i]);
    }
    if (totalDist / shorter.length <= 1) return true;
  }

  // Case 2: shorter is a fuzzy suffix of longer
  // e.g. ["ਹਮਾਰੋ","ਮਾਥਾ"] is a suffix of ["ਸੰਤਹ","ਚਰਣ","ਹਮਾਰੋ","ਮਾਥਾ"]
  if (shorter.length < longer.length) {
    const suffixStart = longer.length - shorter.length;
    const suffix = longer.slice(suffixStart);

    let totalDist = 0;
    for (let i = 0; i < shorter.length; i++) {
      totalDist += levenshteinDistance(shorter[i], suffix[i]);
    }
    if (totalDist / shorter.length <= 1) return true;
  }

  return false;
}

/**
 * Only drop a comma-part as duplicate if it is FULLY complete
 * (i.e. the last word is not a partial prefix of any pankti word).
 * A partial last word means speech is still mid-word — keep it.
 */
function cleanFragmentFuzzy(fragment: string, panktis: Pankti[]): string {
  const parts = fragment
    .split(",")
    .map(p => p.trim())
    .filter(Boolean);

  const deduped: string[] = [];

  for (const part of parts) {
    const words = part.trim().split(/\s+/);
    const lastWord = words[words.length - 1];

    // ✅ If last word looks partial, this part is still being spoken — always keep
    const isPartial = isPartialWord(lastWord, panktis);
    if (isPartial) {
      deduped.push(part);
      continue;
    }

    const isDuplicate = deduped.some(prev => fragmentsSimilar(prev, part));
    if (!isDuplicate) {
      deduped.push(part);
    }
  }

  return deduped.join(", ");
}

/**
 * A word is "partial" if it is a strict prefix (not full match) of any pankti word
 * AND it meets the half-length threshold.
 */
function isPartialWord(word: string, panktis: Pankti[]): boolean {
  if (word.length <= 1) return true; // single char is always partial

  for (const p of panktis) {
    for (const pWord of p.gurmukhi_speech.split(/\s+/)) {
      if (
        pWord !== word &&                              // not an exact match
        pWord.startsWith(word) &&                     // is a prefix
        word.length >= Math.ceil(pWord.length / 2)   // at least half length
      ) {
        return true;
      }
      // Also partial if it's shorter than half — definitely incomplete
      if (pWord.startsWith(word) && word.length < Math.ceil(pWord.length / 2)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * A word is "complete" at a position if:
 * 1. It exactly matches the pankti word at that position, OR
 * 2. It exists as an exact word in ANY pankti (so it's a real complete word, not a fragment)
 *    BUT only if the current pankti word is longer (meaning this pankti sees it as partial)
 */
function isCompleteWordAtPosition(
  fWord: string,
  panktiWords: string[],
  pos: number,
  panktis: Pankti[]
): boolean {
  const f = normalizeGurmukhi(fWord);
  const pWord = normalizeGurmukhi(panktiWords[pos]);

  // If current pankti has exact match at this position — definitely complete
  if (f === pWord) return true;

  // If another pankti has this as an exact word AND
  // the current pankti word is longer (i.e. current pankti treats it as prefix)
  // then trust the other pankti — fWord is complete, not partial
  if (pWord.startsWith(f) && pWord !== f) {
    for (const p of panktis) {
      for (const w of p.gurmukhi_speech.split(/\s+/)) {
        if (normalizeGurmukhi(w) === f) return true; // exists as complete word elsewhere
      }
    }
  }

  return false;
}

/**
 * 🔥 Find best matching Pankti segment
 * Uses:
 * - total matches
 * - longest contiguous match (priority)
 */
function findBestPanktiFragment(
  fragWords: string[],
  panktis: Pankti[]
): string[] {
  if (!fragWords.length) return fragWords;

  let bestScore: MatchScore | null = null;
  let bestWindow: string[] | null = null;

  for (const p of panktis) {
    const panktiWords = p.gurmukhi_speech.split(/\s+/);

    for (let i = 0; i < panktiWords.length; i++) {
      for (let j = 0; j < fragWords.length; j++) {

        let k = 0;
        let hasStartingMatch = false;
        let exactMatches = 0;
        let totalDistance = 0;

        while (
          i + k < panktiWords.length &&
          j + k < fragWords.length
        ) {
          const pWord = panktiWords[i + k];
          const fWord = fragWords[j + k];
          const isLastToken = (j + k + 1) >= fragWords.length;

          // fix: ਐਸੀ ਕਿਰਪਾ ਮੋਹਿ ਕਰੋ, ਐਸੀ ਕਿਰਪਾ ਮੋਹਿ ਕਰੋ। ਐਸੀ ਕਿਰਪਾ ਮੋਹਿ ਕਰੋ, ਐਸੀ ਕਿਰਪਾ ਮੋਹਿ ਕਰੋ। ਸੰਤ

          // ✅ Check prefix match FIRST, before fuzzy distance
          // A partial word should always prefer its completion over a fuzzy wrong word
          const isPrefixMatch =
            isLastToken &&
            pWord !== normalizeGurmukhi(fWord) &&        // ✅ not an exact match at this position
            !isCompleteWordAtPosition(fWord, panktiWords, i + k, panktis) &&
            normalizeGurmukhi(fWord)[0] === normalizeGurmukhi(pWord)[0] &&  // ✅ normalized first char
            fWord.length < pWord.length &&
            isFuzzyPrefix(fWord, pWord);

          if (isPrefixMatch) {
            // Treat prefix as a near-exact match — high quality, low distance
            exactMatches += 0.9;                             // almost exact credit
            totalDistance += 0;                              // no penalty — it's intentionally partial
            hasStartingMatch = true;
            k++;
            break;
          }

          const dist = wordsMatch_distance(fWord, pWord);

          if (dist !== -1) {
            if (dist === 0) exactMatches++;
            totalDistance += dist;
            k++;
          } else {
            break;
          }
        }

        if (k === 0) continue;
        if (hasStartingMatch) {
          const matchedFromStart = j === 0;
          const prefixIsLastFragWord = (j + k) === fragWords.length;

          if (!matchedFromStart || !prefixIsLastFragWord) continue;
        }

        const score: MatchScore = {
          matchLen: k,
          exactMatches,
          totalDistance,
          hasStartingMatch,
        };

        const windowStart = i - j;
        if (windowStart < 0) continue;

        if (!bestScore || isBetterScore(score, bestScore)) {
          bestScore = score;
          bestWindow = panktiWords.slice(windowStart, windowStart + fragWords.length);
        }
      }
    }
  }

  const minMatch = Math.ceil(fragWords.length * 0.5);
  if (!bestScore || bestScore.matchLen < minMatch) return fragWords;

  // Keep partial last word as-is
  if (bestScore.hasStartingMatch && bestWindow && bestWindow.length === fragWords.length) {
    bestWindow[fragWords.length - 1] = fragWords[fragWords.length - 1];
  }

  return bestWindow ?? fragWords;
}

/**
 * Check if fWord is a fuzzy prefix of pWord.
 * e.g. "ਨਨ" ~ prefix of "ਨਾਨਕ" (dist between "ਨਨ" and "ਨਾਨ" <= 1)
 */
function isFuzzyPrefix(fWord: string, pWord: string): boolean {
  const f = normalizeGurmukhi(fWord);
  const p = normalizeGurmukhi(pWord);

  if (f.length > p.length) return false;
  if (f[0] !== p[0]) return false;

  if (p.startsWith(f)) return true;

  if (removeMatras(p).startsWith(removeMatras(f))) return true;

  const pSlice = p.slice(0, f.length);
  return levenshteinDistance(f, pSlice) <= 1;
}

/**
 * Returns levenshtein distance if words match, -1 if they don't.
 */
function wordsMatch_distance(fWord: string, pWord: string): number {
  const f = normalizeGurmukhi(fWord);
  const p = normalizeGurmukhi(pWord);

  if (f.length === 1) return f === p ? 0 : -1;
  if (f[0] !== p[0]) return -1;
  if (f.length === 2) {
    const d = levenshteinDistance(f, p);
    return d <= 1 ? d : -1;
  }

  const dist = levenshteinDistance(f, p);
  if (dist <= 1) return dist;
  if (dist === 2) {
    if (f.length >= 4) return f[f.length - 1] === p[p.length - 1] ? dist : -1;
    return dist;
  }
  return -1;
}

/**
 * Normalize Gurmukhi text for comparison:
 * - Remove virama (੍) joining characters so conjuncts don't inflate distance
 * - Normalize unicode to NFC
 */
function normalizeGurmukhi(word: string): string {
  return word
    .normalize('NFC')
    .replace(/੍/g, '');  // remove virama so ਪ੍ਰ counts as ਪਰ for distance purposes
}

function levenshteinDistance(a: string, b: string): number {
  // ✅ Normalize before comparing
  a = normalizeGurmukhi(a);
  b = normalizeGurmukhi(b);

  const dp = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else dp[i][j] = 1 + Math.min(dp[i-1][j-1], dp[i][j-1], dp[i-1][j]);
    }
  }

  return dp[a.length][b.length];
}

export function unifySpeechText(text: string) {
  const parts = text
    .replaceAll("|", ",")
    .replaceAll(";", ",")
    .split(",")
    .map(p => p.trim())
    .filter(Boolean);

  const words = (s: string) => s.split(/\s+/);

  const isSubset = (small: string, big: string) => {
    const s = words(small);
    const b = words(big);

    for (let i = 0; i <= b.length - s.length; i++) {
      let match = true;

      for (let j = 0; j < s.length; j++) {
        const sw = s[j];
        const bw = b[i + j];

        if (j === s.length - 1) {
          if (!bw.startsWith(sw)) {
            match = false;
            break;
          }
        } else {
          if (bw !== sw) {
            match = false;
            break;
          }
        }
      }

      if (match) return true;
    }

    return false;
  };

  // track last occurrence
  const lastIndex = new Map<string, number>();
  parts.forEach((p, i) => lastIndex.set(p, i));

  const unique = [...lastIndex.keys()];

  const filtered = unique.filter(a => {
    return !unique.some(
      b => a !== b && isSubset(a, b) && words(b).length >= words(a).length
    );
  });

  return filtered
    .sort((a, b) => lastIndex.get(a)! - lastIndex.get(b)!)
    .join(" ").replaceAll('  ', ' ');
};

function normalizeWithMap(text: string) {
  const normalized = [];
  const indexMap = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Ignore punctuation
    if (/[^\p{L}\p{N}\s]/u.test(char)) continue;

    normalized.push(char);
    indexMap.push(i);
  }

  return {
    cleanText: normalized.join(""),
    indexMap
  };
}

export function findIndexIgnoringPunctuation(text: string, searchText: string) {
  const { cleanText, indexMap } = normalizeWithMap(text);

  const cleanSearch = searchText.replace(/[^\p{L}\p{N}\s]/gu, "");

  const pos = cleanText.indexOf(cleanSearch);

  if (pos === -1) return -1;

  return indexMap[pos]; // original string index
}
