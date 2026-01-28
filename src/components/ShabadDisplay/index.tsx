import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { SearchContext } from "../../state/providers/SearchProvider";
import Format from "../../utils/Format";
import { DB } from "../../utils/DB";
import styled from "styled-components";
import { Pankti } from "../../models/Pankti";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { RECENT_SEARCH_UPDATE, RECENT_VISITED_UPDATE, SEARCH_SHABAD_PANKTI, SHABAD_UPDATE } from "../../state/ActionTypes";
import { useSettings } from "../../state/providers/SettingContext";
import { updateServerPankti } from "../../utils/TauriCommands";
import FormatAndBreakText from "../../ui/FormatAndBreakText";
import { AppContext, PAGE_SHABAD } from "../../state/providers/AppProvider";
import { BANI_ACTION_UPDATE, BaniContext } from "../../state/providers/BaniProvider";
import { useThemeColors } from "../../utils/useTheme";

import WavesurferPlayer from '@wavesurfer/react';

// import soundfile from "../../assets/audio/prof_satnam_singh_sethi_sehaj_paath_parts/out000.mp3";
import WaveSurfer from "wavesurfer.js";
import { seekToNearestSilence } from "../../utils/wavesurferUtils";
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'

interface PanelProps {
    startSpace: number;
    endSpace: number;
    leftSpace: number;
    rightSpace: number;
}

const Panel = styled.div<PanelProps>`
    padding-top: ${({ startSpace }) => `${startSpace}px`};
    padding-left: ${({ leftSpace }) => `${leftSpace}px`};
    padding-right: ${({ rightSpace }) => `${rightSpace}px`};
`;

interface FontProps {
    fontSize: number;
    contentSpace: number;
}

interface NextPanktiProps {
    fontSize: number;
    endSpace: number;
    leftSpace: number;
}

const NextPanktiGurmukhi = styled.div<NextPanktiProps>`
    font-size: ${({ fontSize }) => `${fontSize}px`};
    line-height: 1.2;
    margin-bottom: ${({ endSpace }) => `${endSpace}px`};
    font-family: "Open Gurbani Akhar";
    font-weight: 900;
    padding-left: ${({ leftSpace }) => `${leftSpace}px`};
    padding-right: ${({ leftSpace }) => `${leftSpace}px`};

    white-space: nowrap;
`;

const Punjabi = styled.div<FontProps>`
    font-size: ${({ fontSize }) => `${fontSize}px`};
    line-height: 1.4;
    margin-top: ${({ contentSpace }) => `${contentSpace}px`};
    display: flex;
    font-family: "Open Anmol Uni", sans-serif;
    font-weight: 900;
`;

const English = styled.div<FontProps>`
    font-size: ${({ fontSize }) => `${fontSize}px`};
    line-height: 1.4;
    margin-top: ${({ contentSpace }) => `${contentSpace}px`};
    padding-left: 40px;
    padding-right: 40px;
    font-family: "Noto Sans", sans-serif;
    font-weight: 700;
`;

