import { Token } from "@soniox/speech-to-text-web";
import { Pankti } from "../models/Pankti";
import { get } from "fast-levenshtein";

const RAHAOH_PANKTI_TYPE_ID = 3;
const SHABAD_PANKTI_TYPE_ID = 4;

export type PanktiScore = {
    gurmukhiWords: string[];
    matches: number;
    pankti: string;
    panktiIndex: number;
    panktiTypeId?: number;
    score: number;
    start: boolean;
    startFull: boolean;
    startPartial: boolean;
    vishraam: boolean;
    vishraamFull: boolean;
    vishraamPartial: boolean;
    continueMatch: boolean;
    fullMatch: boolean;
    partialMatch: boolean;

    firstMatchIdx: number;
    lastMatchIdx: number;
    matchingWords: string[],
    started: boolean,
    finished: boolean,
};

export const cleanTokens = (tokens: Token[]) => {
    let text = '';
    tokens.forEach((token) => {
        text += token.text;
    });

    text = text.replaceAll('<end>', '');
    text = text.replaceAll('  ', ' ');
    text = text.replaceAll(',', '');
    text = text.replaceAll('।', '');

    if (text.trim() == "") {
        return [];
    }

    return text.trim().split(" ");
};

const filterStartingAfterFinished = (panktiScores: PanktiScore[]): PanktiScore[] => {
    if (!panktiScores.length) return [];

    // Sort by lastMatchIdx in descending order
    const sorted = [...panktiScores].sort((a, b) => b.lastMatchIdx - a.lastMatchIdx);

    // Find the latest pankti that has both started and finished
    const latestPankti = sorted.find(p => (p.started && p.finished) || p.fullMatch);

    if (!latestPankti) return panktiScores; // If no pankti has both started and finished, return empty array

    const latestEnd = latestPankti.lastMatchIdx;

    // Filter to keep only those pankti that started after the latest finished pankti
    return sorted.filter(p => p.firstMatchIdx > latestEnd);
};

// check panktis fall toward the end
const filterLatestPanktis = (panktiScores: PanktiScore[]): PanktiScore[] => {
    if (!panktiScores.length) return [];

    // Sort by firstMatchIdx for easier range handling
    const sorted = [...panktiScores].sort((a, b) =>  b.lastMatchIdx - a.lastMatchIdx);

    // Get the latest pankti based on lastMatchIdx
    const latestPankti = sorted[0];
    const latestStart = latestPankti.firstMatchIdx;
    const latestEnd = latestPankti.lastMatchIdx;

    // Filter: include if overlaps with the latest pankti (based on first and last match indexes)
    const latestScores = sorted.filter(p => {
        const pStart = p.firstMatchIdx;
        const pEnd = p.lastMatchIdx;

        return (pStart <= latestEnd && pEnd >= latestStart)
    });

    // select top matches
    const maxMatches = Math.max(...latestScores.map(p => p.matches));

    return panktiScores.filter(p => p.matches === maxMatches);
};

export function matraClean(word: string) {
    if (gurmukhiOrdinal[word]) {
        return gurmukhiOrdinal[word]
    };

    if (word === 'ੴ') {
        return 'ਇਕਓਨਕਾਰ';
    }

    if (word === 'ਮਃ') {
        return 'ਮਹਲਾ';
    }

  const newword = word
    // .normalize("NFC")
    .replace(/[\u0A3E-\u0A4C\u0A70\u0A71]+$/g, '');
    if (newword.length > 2) {
        return newword;
    }

    return word;
}

const gurmukhiOrdinal: Record<string, string> = {
  '੧': 'ਪਹਿਲਾ',
  '੨': 'ਦੂਜਾ',
  '੩': 'ਤੀਜਾ',
  '੪': 'ਚੌਥਾ',
  '੫': 'ਪੰਜਵਾ',
  '੬': 'ਛੇਵਾ',
  '੭': 'ਸੱਤਵਾ',
  '੮': 'ਅੱਠਵਾ',
  '੯': 'ਨੌਵਾ',
  '੧੦': 'ਦਸਵੀ'
};

