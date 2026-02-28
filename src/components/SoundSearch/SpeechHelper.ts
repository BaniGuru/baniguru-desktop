import { get } from "fast-levenshtein";
import { Pankti } from "../../models/Pankti";

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

const RAHAOH_PANKTI_TYPE_ID = 3;
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

const getAllowedNextPanktiIdxs = (panktis: Pankti[], homeIdx: number, currentIdx: number) => {
    const groups = [...new Set(panktis.map(pankti => pankti.group))];
    const rahaoShabad = groups.length > 1;
    let unvisitedPanktis: number[] = [];

    // Step 1: Find first valid unvisited pankti
    const firstUnvisitedIndex = panktis.findIndex(
        p => !p.visited && p.type_id > 2 && p.gurmukhi_words.length > 1
    );

    if (firstUnvisitedIndex === -1) {
        return [currentIdx];
    }

    if (firstUnvisitedIndex !== -1) {
        const targetGroup = panktis[firstUnvisitedIndex].group;

        panktis.forEach((pankti, index) => {
            if (
            !pankti.visited &&
            pankti.type_id > 2 &&
            pankti.group === targetGroup
            ) {
            unvisitedPanktis.push(index);
            }
        });
    }

    let nextPanktiIdxs = [unvisitedPanktis[0], currentIdx];
    if (!rahaoShabad) {
        if (currentIdx === homeIdx) {
            nextPanktiIdxs = [unvisitedPanktis[0], currentIdx];
        } else {
            nextPanktiIdxs = [unvisitedPanktis[0], currentIdx, homeIdx];
        }
    } else {
        if (panktis[currentIdx].type_id === RAHAOH_PANKTI_TYPE_ID) {
            return [unvisitedPanktis[0], currentIdx];
        }

        // still in same group
        const firstGroup = panktis[firstUnvisitedIndex].group;
        if (firstGroup === panktis[currentIdx].group) {
            return [...unvisitedPanktis, currentIdx];
        }

        // end of current group
        return [currentIdx, homeIdx];
    }

    return nextPanktiIdxs;
};

export const findMatchingPankti = (panktis: Pankti[], tokens: string[], homeIdx: number, currentIdx: number) => {
    if (tokens.length < 1) {
        return [];
    }

    const nextPanktiIdxs = getAllowedNextPanktiIdxs(panktis, homeIdx, currentIdx);
    console.log('next panktis: ', nextPanktiIdxs);
    let matchScores: PanktiScore[] = getPanktiScores(panktis, tokens);

    matchScores = matchScores.filter(matchScore => matchScore.panktiStarted || matchScore.vishraamStarted);

    if (matchScores.length === 0) {
        return [];
    }

    console.log('scores: ', matchScores);

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
    matchScores = matchScores.filter((panktiScore) => nextPanktiIdxs.includes(panktiScore.panktiIdx) &&
        (   (panktiScore.panktiStarted && !panktis[panktiScore.panktiIdx].visited) ||
            panktiScore.panktiIdx === currentIdx)
    );
    if (matchScores.length === 1) {
        return matchScores;
    }

    return [];
};

export const findBaniMatchingPankti = (panktis: Pankti[], tokens: string[], currentIdx: number, panktiFinished: boolean) => {
    if (tokens.length < 1) {
        return [];
    }

    let nextPanktiIdxs = [currentIdx];

    if (panktis.length > (currentIdx+1) && panktiFinished) {
        nextPanktiIdxs.push(currentIdx+1);
    }

    if (panktiFinished && panktis.length > (currentIdx+2) && panktis[currentIdx+1].type_id <= 2) {
        nextPanktiIdxs.push(currentIdx+2);
    }

    console.log('next panktis: ', nextPanktiIdxs);
    let matchScores: PanktiScore[] = getPanktiScores(panktis, tokens);

    matchScores = matchScores.filter(matchScore => matchScore.panktiStarted || matchScore.vishraamStarted);

    if (matchScores.length === 0) {
        return [];
    }

    console.log('scores: ', matchScores);

    // filter towards last match
    matchScores = findMatchTowardEnd(matchScores)
    if (matchScores.length === 0) {
        return [];
    }

    // filter full matched ones
    const fullMatchScores = matchScores.filter(matchScore => matchScore.fullMatch &&
        (
            (matchScore.totalMatches > 1 && panktis[matchScore.panktiIdx].type_id > 2) ||
            nextPanktiIdxs.includes(matchScore.panktiIdx)
        )
    );
    if (fullMatchScores.length === 1) {
        return fullMatchScores;
    }

    // filter full start or vishraam
    const fullStartOrVishraam = matchScores.filter(matchScore => (matchScore.startFull || matchScore.vishraamFull) &&
        (
            nextPanktiIdxs.includes(matchScore.panktiIdx)
        )
    );
    if (fullStartOrVishraam.length === 1) {
        return fullStartOrVishraam;
    }

    // allow next possible panktis only non visited
    matchScores = matchScores.filter((panktiScore) => nextPanktiIdxs.includes(panktiScore.panktiIdx) &&
        (panktiScore.panktiStarted && !panktis[panktiScore.panktiIdx].visited) &&
        (panktis[panktiScore.panktiIdx-1]?.visited || panktiScore.panktiIdx === currentIdx)
    );
    if (matchScores.length === 1) {
        return matchScores;
    }

    return [];
};

const findMatchTowardEnd = (scores: PanktiScore[]) => {
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

        // note: can skip pankti if it's within start end range
        return (pStart <= latestEnd && pEnd >= latestStart)
    });
}

const getPanktiScores = (panktis: Pankti[], tokens: string[]) => {
    const rTokens = tokens.join(' ').split(' ').reverse();

    const matches = [];
    for (let i = 0; i < panktis.length; i++) {
        // console.log(panktis[i].gurmukhi_speech);
        const matchScore = getPanktiScore(panktis[i], rTokens);

        if (matchScore == null) continue;

        matchScore.panktiIdx = i;
        matchScore.shabadId = panktis[i].shabad_id;

        matches.push(matchScore);
    }

    return matches;
}

export const getPanktiScore = (pankti: Pankti, tokens: string[]) => {
    let matches: PanktiScore[] = [];
    const words = pankti.gurmukhi_rwords;
    const vishraam_idx = pankti.vishraam_ridx ? (pankti.vishraam_ridx - 1) : -1;

    for (let i = 0; i < words.length; i++) {
        for (let j = 0; j < tokens.length; j++) {
            
            let k = 0;
            let startMatch = false;

            while (
                i + k < words.length &&
                j + k < tokens.length &&
                (
                    (words[i + k] === tokens[j + k]) ||
                    (get(words[i + k], tokens[j + k]) <= 1 && tokens[j+k].length > 2 && words[i+k].length > 2) ||
                    words[i+k].startsWith(tokens[j+k])
                )
            ) {
                if (words[i + k] !== tokens[j + k] && words[i+k].startsWith(tokens[j+k])) {
                    startMatch = true;
                }

                k++;
            }

            // only allow start match if more than 1 matches
            if ((k > 0 && !startMatch) || k > 1) {
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