const ShabadDisplay: React.FC = () => {
    const searchContext = useContext(SearchContext);
    const baniContext = useContext(BaniContext);
    const {state, dispatch } = useContext(ShabadContext);
    const {state: appState} = useContext(AppContext);
    const { fontSizes, displaySpacing, activeThemeName, visibility } = useSettings();
    const current = state.current;

    const nextPanktiRef = useRef<HTMLDivElement>(null);
    const [nextPanktiFontSize, setNextPanktiFontSize] = useState(fontSizes["Next Pankti"]);
    const { palette } = useThemeColors();

    const [wavesurfer, setWavesurfer] = useState<WaveSurfer|null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);

    const [pastTime, setPastTime] = useState(0);
    const [audio, setAudio] = useState({
        id: null,
        part: null,
        url: `http://localhost:54321/static/audio/sehaj_path_bhai_sarwan_singh_part1.mp3`,
    });

    const regionsPlugin = useMemo(
        () => RegionsPlugin.create(),
        []
    );

    const plugins = useMemo(() => {
        return [regionsPlugin];
    }, [regionsPlugin]);
        
    const onReady = (ws: WaveSurfer) => {
        fetchStartTime(ws);

        setWavesurfer(ws);
        setIsPlaying(false);
        ws.setPlaybackRate(0.95);
    }

     useEffect(() => {
        console.log(audio);
        if (audio.id && wavesurfer) {
            // wavesurfer.load(audio.url);
        }
    }, [audio.id]);

    const fetchStartTime = async (ws: WaveSurfer) => {
        const db = await DB.getSpeechInstance();

        const res: any = await db.select(`
            SELECT * FROM audio_sources
            WHERE status = 'Pending'    
        `);

        const fileName = res[0].file_name;
        const sourceId = res[0].id;
        const partId = res[0].current_part ?? null;

        setAudio({
            id: sourceId,
            part: partId,
            url: `http://localhost:54321/static/audio/${fileName}${partId}.mp3`,
        });

        db.select(`
            SELECT line_id, shabad_id, end_time, audio_source_part
            FROM audio_transcriptions
            WHERE id in (
                SELECT max(id)
                FROM audio_transcriptions
                WHERE audio_source_id = ${sourceId}
            ) and audio_source_id = ${sourceId}
        `).then(async (rows: any) => {
            if (rows[0]) {
                const db = await DB.getInstance();
                db.select(`
                    select * from lines
                    where order_id > (
                        select order_id FROM lines
                        WHERE id = '${rows[0]['line_id']}'
                    )
                    order by order_id
                    limit 1
                `).then((panktis: any) => {
                    if (!panktis[0]) {
                        return;
                    }

                    searchContext.dispatch({
                        type: SEARCH_SHABAD_PANKTI,
                        payload: { pankti: panktis[0] }
                    });
                });
            }
        });

        db.select(`
            SELECT line_id, shabad_id, end_time, audio_source_part
            FROM audio_transcriptions
            WHERE end_time in (
                SELECT max(end_time)
                FROM audio_transcriptions
                WHERE audio_source_id = ${sourceId}
                and audio_source_part = ${partId}
            ) and audio_source_id = ${sourceId}
             and audio_source_part = ${partId}
        `).then(async (rows: any) => {
            if (rows[0]) {
                const endTime = rows[0]['end_time'];
                ws.setTime(endTime);
                setPastTime(endTime);
            }
        });
    }

    const onPlayPause = async () => {
        wavesurfer && wavesurfer.playPause();
    };

    const setStart = async () => {
        setPastTime(currentTime);
    };

    const setPrev = async () => {
        const db = await DB.getSpeechInstance();
        await db.execute(`
            UPDATE audio_transcriptions
            SET end_time = ${currentTime}
            WHERE id IN (select max(id) FROM audio_transcriptions)
        `);
        setPastTime(currentTime);
        drawRegion(currentTime);
    }

    const recordEnd = async () => {
        recordTranscription(currentTime, true);
    };

    const drawRegion = (seektime: number) => {
        const duration = 0.02;
        regionsPlugin.addRegion({
            start: seektime,
            end: seektime + duration,
            color: "rgba(255, 255, 255, 0.9)",
            drag: true,
            resize: true
        });
    };

    const recordTranscription = async (seektime: number, forceRecord = false) => {
        if (!wavesurfer?.isPlaying() && !forceRecord) {
            return;
        }

        let pankti;
        if (forceRecord) {
            pankti = state.panktis[state.current];
        } else {
            pankti = (searchContext.state.previousSearchShabadPankti !== null && state.current === 0) ?
                searchContext.state.previousSearchShabadPankti :
                state.panktis[state.current-1];
        }

        if (!pankti?.gurmukhi) {
            console.log('Error: gurmukhi missing - ', searchContext.state.previousSearchShabadPankti);
            wavesurfer?.pause();
            return;
        }

        drawRegion(seektime);
        const data = {
            audio_source_id: 1,
            transcription: pankti.gurmukhi,
            start_time: pastTime,
            end_time: seektime,
            shabad_id: pankti.shabad_id,
            line_id: pankti.id,
            ang: pankti.source_page
        };

        setPastTime(seektime);

        const db = await DB.getSpeechInstance();
        await db.execute(`
            INSERT INTO audio_transcriptions (
                audio_source_id,
                audio_source_part,
                transcription,
                start_time,
                end_time,
                shabad_id,
                line_id,
                ang
            ) VALUES (
                ${data.audio_source_id},
                ${audio.part},
                '${data.transcription}',
                ${data.start_time},
                ${data.end_time},
                '${data.shabad_id}',
                '${data.line_id}',
                ${data.ang}
            )
        `);

        if (forceRecord) {
            const lineId = state.panktis[state.current].id;
            const db = await DB.getInstance();
            db.select(`
                select * from lines
                where order_id > (
                    select order_id FROM lines
                    WHERE id = '${lineId}'
                )
                order by order_id
                limit 1
            `).then((panktis: any) => {
                if (!panktis[0]) {
                    return;
                }

                searchContext.dispatch({
                    type: SEARCH_SHABAD_PANKTI,
                    payload: { pankti: panktis[0] }
                });
            });

            searchContext.dispatch({
                type: SEARCH_SHABAD_PANKTI,
                payload: { pankti: state.panktis[state.current+1] }
            });
        }
    };

    useEffect(() => {
        const sendDataToBackend = async () => {
            if (state.current < 0) return;

            await updateServerPankti(state.panktis[state.current]);  // Call the utility function
        };

        sendDataToBackend();
    }, [state.panktis, state.current]);

    useEffect(() => {
        const loadShabad = async () => {
            if (appState.page !== PAGE_SHABAD ||
                searchContext.state.searchShabadPankti == null ||
                searchContext.state.searchShabadPankti.shabad_id == null
            ) {
                return;
            }

            const searchPankti: Pankti = searchContext.state.searchShabadPankti;

            const instance = await DB.getInstance();
            instance.select(`
                SELECT
                    lines.*,
                    punjabi.translation as punjabi_translation,
                    english.translation as english_translation
                FROM lines
                INNER JOIN shabads ON lines.shabad_id = shabads.id
                LEFT JOIN translations AS punjabi ON lines.id = punjabi.line_id AND (
                    (shabads.source_id = 1 AND punjabi.translation_source_id = 6) OR
                    (shabads.source_id != 1 AND punjabi.translation_source_id IN (8, 11, 13, 15, 17, 19, 21))
                )
                LEFT JOIN translations AS english ON lines.id = english.line_id AND (
                    (shabads.source_id = 1 AND english.translation_source_id = 1) OR
                    (shabads.source_id != 1 AND english.translation_source_id IN (7, 9, 10, 12, 14, 16, 18, 20, 22))
                )
                WHERE shabad_id = '${searchPankti.shabad_id}'
            `).then((panktis: any) => {
                if (! panktis) {
                    return;
                }

                const current = panktis.findIndex(
                    (pankti: Pankti) => pankti.id === searchPankti.id
                );

                searchContext.dispatch({
                    type: RECENT_SEARCH_UPDATE,
                    payload: {
                        shabadId: searchPankti.shabad_id,
                        pankti: panktis[current],
                        panktis: panktis,
                        home: current,
                        current: current
                    }
                });

                dispatch({
                    type: SHABAD_UPDATE,
                    payload: {
                        shabadId: searchPankti.shabad_id,
                        panktis: panktis,
                        current: current,
                    }
                });
            });
        };

        loadShabad();
    }, [searchContext.state.searchShabadPankti]);

    const nextPankti = state.panktis[current+1]?.gurmukhi;

    useEffect(() => {
        const resizeFontToFit = () => {
            const element = nextPanktiRef.current;
            if (!element) return;

            const containerWidth = element.parentElement?.clientWidth || 0;
            let currentFontSize = fontSizes["Next Pankti"];
            const minFontSize = 10;
            element.style.overflow = 'hidden';
            element.style.fontSize = `${currentFontSize}px`;

            while (element.scrollWidth > containerWidth && currentFontSize > minFontSize) {
                currentFontSize -= 1;
                element.style.fontSize = `${currentFontSize}px`;
            }

            element.style.overflow = 'visible';
            setNextPanktiFontSize(currentFontSize);
        };

        if (nextPankti) {
            resizeFontToFit();
        }
    }, [nextPankti, fontSizes]);

    useEffect(() => {
        if (state.baniId !== null) {
            return;
        }

        searchContext.dispatch({
            type: RECENT_VISITED_UPDATE,
            payload: {
                // baniId: state?.baniId,
                shabadId: state.shabadId,
                panktis: state.panktis,
                current: state.current,
                home: state.home,
            }
        });

        const run = async () => {

            if (wavesurfer?.isPlaying()) {
                wavesurfer.pause();
                const seekTime = seekToNearestSilence(wavesurfer);

                if (seekTime !== undefined) {
                    wavesurfer.play();
                    recordTranscription(seekTime);
                }
            }
        }
        run();
    }, [state.current, state.shabadId, state.baniId, state.home]);

    useEffect(() => {
        if (state.baniId === null) {
            return;
        }

        if (baniContext.state.banis.findIndex(r => r.baniId === state.baniId) < 0) {
            return;
        }

        baniContext.dispatch({
            type: BANI_ACTION_UPDATE,
            payload: {
                baniId: state.baniId,
                panktis: state.panktis,
                current: state.current,
                home: state.home,
            }
        });
    }, [state.baniId, state.current]);

    if (current < 0) {
        return null;
    }

    return (
        <Panel
            className="w-screen flex flex-col justify-between overflow-hidden"
            startSpace={displaySpacing.startSpace}
            endSpace={displaySpacing.endSpace}
            leftSpace={displaySpacing.leftSpace}
            rightSpace={displaySpacing.rightSpace}
            // style={palette.background}
            style={{backgroundColor: activeThemeName === "Bandi Chorh Diwas" ?  "rgb(200 200 200 / 80%)": "rgb(200 200 200 / 20%); margin-bottom: 40px;"}}
        >
            <div className={`flex-1 flex flex-col items-start w-full ${activeThemeName === "Bandi Chorh Diwas" ? 'justify-between' : 'justify-start'}`}>
                <div className="flex flex-row w-full justify-center">
                    <FormatAndBreakText
                        containerClassName="text-center"
                        containerStyle={{
                            color: palette.gurmukhi,
                            fontSize: fontSizes["ਗੁਰਮੁਖੀ"] + "px",
                            lineHeight: 1.3,
                            fontFamily: "Open Gurbani Akhar",
                            fontWeight: 900
                        }}
                        text={state.panktis[current]?.gurmukhi || ""}
                    />
                </div>
                
                <div className="flex flex-col w-full items-center">
                    { visibility.ਪੰਜਾਬੀ &&
                        <Punjabi
                            className="text-center"
                            fontSize={fontSizes["ਪੰਜਾਬੀ"]}
                            contentSpace={displaySpacing.gurmukhiSpace}
                            style={{ color: palette.punjabi }}
                        >
                            { state.panktis[current]?.punjabi_translation }
                        </Punjabi>
                    }
                    {
                        visibility.English &&
                        <English
                            className="text-center"
                            fontSize={fontSizes["English"]}
                            contentSpace={displaySpacing.translationSpace}
                            style={{ color: palette.english }}
                        >
                            { state.panktis[current]?.english_translation }
                        </English>
                    }
                </div>
            </div>
            {
                visibility["Next Pankti"] &&
                nextPankti &&
                <NextPanktiGurmukhi
                    ref={nextPanktiRef}
                    className="gurmukhi-font-2 text-center"
                    fontSize={nextPanktiFontSize}
                    endSpace={displaySpacing.endSpace}
                    leftSpace={displaySpacing.leftSpace}
                    style={{ color: palette.gurmukhi }}
                >
                    { Format.removeVishraams(nextPankti) }
                </NextPanktiGurmukhi>
            }

            <div style={{width: '100%', height: '20px'}} />
            <WavesurferPlayer
                // backend="MediaElement"
                minPxPerSec={120}
                height={250}
                waveColor="violet"
                url={audio.url}
                onReady={onReady}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onTimeupdate={(wavesurfer: WaveSurfer) => {
                    setCurrentTime(wavesurfer.getCurrentTime())
                }}
                plugins={plugins}
            />

            <div style={{textAlign: 'center'}}>
                <button onClick={setStart} style={{color: 'white', marginRight: '100px'}}>
                    Set Start {pastTime}
                </button>
                <button onClick={setPrev} style={{marginRight: '100px', color: 'white'}}>
                    Redo Prev
                </button>

                <button onClick={onPlayPause} style={{marginRight: '100px', color: 'white'}}>
                    {isPlaying ? 'Pause' : 'Play'}
                </button>
            
                <button onClick={recordEnd} style={{marginLeft: '100px', color: 'white'}}>
                    Record End
                </button>

                <div style={{float: 'right', color: 'white'}}>/ {((wavesurfer?.getDuration() ?? 0) / 60).toFixed(1)}</div>
                <div style={{float: 'right', color: 'white'}}>{(currentTime / 60).toFixed(2)}&nbsp;</div>
            </div>

            <div style={{color: 'white'}}>Ang: {state.panktis[current]?.source_page}</div>
            <div style={{color: 'white'}}>Time: {currentTime.toFixed(1)}</div>
        </Panel>
    );
};

export default ShabadDisplay;