function convertMahala(text: string) {
    return text.replace(/੧੦|[੧੨੩੪੫੬੭੮੯]/g, (digit) => {
        return gurmukhiOrdinal[digit] || digit;
    }).replaceAll('ਮਃ', 'ਮਹਲਾ');
//   return text.replace(/ਮਹਲਾ\s([੧੨੩੪੫੬੭੮੯੧੦])/g, (match, digit) => {
//     const ordinal = gurmukhiOrdinal[digit];
//     return ordinal ? `ਮਹਲਾ ${ordinal}` : match;
//   });
}

export const cleanGurmukhiUnicode = (gurmukhi: string, vishraamReplace = true) => {
    gurmukhi = gurmukhi.normalize("NFC");
    gurmukhi = gurmukhi.replaceAll('ੴ', 'ਇਕਓਨਕਾਰ');
    gurmukhi = gurmukhi.replaceAll('ਰਹਾੳੁ', '');
    gurmukhi = gurmukhi.replaceAll('ਅਾ', 'ਆ').replaceAll('ੲੇ', 'ਏ').replaceAll('ੳੁ', 'ਉ').replaceAll('ੲੀ', 'ਈ');
    gurmukhi = convertMahala(gurmukhi);
    gurmukhi = gurmukhi.replaceAll("॥", '');

    if (vishraamReplace) {
        gurmukhi = gurmukhi.replaceAll(',', '')
    }
    
    gurmukhi = gurmukhi.trim();

    console.log(gurmukhi);

    return gurmukhi;
};


function wordsEqual(a: string, b: string): boolean {
    // const normalizedA = a.normalize("NFC");
    // const normalizedB = b.normalize("NFC");

    a = matraClean(a.normalize("NFC"));
    b = matraClean(b.normalize("NFC"));
    return a === b;
}

function wordsInclude(source: string[], target: string) {
    // const normalizedTarget = target.normalize("NFC");

    return source.some(item => {
        return matraClean(item.normalize("NFC")) === matraClean(target.normalize("NFC"));
    });
}

const createDefaultScoreData = (): PanktiScore => ({
    pankti: '',
    gurmukhiWords: [],
    panktiIndex: -1,
    matches: 0,
    continueMatch: false,
    start: false,
    startPartial: false,
    startFull: false,
    vishraam: false,
    vishraamPartial: false,
    vishraamFull: false,
    fullMatch: false,
    partialMatch: false,
    score: -1,

    firstMatchIdx: -1,
    lastMatchIdx: -1,
    matchingWords: [],
    started: false,
    finished: false,
});


