import { useContext, useEffect, useState } from "react";
import { RecorderState } from "@soniox/speech-to-text-web";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { Pankti } from "../../models/Pankti";
import { findBaniMatchingPankti, findIndexIgnoringPunctuation, getLatestPanktiPart, unifySpeechText } from "./SpeechHelper";
import { SHABAD_PANKTI, SHABAD_PANKTI_MARK_VISITED, SHABAD_PANKTI_NO_VISITED } from "../../state/ActionTypes";

const useBaniPilot = (finalText: string, partialText: string, status: RecorderState, startTranscription: (panktis: string[]) => any, stopTranscription: (panktis: string[]) => any) => {

    const [lastCheckIdx, setLastCheckIdx] = useState(0);
    const [lastCheckIndex] = useState(0);
    const [active, setActive] = useState(false);
    const shabadContext = useContext(ShabadContext);
    const [panktiFinished, setPanktiFinished] = useState(false);

    const [part, setPart] = useState(1);

    const getTerms = (termPart: number) => {
        let terms: string[] = [];
        if (shabadContext.state.baniId === 13) {
            let panktis = []
            if (termPart === 1) {
                panktis = shabadContext.state.panktis.filter(pankti => pankti.line_group <= 12);
            } else if (termPart === 2) {
                panktis = shabadContext.state.panktis.filter(pankti => pankti.line_group >= 12 && pankti.line_group <= 24);
            }  else if (termPart === 3) {
                panktis = shabadContext.state.panktis.filter(pankti => pankti.line_group >= 24 && pankti.line_group <= 36);
            } else {
                panktis = shabadContext.state.panktis.filter(pankti => pankti.line_group >= 36);
            }

            terms = panktis.map((pankti: Pankti) => pankti.gurmukhi_speech);
        } else if (shabadContext.state.baniId === 12) {
            let panktis = [];
            const line_group_start = termPart;
            const line_group_end = termPart + 2;
            panktis = shabadContext.state.panktis.filter(pankti => pankti.line_group >= line_group_start &&  pankti.line_group <= line_group_end);

            terms = panktis.map((pankti: Pankti) => pankti.gurmukhi_speech);
            console.log(terms);
        } else {
            terms = shabadContext.state.panktis.map((pankti: Pankti) => pankti.gurmukhi_speech);
        }

        return terms;
    }

    useEffect(() => {
        if (shabadContext.state.baniId === 13) {
            const lineGroup = shabadContext.state.panktis[shabadContext.state.current].line_group;
            // todo: switch on last pankti
            if (
                (lineGroup === 12 && part == 1) ||
                (lineGroup === 24 && part == 2) ||
                (lineGroup === 36 && part == 3)
            ) {
                stopTranscription(getTerms(part+1));
                setPart(part+1);
            }
        } else  if (shabadContext.state.baniId === 12) {
            const lineGroup = shabadContext.state.panktis[shabadContext.state.current].line_group;
            const expectedPart = Math.floor((lineGroup + 1) / 2) + 1;
            if (lineGroup % 2 === 0 && lineGroup < 24 && lineGroup > 1 && expectedPart !== part) {
                getTerms(part+1);
                stopTranscription(getTerms(part+1));

                setPart(part+1);
            }
        }
    }, [shabadContext.state.current]);

    useEffect(() => {
        if (!active) return;

        if (![6,9,12,13,15].includes(shabadContext.state.baniId ?? -1)) {
            return;
        }

        // asa ki vaar
        

        if (status === 'Init') {
            startTranscription(getTerms(part));
        }

        navigatePankti();

    }, [active, finalText, partialText]);

    const navigatePankti = () => {
        if ((lastCheckIdx + 1) > finalText.length) {
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
        const matchingPanktis = findBaniMatchingPankti(shabadContext.state.panktis, tokens, shabadContext.state.current);

        if (matchingPanktis.length === 1) {
            console.log(speechText);
            const matchingPankti = matchingPanktis[0];

            if (matchingPankti.fullMatch && !matchingPankti.startingWordMatch && matchingPankti.panktiIdx === shabadContext.state.current) {
                setPanktiFinished(true);

                setLastCheckIdx((finalText + partialText).length - 1);

                // auto next
                shabadContext.dispatch({
                    type: SHABAD_PANKTI_NO_VISITED,
                    payload: {
                        current: (matchingPankti.panktiIdx+1),
                    }
                });
                return;
            }

            const matchText = matchingPankti.matches.reverse().join(" ");
            const matchPosition = findIndexIgnoringPunctuation(tokenText, matchText);
            if (matchPosition > -1 && matchPosition < panktiFinalText.length) {
                setLastCheckIdx(prev => prev + matchPosition);
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
            console.log(matchingPankti);
        }
    }

    return {
        setActive
    };
};

export default useBaniPilot;
