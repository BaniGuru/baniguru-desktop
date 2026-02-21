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
    const [speech, setSpeech] = useState<{tokens: string[], finalised: boolean}>({tokens: [], finalised: false});
    const processingRef = useRef(false);
    const [status, setStatus] = useState('Not Started');
    const [lastCheckIndex, setLastCheckIndex] = useState(0);
    const [lastPanktiCheckIdx, setLastPanktiCheckIdx] = useState(0);
    const [panktiMatchIdx, setPanktiMatchIdx] = useState(0);
    const [visitedIdxs, setVisistedIdxs] = useState<Number[]>([]);
    const [panktiFinished, setPanktiFinished] = useState<boolean>(false);
    const [baniId, setBaniId] = useState(null);
    const [shabadId, setShabadId] = useState('');

    useEffect(() => {
        if (!state.baniId) {
            setBaniId(null);
            setShabadId(state.shabadId);
        } else {
            setBaniId(baniId);
            setShabadId('');
        }

        setLastCheckIndex(0);
        setLastPanktiCheckIdx(0);
        setVisistedIdxs([]);
    }, [state.baniId, state.shabadId]);

    const findNextPanki = (scores: PanktiScore[], currentPankti: Pankti, singleShabad: boolean, allowedShabadIds: string[], allowedPanktiIds: number[]) => {
        // 1. prefer full match (avoid less than two words unless continuous pankti)
        const fullMatches = scores.filter((score) => score.fullMatch);
        if (fullMatches.length === 1 &&
            (
                fullMatches[0].totalMatches > 2 ||
                allowedPanktiIds.includes(fullMatches[0].panktiIdx)
            )
        ) {
            return fullMatches;
        }

        
        if (singleShabad) {
            scores = scores.filter(score => allowedPanktiIds.includes(score.panktiIdx));
        } else {
            scores = scores.filter(score => allowedPanktiIds.includes(score.panktiIdx) && allowedShabadIds.includes(score.shabadId));
        }

        if (scores.length === 0) {
            return [];
        }

        // 2. prefer full start or full vishram but atleast 2 words match
        //    or mathes with current pankti ending or starting but atleast 1 match
        const StartOrVishraamFull = scores.filter((score) => score.startFull || score.vishraamFull || score.panktiStarted);
        if (StartOrVishraamFull.length === 1 &&
            (
                scores[0].totalMatches > 0 &&
                (scores[0].panktiStarted || scores[0].vishraamStarted)
            )
        ) {
            return StartOrVishraamFull;
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
        const singleShabad = new Set(state.shabadIds).size <= 1;
        let allowedShabadIds = [state.panktis[state.current].shabad_id];
        let allowedPanktiIds = [state.current];

        // TODO: only skip if last not final yet
        const partialSkip = speech.finalised ? 0 : 1;

        // auto next
        if (speech.finalised && singleShabad && panktiFinished && state.home === state.current) {
            for (let index = 0; index < state.panktis.length; index++) {
                let pankti = state.panktis[index];
                if (!visitedIdxs.includes(index) && (pankti.type_id === 3 || index === state.home)) {
                    dispatch({
                        type: SHABAD_PANKTI,
                        payload: {
                            current: index,
                        }
                    });
                    allowedPanktiIds.push(index);
                    break;
                }
            }
            
        }

        let checkTokens = speech.tokens.slice(lastCheckIndex, partialSkip > 0 ? -partialSkip : speech.tokens.length);
        let panktiTokens = speech.tokens.slice(lastPanktiCheckIdx, partialSkip > 0 ? -partialSkip : speech.tokens.length);

        // wait for one token
        console.log(`
┌─────────────────────────────────────────────────────────────
│ panktiTokens : ${panktiTokens.join(' ')} partialSkip:${partialSkip}
│ checkTokens : ${checkTokens.join(' ')} Without Skip: ${speech.tokens.slice(lastCheckIndex).join(' ')}
| lastMatchIdx:${lastCheckIndex} | lastPanktiCheckIdx:${lastPanktiCheckIdx}
└─────────────────────────────────────────────────────────────
`);

        if (checkTokens.length === 0) {
            endProcessing(start);
            return;
        }

        if (!singleShabad) {
            let i = state.current+1;
            while (i < (state.panktis.length - 1) && state.panktis[i].type_id <= 2) {
                allowedShabadIds.push(state.panktis[i].shabad_id);
                allowedPanktiIds.push(i);
                i++;
            }
            allowedPanktiIds.push(i);
            allowedShabadIds.push(state.panktis[i].shabad_id);
        } else {
            allowedPanktiIds.push(state.home);
            for (let index = 0; index < state.panktis.length; index++) {
                let pankti = state.panktis[index];
                if (pankti.type_id === 3 || index === state.home) {
                    allowedPanktiIds.push(index);
                } else if (!visitedIdxs.includes(index) && pankti.type_id > 2) {
                    allowedPanktiIds.push(index);
                    break;
                }
            }
        }

        let matchingScores = findMatches(panktiTokens, checkTokens, state.panktis, state.current);

        if (matchingScores.length > 1) {
            setLastPanktiCheckIdx(lastCheckIndex);
            matchingScores = findNextPanki(matchingScores, state.panktis[state.current], singleShabad, allowedShabadIds, allowedPanktiIds);
        }

        let matchingPanktiIndex = -1;
        if (matchingScores.length === 1) {
            matchingPanktiIndex = matchingScores[0].panktiIdx;

            if (! visitedIdxs.includes(matchingPanktiIndex)) {
                setVisistedIdxs(prev =>
                    [...prev, matchingPanktiIndex].sort()
                );
            }

                    matchingScores.forEach((s, i) => {
            const green = (v: boolean) =>
                v ? '\x1b[32mtrue\x1b[0m' : '\x1b[31mfalse\x1b[0m';

            const output =
`
┌─────────────────────────────────────────────────────────────
│ panktiTokens : ${panktiTokens.join(' ')}
│ checkTokens : ${checkTokens.join(' ')}
│ matches     : ${s.matches.join(' ')}
│ words       : ${s.words.join(' ')}
│ tokenIdxs   : ${s.tokenIdxs.join(', ')} │ wordIdxs : ${s.wordIdxs.join(', ')}
├─────────────────────────────────────────────────────────────
│ startFull:${green(s.startFull)} │ vishraamFull:${green(s.vishraamFull)} │ fullMatch:${green(s.fullMatch)} │ panktiStarted:${green(s.panktiStarted)} │ vishraamStarted:${green(s.vishraamStarted)} │ panktiFinished:${green(s.panktiFinished)} │ totalMatches:${s.totalMatches} │ total Words:${s.words.length}
│ panktiIdx:${s.panktiIdx} │ shabadId:${s.shabadId} │ panktiStartIdx:${s.panktiStartIdx} │ panktiEndIdx:${s.panktiEndIdx} │ firstMatchIdx:${s.firstMatchIdx} │ lastMatchIdx:${s.lastMatchIdx}
│ lastCheckIndex:${lastCheckIndex} | lastPanktiCheckIdx:${lastPanktiCheckIdx} | allowedPanktiIds: ${allowedPanktiIds.join(', ')} | allowedShabadIds: ${allowedShabadIds.join(', ')}
└─────────────────────────────────────────────────────────────`;

            console.log(output);
        });

        }

        if (matchingPanktiIndex === state.current) {
            console.log('current pankti matching, tokens: ', speech.tokens.join(' '), ' pankti: ', state.panktis[state.current].gurmukhi_unicode);
            // setLastPanktiCheckIdx(lastCheckIndex+matchingScores[0].totalMatches);
            if (matchingScores[0].fullMatch || matchingScores[0].panktiFinished) {
                const newLastCheckIdx = lastCheckIndex + matchingScores[0].lastMatchIdx + 1;
                setLastPanktiCheckIdx(newLastCheckIdx);
                setLastCheckIndex(newLastCheckIdx);
                setPanktiFinished(true);
            }

            endProcessing(start);
            return;
        } else if (matchingPanktiIndex > 0) {
            // only update last match index when pankti completed
            // if (matchingScores[0].fullMatch || matchingScores[0].vishraamFull
            //     || (matchingScores[0].vishraamStarted && matchingScores[0].panktiFinished)
            // ) {
            //     const lastMatchIdx = speech.tokens.length - (matchingScores[0].lastMatchIdx + 1);
            //     setLastCheckIndex(lastMatchIdx);
            // }

            const newLastCheckIdx = lastCheckIndex + (checkTokens.length - 1 - matchingScores[0].lastMatchIdx);
            setLastPanktiCheckIdx(newLastCheckIdx);
            setLastCheckIndex(newLastCheckIdx);
            setPanktiFinished(false);

            console.log(`

┌─────────────────────────────────────────────────────────────
| newLastCheckIdx:${newLastCheckIdx} newPanktiCheckIdx:${newLastCheckIdx}
└─────────────────────────────────────────────────────────────

            `);

            dispatch({
                type: SHABAD_PANKTI,
                payload: {
                    current: matchingScores[0].panktiIdx,
                }
            });
            endProcessing(start);
            return;
        } else {
            console.log(`
┌─────────────────────────────────────────────────────────────
| Multiple Matches: ${matchingScores.length}
| Match Panktis: ${matchingScores.map(matchingScore => matchingScore.words.join(' ')).join('| ')}
│ panktiTokens : ${panktiTokens.join(' ')}
│ checkTokens : ${checkTokens.join(' ')} Without Skip: ${speech.tokens.slice(lastCheckIndex).join(' ')}
| lastMatchIdx:${lastCheckIndex} | lastPanktiCheckIdx:${lastPanktiCheckIdx}
| Details: ${JSON.stringify(matchingScores)}
└─────────────────────────────────────────────────────────────
`);
        }

        endProcessing(start);
    }, [
        speech,
        state,
    ]);

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
        setSpeech,
        status,
    };
};
