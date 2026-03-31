import { extract, partial_token_set_ratio } from "fuzzball";
import { Pankti } from "../../models/Pankti";
import { removeMatras } from "./SpeechHelper";
import { get } from "fast-levenshtein";
import { DB } from "../../utils/DB";
import { gurbaniSearch } from "../../utils/gurbaniSearch";

interface Match {
    gurmukhi: string;
    gurmukhi_words: string[];
    score: number;
    idx: number;
}

interface MatchScore {
    matchLen: number;
    exactMatches: number;      // exact matches score higher than fuzzy
    totalDistance: number;     // lower is better
    hasStartingMatch: boolean;
    hasEndingMatch: boolean;
    startidx: number;
    endIdx: number;
    totalWords: number;
    totalGap: number;
    idx: number;
}

function isBetterScore(a: MatchScore, b: MatchScore): boolean {
    if (a.exactMatches !== b.exactMatches) return a.exactMatches > b.exactMatches;
    if (a.matchLen !== b.matchLen) return a.matchLen > b.matchLen;
    if (a.hasStartingMatch !== b.hasStartingMatch) return a.hasStartingMatch; // prefer no partial
    if (a.totalDistance !== b.totalDistance) return a.totalDistance < b.totalDistance;
    if (a.hasEndingMatch !== b.hasEndingMatch) return a.hasEndingMatch;
    if (a.totalGap !== b.totalGap) return a.totalGap > b.totalGap;
    return false;
}

function isEqualScore(a: MatchScore, b: MatchScore): boolean {
    return (
        a.matchLen === b.matchLen &&
        a.exactMatches === b.exactMatches &&
        a.totalDistance === b.totalDistance &&
        (
            a.hasStartingMatch === b.hasStartingMatch &&
            a.hasEndingMatch === b.hasEndingMatch
        ) &&
        a.totalGap === b.totalGap
    );
}

const isMatch = (
    gurmukhiWord: string,
    gurmukhiWords: string[],
    fragWord: string,
    fragWords: string[],
    prevWord: string|null,
    nextFragWord: string|null,
    i: number,
    j: number,
    k: number,
    exactMatches: number,
    hasStartingMatch: boolean,
    totalDistance: number,
    matchFound: boolean,
    hasEndingMatch: boolean,
    matches: string[],
    match: any,
    splitted: number,
    typoMatch: number,
) => {
    // console.log('gurmukhi: ', gurmukhiWord, ' prev: ', prevWord, ' frag: ', fragWord);
    if (gurmukhiWord.startsWith(fragWord) &&
        gurmukhiWord !== fragWord &&
        (j+k) === (fragWords.length - 1)
    ) {
        if (nextFragWord && get(gurmukhiWord, fragWord+nextFragWord) <= 2) {
            exactMatches++;
        } else {
            hasStartingMatch = true;
        }
        matchFound = true;
    } else if (prevWord &&
        get(gurmukhiWord, prevWord +fragWord) <= 2 &&
        removeMatras(gurmukhiWord) == removeMatras(prevWord+fragWord) &&
        gurmukhiWord !== fragWord
    ) {
        hasEndingMatch = true;
        matchFound = true;
    } else if (fragWord === gurmukhiWord) {
        matches.push(match.gurmukhi_words[i+k]);
        exactMatches++;
        hasStartingMatch = false;
        matchFound = true;
    } else if (get(fragWord, gurmukhiWord) <= 1 && !hasStartingMatch) {
        totalDistance += 1;
        typoMatch = typoMatch <= 1 ? 1 : typoMatch;
        matches.push(match.gurmukhi_words[i+k]);
        matchFound = true;
    } else if (get(fragWord, gurmukhiWord) <= 2 && gurmukhiWord.length > 3 && fragWord.length > 3 && !hasStartingMatch) {
        totalDistance += 2;
        typoMatch = typoMatch <= 2 ? 2 : typoMatch;
        matches.push(match.gurmukhi_words[i+k]);
        matchFound = true;
    } else if (i+k+1 < gurmukhiWords.length &&
        // two words together in speech (only small word next)
        get(gurmukhiWord + gurmukhiWords[i+k+1], fragWord) <= 2 &&
        removeMatras(gurmukhiWord + gurmukhiWords[i+k+1]) == removeMatras(fragWord) &&
        get(gurmukhiWords[i+k+1], fragWord) > 1 // next word is not complete match
    ) {
        fragWords = [
            gurmukhiWord,
            gurmukhiWords[i+k+1],
            ...fragWords.slice(j+1),
        ];
        totalDistance += get(gurmukhiWord + gurmukhiWords[i+k+1], fragWord);
        matches.push(gurmukhiWord);
        matches.push(gurmukhiWords[i+k+1]);
        exactMatches += get(gurmukhiWord + gurmukhiWords[i+k+1], fragWord) === 0 ? 2 : 0;
        k++;
        matchFound = true;
    } else if (
        // word splitted in speech
        j+k+1 < fragWords.length &&
        get(gurmukhiWord, fragWord + fragWords[j+k+1]) <= 2 &&
        (
            i+k+1 === gurmukhiWords.length ||
            get(gurmukhiWords[i+k+1], fragWords[j+k+1]) > 2 //next word no match
        )
    ) {
        totalDistance += get(gurmukhiWord, fragWord + fragWords[j+k+1]);
        matchFound = true;
        exactMatches += get(gurmukhiWord, fragWord + fragWords[j+k+1]) == 0 ? 1 : 0;
        splitted++;
    }

    return {
        exactMatches,
        fragWords,
        hasEndingMatch,
        hasStartingMatch,
        k,
        matches,
        matchFound,
        totalDistance,
        typoMatch,
        splitted,
    };
}

