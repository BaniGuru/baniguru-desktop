import { useContext, useEffect, useState } from "react";
import { RecorderState } from "@soniox/speech-to-text-web";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { Pankti } from "../../models/Pankti";
import { findMatchingPankti, getLatestPanktiPart } from "./SpeechHelper";
import { SHABAD_PANKTI } from "../../state/ActionTypes";

const useShabadPilot = (speechTokens: string[], status: RecorderState, startTranscription: (panktis: string[]) => any) => {

    const [lastCheckIndex, setLastCheckIndex] = useState(0);
    const [active, setActive] = useState(false);
    const shabadContext = useContext(ShabadContext);

    const getTerms = () => {
        const terms = shabadContext.state.panktis.map((pankti: Pankti) => pankti.gurmukhi_speech);

        return terms;
    }

    useEffect(() => {
        if (!active) return;

        if (status === 'Init') {
            startTranscription(getTerms());
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
        const matchingPanktis = findMatchingPankti(shabadContext.state.panktis, tokenParts, shabadContext.state.home, shabadContext.state.current);

        if (matchingPanktis.length === 1) {
            const matchingPankti = matchingPanktis[0];

            if (matchingPankti.panktiIdx !== shabadContext.state.current) {
                shabadContext.dispatch({
                    type: SHABAD_PANKTI,
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

export default useShabadPilot;
