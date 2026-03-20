import { useContext, useEffect, useState } from "react";
import { RecorderState } from "@soniox/speech-to-text-web";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { Pankti } from "../../models/Pankti";
import { findIndexIgnoringPunctuation, findMatchingPankti, getAllowedNextPanktiIdxs, unifySpeechText } from "./SpeechHelper";
import { SET_APP_PAGE, SHABAD_PANKTI, SHABAD_PANKTI_MARK_VISITED, SHABAD_PANKTI_NO_VISITED } from "../../state/ActionTypes";
import { SearchContext } from "../../state/providers/SearchProvider";
import { AppContext, PAGE_ANNOUNCEMENT, PAGE_SEARCH } from "../../state/providers/AppProvider";
import * as Sentry from "@sentry/react";
import { useContext as useCtxSelector } from "use-context-selector";

function isSimran(tokenText: string) {
    const tokens = tokenText.trim().split(/[\s,]+/);

    let count = 0;

    for (let i = tokens.length - 2; i >= 0; i--) {
        const word = tokens[i];

        if (word === "ਵਾਹਿਗੁਰੂ") {
            count++;
        } else if (word === "ਗੁਰੂ") {
            continue;
        } else {
            break;
        }
    }

    return count >= 4;
}

const useShabadPilot = (finalText: string, partialText: string, status: RecorderState, startTranscription: any, silenceSeconds: number) => {

    const [lastCheckIdx, setLastCheckIdx] = useState(0);
    const [active, setActive] = useState(false);
    const shabadContext = useCtxSelector(ShabadContext);
    const searchContext = useContext(SearchContext);
    const appContext = useContext(AppContext);
    const [simran, setSimran] = useState(false);

    const getTerms = (panktis: Pankti[]) => {
        const terms = panktis.map((pankti: Pankti) => pankti.gurmukhi_speech);

        return terms;
    }

    useEffect(() => {
        if (!active || appContext.state.page === PAGE_SEARCH) return;

        // wait for shabad load
        if (appContext.state.prev_page === PAGE_SEARCH &&
            searchContext.state.searchShabadPankti?.shabad_id != shabadContext.state.shabadId
        ) {
            return;
        }

        if (status === 'Init') {
            startTranscription(getTerms(shabadContext.state.panktis));
            setLastCheckIdx(0);
            setSimran(false);
        }

        matchPankti();

    }, [
        active,
        finalText,
        partialText,
        status,
        silenceSeconds,
        shabadContext.state.shabadId,
        searchContext.state.searchShabadPankti,
        appContext.state.prev_page,
        appContext.state.page,
        simran,
        setSimran,
        startTranscription,
        setLastCheckIdx
    ]);

    useEffect(() => {
        console.log('silence: ', silenceSeconds, ' simran: ', simran);
        if (silenceSeconds < 5 || simran) return;

        const panktis = shabadContext.state.panktis
        const firstUnvisitedIndex = panktis.findIndex(
            p => !p.visited && p.type_id > 2 && p.gurmukhi_words.length > 1
        );

        // all visited and on home
        if (firstUnvisitedIndex === -1 && shabadContext.state.home === shabadContext.state.current && silenceSeconds > 7) {
            appContext.dispatch({
                type: SET_APP_PAGE,
                payload: {
                    page: PAGE_SEARCH,
                    show_panel: true,
                }
            });
            return;
        }

        if (firstUnvisitedIndex === -1) {
            return;
        }

        // auto navigate when home pankti
        if (shabadContext.state.current === shabadContext.state.home) {
            shabadContext.dispatch({
                type: SHABAD_PANKTI_NO_VISITED,
                payload: {
                    current: firstUnvisitedIndex,
                }
            });
        }

    }, [silenceSeconds, shabadContext.dispatch]);

    const matchPankti = () => {
        if (silenceSeconds > 5 && !simran) {
            return;
        }

        if (silenceSeconds > 4 && !simran) {
            setLastCheckIdx(finalText.length - 1);
            return;
        }

        const panktiFinalText = finalText.slice(lastCheckIdx)
            .replaceAll('।', ',')
            .replaceAll('.', ',');
        const tokenText = panktiFinalText + partialText
            .replaceAll('।', ',')
            .replaceAll('.', ',');
        const speechText = unifySpeechText(tokenText);

        const tokens = speechText.split(' ');

        if (isSimran(tokenText)) {
            if (!simran) {
                setSimran(true);
                appContext.dispatch({
                    type: SET_APP_PAGE,
                    payload: {
                        page: PAGE_ANNOUNCEMENT,
                        show_panel: false,
                    }
                });
            }
            return;
        } else if (simran) {
            if (appContext.state.page === PAGE_ANNOUNCEMENT) {
                appContext.dispatch({
                    type: SET_APP_PAGE,
                    payload: {
                        page: appContext.state.prev_page,
                        show_panel: appContext.state.prev_show_panel,
                    }
                });
            }

            setSimran(false);
        }

        const matchingPanktis = findMatchingPankti(shabadContext.state.panktis, tokens, shabadContext.state.home, shabadContext.state.current);

        if (matchingPanktis.length === 1) {
            const matchingPankti = matchingPanktis[0];

            // update position in matching text
            const matchText = matchingPankti.matches.reverse().join(" ");
            const matchPosition = findIndexIgnoringPunctuation(tokenText, matchText);
            if (matchPosition > -1 && matchPosition < panktiFinalText.length) {
                setLastCheckIdx(prev => prev + matchPosition);
            }

            if (matchingPankti.panktiIdx !== shabadContext.state.current || !shabadContext.state.panktis[shabadContext.state.current].visited) {
                Sentry.captureMessage(JSON.stringify({
                    tkn: panktiFinalText + partialText,
                    stxt: speechText,
                    mch: matchingPankti.matches.join(" "),
                    wrds: matchingPankti.words.join(" "),
                    nxt: getAllowedNextPanktiIdxs(
                        shabadContext.state.panktis,
                        shabadContext.state.home,
                        shabadContext.state.current
                    ).join(","),
                    idx: matchingPankti.panktiIdx,
                    shbd: shabadContext.state.panktis[matchingPankti.panktiIdx].shabad_id,
                }), "info");
                // console.log('final: ', panktiFinalText, ' partial: ', partialText.replaceAll('।', ','));
                // console.log('speech: ', speechText);
                // console.log(JSON.stringify(matchingPankti));
                // console.log('nextpanktis: ', getAllowedNextPanktiIdxs(
                //     shabadContext.state.panktis,
                //     shabadContext.state.home,
                //     shabadContext.state.current
                // ))

                shabadContext.dispatch({
                    type: SHABAD_PANKTI,
                    payload: {
                        current: matchingPankti.panktiIdx,
                    }
                });
            } else if (shabadContext.state.panktis[shabadContext.state.current].visited !== true) {
                shabadContext.dispatch({
                    type: SHABAD_PANKTI_MARK_VISITED,
                    payload: {
                        current: matchingPankti.panktiIdx,
                    }
                });
            }
        } else if(matchPankti.length > 0) {
            console.log('=======================================================================================');
            console.log('more matches: ', matchingPanktis);
        }
    };

    return {
        setActive
    };
};

export default useShabadPilot;