const findBestPanktiMatch = (searchText: string, matches: Match[], prevWord: string|null, nextRawFragment: string|null): {matches: Match[], score: MatchScore|null, hasTie: boolean} => {
    let searchWords = searchText.split(" ");
    let nextFragWord = nextRawFragment ? nextRawFragment.split(" ")[0] : null;
    const totalWords = searchWords.length;

    let bestMatches: Match[] = [];
    let bestScore: MatchScore|null = null;
    for (const match of matches) {
        const gurmukhiWords = match.gurmukhi_words.map(word => normalizeGurmukhi(word));

        let matches: string[] = [];
        let score: MatchScore|null = null;

        // console.log('------------------------');
        outerLoop: for (let i = 0; i < gurmukhiWords.length; i++) {
            for (let j = 0; j < searchWords.length; j++) {

                let k = 0;
                let extra = 0;
                let splitted = 0;
                let gap = 0;
                let typoMatch = 0;
                let exactMatches = 0;
                let totalDistance = 0;
                let hasStartingMatch = false;
                let hasEndingMatch = false;

                let fragWords = searchWords;
                while (
                    i + k + extra < gurmukhiWords.length &&
                    j + k + splitted < fragWords.length
                ) {
                    let speechIdx = i + k + extra;
                    let matchFound = false;

                    let fragWord = fragWords[j+k];
                    const gurmukhiWord = gurmukhiWords[speechIdx];
                    // console.log(gurmukhiWord, fragWord, i+extra, j, k+extra);

                    let matchResult = isMatch(
                        gurmukhiWord,
                        gurmukhiWords,
                        fragWord,
                        fragWords,
                        prevWord,
                        nextFragWord,
                        i,
                        j,
                        k,
                        exactMatches,
                        hasStartingMatch,
                        totalDistance,
                        matchFound,
                        hasEndingMatch,
                        matches,
                        match,
                        splitted,
                        typoMatch,
                    );

                    // todo: only gap match if matching with previous (maybe if current token exists in previous match tokens)
                    while (k > 0 && (
                        !matchResult.matchFound ||
                        (matchResult.matchFound && speechIdx === gurmukhiWords.length)
                    ) && (
                        (j + matchResult.k + matchResult.splitted + gap + 1) < fragWords.length
                    )) {
                        gap++;
                        fragWord = fragWords[j+k+gap];
                        // console.log('gap match: ', gurmukhiWord, fragWord, speechIdx, j+k+gap);
                        matchResult = isMatch(
                            gurmukhiWord,
                            gurmukhiWords,
                            fragWord,
                            fragWords,
                            prevWord,
                            nextFragWord,
                            i,
                            j,
                            k,
                            exactMatches,
                            hasStartingMatch,
                            totalDistance,
                            matchFound,
                            hasEndingMatch,
                            matches,
                            match,
                            splitted,
                            typoMatch,
                        );
                    }

                    ({
                        exactMatches,
                        fragWords,
                        hasEndingMatch,
                        hasStartingMatch,
                        k,
                        matches,
                        matchFound,
                        totalDistance,
                        typoMatch,
                        splitted,
                    } = matchResult);

                    if (matchFound) {
                        k++;

                        // all speech words matched
                        // ਗੁਰੂ ਕੇ ਸਬ ਦਿ
                        // console.log('match found: k', k, ' splitted: ', splitted, fragWords.length);
                        if (k+splitted+gap == fragWords.length) {
                            score = {
                                matchLen: (k+extra),
                                exactMatches,
                                totalDistance,
                                hasStartingMatch,
                                startidx: i,
                                endIdx: i + k + extra-1,
                                totalWords,
                                hasEndingMatch,
                                totalGap: gap,
                                idx: match.idx,
                            };
                            // console.log('k: ', k, ' splitted: ', splitted, ' gap: ', gap);
                            // console.log('all match score: ', score);
                            break outerLoop;
                        }

                        continue;
                    }

                    break;
                }

                if (k > 0) {
                    score = {
                        matchLen: (k+extra),
                        exactMatches,
                        totalDistance,
                        hasStartingMatch,
                        startidx: i,
                        endIdx: i+k+extra-1,
                        totalWords,
                        hasEndingMatch,
                        totalGap: gap,
                        idx: match.idx,
                    };
                }
            }

            if (score) {
                // console.log('score here: ', score);
                if (!bestScore) {
                    bestScore = score;
                    bestMatches = [match];
                } else if (isBetterScore(score, bestScore)) {
                    bestScore = score;
                    bestMatches = [match];
                } else if (isEqualScore(score, bestScore)) {
                    if (!bestMatches.some(m => m.idx === match.idx)) {
                        bestMatches.push(match);
                    }
                }
            }
        }

        if (score) {
            // console.log('new score: ', score);
            if (!bestScore) {
                bestScore = score;
                bestMatches = [match];
            } else if (isBetterScore(score, bestScore)) {
                bestScore = score;
                bestMatches = [match];
            } else if (isEqualScore(score, bestScore)) {
                if (!bestMatches.some(m => m.idx === match.idx)) {
                    bestMatches.push(match);
                }
            }
        }

        if (score === null) continue;
    }

    // console.log('best: ', bestMatches);
    return {
        matches: bestMatches,
        score: bestScore,
        hasTie: bestMatches.length > 1
    };
}

