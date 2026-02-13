import { get as levenshteinGet } from "fast-levenshtein";
import { Pankti } from "../models/Pankti";

export type PanktiScore = {
    matches: string[];
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
    firstMatchIdx: number;
    lastMatchIdx: number;
};

const getDefaultScore = (): PanktiScore => {
    return {
        matches: [],
        tokenIdxs: [],
        wordIdxs: [],
        totalMatches: 0,
        panktiStarted: false,
        vishraamStarted: false,
        panktiFinished: false,
        continueMatch: false,
        startFull: false,
        vishraamFull: false,
        fullMatch: false,
        panktiIdx: -1,
        firstMatchIdx: -1,
        lastMatchIdx: -1,
    }
};

export const isMatching = (word: string, token: string): boolean => {
    if (!word || !token) return false;

    if (word === token) return true;

    // allow last ੁ missing
    const lastChar = word[word.length - 1];
    const wordWithoutLastMatra = word.slice(0, -1);

    if (
        token[token.length - 1] !== lastChar &&
        (lastChar === 'ੁ' || lastChar === 'ਿ'  || lastChar === 'ਂ') &&
        wordWithoutLastMatra === token
    ) {
        return true;
    }

    return false;
};

const pushScore = (
    score: PanktiScore,
    word: string,
    tokenIndex: number,
    wordIndex: number,
    totalWords: number,
    vishraam_idx: number,
): PanktiScore => {
    score.matches.push(word);
    score.tokenIdxs.push(tokenIndex);
    score.wordIdxs.push(wordIndex);

    if (wordIndex === (totalWords - 1)) {
        score.panktiStarted = true;

        if (score.continueMatch && score.vishraamStarted) {
            score.startFull = true;
        }
    }

    if (wordIndex === vishraam_idx) {
        score.vishraamStarted = true;
    }

    if (wordIndex === (totalWords - 1)) {
        score.panktiFinished = true;

        if (score.continueMatch && score.vishraamStarted) {
            score.vishraamFull = true;
        }
    }

    return score;
};

