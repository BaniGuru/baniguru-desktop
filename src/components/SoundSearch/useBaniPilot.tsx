import { useContext, useEffect, useRef, useState } from "react";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { Pankti } from "../../models/Pankti";
import { findBaniMatchingPankti, unifySpeechText } from "./SpeechHelper";
import { SET_APP_PAGE, SHABAD_PANKTI, SHABAD_PANKTI_MARK_VISITED, SHABAD_PANKTI_NO_VISITED, SHABAD_RESET } from "../../state/ActionTypes";
import { useContext as useCtxSelector } from "use-context-selector";
import { AppContext, PAGE_SEARCH } from "../../state/providers/AppProvider";
import { RecordState } from "./useSpeech";

const useBaniPilot = (finalText: string, partialText: string, status: RecordState, startTranscription: (panktis: string[]) => any, restartTranscript: (panktis: string[]) => any, silenceSeconds: number) => {

    const [lastCheckIdx, setLastCheckIdx] = useState(0);
    const [active, setActive] = useState(false);
    const shabadContext = useCtxSelector(ShabadContext);
    const appContext = useContext(AppContext);
    const [_panktiFinished, setPanktiFinished] = useState(false);
    const lastTerm = useRef(0);

    const [part, setPart] = useState(1);
    const [panktis, setPanktis] = useState<Pankti[]>([]);

    const getTerms = (termPart: number) => {
        let terms: string[] = [];

        if (shabadContext.state.baniId === 13) {
            const line_group_start = termPart;
            const line_group_end = termPart + 2;

            const lastTermPart = lastTerm.current;
            let lastTermPanktis = shabadContext.state.panktis.filter(pankti => pankti.speech_group == lastTermPart);
            const lastTermPankti = lastTermPanktis.length > 0 ? lastTermPanktis[lastTermPanktis.length - 1] : undefined;

            let prevPanktis: Pankti[] = [];
            if (lastTermPankti) {
                prevPanktis = shabadContext.state.panktis.filter(pankti => pankti.shabad_id == lastTermPankti.shabad_id);
            }

            let newPanktis = [
                ...prevPanktis,
                ...shabadContext.state.panktis.filter(pankti => pankti.speech_group >= line_group_start &&  pankti.speech_group <= line_group_end)
            ];

            setPanktis(newPanktis);
            terms = newPanktis.map((pankti: Pankti) => pankti.gurmukhi_speech);
            lastTerm.current = line_group_end;
        } else if (shabadContext.state.baniId === 12) {
            const line_group_start = termPart;
            const line_group_end = termPart + 2;

            const lastShabadId = panktis.slice(-1)[0]?.shabad_id;
            let prevPanktis = shabadContext.state.panktis.filter(pankti => pankti.shabad_id == lastShabadId);
            let newPanktis = [
                ...prevPanktis,
                ...shabadContext.state.panktis.filter(pankti => pankti.line_group >= line_group_start &&  pankti.line_group <= line_group_end)
            ];

            terms = newPanktis.map((pankti: Pankti) => pankti.gurmukhi_speech);
            setPanktis(newPanktis);
        } else {
            setPanktis(shabadContext.state.panktis);
            terms = shabadContext.state.panktis.map((pankti: Pankti) => pankti.gurmukhi_speech);
        }

        return terms;
    }

    useEffect(() => {
        if (!active || (shabadContext.state.baniId ?? 0) <= 0) return;

        if (shabadContext.state.baniId === 13) {

            const shabadId = shabadContext.state.panktis[shabadContext.state.current].shabad_id;
            if (shabadContext.state.panktis[shabadContext.state.current-1]?.shabad_id
                != shabadId
            ) {
                return;
            }

            const nextShabadIdx = shabadContext.state.panktis.findIndex(
                (pankti, index) => index > shabadContext.state.current &&
                    pankti.shabad_id !== shabadId
            );

            const speech_group = shabadContext.state.panktis[nextShabadIdx]?.speech_group;

            const lastTermPart = lastTerm.current;
            const currentPankti = shabadContext.state.panktis[shabadContext.state.current];
            let lastTermPanktis = shabadContext.state.panktis.filter(pankti => pankti.speech_group == lastTermPart);
            const lastTermPankti = lastTermPanktis.length > 0 ? lastTermPanktis[lastTermPanktis.length - 1] : undefined;
            
            
            if (speech_group < lastTermPart || (currentPankti.shabad_id !== lastTermPankti?.shabad_id && lastTerm.current !== 0)) {
                return;
            }

            const nextLineGroup = lastTermPart + 1;
            if (speech_group && speech_group !== part && speech_group > part) {
                restartTranscript(
                    getTerms(speech_group)
                );
                setPart(nextLineGroup);
                setLastCheckIdx(0);
            }
        } else  if (shabadContext.state.baniId === 12) {
            const lastShabadId = panktis.slice(-1)[0].shabad_id;
            const lastLineGroup = panktis.slice(-1)[0].line_group;
            const currentShabadId = shabadContext.state.panktis[shabadContext.state.current].shabad_id;
            const currentLineGroup = shabadContext.state.panktis[shabadContext.state.current].line_group;

            if (!lastLineGroup || !lastShabadId || (
                currentShabadId !== lastShabadId &&
                currentLineGroup <= lastLineGroup
            )) {
                return;
            }

            const nextLineGroup = lastLineGroup + 1;
            if ( nextLineGroup % 3 === 1 && nextLineGroup < 24 && nextLineGroup > 1) {
                restartTranscript(getTerms(nextLineGroup));

                setPart(nextLineGroup);
            }
        }
    }, [
        shabadContext.state.current,
        shabadContext.state.baniId
    ]);

    const navigatePankti = () => {
        if (silenceSeconds > 5 && (shabadContext.state.panktis.length - 1) === shabadContext.state.current) {
            shabadContext.dispatch({ type: SHABAD_RESET });
            appContext.dispatch({
                type: SET_APP_PAGE,
                payload: {
                    page: PAGE_SEARCH,
                    show_panel: true,
                }
            });
            return;
        }

        const finalAndPartialText = (finalText ?? "") + (partialText ?? "");
        const tokenText = finalAndPartialText.slice(lastCheckIdx)
            .replaceAll('।', ',')
            .replaceAll('.', ',');

        const speechText = unifySpeechText(tokenText);

        const tokens = speechText.split(' ');

        if (tokens.length < 1) return;

        let lastPanktiIdx = 0;

        for (let i = shabadContext.state.panktis.length - 1; i >= 0; i--) {
            if (shabadContext.state.panktis[i].speech_group === part - 1) {
                lastPanktiIdx = i;
                break;
            }
        }

        if (lastPanktiIdx > 0) {
            lastPanktiIdx = lastPanktiIdx - 6 + 1;
        }

        const matchingPanktis = findBaniMatchingPankti(panktis, tokens, shabadContext.state.current, lastPanktiIdx);

        if (matchingPanktis.length === 1) {
            const matchingPankti = matchingPanktis[0];
            if (matchingPankti.fullMatch
                && !matchingPankti.startingWordMatch
                && matchingPankti.panktiIdx === shabadContext.state.current
            ) {
                setPanktiFinished(true);

                setLastCheckIdx(finalAndPartialText.length - 1);

                // auto next
                const currentPankti = shabadContext.state.panktis[shabadContext.state.current];
                if (currentPankti.auto_next) {
                    shabadContext.dispatch({
                        type: SHABAD_PANKTI_NO_VISITED,
                        payload: {
                            current: (matchingPankti.panktiIdx+1),
                        }
                    });
                    return;
                }

                if (currentPankti.visited !== true) {
                    shabadContext.dispatch({
                        type: SHABAD_PANKTI_MARK_VISITED,
                        payload: {
                            current: matchingPankti.panktiIdx,
                        }
                    });
                }

                return;
            }

            setPanktiFinished(false);

            if (matchingPankti.panktiIdx !== shabadContext.state.current) {
                shabadContext.dispatch({
                    type: SHABAD_PANKTI,
                    payload: {
                        current: matchingPankti.panktiIdx,
                    }
                });
            }  else if (shabadContext.state.panktis[shabadContext.state.current].visited !== true) {
                shabadContext.dispatch({
                    type: SHABAD_PANKTI_MARK_VISITED,
                    payload: {
                        current: matchingPankti.panktiIdx,
                    }
                });
            }
        }
    }

    useEffect(() => {
        if (!active) return;

        if (![6,9,12,13,15].includes(shabadContext.state.baniId ?? -1)) {
            return;
        }

        if (status === 'Init') {
            const shabadId = shabadContext.state.panktis[shabadContext.state.current].shabad_id;
            const speechGroup = shabadContext.state.panktis[shabadContext.state.current].speech_group;
            const groupPanktis = shabadContext.state.panktis.filter(pankti => pankti.speech_group === speechGroup)
            const lastShabadId = groupPanktis.slice(-1)[0].shabad_id;

            let starPart = shabadContext.state.panktis[shabadContext.state.current].speech_group;
            if (shabadId === lastShabadId) {
                starPart++;
            }

            setPart(starPart);
            setLastCheckIdx(0);
            startTranscription(
                getTerms(starPart)
            )
        }

        navigatePankti();

    }, [active, finalText, partialText, setPart, appContext.dispatch, shabadContext.dispatch]);

    return {
        setActive
    };
};

export default useBaniPilot;