type SearchPankti = {
    gurmukhi_words: string[],
    gurmukhi_speech: string,
}

const findRelativePankti = (searchText: string, panktis: SearchPankti[], gurmukhiPanktis: string[], prevWord: string | null, nextRawFragment: string|null = null) => {
    const matches: Match[] = extract(searchText, gurmukhiPanktis, {
        scorer: partial_token_set_ratio,
        cutoff: 60,
    }).map(([gurmukhi, score, idx]) => ({
        gurmukhi,
        gurmukhi_words: panktis[idx].gurmukhi_words,
        score,
        idx,
    }));

    const highestScore = Math.max(...matches.map(match => match.score));
    const topMatches = matches.filter(match => match.score === highestScore);

    return findBestPanktiMatch(searchText, topMatches, prevWord, nextRawFragment);
}

const getPanktiWithVishraams = (match: Match, score: MatchScore, panktis: Pankti[]) => {
    const pankti = panktis[match.idx];
    const vishraamIdx = pankti.vishraam_idx ? pankti.vishraam_idx - 1 : pankti.vishraam_idx;

    const start = score.startidx;
    const end = score.endIdx;

    let words = match.gurmukhi_words.slice(start, end+1);

    // Only handle comma if vishraam exists
    if (vishraamIdx !== null) {
        if (vishraamIdx !== null && vishraamIdx >= start && vishraamIdx <= end) {
            // attach to vishraam word
            const insertPos = vishraamIdx - start;
            words[insertPos] = words[insertPos] + ",";
        }
    }

    let text = words.join(" ");

    // Add danda if slice ends at full pankti
    if (end + 1 === pankti.gurmukhi_words.length) {
        text += "। ";
    } else {
        text += " ";
    }

    return text;
};

