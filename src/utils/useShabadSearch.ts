import { Token } from "@soniox/speech-to-text-web";
import { useContext, useRef, useState } from "react";
import { DB } from "./DB";
import { findBestScore, findMatches } from "./matchFinder";
import { cleanGurmukhiUnicode, formatPanktis } from "./shabadUtil";
import { Pankti } from "../models/Pankti";
import { AppContext } from "../state/providers/AppProvider";
import { SearchContext } from "../state/providers/SearchProvider";
import { SEARCH_SHABAD_PANKTI, SET_APP_PAGE } from "../state/ActionTypes";
import { path } from "@tauri-apps/api";

export const useShabadSearch = (rawTokens: Token[], tokens: string[], dbPath: string) => {
    const searchingRef = useRef(false);
    const appContext = useContext(AppContext);
    const searchContext = useContext(SearchContext);
    const [termUpdated, setTermUpdated] = useState(false);

    const search = async () => {
        if (searchingRef.current) return;

        searchingRef.current = true;

        console.log('searching...');
        console.log(rawTokens.map(token => token.text).join(''));

        const lines = rawTokens.map(token => token.text).join('').split('<end>');
        // const lines = ['ਪ੍ਰੀਤ ਹਮਾਰੀ ਲਾਗੀ'];

        // wait for some words
        if (lines.length == 1 && lines[0].split(',|').length < 1) {
            searchingRef.current = false;
            return;
        }

        const panktis = getMainShabadLines(lines);
        console.log('panktis: ', panktis);

        const result = await searchShabadWithLogic(panktis);
        
        if (result.length < 1) {
            searchingRef.current = false;
            return;
        }

        let matchingScores = findMatches(tokens, tokens, result, 0);
        console.log('search match scores: ', matchingScores);
        if (matchingScores.length == 1 && (matchingScores[0].panktiStarted || matchingScores[0].vishraamStarted) && matchingScores[0].continueMatch && matchingScores[0].totalMatches > 1) {
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

        // set tokens from panktis
        let panktiTokens: string[] = [];
        result.forEach((pankti: Pankti) => {
            panktiTokens.push(cleanGurmukhiUnicode(pankti.gurmukhi_unicode));
        });

        // only once
        if (!termUpdated) {
            setTermUpdated(true);
            appContext.setTerms(panktiTokens);
        }

        // const score = findBestScore(reverseTokens, reverseWords, reverse_vishraam_idx, isPartial);

        searchingRef.current = false;
    }

    function removeGurmukhiVowelsAndMarks(text: string): string {
        // remove nukta, halant, matras, Sihaari, Tippi, Bindi
        return text.replace(/[\u0A3C\u0A3E-\u0A4C\u0A3F\u0A41-\u0A42\u0A4D\u0A70\u0A02]/g, '');
    }

    function buildSql(nestedPhrases: string[][], column = 'linesfts.gurmukhi_unicode'): string {
        const escapeSql = (s: string) => s.replace(/'/g, "''");

        const conditions = nestedPhrases
            .flatMap(phraseArr => 
                phraseArr
                    .map(part => part.trim())
                    .filter(part => part.length > 0)
            )
            .map(part => {
                return `(${escapeSql(removeGurmukhiVowelsAndMarks(part).trim().split(' ').join('* + '))}*)`;
            });

        return conditions.join(' OR ');
    }

    async function searchShabadWithLogic(nestedPhrases: string[][]) {
        const sqlCondition = buildSql(nestedPhrases);

        if (!sqlCondition) return [];

        DB.setDbPath(dbPath);
        const db = await DB.getInstance();
        console.log(db.path);

        const sql = `
            SELECT * FROM gurmukhifts
            inner join lines on gurmukhifts.id = lines.id
            WHERE gurmukhifts.gurmukhi_no_vowel MATCH '${sqlCondition}'
        `;

        console.log(sql);
        const res: any[] = await db.select(sql);
        // console.log(res);
        // return [];

        if (res.length < 0 || res.length > 20) {
            return [];
        }

        const panktis: Pankti[] = res.map((line: any) => ({
            first_letter: '',
            gurmukhi: line.gurmukhi,
            gurmukhi_unicode: line.gurmukhi_unicode,
            id: line.id,
            order_id: line.order_id,
            pronuciation: '',
            shabad_id: line.shabad_id,
            source_line: line.source_line,
            source_page: line.source_page,
            type_id: line.type_id,
            vishraam_first_letters: line.vishraam_first_letters,
            visited: false,
            punjabi_translation: '',
            english_translation: '',
            bani_id: undefined,
            gurmukhi_words: [],
            vishraam_idx: 0,
            reverse_gurmukhi_words: [],
            reverse_vishraam_idx: 0,
            group: 1
        }));

        return formatPanktis(panktis);
    }

    function getSearchWords(text: string): string[] {
        const parts = text.replaceAll('।', '').trim().split(",").map(p => p.trim());
        const words: string[] = [];

        for (const part of parts) {
            if (part.trim() !== '' && !words.includes(part.trim())) {
                words.push(part.trim());
            }
        }

        return words;
    }

    const getMainShabadLines = (lines: string[]) => {
        return lines
        .slice(-3)
            .map(line => getSearchWords(line))
            .filter(words => words.length > 0);
    };

    return {
        search,
    };
}