export const getPanktiScores = (tokens: string[], panktis: Pankti[], currentPanktiIndex: number = 0): PanktiScore[] => {
    console.log('score check tokens: ', JSON.stringify(tokens));
    let panktiScores: PanktiScore[] = [];

    for (let panktiIndex = 0; panktiIndex < panktis.length; panktiIndex++) {
        const relativePanktiIndex = panktiIndex;
        const pankti = panktis[panktiIndex];
        let prevWordIndex = -1;
        const scoreData = createDefaultScoreData();

        let totalStartMatches = 0;
        let totalVishraamMatches = 0;
        for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
            const token = tokens[tokenIndex];
            const wordIndex = pankti.gurmukhi_words.findIndex(
                gurmukhiWord => wordsEqual(token, gurmukhiWord)
            );
            if (wordIndex !== -1) {
                scoreData.matches++;
                scoreData.matchingWords.push(token);

                // set match indexes
                if (scoreData.firstMatchIdx === -1) {
                    scoreData.firstMatchIdx = tokenIndex;
                    scoreData.lastMatchIdx = tokenIndex;
                } else {
                    scoreData.lastMatchIdx = tokenIndex;
                }

                // continue and parital match flags
                if (prevWordIndex === -1 || wordIndex === (prevWordIndex - 1)) {
                    scoreData.continueMatch = true;
                } else if (prevWordIndex - wordIndex <= 2) {
                    scoreData.continueMatch = false;
                    scoreData.partialMatch = true;
                } else {
                    scoreData.continueMatch = false;
                }

                // start and vishraam flags
                if (wordIndex === 0) {
                    scoreData.start = true;
                } else if (wordIndex === pankti.vishraam_idx) {
                    scoreData.vishraam = true;
                }

                if (wordIndex < pankti.vishraam_idx) {
                    totalStartMatches++;
                } else {
                    totalVishraamMatches++;
                }

                prevWordIndex = wordIndex;
            }
        }

        // update flags (started, finished, fullmatch)
        if (wordsInclude(scoreData.matchingWords, pankti.gurmukhi_words[0])) {
            scoreData.started = true;
        }

        if (wordsInclude(scoreData.matchingWords, pankti.gurmukhi_words[pankti.gurmukhi_words.length - 1])) {
            scoreData.finished = true;
        }

        if (pankti.gurmukhi_words.length === scoreData.matches) {
            scoreData.fullMatch = true;
        }

        if (totalStartMatches === pankti.vishraam_idx) {
            scoreData.startFull = true;
        } else {
            scoreData.startFull = false;

            if (totalStartMatches > 0) {
                scoreData.startPartial = true;
            }
        }

        // satgr hoye dyal, ta sharda pooriye
        if (totalVishraamMatches === (pankti.gurmukhi_words.length - pankti.vishraam_idx)) {
            scoreData.vishraamFull = true;
        } else {
            scoreData.vishraamFull = false;

            if (totalVishraamMatches > 0) {
                scoreData.vishraamPartial = true;
            }
        }


        let score = scoreData.matches;
        if (scoreData.matches === 0) {
            continue;
        }

        if (scoreData.start) {
            score += 1;
        }

        // maybe else if here (todo: check)
        if (scoreData.vishraam) {
            score += 1;
        }

        if (scoreData.fullMatch) {
            score += 1;
        }

        if (scoreData.continueMatch) {
            score += 1;
        } else if (scoreData.partialMatch) {
            score += 0.5;
        }

        scoreData.pankti = pankti.gurmukhi_unicode;
        scoreData.panktiTypeId = pankti.type_id;
        scoreData.gurmukhiWords = pankti.gurmukhi_words;
        scoreData.panktiIndex = relativePanktiIndex;
        scoreData.score = score;
        panktiScores.push(scoreData);

        console.log("pankti: " + pankti.gurmukhi_unicode + ", score: 0, data: " + JSON.stringify(scoreData));
    }

    const nextPanktis = [currentPanktiIndex+1];
    if (panktis[currentPanktiIndex+1].type_id !== RAHAOH_PANKTI_TYPE_ID &&
        panktis[currentPanktiIndex+1].type_id !== SHABAD_PANKTI_TYPE_ID
    ) {
        nextPanktis.push(currentPanktiIndex+2);
    }

    if (panktiScores.length > 1) {
        panktiScores = panktiScores.filter((latestPanktiScore: PanktiScore) => {
            return latestPanktiScore.fullMatch
                || (
                    (
                        // next pankti
                        (
                            latestPanktiScore.startFull ||
                            latestPanktiScore.vishraamFull
                        )
                        && latestPanktiScore.matches > 0
                    )
                    || ( // current pankti not finished
                        !latestPanktiScore.finished &&
                        latestPanktiScore.panktiIndex === currentPanktiIndex
                    )
                    || (
                        (latestPanktiScore.started || latestPanktiScore.matches > 0) &&
                        nextPanktis.includes(latestPanktiScore.panktiIndex)
                    )
                );
        });
    }

    console.log('before latest[current:', currentPanktiIndex ,']: ', JSON.stringify(panktiScores));
    let latestPanktiScores = filterLatestPanktis(panktiScores);
    console.log('scores: ', JSON.stringify(latestPanktiScores));

    if (latestPanktiScores.length > 1) {
        latestPanktiScores = filterStartingAfterFinished(latestPanktiScores);
    }

    return latestPanktiScores;
};