type Range = {
    startidx: number;
    endIdx: number;
};

const addAndMergeScore = (ranges: Range[], newScore: Range): Range[] => {
    // 🔹 1. Ignore if fully inside any existing range
    for (const r of ranges) {
        if (
            newScore.startidx >= r.startidx &&
            newScore.endIdx <= r.endIdx
        ) {
            return ranges;
        }
    }

    // 🔹 2. Add new range
    const all = [...ranges, newScore];

    // 🔹 3. Sort
    all.sort((a, b) => a.startidx - b.startidx);

    const merged: Range[] = [];

    for (const curr of all) {
        if (!merged.length) {
            merged.push({ ...curr });
            continue;
        }

        const last = merged[merged.length - 1];

        if (curr.startidx <= last.endIdx + 1) {
            last.endIdx = Math.max(last.endIdx, curr.endIdx);
        } else {
            merged.push({ ...curr });
        }
    }

    return merged;
}

type PanktiSearchRow = {
  id: string;
  gurmukhi_no_matra: string;
};

export const searchText = async (searchText: string) => {
    if (searchText.trim().split(" ").length <= 2) {
        return;
    }

    return;

    const rows = await gurbaniSearch.search([searchText]);

    const panktis: SearchPankti[] = rows.map(row => {
        return {
            id: row.id,
            gurmukhi_words: row.gurmukhi_speech.split(" ").map(word => normalizeGurmukhi(word)),
            gurmukhi_speech: row.gurmukhi_speech,
        }
    });

    const gurmukhiPanktis = panktis.map(pankti => pankti.gurmukhi_words.join(" "));

    const {match, score} = findRelativePankti(searchText, panktis, gurmukhiPanktis)

    console.log('searchText: ', searchText);
    console.log('Matched rows:', rows);
    console.log('match: ', match);
    console.log('score: ', score);
};

export type ProcessResult = {
    speechText: string,
    lastText: string,
}

const defaultMatchData = (): {match: Match|null, score: MatchScore|null} => {
    return {
        match: null,
        score: null,
    }
}

