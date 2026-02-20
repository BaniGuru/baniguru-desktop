import { get } from "fast-levenshtein";
import { Pankti } from "../models/Pankti";

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

export const isMatching = (word: string, token: string): boolean => {
    if (!word || !token) return false;

    if (word === token) return true;

    if (token === 'ਇਕਓੰਕਾਰ' && word === 'ਇਕਓਨਕਾਰ') {
        return true;
    }

    // allow last ੁ missing
    const lastChar = word[word.length - 1];
    const tokenLastChar = token[token.length - 1];
    const wordWithoutLastMatra = word.slice(0, -1);
    const tokenWithoutLastMatra = token.slice(0, -1);

    // word with quiet similar matra match e.g. ੇ or ੈ
    if (tokenWithoutLastMatra === wordWithoutLastMatra && (
        (['ੈ', 'ੇ'].includes(lastChar) && ['ੈ', 'ੇ'].includes(tokenLastChar)) ||
        (['ੋ', 'ੌ', 'ੁ'].includes(lastChar) && ['ੋ', 'ੌ', 'ੁ'].includes(tokenLastChar))
    )) {
        return true;
    }

    if (
        tokenLastChar !== lastChar &&
        (lastChar === 'ੁ' || lastChar === 'ਿ' || lastChar === 'ਂ') &&
        wordWithoutLastMatra === token
    ) {
        return true;
    }

    return false;
};

export const findLatestMatches = (scores: PanktiScore[]) => {
    if (!scores.length) return [];

    // todo: could use next possible panktis to remove matches less than 2 match (in future)
    const sorted = [...scores].filter((score) => (score.totalMatches > 1 || score.firstMatchIdx !== 0))
    .sort((a, b) => {
        // Step 1: Ascending firstMatchIdx
        if (a.firstMatchIdx !== b.firstMatchIdx) {
            return a.firstMatchIdx - b.firstMatchIdx;
        }

        // Step 2: Descending lastMatchIdx
        return b.lastMatchIdx - a.lastMatchIdx;
    });

    if (sorted.length === 0) return [];

    // Get the first pankti based on lastMatchIdx (due to reverse)
    const firstPanti = sorted[0];
    const latestStart = firstPanti.firstMatchIdx;
    const latestEnd = firstPanti.lastMatchIdx;

    // Filter: include if overlaps with the latest pankti (based on first and last match indexes)
    return sorted.filter(p => {
        const pStart = p.firstMatchIdx;
        const pEnd = p.lastMatchIdx;

        // note: can skip pankti if it's within start end range
        return (pStart <= latestEnd && pEnd >= latestStart)
    });
};

export const findBestScore = (
    tokens: string[],
    words: string[],
    vishraam_idx: number,
    isPartial: boolean = false,
): PanktiScore | null => {

    let matches: PanktiScore[] = [];

    for (let i = 0; i < words.length; i++) {
        for (let j = 0; j < tokens.length; j++) {

            let k = 0;

            while (
                i + k < words.length &&
                j + k < tokens.length &&
                (
                    isMatching(words[i + k], tokens[j + k]) ||
                    (isPartial && get(words[i + k], tokens[j + k]) <= 2)
                )
            ) {
                k++;
            }

            if (k > 0) {
                const tokensIndexes = Array.from({ length: k }, (_, idx) => j + idx);
                const wordIdxs = Array.from({ length: k }, (_, idx) => i + idx);
                const matchedWords = tokens.slice(j, j + k);

                const vishraamStarted = wordIdxs[0] < vishraam_idx;
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

export const findBestPanktiScore = (reverseTokens: string[], pankti: Pankti, panktiIdx: number, shabadId: string, isPartial = false) => {
    const reverse_vishraam_idx = pankti.reverse_vishraam_idx;
    const reverseWords = pankti.reverse_gurmukhi_words;

    const score = findBestScore(reverseTokens, reverseWords, reverse_vishraam_idx, isPartial);

    if (!score) {
        return score;
    }

    score.panktiIdx = panktiIdx;
    score.shabadId = shabadId;

    return score;
};

    export const findMatches = (panktiTokens: string[], tokens: string[], panktis: Pankti[], current: number): PanktiScore[] => {
        let scores: PanktiScore[] = [];

        // check current pankti when pankti tokens are not same
        if (panktiTokens.length !== tokens.length) {
            const score = findBestPanktiScore(tokens, panktis[current], current, panktis[current].shabad_id, true);
            if (score && score.totalMatches < panktis[current].gurmukhi_words.length && score.continueMatch) {
                scores.push(score);
                return scores;
            }
        }

        // reserve tokens
        const reverseTokens = [...tokens].reverse();
        console.log(`token: ${reverseTokens.join(' ')}\n`);

        for (let panktiIdx = 0; panktiIdx < panktis.length; panktiIdx++) {
            const pankti = panktis[panktiIdx];
            const score = findBestPanktiScore(reverseTokens, pankti, panktiIdx, panktis[panktiIdx].shabad_id);
            if (!score) {
                continue;
            }

            // console.log();
            // console.log('reverse words: ', JSON.stringify(reverseWords), ' vishraam: ', reverse_vishraam_idx);
            // console.log('score: ', JSON.stringify(score));
            scores.push(score);
        }

        scores = scores.filter((score) => {
            return score.panktiStarted || score.vishraamStarted
            // TODO: check if this required
            // || score.panktiFinished
        })

        scores = findLatestMatches(scores);

        return scores;
    };

export const isMatchingPankti = (tokens: string[], pankti: Pankti) => {

}
