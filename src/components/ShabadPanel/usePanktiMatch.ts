import { useContext, useEffect, useRef, useState } from "react";
import { Pankti } from "../../models/Pankti";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { Token } from "@soniox/speech-to-text-web";
import { SHABAD_PANKTI } from "../../state/ActionTypes";
import {  getPanktiScores } from "../../utils/autoPilotHelpers";

const RAHAOH_PANKTI_TYPE_ID = 3;
const SHABAD_PANKTI_TYPE_ID = 4;

const areAllTokenPresent = (tokens: string[], panktiTokens: string[]) => {
    return tokens.every(token => panktiTokens.includes(token));
};

export const usePanktiMatch = ({speechTerms}: {speechTerms: string[]}) => {
    const { state, dispatch } = useContext(ShabadContext);
    const [setTokens] = useState<Token[]>([]);
    const [msgTokens, setMsgTokens] = useState<any>([]);
    const [status, setStatus] = useState('Connecting...');
    const [lastTokenIndex, setLastTokenIndex] = useState(-1);
    const [visitedPanktis, setVisitedPanktis] = useState<number[]>([]);
    const [currentPankti, setCurrentPankti] = useState<{ index: Number, gurmukhiWords: string[] }>({ index: -1, gurmukhiWords: [] }); // current pankti
    const [currentMatchIndex, setCurrentMatchIndex] = useState(-1); // position of current pankti matching started

    const processingRef = useRef(false);

    const getNextPankti = (matchingPanktis: any[]) => {
        const matchingRahaoPanktis = matchingPanktis.filter((matchingPankti: any) => {
            return (
                matchingPankti.panktiTypeId === RAHAOH_PANKTI_TYPE_ID
            )
        });

        const unvisitedMatchPanktis = matchingPanktis.filter((matchingPankti: any) => {
            return (
                ! visitedPanktis.includes(matchingPankti.panktiIndex) ||
                matchingPankti.panktiTypeId !== RAHAOH_PANKTI_TYPE_ID
            )
        });

        if (matchingRahaoPanktis.length === 0 && unvisitedMatchPanktis.length === 0) {
            return matchingRahaoPanktis;
        }

        unvisitedMatchPanktis.sort((a, b) => a.panktiIndex - b.panktiIndex);

        let homeOrRahaoIdxs: number[] = [];
        state.panktis.forEach((pankti: Pankti, index: number) => {
            if (pankti.type_id === RAHAOH_PANKTI_TYPE_ID) {
                homeOrRahaoIdxs.push(index);
            } else if (index === state.home) {
                homeOrRahaoIdxs.push(index);
            }
        });

        for (let index = 0; index < state.panktis.length; index++) {
            const pankti = state.panktis[index];

            // Skip sirlekh and mangla charan
            if (pankti.type_id !== RAHAOH_PANKTI_TYPE_ID && pankti.type_id !== SHABAD_PANKTI_TYPE_ID) {
                continue;
            }

            // allow rahao pankti to match again
            if (visitedPanktis.includes(index) && pankti.type_id !== RAHAOH_PANKTI_TYPE_ID) {
                continue;
            }

            // get next pankti not visited when in rahao panktis
            const firstMatch = unvisitedMatchPanktis.filter((matchingPankti: any) => matchingPankti.panktiIndex === index
                && homeOrRahaoIdxs.includes(state.current)
            );
            if (firstMatch.length === 1) {
                return firstMatch;
            }

            // match raho pankti as last resource
            if (matchingRahaoPanktis.length > 0 && matchingRahaoPanktis[0].panktiIndex === index && (pankti.type_id === RAHAOH_PANKTI_TYPE_ID)) {
                return [matchingRahaoPanktis[0]];
            }

            break;
        }


        return unvisitedMatchPanktis;
    }

    const checkHighConfidenceMatch = (words: string[], matchingPanktis: any[]) => {
        let highConfidenceMatch = matchingPanktis.filter((matchingPankti) => (
            matchingPankti.fullmatch
        ));

        if (highConfidenceMatch.length === 1) {
            return highConfidenceMatch;
        }

        // start or vishraam matching
        highConfidenceMatch = matchingPanktis.filter((matchingPankti) => (
            (matchingPankti.startFull || matchingPankti.vishraamFull)
        ));
        if (highConfidenceMatch.length === 1) {
            return highConfidenceMatch;
        }

        // start or vishraam matching with other partial match
        highConfidenceMatch = matchingPanktis.filter((matchingPankti) => (
                (matchingPankti.startFull && matchingPankti.vishraamPartial) ||
                (matchingPankti.vishraamFull && matchingPankti.startPartial)
        ));
        if (highConfidenceMatch.length === 1) {
            return highConfidenceMatch;
        }

        // home pankti
        highConfidenceMatch = matchingPanktis.filter((matchingPankti) => (
            (matchingPankti.startFull || matchingPankti.vishraamFull) &&
            matchingPankti.panktiIndex === state.home
        ));
        if (highConfidenceMatch.length === 1) {
            return highConfidenceMatch;
        }

        // go back in history and check which pankti is more matching (track the first match index and use that to go back from pankti position)
        // e.g. stagur hoye (dyal ta sharda pooriye) go back from dyal to find satgur hoye in previous history

        // start and vishraam matching with some words (low quality match)
        highConfidenceMatch = matchingPanktis.filter((matchingPankti) => (
            (matchingPankti.start && matchingPankti.vishraam && matchingPankti.matches > 2)
        ));

        if (highConfidenceMatch.length === 1) {
            return highConfidenceMatch;
        }

        // same number of matches with atlest three matches
        highConfidenceMatch = matchingPanktis.filter((matchingPankti) => (
            (matchingPankti.matches === words.length && words.length > 2)
        ));

        if (highConfidenceMatch.length === 1) {
            return highConfidenceMatch;
        }

        return matchingPanktis;
    };

    // live
    // useEffect(() => {
    //     setMsgTokens(tokens);
    // }, [tokens]);

    // local test
    useEffect(() => {
        const wss = new WebSocket('ws://localhost:8080');

        // Handle WebSocket events
        wss.onopen = () => {
            if (status !== 'Connected') {
                setStatus('Connected');
                console.log('WebSocket connected');
            }

            wss.send(JSON.stringify(speechTerms));
        };

        wss.onmessage = (event) => {
            const message = JSON.parse(event.data);
            setMsgTokens((prevTokens: any) => [...prevTokens, ...message]);
            console.log('Received from server:', event.data);
        };

        wss.onerror = (error) => {
            setStatus('Error connecting to WebSocket');
            console.error('WebSocket error:', error);
        };

        wss.onclose = () => {
            setStatus('Disconnected');
            console.log('WebSocket connection closed');
        };

        // Cleanup WebSocket connection when the component unmounts
        return () => {
            if (wss) {
                wss.close();
            }
        };
    }, []);

    const endProcessing = () => {
        console.log("==================================================================");
        processingRef.current = false;
    }

    useEffect(() => {
        if (processingRef.current) return;

        console.log('processing: ', JSON.stringify(msgTokens), ' index: ', lastTokenIndex, ' current: ', currentPankti);

        processingRef.current = true;

        const words = msgTokens.slice(lastTokenIndex + 1);
        let currentPanktiTokens = [];

        if (currentPankti.index !== -1) {
            currentPanktiTokens = msgTokens.slice(currentMatchIndex);
        }

        console.log('recognising: ', words);

        // check pankti based on current tokens
        console.log('currentPanktiTokens: ', currentPanktiTokens);
        if (currentPanktiTokens.length > 0) {
            console.log('current pankti match: ');
            if (areAllTokenPresent(currentPanktiTokens, currentPankti.gurmukhiWords)) {
                setLastTokenIndex(words.length + lastTokenIndex);
                endProcessing();
                return;
                // todo: mark current pankti complete if all token matched
                // const matchingCurrentPanktis = getPanktiScores(currentPanktiTokens, state.panktis);
            }
        }

        // get scoring for new words
        console.log('new words match: ');
        let matchingPanktis = getPanktiScores(words, state.panktis);
        if (lastTokenIndex === -1) {
            console.log(state.panktis);
        }

        // skip no matching and don't update last token index yet
        if (matchingPanktis.length === 0) {
            endProcessing();
            return;
        }

        // check if matching pankti is in auto next panktis
        if (currentPankti.index != -1) {
            const nextPankti = getNextPankti(matchingPanktis);
            if (nextPankti.length === 1) {
                console.log('auto next: ', nextPankti);
                matchingPanktis = nextPankti;
            }
        }

        // check if it's full match or atlest start and vishraam matches with word >= 3
        if (matchingPanktis.length > 1) {
            matchingPanktis = checkHighConfidenceMatch(words, matchingPanktis);
        }

        console.log('Updated tokens: ', words);
        console.log('matching: ', matchingPanktis);

        if (matchingPanktis.length === 1) {
            const matchingPankti = matchingPanktis[0];

            if (currentPankti.index !== matchingPankti.panktiIndex) {
                setCurrentMatchIndex(lastTokenIndex + 1);
            }

            // update references
            setLastTokenIndex(words.length + lastTokenIndex);

            if (!visitedPanktis.includes(matchingPankti.panktiIndex)) {
                visitedPanktis.push(matchingPankti.panktiIndex);
            }

            if (currentPankti.index !== matchingPankti.panktiIndex) {
                setVisitedPanktis([...visitedPanktis, matchingPankti.panktiIndex]);
                setCurrentPankti({ index: matchingPankti.panktiIndex, gurmukhiWords: matchingPankti.gurmukhiWords });
            }
        }

        endProcessing();
    }, [msgTokens]);


    // navigate to current pankti
    useEffect(() => {
        if (state.current !== currentPankti.index && currentPankti.index !== -1) {
            dispatch({ type: SHABAD_PANKTI, payload: {
                current: currentPankti.index
            }});
        }
    }, [currentPankti.index]);

    useEffect(() => {

    }, [state.shabadId]);


    return { setTokens, status };
};