export function postProcessText(
    speechText: string,
    panktis: Pankti[]
): ProcessResult {
    if (speechText.trim() === "") {
        return {speechText: speechText, lastText: speechText};
    };

    const regex = /[^।,.]+[।,.]?/g;

    const rawFragments = speechText.match(regex)?.map(fragment => {
        const lastChar = fragment.slice(-1);
        if (lastChar === '।' || lastChar === ',' || lastChar === '.') {
            return { text: fragment.slice(0, -1), delimiter: lastChar };
        } else {
            return { text: fragment, delimiter: "" };
        }
    }) ?? [];

    const gurmukhiPanktis = panktis.map(pankti => pankti.gurmukhi_words.map(
        gurmukhi_word => normalizeGurmukhi(gurmukhi_word)
    ).join(" "));

    let data = defaultMatchData();

    let processedText = "";
    let prevText = "";
    let scoreRanges: Range[] = [];
    let prevRawFragment = "";
    let lastSpeechText = "";

    for (let i = 0; i < rawFragments.length; i++) {
        let rawFrag = rawFragments[i].text;
        let normFragment = normalisedGurmukhiText(
            rawFrag.replaceAll('ਂ', '').trim()
        );
        let nextRawFragment = i+1 < rawFragments.length ? normalisedGurmukhiText(rawFragments[i+1].text) : null;

        if (normFragment.trim() === '') {
            continue;
        };

        const prevWord = rawFragments[i - 1]?.text.split(' ').pop() ?? null;
        const prevNormWord = prevWord ? normalizeGurmukhi(prevWord) : null;

        // console.log('----------------------');
        // console.log('norm frag: ', normFragment);
        const {matches, score} = findRelativePankti(normFragment, panktis, gurmukhiPanktis, prevNormWord, nextRawFragment);

        // console.log('match: ', match);
        // console.log('score: ', score);

        if (matches.length === 0 || (score && score.totalWords != (score.matchLen + score.totalGap))) {
            if (prevRawFragment.includes(normFragment)) {
                lastSpeechText += rawFrag + rawFragments[i].delimiter;
                continue;
            }

            searchText(normFragment);
            processedText += rawFrag + " <no_match>। ";
            prevText = "";
            prevRawFragment = normFragment;
            data = defaultMatchData();
            lastSpeechText = rawFrag + rawFragments[i].delimiter;
            continue;
        }

        if (matches.length > 1) {
            prevRawFragment = "";
            prevText = "";
            data = defaultMatchData();
            lastSpeechText = rawFrag + rawFragments[i].delimiter;
            continue;
        }

        const match = matches[0];
        prevRawFragment = "";
        if (data.match && match.idx === data.match.idx && score) {
            scoreRanges = addAndMergeScore(scoreRanges, score);

            if (prevText.length > 0) {
                processedText = processedText.slice(0, -prevText.length);
            }

            prevText = scoreRanges
                .map(r =>
                    getPanktiWithVishraams(match, {
                        ...score,
                        startidx: r.startidx,
                        endIdx: r.endIdx
                    }, panktis)
                )
                .join("");
            
            processedText += prevText;
            lastSpeechText += rawFrag + rawFragments[i].delimiter;
            continue;
        }

        if (match && score) {
            data.match = match;
            data.score = score;
            scoreRanges = [score];

            prevText = getPanktiWithVishraams(match, score, panktis);
            if (processedText !== "" && processedText[processedText.length-1] !== '। ') {
                processedText += '। ';
            }
            processedText += prevText;
            lastSpeechText = rawFrag + rawFragments[i].delimiter;
        }
    }

    // console.log("processedText: ", processedText);

    return {
        speechText: processedText,
        lastText: lastSpeechText
    };
}

/**
 * Normalize Gurmukhi text for comparison:
 * - Remove virama (੍) joining characters so conjuncts don't inflate distance
 * - Normalize unicode to NFC
 */
function normalizeGurmukhi(word: string): string {
    let normalised = word
        .normalize('NFC')
        .replace(/੍/g, '');
    
    const lastTwo = normalised.slice(-2);
    const lastThree = normalised.slice(-3);

    if (lastTwo === 'ਰਉ') {
        normalised = normalised.slice(0, -2) + 'ਰੋ';
    } else if (lastThree === 'ਰਹੁ') {
        normalised = normalised.slice(0, -3) + 'ਰੋ';
    } else if (lastTwo === 'ਹਉ') {
        normalised = normalised.slice(0, -2) + 'ਹੋ';
    } 

    return normalised;
}

const normalisedGurmukhiText = (gurmukhi: string) => {
    return gurmukhi.trim().split(' ').map(word => normalizeGurmukhi(word))
        .join(' ');
}
