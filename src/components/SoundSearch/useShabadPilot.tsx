import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { Pankti } from "../../models/Pankti";
import { findMatchingPankti, getUnvisitedIdx } from "./SpeechHelper";
import { SET_APP_PAGE, SHABAD_PANKTI, SHABAD_PANKTI_MARK_VISITED, SHABAD_PANKTI_NO_VISITED } from "../../state/ActionTypes";
import { SearchContext } from "../../state/providers/SearchProvider";
import { AppContext, PAGE_ANNOUNCEMENT, PAGE_SEARCH, PAGE_SHABAD } from "../../state/providers/AppProvider";
import { useContext as useCtxSelector } from "use-context-selector";
import { RecordState } from "./useSpeech";
import { postProcessText } from "./NoiseFilter";
import { useSettings } from "../../state/providers/SettingContext";

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

const useShabadPilot = (finalText: string, partialText: string, newFinalToken: string, status: RecordState, startPage: string|null, startTranscription: any, restartTranscript: any, silenceSeconds: number, pauseSpeech: boolean) => {

    const [lastCheckIdx, setLastCheckIdx] = useState(0);
    const [prevText, setPrevText] = useState("");
    const [active, setActive] = useState(false);
    const shabadContext = useCtxSelector(ShabadContext);
    const searchContext = useContext(SearchContext);
    const appContext = useContext(AppContext);
    const [simran, setSimran] = useState(false);
    const autoNextTrigger = useRef(false);
    const {autoNext} = useSettings();

    const getTerms = useCallback((panktis: Pankti[]) => {
        if (panktis.length > 30) {
            const currentGroup = shabadContext.state.panktis[shabadContext.state.current]?.group ?? 0;
            panktis = panktis.filter(pankti => pankti.group === currentGroup);
        }

        const terms = panktis.map((pankti: Pankti) => pankti.gurmukhi_speech);

        return terms;
    }, [shabadContext.state.panktis, shabadContext.state.current]);

    useEffect(() => {
        if (!active || appContext.state.page === PAGE_SEARCH) {
            return;
        };

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
        } else if (status === 'Running' && startPage !== PAGE_SHABAD) {
            restartTranscript(getTerms(shabadContext.state.panktis));
            setLastCheckIdx(0);
            setSimran(false);
        }

        // console.log('--------------------------------');
        // console.log(finalText + partialText);
        // return;

        if (silenceSeconds > 2 && !simran) {
            return;
        }

        // if (silenceSeconds > 1 && !simran) {
        //     setLastCheckIdx(finalText.length - 1);
        //     return;
        // }

        if (silenceSeconds > 0 || pauseSpeech) {
            return;
        }

        // prevent going to previous pankti when empty new token or initial partial token
        if ((newFinalToken + partialText).length <= 1) {
            return;
        }

        const totalText = finalText + partialText;
        const tokenText = totalText.slice(lastCheckIdx);

        // skip checking if already processed
        if (prevText === totalText) {
            return;
        }

        setPrevText(totalText);

        const {speechText, lastText} = postProcessText(tokenText, shabadContext.state.panktis);
        // console.log('tokentext: ', tokenText);
        // console.log('speechText: ', speechText);

        // console.log('totalText: ', totalText)
        // console.log('last Token: ', lastText);
        const checkIdx = (finalText + partialText).length - lastText.length;

        // console.log('checkIdx: ', checkIdx);
        if (checkIdx <= finalText.length && checkIdx !== lastCheckIdx) {
            setLastCheckIdx(checkIdx);
        }

        // wait for matching pankti
        if (speechText.trim().endsWith('<no_match>।') || speechText.trim().endsWith('<multi-match>।')) {
            return;
        }

        if (autoNextTrigger.current) {
            autoNextTrigger.current = false;
        }

        const speechParts = speechText.replace(/[,।\s]+$/g, '').split('।');
        const lastPart = speechParts[speechParts.length-1];

        const tokens = lastPart.split(' ');

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

        // const matches = findMatchPankti(shabadContext.state.panktis, speechText);
        // console.log('matches: ', matches);

        const matchingPanktis = findMatchingPankti(shabadContext.state.panktis, tokens, shabadContext.state.home, shabadContext.state.current);

        if (matchingPanktis.length === 1) {
            const matchingPankti = matchingPanktis[0];

            if (matchingPankti.panktiIdx !== shabadContext.state.current || !shabadContext.state.panktis[shabadContext.state.current].visited) {

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
        }
    }, [
        active,
        finalText,
        partialText,
        newFinalToken,
        status,
        silenceSeconds,
        shabadContext.state.shabadId,
        searchContext.state.searchShabadPankti,
        appContext.state.prev_page,
        appContext.state.page,
        simran,
        startTranscription,
        restartTranscript,
        lastCheckIdx,
        prevText,
        shabadContext.state.panktis,
        shabadContext.state.current,
        getTerms,
        pauseSpeech,
    ]);

    useEffect(() => {
        if (silenceSeconds < 5 || simran || pauseSpeech) return;

        const panktis = shabadContext.state.panktis
        const firstUnvisitedIndex = getUnvisitedIdx(panktis, shabadContext.state.current);

        // all visited and on home
        if (firstUnvisitedIndex === -1 && shabadContext.state.home === shabadContext.state.current && silenceSeconds > 20) {
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
        if (shabadContext.state.current === shabadContext.state.home &&
            !autoNextTrigger.current &&
            autoNext
        ) {
            shabadContext.dispatch({
                type: SHABAD_PANKTI_NO_VISITED,
                payload: {
                    current: firstUnvisitedIndex,
                }
            });
            autoNextTrigger.current = true;
        }

    }, [silenceSeconds, shabadContext.dispatch, autoNext, pauseSpeech]);

    return {
        setActive
    };
};

export default useShabadPilot;
