import { useContext, useEffect, useState } from "react";
import { RecorderState } from "@soniox/speech-to-text-web";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { Pankti } from "../../models/Pankti";
import { findBaniMatchingPankti, getLatestPanktiPart } from "./SpeechHelper";
import { SHABAD_PANKTI } from "../../state/ActionTypes";

const useBaniPilot = (speechTokens: string[], status: RecorderState, startTranscription: (panktis: string[]) => any, stopTranscription: any) => {

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
                stopTranscription();

                startTranscription(getTerms(part+1));
                setPart(part+1);
            }
        }
    }, [shabadContext.state.current]);

    useEffect(() => {
        if (!active) return;

        if (![6,9,13,15].includes(shabadContext.state.baniId ?? -1)) {
            return;
        }

        // asa ki vaar
        

        if (status === 'Init') {
            startTranscription(getTerms(part));
        }

        navigatePankti();

    }, [active, speechTokens]);

    const navigatePankti = () => {

        const tokens = speechTokens.slice(lastCheckIndex);
        if (tokens.length < 1) {
            return;
        }

        const lastToken = tokens[tokens.length-1];
        if (lastToken.trim() === '') {
            return;
        }

        const tokenParts = getLatestPanktiPart(lastToken);
        const matchingPanktis = findBaniMatchingPankti(shabadContext.state.panktis, tokenParts, shabadContext.state.current, panktiFinished);

        if (matchingPanktis.length === 1) {
            const matchingPankti = matchingPanktis[0];

            if (matchingPankti.fullMatch) {
                setPanktiFinished(true);
                // auto next
                // shabadContext.dispatch({
                //     type: SHABAD_PANKTI_NO_VISITED,
                //     payload: {
                //         current: (matchingPankti.panktiIdx+1),
                //     }
                // });
            } else {
                setPanktiFinished(false);
            }

            if (matchingPankti.panktiIdx !== shabadContext.state.current) {
                shabadContext.dispatch({
                    type: SHABAD_PANKTI,
                    payload: {
                        current: matchingPankti.panktiIdx,
                    }
                });
            } else if (matchingPankti.panktiIdx === shabadContext.state.current){
                
                //     shabadContext.dispatch({
                //         type: SHABAD_PANKTI,
                //         payload: {
                //             current: matchingPankti.panktiIdx+1,
                //         }
                //     });
            }
            console.log(matchingPankti);
        }
    }

    return {
        setActive
    };
};

export default useBaniPilot;
