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

export const useBaniPilot = () => {

    const { state, dispatch } = useContext(ShabadContext);
    const [tokens, setTokens] = useState<string[]>([]);
    const processingRef = useRef(false);
    const [status, setStatus] = useState('Not Started');
    const [lastCheckIndex, setLastCheckIndex] = useState(0);
    const [lastPanktiCheckIdx, setLastPanktiCheckIdx] = useState(0);
    const [panktiMatchIdx, setPanktiMatchIdx] = useState(0);
    const [visitedIdxs, setVisistedIdxs] = useState<Number[]>([]);

    const findNextPanki = (scores: PanktiScore[], currentPankti: Pankti, singleShabad: boolean) => {
        const continuousPantiIdxs: number[] = [state.current, state.current+1];

        // allow current shabad and next pankti
        scores = scores.filter(
            score => score.shabadId === currentPankti.shabad_id ||
                continuousPantiIdxs.includes(score.panktiIdx)
        );

        if (scores.length === 0) {
            return [];
        }

        // 1. prefer full match (avoid less than two words unless continuous pankti)
        const fullMatches = scores.filter((score) => score.fullMatch);
        if (fullMatches.length === 1 &&
            (
                fullMatches[0].totalMatches > 2 ||
                continuousPantiIdxs.includes(fullMatches[0].panktiIdx)
            )
        ) {
            return fullMatches;
        }

        // 2. prefer full start or full vishram but atleast 2 words match
        //    or mathes with current pankti ending or starting but atleast 1 match
        const fullStartOrVishraam = scores.filter((score) => score.startFull || score.vishraamFull);
        if (fullStartOrVishraam.length === 1 &&
            (
                (
                    scores[0].totalMatches > 1 &&
                    (scores[0].panktiStarted || scores[0].panktiFinished) &&
                    continuousPantiIdxs.includes(scores[0].panktiIdx)
                ) ||
                (
                    // for single shabad, allow more than one word match
                    scores[0].totalMatches > 2 && singleShabad
                ) ||
                (
                    // for bani view, only allow to current shabad
                    scores[0].totalMatches > 2 && !singleShabad && scores[0].shabadId === currentPankti.shabad_id
                )
            )
        ) {
            return fullStartOrVishraam;
        }

        // 3. continuous pankti or next not visited but with pankti or rahao type
        let notVisitedIdx = state.panktis.findIndex(
            (p, index) => p.visited !== true &&
                !visitedIdxs.includes(index) &&
                state.panktis[index].type_id > 2
        );

        let rahaoPanktis: number[] = [];
        if (singleShabad) {
            rahaoPanktis = state.panktis.filter((pankti) =>
                pankti.type_id === RAHAO_PANKTI
            ).map((_, index) => index);
        }

        let possiblePanktis = [...continuousPantiIdxs, notVisitedIdx, ...rahaoPanktis].filter(idx => idx != -1);

        // possible next but continue match and should be starting with next possible pankti word
        const possibleNext = scores.filter((score) => {
            possiblePanktis.includes(score.panktiIdx) &&
            score.continueMatch &&
            score.panktiStarted &&
            (
                (
                    // allow single word for continuous pankti
                    continuousPantiIdxs.includes(score.panktiIdx) && score.totalMatches > 1
                ) ||
                (
                    // match more than two matches for non visited and rahao panktis
                    score.panktiIdx !== state.current + 1 &&
                    score.totalMatches > 2
                )
            )
        });
        if (possibleNext.length === 1) {
            return possibleNext;
        }

        return scores;
    }

    const endProcessing = (start: number) => {
        processingRef.current = false;
        const end = performance.now();

        const duration = end - start;

        console.log(`${duration.toFixed(2)} ms\n\n`);
    }

    useEffect(() => {
        if (processingRef.current) return;

        const start = performance.now();

        let lastCheckIdx1 = lastCheckIndex;
        let checkTokens = tokens.slice(lastCheckIndex);
        let panktiTokens = tokens.slice(lastPanktiCheckIdx);
        console.log('checkTokens: ', checkTokens);
        console.log('panktiTokens: ', panktiTokens);

        // wait for two tokens atleast
        if (lastPanktiCheckIdx === lastCheckIdx1 && panktiTokens.length < 2) {
            endProcessing(start);
            return;
        }

        if (checkTokens.length === 0) {
            endProcessing(start);
            return;
        }

        let matchingScores = findMatches(panktiTokens, checkTokens, state.panktis, state.current);

        if (matchingScores.length > 1) {
            setLastPanktiCheckIdx(lastCheckIndex);
            const singleShabad = state.shabadIds.length === 1;
            matchingScores = findNextPanki(matchingScores, state.panktis[state.current], singleShabad);
        }

        let matchingPanktiIndex = -1;
        if (matchingScores.length === 1) {
            matchingPanktiIndex = matchingScores[0].panktiIdx;

            if (! visitedIdxs.includes(matchingPanktiIndex)) {
                setVisistedIdxs([...visitedIdxs, matchingPanktiIndex].sort());
            }

                    matchingScores.forEach((s, i) => {
            const green = (v: boolean) =>
                v ? '\x1b[32mtrue\x1b[0m' : '\x1b[31mfalse\x1b[0m';

            const output =
`
┌─────────────────────────────────────────────────────────────
│ matches   : ${s.matches.join(', ')}
│ words     : ${s.words.join(', ')}
│ tokenIdxs : ${s.tokenIdxs.join(', ')} │ wordIdxs : ${s.wordIdxs.join(', ')}
├─────────────────────────────────────────────────────────────
│ startFull:${green(s.startFull)} │ vishraamFull:${green(s.vishraamFull)} │ fullMatch:${green(s.fullMatch)}
│ panktiIdx:${s.panktiIdx} │ shabadId:${s.shabadId} │ panktiStartIdx:${s.panktiStartIdx} │ panktiEndIdx:${s.panktiEndIdx} │ firstMatchIdx:${s.firstMatchIdx} │ lastMatchIdx:${s.lastMatchIdx}
└─────────────────────────────────────────────────────────────`;

            console.log(output);
        });

        }

        if (matchingPanktiIndex === state.current) {
            // setLastPanktiCheckIdx(lastCheckIndex+matchingScores[0].totalMatches);
            endProcessing(start);
            return;
        } else if (matchingPanktiIndex > 0) {
            // only update last match index when pankti completed
            // if (matchingScores[0].fullMatch || matchingScores[0].vishraamFull
            //     || (matchingScores[0].vishraamStarted && matchingScores[0].panktiFinished)
            // ) {
            //     const lastMatchIdx = tokens.length - (matchingScores[0].lastMatchIdx + 1);
            //     setLastCheckIndex(lastMatchIdx);
            // }

            const lastMatchIdx = tokens.length - (matchingScores[0].lastMatchIdx + 1);
            setLastPanktiCheckIdx(tokens.length - (matchingScores[0].lastMatchIdx + 1));
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