export const findLatestMatches = (scores: PanktiScore[]) => {
    if (!scores.length) return [];

    const sorted = [...scores].sort((a, b) => a.firstMatchIdx - b.firstMatchIdx);

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

export const findMatches = (tokens: string[], panktis: Pankti[], current: number): PanktiScore[] => {
    let scores: PanktiScore[] = [];
    const currentPankti = panktis[current];
    const NO_LAST_MATCH = -1;

    // reserve tokens
    const reverseTokens = [...tokens].reverse();
    console.log('reverse tokens: ', JSON.stringify(reverseTokens));

    for (let panktiIdx = 0; panktiIdx < panktis.length; panktiIdx++) {
        let score = getDefaultScore();
        let lastMatchIdx = -1;
        let lastWordIdx = -1;
        let prevMatchIdx = -1;
        let sameMatchCouter = 0;

        // reverse words
        const pankti = panktis[panktiIdx];
        const words = pankti.gurmukhi_words;
        const totalWords = pankti.gurmukhi_words.length;
        const vishraam_idx = pankti.vishraam_idx;
        const reverse_vishraam_idx = totalWords - 1 - vishraam_idx; // 2 = 6 - 1 - 3
        const reverseWords = [...words].reverse();

        // find match
        let allowedLength = reverseWords.length;
        outer:
        for (let wordIndex = 0; wordIndex < allowedLength; wordIndex++) {
            const word = reverseWords[wordIndex];

            for (let tokenIndex = 0; tokenIndex < reverseTokens.length; tokenIndex++) {
                const token = reverseTokens[tokenIndex];
                let isMatch = isMatching(word, token);

                // similar words (skip to next if wasn't previous there)
                // test: mai sat sat sat mai sat sat sat sadha
                // test: gobind gobind gobind sang
                if (isMatch &&
                    wordIndex < (totalWords - 1) && // not last one
                    (tokenIndex + sameMatchCouter + 1) < reverseTokens.length &&
                    (wordIndex + sameMatchCouter + 1) < totalWords &&
                    reverseTokens[tokenIndex + sameMatchCouter + 1] === word[wordIndex + sameMatchCouter + 1] && // same word next
                    (wordIndex + sameMatchCouter + 1) < prevMatchIdx // before already matched word
                ) {
                    sameMatchCouter++;
                    continue outer;
                }

                // skip token until reach to same match token position
                // since we are on last same word, keep decreasing words to add these to list
                if (isMatch && sameMatchCouter > 0) {
                    let serial = 0;
                    while (sameMatchCouter > 0) {
                        const sameWord = reverseWords[sameMatchCouter];
                        const sameWordIdx = wordIndex - serial;
                        const sameTokenIdx = tokenIndex + sameMatchCouter;
                        score = pushScore(score, sameWord, sameTokenIdx, sameWordIdx, totalWords, reverse_vishraam_idx);
                        sameMatchCouter--;
                        serial++;
                        continue;
                    }

                    // do not process tokens anymore
                    break;
                }

                // first match
                if (isMatch && lastMatchIdx === NO_LAST_MATCH) {
                    lastMatchIdx = tokenIndex;
                    lastWordIdx = wordIndex;
                    console.log(
                        'lastMatchIdx: ', lastMatchIdx,
                        ' lastWordIdx: ', lastWordIdx,
                        ' reverse_vishraam_idx: ', reverse_vishraam_idx,
                        ' totalWords: ', totalWords,
                        ' vishraam_idx: ', vishraam_idx,
                        'words: ', JSON.stringify(words)
                    );
                    prevMatchIdx = tokenIndex;
                    score.continueMatch = true;
                    score = pushScore(score, word, tokenIndex, wordIndex, totalWords, reverse_vishraam_idx);
                    continue;
                }

                // skip previous matched indexes
                if (score.tokenIdxs.includes(tokenIndex)) {
                    continue;
                }

                // vishraam matches
                if (isMatch && (tokenIndex - lastMatchIdx) === (wordIndex - lastWordIdx)) {
                    score.continueMatch = (tokenIndex - prevMatchIdx) === 1;
                    score = pushScore(score, word, tokenIndex, wordIndex, totalWords, reverse_vishraam_idx);
                    prevMatchIdx = tokenIndex;
                    continue;
                }

                if (isMatch && panktiIdx > reverse_vishraam_idx && (
                    (tokenIndex - lastMatchIdx) === (wordIndex - lastWordIdx)
                )) {
                    score.continueMatch = (tokenIndex - prevMatchIdx) === 1;
                    score = pushScore(score, word, tokenIndex, wordIndex, totalWords, reverse_vishraam_idx);
                    prevMatchIdx = tokenIndex;
                    continue;
                }
                // TODO: manage 1 gap with is similar word pattern
            }

            // // reset sameMatchCouter if next word is not same as current word
            // // keep resetting for same words after match completed
            // if (sameMatchCouter > 1) {
            //     allowedLength--;
            // }
            // if (sameMatchCouter > 0) {
            //     wordIndex--;
            //     sameMatchCouter--;
            // }
        }

        score.totalMatches = score.matches.length;
        if (score.totalMatches === 0) {
            continue;
        }

        score.panktiIdx = panktiIdx;
        if (score.matches.length === words.length) {
            score.fullMatch = true;
        }

        score.firstMatchIdx = score.tokenIdxs.length > 0 ? Math.min(...score.tokenIdxs) : -1;
        score.lastMatchIdx = score.tokenIdxs.length > 0 ? Math.max(...score.tokenIdxs) : -1;

        console.log('reverse words: ', JSON.stringify(reverseWords));
        console.log('score: ', JSON.stringify(score));
        scores.push(score);
    }

    scores = scores.filter((score) => {
        return score.panktiStarted || score.vishraamStarted
    })

    scores = findLatestMatches(scores);

    console.log('final: ', JSON.stringify(scores));

    return scores;
};
