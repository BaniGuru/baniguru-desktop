import { useContext, useEffect, useRef, useState } from "react";
import { unifySearchText } from "./SpeechHelper";
import { DB } from "../../utils/DB";
import { SearchContext } from "../../state/providers/SearchProvider";
import { Pankti } from "../../models/Pankti";
import { usePanktiSearch } from "../../hooks/usePanktiSearch";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { useContext as useCtxSelector } from "use-context-selector";
import { SET_PANKTIS } from "../../state/ActionTypes";
import { AppContext } from "../../state/providers/AppProvider";
import { RecordState } from "./useSpeech";
import { getAutoNavigateMatch, searchPanktiHybrid } from "../../utils/meili";

const useSearchPilot = (finalText: string, partialText: string, status: RecordState, startTranscription: any, _restartTranscript: any) => {

    const [active, setActive] = useState<boolean>(false);
    const {searchTerm, dispatch: searchDispatch} = useContext(SearchContext);
    const {dispatch: shabadDispatch} = useCtxSelector(ShabadContext);
    const {dispatch: appDispatch} = useContext(AppContext);
    const {loading} = usePanktiSearch();
    const started = useRef<boolean>(false);

    const lastIdx = useRef<number>(0);
    const recentSearchParts = useRef<string[]>([]);
    const lastSearchedText = useRef<string>("");
    const shabadIdsRef = useRef<Set<string>>(new Set());
    const streamStartedRef = useRef(false);

    useEffect(() => {
        if (!active) {
            if (started.current || lastIdx.current > 0) {
                started.current = false;
                lastIdx.current = 0;
                recentSearchParts.current = [];
                lastSearchedText.current = "";
                shabadIdsRef.current.clear();
                streamStartedRef.current = false;
            }

            return;
        };

        if (!started.current) {
            started.current = true;
            lastIdx.current = (finalText + partialText).length;
            recentSearchParts.current = [];
            lastSearchedText.current = "";
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

        const fullText = finalText + partialText;
        const tokenText = fullText.substring(lastIdx.current);

        const hasSearchDelimiter = /[,|।]/.test(tokenText);
        const hasFinalText = partialText.length === 0 && tokenText.trim().length > 0;

        if (!hasSearchDelimiter && !hasFinalText) return;

        const parts = tokenText
            .split(/[,|।]+/)
            .map(part => part.trim())
            .filter(Boolean);

        if (!parts.length) return;

        const currentPart = hasSearchDelimiter ? parts[0] : parts[parts.length - 1];

        if (!currentPart) return;

        recentSearchParts.current = [
            ...recentSearchParts.current,
            currentPart
        ].slice(-3);

        const speechText = unifySearchText(recentSearchParts.current.join(" "));

        if (!speechText || speechText === lastSearchedText.current) return;

        lastSearchedText.current = speechText;

        const lastDelimiterIdx = Math.max(
            fullText.lastIndexOf(","),
            fullText.lastIndexOf("|"),
            fullText.lastIndexOf("।")
        );

        lastIdx.current = hasSearchDelimiter
            ? lastDelimiterIdx + 1
            : fullText.length;

        const matchResults = await searchPanktiHybrid(speechText);

        const panktis = await getByLineIds(matchResults.map(matchResult => matchResult.id));

        const fullMatchPanktis = getAutoNavigateMatch(speechText, panktis);

        if (fullMatchPanktis.length === 1) {
            const pankti = fullMatchPanktis[0];
            showMatchingPanktis([pankti.id]);
            return;
        }

        const panktiIds = matchResults.map(matchRow => matchRow.id);

        showMatchingPanktis(panktiIds);
    }

    /**
     * Navigate to full match pankti after search
     * (not used at this stage)
     */
    // const navigateToFullMatchPankti = (pankti: Pankti) => {
    //         shabadDispatch({ type: SHABAD_RESET });
    //         searchDispatch({
    //             type: SEARCH_SHABAD_PANKTI,
    //             payload: { pankti }
    //         });

    //         appDispatch({
    //             type: SET_APP_PAGE,
    //             payload: {
    //                 page: "shabad",
    //                 prev_page: "search",
    //                 show_panel: false,
    //             }
    //         });
    // }

    /**
     * Restart stream with terms from last 10 pankti shabads
     * (Not used at this stage)
     * Should do after full match check and before showing all matching panktis
     */
    // const restartWithShabads = async (panktis: Pankti[], speechText: string) => {
    //     const newShabadIds = panktis
    //         .map(pankti => pankti.shabad_id)
    //         .filter(Boolean);

    //     let addedNewShabad = false;

    //     newShabadIds.forEach(shabadId => {
    //         if (!shabadIdsRef.current.has(shabadId)) {
    //             shabadIdsRef.current.add(shabadId);
    //             addedNewShabad = true;
    //         }
    //     });

    //     if (addedNewShabad) {
    //         if (!streamStartedRef.current && speechText.split(' ').length > 3) {
    //             streamStartedRef.current = true;
    //             const shabadPanktis: Pankti[] = await getByShabadIds(
    //                 Array.from(shabadIdsRef.current)
    //             );

    //             // Count panktis per shabad
    //             const panktiCounts = shabadPanktis.reduce((acc, pankti) => {
    //                 acc[pankti.shabad_id] = (acc[pankti.shabad_id] || 0) + 1;
    //                 return acc;
    //             }, {} as Record<string, number>);

    //             // Keep only panktis from shabads with <= 20 panktis
    //             const filteredPanktis = shabadPanktis.filter(
    //                 pankti => panktiCounts[pankti.shabad_id] <= 20
    //             );

    //             const terms = filteredPanktis.map(
    //                 (pankti: Pankti) => pankti.gurmukhi_speech
    //             );
    //             restartTranscript(terms);
    //             lastIdx.current = 0;
    //         }
    //     }
    // }

    const showMatchingPanktis = async (lineIds: string[]) => {
        if (!lineIds.length) return;

        const db = await DB.getInstance();
        const orderByCase = lineIds
            .map((id, index) => `WHEN '${id}' THEN ${index}`)
            .join(' ');

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
            ORDER BY CASE panktis.id
                ${orderByCase}
            END
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

            searchDispatch({
                type: SET_PANKTIS,
                payload: panktis
            });
        }
    }

    const getByLineIds = async (lineIds: string[]) => {
        if (!lineIds.length) return [];

        const db = await DB.getInstance();
        const query = `
            SELECT
            lines.*,
            panktis.gurmukhi_speech,
            panktis.vishraam_idx,
            panktis.vishraam_ridx,
            panktis.gurmukhi_words,
            panktis.gurmukhi_rwords
            FROM lines
            INNER JOIN panktis ON lines.id = panktis.id
            INNER JOIN shabads ON lines.shabad_id = shabads.id
            WHERE lines.id IN ('${lineIds.join("','")}')
            ORDER BY shabads.source_id
        `;

        let resultPanktis: Pankti[] = [];
        try {
            const res: any = await db.select(query);

            if (res) {
                resultPanktis = res.map(
                    (pankti: any) => {
                        return {
                            ...pankti,
                            gurmukhi_words: JSON.parse(pankti.gurmukhi_words),
                            gurmukhi_rwords: JSON.parse(pankti.gurmukhi_rwords),
                        };
                    }
                );
            }
        } catch (err) {
            console.error("DB error:", err);
        }

        return resultPanktis;
    };

    // const getByShabadIds = async (shabadIds: string[]) => {
    //     if (!shabadIds.length) return [];

    //     const db = await DB.getInstance();
    //     const query = `
    //         SELECT
    //         lines.*,
    //         panktis.gurmukhi_speech,
    //         panktis.vishraam_idx,
    //         panktis.vishraam_ridx,
    //         panktis.gurmukhi_words,
    //         panktis.gurmukhi_rwords
    //         FROM lines
    //         INNER JOIN panktis ON lines.id = panktis.id
    //         INNER JOIN shabads ON lines.shabad_id = shabads.id
    //         WHERE lines.shabad_id IN ('${shabadIds.join("','")}')
    //         ORDER BY shabads.source_id, shabads.order_id, lines.order_id
    //     `;

    //     let resultPanktis: Pankti[] = [];
    //     try {
    //         const res: any = await db.select(query);

    //         if (res) {
    //             resultPanktis = res.map(
    //                 (pankti: any) => {
    //                     return {
    //                         ...pankti,
    //                         gurmukhi_words: JSON.parse(pankti.gurmukhi_words),
    //                         gurmukhi_rwords: JSON.parse(pankti.gurmukhi_rwords),
    //                     };
    //                 }
    //             );
    //         }
    //     } catch (err) {
    //         console.error("DB error:", err);
    //     }

    //     return resultPanktis;
    // };

    return {
        setActive
    };
};

export default useSearchPilot;
