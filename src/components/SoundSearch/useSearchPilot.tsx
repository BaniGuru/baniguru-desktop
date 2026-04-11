import { useContext, useEffect, useRef, useState } from "react";
import { removeMatras, unifySearchText } from "./SpeechHelper";
import { DB } from "../../utils/DB";
import { SearchContext } from "../../state/providers/SearchProvider";
import { Pankti } from "../../models/Pankti";
import { usePanktiSearch } from "../../hooks/usePanktiSearch";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { useContext as useCtxSelector } from "use-context-selector";
import { SEARCH_SHABAD_PANKTI, SET_APP_PAGE, SHABAD_RESET } from "../../state/ActionTypes";
import { AppContext } from "../../state/providers/AppProvider";
import { RecordState } from "./useSpeech";
import { gurbaniSearch } from "../../utils/gurbaniSearch";
import { findRelativePankti, Match, MatchScore, normalisedSearchGurmukhiText, normaliseSearchGurmukhi, SearchPankti } from "./NoiseFilter";

const useSearchPilot = (finalText: string, partialText: string, status: RecordState, startTranscription: any, restartTranscript: any) => {

    const [active, setActive] = useState<boolean>(false);
    const {setPanktis, searchTerm, dispatch: searchDispatch} = useContext(SearchContext);
    const {dispatch: shabadDispatch} = useCtxSelector(ShabadContext);
    const {dispatch: appDispatch} = useContext(AppContext);
    const {loading} = usePanktiSearch();
    const started = useRef<boolean>(false);
    const lastIdx = useRef<number>(0);

    useEffect(() => {
        if (!active) {
            if (started.current || lastIdx.current > 0) {
                started.current = false;
                lastIdx.current = 0;
            }

            return;
        };

        if (!started.current) {
            started.current = true;
            lastIdx.current = (finalText + partialText).length - 1;
        }

        if (status === 'Init') {
            startTranscription([]);
        }

        searchShabad();
    }, [
        finalText,
        partialText,
        startTranscription,
        status,
        active,
        loading,
        searchTerm,
        shabadDispatch,
        searchDispatch,
        appDispatch
    ]);

    const searchShabad = async () => {
        if (searchTerm && searchTerm.length > 0) {
            return;
        }

        const tokenText = (finalText + partialText).substring(lastIdx.current);

        const speechText = unifySearchText(tokenText);

        const regex = /[^।.]+[।.]?/g;
        const tokens = speechText.match(regex);

        if (!tokens ||
            (tokens.length == 1 && tokens[0].split(' ').length <= 2)
        ) {
            return;
        }

        const searchTokens = tokens.filter(token => token.trim().endsWith(',') || token.trim().endsWith('।'))
            .map(token => token.trim().slice(0, -1));

        const result = await gurbaniSearch.search(searchTokens.map(searchToken => removeMatras(searchToken)), "search");

        const searchPanktis: SearchPankti[] = result.map(row => {
            return {
                id: row.id,
                gurmukhi_speech: row.gurmukhi_speech,
                gurmukhi_words: normalisedSearchGurmukhiText(row.gurmukhi_speech).split(' '),
            }
        });

        const gurmukhiPanktis = searchPanktis.map(searchPankti => normalisedSearchGurmukhiText(searchPankti.gurmukhi_speech));

        const relativePanktis = [];
        const exactMatches = new Map<string, { match: Match; score: MatchScore, searchToken: string, valid: boolean }>();
        const panktiIds = [];
        for (let i = 0; i < searchTokens.length; i++) {
            const searchText = normaliseSearchGurmukhi(searchTokens[i].trim());
            const {matches, score} = findRelativePankti(searchText, searchPanktis, gurmukhiPanktis, null, null);

            if (!score) continue;

            if (matches.length === 1) {
                if (!exactMatches.has(searchTokens[i].trim())) {
                    exactMatches.set(searchTokens[i].trim(), {
                        match: matches[0],
                        score,
                        searchToken: searchTokens[i].trim(),
                        valid:  matches[0].gurmukhi_words.length === score.matchLen ||
                                matches[0].gurmukhi_words.length === (score.matchLen + 1),
                    });
                }

                if (score.matchLen > 1) {
                    panktiIds.push(searchPanktis[matches[0].idx].id);
                }
                continue;
            }

            relativePanktis.push(...matches);
        }

        let lastValidMatch = null;
        for (let i = searchTokens.length-1; i >= 0; i--) {
            const searchToken = searchTokens[i].trim();
            if (exactMatches.has(searchToken) && exactMatches.get(searchToken)?.valid) {
                lastValidMatch = exactMatches.get(searchToken);
                break;
            }
        }

        if (lastValidMatch) {
            const panktiId = searchPanktis[lastValidMatch.score.idx].id;
            const panktis = await getByLineIds([panktiId]);

            if (panktis.length === 0) return;

            const pankti = panktis[0];

            shabadDispatch({ type: SHABAD_RESET });
            searchDispatch({
                type: SEARCH_SHABAD_PANKTI,
                payload: { pankti }
            });

            appDispatch({
                type: SET_APP_PAGE,
                payload: {
                    page: "shabad",
                    prev_page: "search",
                    show_panel: false,
                }
            });
            
            return;
        }

        showMatchingPanktis(panktiIds);
    }

    const showMatchingPanktis = async (lineIds: string[]) => {
        if (!lineIds.length) return;

        const db = await DB.getInstance();
        const query = `
            SELECT
                lines.*,
                panktis.gurmukhi_speech,
                gurmukhi_words,
                panktis.gurmukhi_rwords,
                panktis.vishraam_ridx
            FROM panktis
            INNER JOIN lines ON panktis.id = lines.id
            WHERE panktis.id IN ('${lineIds.join("','")}')
            ORDER BY lines.shabad_id, lines.order_id
        `;
        const res: any = await db.select(query);

        if (res) {
            const panktis: Pankti[] = res.map(
                (pankti: any) => {
                    return {
                        ...pankti,
                        gurmukhi_words: JSON.parse(pankti.gurmukhi_words),
                        gurmukhi_rwords: JSON.parse(pankti.gurmukhi_rwords),
                    };
                }
            );

            setPanktis(panktis);
            // const distinctShabadIds: string[] = [...new Set(panktis.map(p => p.shabad_id))];
            // setMatchShabads(distinctShabadIds);
            // const terms = res.map((pankti: any) => pankti.gurmukhi_speech);
            // restartTranscript(terms);
        }
    }

    const getByLineIds = async (lineIds: string[]) => {
        if (!lineIds.length) return;

        const db = await DB.getInstance();
        const query = `
            SELECT
            lines.*, panktis.gurmukhi_speech
            FROM lines
            INNER JOIN panktis ON lines.id = panktis.id
            INNER JOIN shabads ON lines.shabad_id = shabads.id
            WHERE lines.id IN ('${lineIds.join("','")}')
            ORDER BY shabads.source_id
        `;

        let resultPanktis = [];
        try {
            const res: any = await db.select(query);

            if (res) {
                resultPanktis = res;
            }
        } catch (err) {
            console.error("DB error:", err);
        }

        return resultPanktis;
    };

    return {
        setActive
    };
};

export default useSearchPilot;
