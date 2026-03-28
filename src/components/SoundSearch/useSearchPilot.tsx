import { useContext, useEffect, useState } from "react";
import { findMatchTowardEnd, getPanktiScores, PanktiScore, removeMatras, unifySearchText } from "./SpeechHelper";
import { DB } from "../../utils/DB";
import { SearchContext } from "../../state/providers/SearchProvider";
import { Pankti } from "../../models/Pankti";
import { usePanktiSearch } from "../../hooks/usePanktiSearch";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { useContext as useCtxSelector } from "use-context-selector";
import { SEARCH_SHABAD_PANKTI, SET_APP_PAGE, SHABAD_RESET } from "../../state/ActionTypes";
import { AppContext } from "../../state/providers/AppProvider";
import { RecordState } from "./useSpeech";

const useSearchPilot = (finalText: string, partialText: string, status: RecordState, speechStarted: React.MutableRefObject<boolean>, startTranscription: any, restartTranscript: any) => {

    const [active, setActive] = useState<boolean>(false);
    const {panktis, setPanktis, searchTerm, dispatch: searchDispatch} = useContext(SearchContext);
    const {dispatch: shabadDispatch} = useCtxSelector(ShabadContext);
    const {dispatch: appDispatch} = useContext(AppContext);
    const [searchPanktis, setSearchPanktis] = useState<Pankti[]>([]);
    const {loading, setQuery, results} = usePanktiSearch();
    const [matchShabads, setMatchShabads] = useState<string[]>([]);
    const [lastTokens, setLastTokens] = useState<string[]>([]);

    useEffect(() => {
        if (!active) {
            if (matchShabads.length > 0 || searchPanktis.length > 0 || lastTokens.length > 0) {
                setSearchPanktis([]);
                setMatchShabads([]);
                setLastTokens([]);
            }

            return;
        };

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
        setQuery,
        lastTokens,
        setLastTokens,
        searchTerm,
        setSearchPanktis,
        searchPanktis,
        shabadDispatch,
        searchDispatch,
        appDispatch
    ]);

    useEffect(() => {
        if (results.length > 0 && results.length <= 30) {
            setTerms(results.map(result => result.id));
        }

        if (results.length == 0 || results.length > 5) return;

        getByLineIds(results.map(result => result.id));
    }, [results, setSearchPanktis]);

    const searchShabad = async () => {
        if (loading) return;

        if (searchTerm && searchTerm.length > 0) {
            return;
        }

        const tokenText = finalText + partialText;
        const speechText = unifySearchText(tokenText);

        console.log('search panktis: ', searchPanktis);
        if (searchPanktis.length > 0) {
            console.log('speech: ', speechText);
            const parts = speechText.split(',').slice(-2);

            //todo: try reverse parts

            const tokens = parts.join(' ').split(' ');

            console.log('tokens: ', tokens);
            // gurmukhi_rwords
            // vishraam_ridx
            let matchScores: PanktiScore[] = getPanktiScores(
                searchPanktis,
                tokens
            );
            let reverseScores: PanktiScore[] = getPanktiScores(
                searchPanktis,
                parts.length === 2 ? (parts[1] + ' ' + parts[0]).split(' ') : parts.join(' ').split(' '),
            )

            if (matchScores.length > 0) {
                // filter towards last match
                matchScores = findMatchTowardEnd(matchScores);
                console.log('scores: ', matchScores);
            }

            if (reverseScores.length > 0) {
                reverseScores = findMatchTowardEnd(reverseScores);
                console.log('reverse scores: ', reverseScores);
            }

            let pankti = null;
            if (matchScores.length === 1 && matchScores[0].fullMatch) {
                pankti = searchPanktis[matchScores[0].panktiIdx];
            } else if (reverseScores.length === 1 && reverseScores[0].fullMatch) {
                pankti = searchPanktis[reverseScores[0].panktiIdx];
            }

            console.log('score final pankti: ', pankti);
            if (pankti !== null) {
                console.log('shabad navigate: ', pankti);
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
            } else {
                let match = null;
                if (matchScores.length === 1 && matchScores[0].totalMatches > 1) {
                    match = matchScores[0];
                }

                if (reverseScores.length === 1 && reverseScores[0].totalMatches > 1 && reverseScores[0].totalMatches > (match?.totalMatches ?? 0)) {
                    match = reverseScores[0];
                }

                // check match
                if (match) {
                    const db = await DB.getInstance();
                    const res: any = await db.select(`
                        SELECT id
                        FROM panktis
                        WHERE gurmukhi_speech like '%${match.matches.reverse().concat(' ')}%'
                    `);
                    if (res.length === 1) {
                        console.log('shabad navigate: ', pankti);
                        shabadDispatch({ type: SHABAD_RESET });
                        searchDispatch({
                            type: SEARCH_SHABAD_PANKTI,
                            payload: { pankti: pankti }
                        });
                
                        appDispatch({
                            type: SET_APP_PAGE,
                            payload: { 
                                page: "shabad",
                                prev_page: "search",
                                show_panel: false,
                            }
                        });
                    }
                }
            }
        }

        const tokens = removeMatras(speechText).split(',');

        let newTokens = tokens.slice(-2);

        // wait for more words
        if (speechText.split(' ').length <= 3) {
            return;
        }

        // skip same search
        if (newTokens.length === 1 && lastTokens.length == 1) {
            if (newTokens[0] === lastTokens[0]) {
                return;
            }
        }

        if (newTokens.length === 2 && lastTokens.length == 2) {
            if (newTokens[0] === lastTokens[0] && newTokens[1] === lastTokens[1]) {
                return;
            }
        }

        setLastTokens(newTokens);
        setQuery(newTokens);
    }

    const setTerms = async (lineIds: string[]) => {
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
            if (matchShabads.length === 0) {
                const panktis: Pankti[] = res.map(
                    (pankti: any) => {
                        return {
                            ...pankti,
                            gurmukhi_words: JSON.parse(pankti.gurmukhi_words),
                            gurmukhi_rwords: JSON.parse(pankti.gurmukhi_rwords),
                        };
                    }
                );
                setSearchPanktis(panktis);
                const distinctShabadIds: string[] = [...new Set(panktis.map(p => p.shabad_id))];
                setMatchShabads(distinctShabadIds);
                const terms = res.map((pankti: any) => pankti.gurmukhi_speech);
                console.log(terms);
                speechStarted.current = false;
                restartTranscript(terms);
            } else {
                console.log('existing match shabad');
            }
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

        try {
            const res: any = await db.select(query);

            if (res) {
                setPanktis(res as Pankti[]);
            }
        } catch (err) {
            console.error("DB error:", err);
        }
    };

    return {
        setActive
    };
};

export default useSearchPilot;
