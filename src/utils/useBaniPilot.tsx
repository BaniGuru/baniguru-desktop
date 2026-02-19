import { Token } from "@soniox/speech-to-text-web";
import { useContext, useEffect, useRef, useState } from "react";
import { ShabadContext } from "../state/providers/ShabadProvider";
import { SHABAD_PANKTI } from "../state/ActionTypes";
import { stat } from "fs";
import {get} from 'fast-levenshtein';
import { findMatches, PanktiScore } from "./matchFinder";
import { Pankti } from "../models/Pankti";

const RAHAO_PANKTI   = 3;
const GURBANI_PANKTI = 4;

//todo: remove tokens from lastCheck which does not match with current pankti

export const useBaniPilot = () => {

    const { state, dispatch } = useContext(ShabadContext);
    const [tokens, setTokens] = useState<string[]>([]);
    const processingRef = useRef(false);
    const [status, setStatus] = useState('Not Started');
    const [lastCheckIndex, setLastCheckIndex] = useState(0);
    const [visitedIdxs, setVisistedIdxs] = useState<Number[]>([]);

    const findNextPanki = (scores: PanktiScore[], currentPankti: Pankti) => {
        // allow current shabad and next pankti
        scores = scores.filter(score => score.shabadId === currentPankti.shabad_id || score.panktiIdx === (state.current+1));

        if (scores.length === 0) {
            return [];
        }

        // 1. prefer full match
        const fullMatches = scores.filter((score) => score.fullMatch);
        if (fullMatches.length === 1) {
            return fullMatches;
        }

        // 2. prefer full start or full vishram but with more than 2 words match
        const fullStartOrVishraam = scores.filter((score) => score.startFull || score.vishraamFull);
        if (fullStartOrVishraam.length === 1 && scores[0].totalMatches > 2) {
            return fullStartOrVishraam;
        }

        // 3. prefer next possible (next pankti or next not visited or rahao)
        let notVisitedIdx = state.panktis.findIndex(
            (p, index) => p.visited !== true && !visitedIdxs.includes(index)
        );

        let possiblePanktis = [state.current, notVisitedIdx];
        if (notVisitedIdx !== -1 && state.panktis[notVisitedIdx].type_id === 2) {
            notVisitedIdx = state.panktis.findIndex(
                (p, index) => p.visited !== true && !visitedIdxs.includes(index) && index > notVisitedIdx
            );
            if (notVisitedIdx !== -1) {
                possiblePanktis.push(notVisitedIdx);
            }
        }
        
        // TODO: allow rahoa pankti if not bani navigation
        // but need careful implementation to avoid noise
        const rahaoPanktis: number[] = [];
        // state.panktis.forEach((p, index) => {
        //     // allow rahao pankti of current shabad
        //     if (p.type_id === 3 && p.shabad_id === currentPankti.shabad_id) {
        //         rahaoPanktis.push(index);
        //     }
        // });
        possiblePanktis = [...possiblePanktis, ...rahaoPanktis].filter(idx => idx != -1);

        // possible next but continue match
        const possibleNext = scores.filter((score) => {
            possiblePanktis.includes(score.panktiIdx) && score.continueMatch &&
            (
                // allow single word for next pankti
                score.panktiIdx === (state.current + 1) ||
                // match more than two matches for non visited and rahao panktis
                (score.panktiIdx !== state.current + 1 && score.totalMatches > 2)
            )
        });
        if (possibleNext.length === 1) {
            return possibleNext;
        }

        return scores;
    }

    const endProcessing = (start: number) => {
        console.log("==================================================================");
        processingRef.current = false;
        const end = performance.now();

        const duration = end - start;

        console.log(`${duration.toFixed(2)} ms`);
    }

    useEffect(() => {
        console.log("==================================================================");
        console.log('tokens: ', JSON.stringify(tokens));
        console.log("==================================================================");
    }, [tokens]);

    useEffect(() => {
        if (processingRef.current) return;

        const start = performance.now();

        console.log('checkTokens: ', JSON.stringify(tokens.slice(lastCheckIndex)), ' lastCheckIndex: ', lastCheckIndex);
        const checkTokens = tokens.slice(lastCheckIndex);
        if (checkTokens.length === 0) {
            endProcessing(start);
            return;
        }

        let matchingScores = findMatches(checkTokens, state.panktis, state.current);
        console.log('matches: ', matchingScores.length);

        if (matchingScores.length > 1) {
            matchingScores = findNextPanki(matchingScores, state.panktis[state.current]);
            console.log('current shabad: ', state.panktis[state.current].shabad_id);
            console.log('possible matches: ', JSON.stringify(matchingScores));
        }


        let matchingPanktiIndex = -1;
        if (matchingScores.length === 1) {
            matchingPanktiIndex = matchingScores[0].panktiIdx;

            if (! visitedIdxs.includes(matchingPanktiIndex)) {
                setVisistedIdxs([...visitedIdxs, matchingPanktiIndex].sort());
            }
        }

        if (matchingPanktiIndex === state.current) {
            endProcessing(start);
            return;
        } else if (matchingPanktiIndex > 0) {
            const lastMatchIdx = tokens.length - (matchingScores[0].lastMatchIdx + 1);
            setLastCheckIndex(lastMatchIdx);
            dispatch({
                type: SHABAD_PANKTI,
                payload: {
                    current: matchingScores[0].panktiIdx,
                }
            });
            endProcessing(start);
            return;
        }

        endProcessing(start);
    }, [tokens, dispatch]);

    // local only
    // useEffect(() => {
    //     const wss = new WebSocket('ws://localhost:8080');

    //     // Handle WebSocket events
    //     wss.onopen = () => {
    //         if (status !== 'Connected') {
    //             setStatus('Connected');
    //             console.log('WebSocket connected');
    //         }

    //         wss.send(JSON.stringify(state.panktis.map((pankti: Pankti) => pankti.gurmukhi_words.join(" "))));
    //     };

    //     wss.onmessage = (event) => {
    //         const message = JSON.parse(event.data);
    //         setTokens((prevTokens: any) => {
    //             return [...prevTokens, ...message];
    //         });
    //         console.log('Received from server:', event.data);
    //     };

    //     wss.onerror = (error) => {
    //         setStatus('Error connecting to WebSocket');
    //         console.error('WebSocket error:', error);
    //     };

    //     wss.onclose = () => {
    //         setStatus('Disconnected');
    //         console.log('WebSocket connection closed');
    //     };

    //     return () => {
    //         if (wss) {
    //             wss.close();
    //         }
    //     };
    // }, [state.baniId]);

    return {
        tokens,
        setTokens,
        status,
    };
};
