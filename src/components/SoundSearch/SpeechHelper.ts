import { get } from "fast-levenshtein";
import { Pankti } from "../../models/Pankti";
import { extract, partial_ratio } from "fuzzball";

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
    panktiId: string;
    shabadId: string;
    panktiStartIdx: number;
    panktiEndIdx: number;
    firstMatchIdx: number;
    lastMatchIdx: number;
};

// const RAHAOH_PANKTI_TYPE_ID = 3;
// const SHABAD_PANKTI_TYPE_ID = 4;

export function getAdjacentShabadPanktis(statePanktis: Pankti[], currentIndex: number) {
  const currentPankti = statePanktis[currentIndex];

  if (!currentPankti) return [];

  const currentShabadId = currentPankti.shabad_id;

  let start = currentIndex;
  let end = currentIndex;

  // move left while still current shabad
  while (
    start > 0 &&
    statePanktis[start - 1].shabad_id === currentShabadId
  ) {
    start--;
  }

  // move right while still current shabad
  while (
    end < statePanktis.length - 1 &&
    statePanktis[end + 1].shabad_id === currentShabadId
  ) {
    end++;
  }

  // include previous shabad block
  if (start > 0) {
    const prevShabadId = statePanktis[start - 1].shabad_id;

    while (
      start > 0 &&
      statePanktis[start - 1].shabad_id === prevShabadId
    ) {
      start--;
    }
  }

  // include next shabad block
  if (end < statePanktis.length - 1) {
    const nextShabadId = statePanktis[end + 1].shabad_id;

    while (
      end < statePanktis.length - 1 &&
      statePanktis[end + 1].shabad_id === nextShabadId
    ) {
      end++;
    }
  }

  return statePanktis.slice(start, end + 1);
}

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

// Checks if candidate matches all words within MAX_TYPOS
const isWithinTypos = (input: string, candidate: string, typos: number = 2): boolean => {
  const inputWords = input.trim().split(/\s+/);
  const candidateWords = candidate.trim().split(/\s+/);

  return inputWords.every(inputWord => {
    // Find best match for this word in candidate
    const minDistance = Math.min(
      ...candidateWords.map(cw => get(inputWord, cw))
    );
    return minDistance <= typos;
  });
};

export const findMatchPankti = (panktis: Pankti[], speechText: string) => {
  const panktisText = panktis.map(p => p.gurmukhi_speech);

  // Step 1: get fuzzy candidates
  const results = extract(speechText, panktisText, {
    scorer: partial_ratio,
    limit: 20,
  });

  // Step 2: filter by word-level typo constraint
  const filtered = results.filter(([text]) => isWithinTypos(speechText, text));

  if (!filtered.length) return [];

  // Step 3: find highest fuzzy score among filtered
  const topScore = Math.max(...filtered.map(([, score]) => score));

  // Step 4: return all matches with top score
  const bestMatches = filtered
    .filter(([, score]) => score === topScore)
    .map(([text, score, index]) => ({
      text,
      gurmukhi_speech: panktis[index].gurmukhi_speech,
      gurmukhi_words: panktis[index].gurmukhi_words,
      score,
      pankti: panktis[index],
    }));

  return bestMatches;
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

    const relativeCurrentIdx = currentIdx - prefixIdx;
    let nextPanktiIdxs = [relativeCurrentIdx, relativeCurrentIdx+1];

    let i = 1;
    while (panktis[relativeCurrentIdx+i]?.type_id <= 2 && i <= 5) {
        nextPanktiIdxs.push(relativeCurrentIdx+i);
        i++;
    }

    let matchScores: PanktiScore[] = getPanktiScores(panktis, tokens, 0, true);

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
        return [
            {
                ...fullMatchScores[0],
                panktiIdx: fullMatchScores[0].panktiIdx + prefixIdx
            }
        ];
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
        return [
            {
                ...fullStartOrVishraam[0],
                panktiIdx: fullStartOrVishraam[0].panktiIdx + prefixIdx
            }
        ];
    }

    // allow next possible panktis only non visited
    matchScores = matchScores.filter(
        (panktiScore) => (
            nextPanktiIdxs.includes(panktiScore.panktiIdx)) &&
            (
                panktiScore.panktiStarted ||
                panktiScore.panktiIdx === relativeCurrentIdx
            )
    );
    if (matchScores.length === 1) {
        return [
            {
                ...matchScores[0],
                panktiIdx: matchScores[0].panktiIdx + prefixIdx
            }
        ];
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

export const getPanktiScores = (panktis: Pankti[], tokens: string[], prefixIdx = 0, strictMatch: boolean = true, strictLevel: number = 1) => {
    const rTokens = tokens.join(' ').split(' ').reverse();

    const matches = [];
    for (let i = 0; i < panktis.length; i++) {
        const matchScore = getPanktiScore(panktis[i], rTokens, strictMatch, strictLevel);

        if (matchScore == null) continue;

        matchScore.panktiIdx = i + prefixIdx;
        matchScore.shabadId = panktis[i].shabad_id;

        matches.push(matchScore);
    }

    return matches;
}

const isMatching = (word: string, token: string, strictMatch: boolean, strictLevel: number = 1): boolean => {
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
        return get(word, token) <= strictLevel;
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

export const getPanktiScore = (pankti: Pankti, tokens: string[], strictMatch: boolean, strictLevel: number = 1) => {
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
                    isMatching(words[i + k], tokens[j + k], strictMatch, strictLevel) ||
                    (
                        words[i+k].startsWith(tokens[j+k]) &&
                        (i+k+1) < words.length &&
                        (j+k+1) < tokens.length &&
                        isMatching(words[i + k + 1], tokens[j + k + 1], strictMatch, strictLevel)
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
                    panktiId: pankti.id,
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

export function unifySearchText(speechText: string) {
  const regex = /[^।,.]+[।,.]?/g;

  const rawFragments =
    speechText.match(regex)?.map(fragment => {
      const trimmed = fragment.trim();

      const lastChar = trimmed.slice(-1);
      if (lastChar === "।" || lastChar === "," || lastChar === ".") {
        return {
          text: trimmed.slice(0, -1).trim(),
          delimiter: lastChar,
        };
      }

      return { text: trimmed, delimiter: "" };
    }) ?? [];

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
          if (sw !== bw) {
            match = false;
            break;
          }
        }
      }

      if (match) return true;
    }

    return false;
  };

  const result: typeof rawFragments = [];

  for (const frag of rawFragments) {
    if (!frag.text) continue;

    const exists = result.some(
      r => r.text === frag.text || isSubset(frag.text, r.text)
    );

    if (!exists) {
      result.push(frag);
    }
  }

  // rebuild preserving original delimiter
  let output = result
    .map(f => f.text + f.delimiter)
    .join(" ")
    .trim();

  // important fix:
  // if only one fragment left but original had commas → keep last delimiter
  if (
    result.length === 1 &&
    rawFragments.length > 1 &&
    !result[0].delimiter
  ) {
    // find any delimiter from original
    const found = rawFragments.find(f => f.delimiter);
    if (found) {
      output = result[0].text + found.delimiter;
    }
  }

  return output;
}

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

