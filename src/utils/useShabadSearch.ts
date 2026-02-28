import { Token } from "@soniox/speech-to-text-web";
import { useContext, useRef, useState } from "react";
import { DB } from "./DB";
import { findMatches } from "./matchFinder";
import { formatPanktis } from "./shabadUtil";
// import { Pankti } from "../models/Pankti";
import { AppContext } from "../state/providers/AppProvider";
import { SearchContext } from "../state/providers/SearchProvider";
import { SEARCH_SHABAD_PANKTI, SET_APP_PAGE } from "../state/ActionTypes";
import useMeilisearch from "./useMeilisearch";

export const useShabadSearch = (dbPath: string) => {
    const searchingRef = useRef(false);
    const appContext = useContext(AppContext);
    const searchContext = useContext(SearchContext);
    const [termUpdated, setTermUpdated] = useState(false);
    // const [setLastCheckIndex] = useState(0);

    const { isLoading, results, searchPankti } = useMeilisearch('panktis');

//     navigator.mediaDevices.enumerateDevices()
//   .then(devices => {
//     const microphones = devices.filter(device => device.kind === 'audioinput');
//     console.log(microphones);  // Log all available microphones
//   })
//   .catch(error => console.error('Error fetching media devices:', error));

    const removeDuplicateLinesByComma = (data: string) => {
        // Split the speech data by <end> and trim any spaces
        const lines = data.replaceAll('<end>', '').split('।').map(line => line.trim()).filter(line => line.length > 0);

        // To track unique segments while maintaining order
        const seen = new Set<string>();  // Set to track seen segments
        const uniqueLines: string[] = []; // Array to store unique lines in order

        lines.forEach(line => {
            // Split each line by commas
            const segments = line.split(',').map(segment => segment.trim());

            // Remove duplicates in the segments
            const uniqueSegments:string[] = [];
            segments.forEach(segment => {
            if (!seen.has(segment) && segment.trim().length > 0) {
                seen.add(segment);  // Mark this segment as seen
                uniqueSegments.push(segment);  // Add the unique segment
            }
            });

            // Join the unique segments back together with commas
            uniqueLines.push(uniqueSegments.filter(segment => segment.trim().length > 0).join(' '));
        });

        return uniqueLines;
    };

    // searchingRef.current = false;
    const search = async (rawTokens: Token[], tokens: string[]) => {
        if (searchingRef.current) return;

        if (isLoading) {
            console.log('search is not ready yet')
            return;
        };

        searchingRef.current = true;

        const speechText = rawTokens.map(token => token.text).join('');

        console.log('searching raw...');
        console.log(speechText);

        const speechPanktis = removeDuplicateLinesByComma(speechText);
        console.log('formated: ', speechPanktis);

        // wait for pankti finish
        if (speechText.indexOf('।') < 0) {
            searchingRef.current = false;
            return;
        }

        // const lines = 'ਗੁਰ ਕੀ ਟਹਲ, ਗੁਰੂ ਕੀ ਸੇਵਾ, ਗੁਰ ਕੀ ਆਗਿਆ ਪਾਣੀ।<end>'
        // ਗੁਰ ਕੀ ਆਗਿਆ ਭਾਣੀ।<end> [after refine]

        if (isLoading) {
            searchingRef.current = false;
            return;
        }

        if (!termUpdated) {
            searchPankti(speechPanktis.join(' '));

            if (results.length > 0 && results.length < 50) {
                let panktiTokens: string[] = [];
                results.forEach((pankti: any) => {
                    panktiTokens.push(pankti.gurmukhi_speech);
                });
                setTermUpdated(true);
                console.log('terms: ', panktiTokens);
                appContext.setTerms(panktiTokens);
            }

            // setLastCheckIndex(speechText.length);
            searchingRef.current = false;
            return;
        }

        // const panktis = getMainShabadLines(removeDuplicateLinesByComma(lines));
        // console.log('panktis: ', panktis);

        if (!termUpdated) {
            searchingRef.current = false;
            return;
        }

        // get using last check index
        // const shabadSpeechText = speechText.slice(lastCheckIndex).split(',').map(s => s.trim()); // split into array and remove extra spaces
        console.log('shabadSpeechText: ', speechPanktis);

        const result = await searchShabadWithLogic(speechPanktis);
        console.log('matching panktis: ', result);

        let matchingScores = findMatches(tokens, tokens, result, 0);
        console.log('search match scores: ', matchingScores);
        if (matchingScores.length == 1 && (matchingScores[0].vishraamFull || matchingScores[0].startFull) && matchingScores[0].continueMatch && matchingScores[0].totalMatches > 1) {
            const panktiIdx = matchingScores[0].panktiIdx;

            const pankti = result[panktiIdx];
            searchContext.dispatch({
                type: SEARCH_SHABAD_PANKTI,
                payload: { pankti }
            });

            appContext.dispatch({
                type: SET_APP_PAGE,
                payload: { page: "shabad" }
            });
        }

        // // set tokens from panktis
        // let panktiTokens: string[] = [];
        // result.forEach((pankti: Pankti) => {
        //     panktiTokens.push(cleanGurmukhiUnicode(pankti.gurmukhi_unicode));
        // });

        // // only once
        // if (!termUpdated) {
        //     console.log('pankti tokens: ');
        //     console.log(panktiTokens);
        //     setTermUpdated(true);
        //     // appContext.setTerms(panktiTokens);
        // }

        // const score = findBestScore(reverseTokens, reverseWords, reverse_vishraam_idx, isPartial);

        searchingRef.current = false;
    }

    // function gurmukhiWithoutMatra(text: string) {
    //     // Allowed Gurmukhi letters + space
    //     const allowedLetters = new Set([
    //         "ੳ", "ੲ", "ਅ", "ਉ", "ਏ", "ਐ", "ਓ", // base vowels
    //         "ਸ", "ਹ",
    //         "ਕ", "ਖ", "ਗ", "ਘ", "ਞ",
    //         "ਚ", "ਛ", "ਜ", "ਝ", "ਙ",
    //         "ਤ", "ਥ", "ਦ", "ਧ", "ਨ",
    //         "ਟ", "ਠ", "ਡ", "ਢ", "ਣ",
    //         "ਪ", "ਫ", "ਬ", "ਭ", "ਮ",
    //         "ਯ", "ਰ", "ਲ", "ਵ", "ੜ",
    //         "ਖ਼", "ਲ਼", "ਸ਼", "ਫ਼", "ਗ਼", "ਜ਼",
    //         " " // allow spaces
    //     ]);

    //     // Map vowels with matras to their base letters
    //     const matraToBase = {
    //         "ਆ": "ਅ",
    //         "ਇ": "ੲ",
    //         "ਈ": "ੲ",
    //         "ਉ": "ੳ",
    //         "ਊ": "ੳ",
    //         "ਏ": "ੲ",
    //         "ਐ": "ਅ",
    //         "ਓ": "ਓ",
    //         "ਔ": "ਅ"
    //     };

    //     // Remove 'ਰਹਾਉ'
    //     text = text.replace(/ਰਹਾਉ/g, "");

    //     // Remove peri reph ("੍ਰ")
    //     text = text.replace(/੍ਰ/g, "");

    //     // Replace matras with base letters
    //     for (const [matra, base] of Object.entries(matraToBase)) {
    //         const regex = new RegExp(matra, "g");
    //         text = text.replace(regex, base);
    //     }

    //     // Keep only allowed letters + spaces
    //     let cleaned = "";
    //     for (const char of text) {
    //         if (allowedLetters.has(char)) {
    //         cleaned += char;
    //         }
    //     }

    //     // Normalize spaces (trim and replace multiple spaces with single)
    //     cleaned = cleaned.split(/\s+/).join(" ").trim();

    //     return cleaned;
    // }

    // function removeGurmukhiVowelsAndMarks(text: string): string {
    //     // remove nukta, halant, matras, Sihaari, Tippi, Bindi
    //     return text.replace(/[\u0A3C\u0A3E-\u0A4C\u0A3F\u0A41-\u0A42\u0A4D\u0A70\u0A02]/g, '');
    // }

    function buildSql(speechPanktis: string[]): string {
        const escapeSql = (s: string) => s.replace(/'/g, "''");

        const conditions = speechPanktis
            .map(part => {
                return `(${escapeSql(part.split(' ').join('* + '))}*)`;
            });

        return conditions.join(' OR ');
    }

    async function searchShabadWithLogic(speechPanktis: string[]) {
        const sqlCondition = buildSql(speechPanktis);

        if (!sqlCondition) return [];

        DB.setDbPath(dbPath);
        const db = await DB.getInstance();
        console.log(db.path);

        const sql = `
            SELECT * FROM pankti_search
            inner join lines on pankti_search.id = lines.id
            WHERE pankti_search.gurmukhi_speech MATCH '${sqlCondition}'
        `;

        console.log(sql);
        const res: any[] = await db.select(sql);
        // console.log(res);
        // return [];

        if (res.length < 0 || res.length > 20) {
            return [];
        }

        // const panktis: Pankti[] = res.map((line: any) => ({
        //     first_letter: '',
        //     gurmukhi: line.gurmukhi,
        //     gurmukhi_unicode: line.gurmukhi_unicode,
        //     id: line.id,
        //     order_id: line.order_id,
        //     pronuciation: '',
        //     shabad_id: line.shabad_id,
        //     source_line: line.source_line,
        //     source_page: line.source_page,
        //     type_id: line.type_id,
        //     vishraam_first_letters: line.vishraam_first_letters,
        //     visited: false,
        //     punjabi_translation: '',
        //     english_translation: '',
        //     bani_id: undefined,
        //     gurmukhi_words: [],
        //     vishraam_idx: 0,
        //     reverse_gurmukhi_words: [],
        //     reverse_vishraam_idx: 0,
        //     group: 1
        // }));

        return formatPanktis([]);
    }

    // function getSearchWords(text: string): string[] {
    //     const parts = text.replaceAll('।', '').trim().split(",").map(p => p.trim());
    //     const words: string[] = [];

    //     for (const part of parts) {
    //         if (part.trim() !== '' && !words.includes(part.trim())) {
    //             words.push(part.trim());
    //         }
    //     }

    //     return words;
    // }

    // const getMainShabadLines = (lines: string[]) => {
    //     return lines
    //     .slice(-3)
    //         .map(line => getSearchWords(line))
    //         .filter(words => words.length > 0);
    // };

    return {
        search,
    };
}