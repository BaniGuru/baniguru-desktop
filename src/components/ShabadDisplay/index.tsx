import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { RecentShabad, SearchContext } from "../../state/providers/SearchProvider";
import Format from "../../utils/Format";
import { DB } from "../../utils/DB";
import styled from "styled-components";
import { Pankti } from "../../models/Pankti";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { RECENT_SEARCH_UPDATE, RECENT_VISITED_UPDATE, SHABAD_UPDATE } from "../../state/ActionTypes";
import { useSettings } from "../../state/providers/SettingContext";
import { updateServerPankti } from "../../utils/TauriCommands";
import FormatAndBreakText from "../../ui/FormatAndBreakText";
import { AppContext, PAGE_ANNOUNCEMENT, PAGE_SHABAD } from "../../state/providers/AppProvider";
import { BANI_ACTION_UPDATE, BaniContext } from "../../state/providers/BaniProvider";
import { useThemeColors } from "../../utils/useTheme";
import { formatPanktis, getShabadIds } from "../../utils/shabadUtil";
import { useContext as useCtxSelector } from "use-context-selector";
import useFitTextToTwoLines from "../../utils/useFitTextToTwoLines";

interface PanelProps {
    fontSize: number;
}

const Panel = styled.div<PanelProps>`
    padding-top: ${({ fontSize }) => `${fontSize}px`};
    padding-left: ${() => `${window.innerWidth * 0.03}px`};
    padding-right: ${() => `${window.innerWidth * 0.03}px`};
`;

interface FontProps {
    fontSize: number;
}

interface NextPanktiProps {
    fontSize: number;
}

const NextPanktiGurmukhi = styled.div<NextPanktiProps>`
    font-size: ${({ fontSize }) => `${fontSize}px`};
    line-height: 1.2;
    margin-bottom: ${({ fontSize }) => `${fontSize * 0.5}px`};
    font-family: "Open Gurbani Akhar";
    font-weight: 900;
    padding-left: ${() => `${window.innerWidth * 0.03}px`};
    padding-right: ${() => `${window.innerWidth * 0.03}px`};

    white-space: nowrap;
`;

const Punjabi = styled.div<FontProps>`
    font-size: ${({ fontSize }) => `${fontSize}px`};
    line-height: 1.4;
    font-family: "Open Anmol Uni", sans-serif;
    font-weight: 900;
    display: block;
    text-align: center;
`;

const English = styled.div<FontProps>`
    font-size: ${({ fontSize }) => `${fontSize}px`};
    line-height: 1.3;
    margin-top: ${({ fontSize }) => `${fontSize*0.5}px`};
    font-family: "Noto Sans", sans-serif;
    font-weight: 700;
    display: block;
    text-align: center;
`;

const ShabadDisplay: React.FC = () => {
    const searchContext = useContext(SearchContext);
    const baniContext = useContext(BaniContext);
    const {state, dispatch } = useCtxSelector(ShabadContext);
    const {state: appState, fontSize} = useContext(AppContext);
    const { activeThemeName, visibility } = useSettings();
    const current = state.current;

    const mainRef = useRef<HTMLDivElement>(null); 
    const topRef = useRef<HTMLDivElement>(null);
    const middleRef = useRef<HTMLDivElement>(null);
    const [middleGap, setMiddleGap] = useState(0);

    const nextPanktiRef = useRef<HTMLDivElement>(null);
    const [nextPanktiFontSize, setNextPanktiFontSize] = useState(fontSize);
    const { palette } = useThemeColors();

    const punjabiRef = useRef<HTMLDivElement>(null);
    const { fontSize: punjabiFontSize, isClamped: punjabiClamped } = useFitTextToTwoLines(
        punjabiRef,
        state.panktis[current]?.punjabi_translation ?? '',
        fontSize * 0.5,
        3
    );

    const englishRef = useRef<HTMLDivElement>(null);
    const { fontSize: englishFontSize, isClamped: englishClamped } = useFitTextToTwoLines(
        englishRef,
        state.panktis[current]?.english_translation ?? '',
        fontSize * 0.45,
    );

    useLayoutEffect(() => {
        const main = mainRef.current;
        const top = topRef.current;
        const middle = middleRef.current;

        if (!main || !top || !middle) return;

        const calculateGap = () => {
            const mainRect = main.getBoundingClientRect();
            const topRect = top.getBoundingClientRect();
            const middleRect = middle.getBoundingClientRect();

            const bottomGap = mainRect.bottom - middleRect.bottom;
            const topGap = middleRect.top - topRect.bottom;

            let gap = fontSize;
            if (bottomGap < fontSize) {
                gap = (topGap + bottomGap) / 2;
            }

            setMiddleGap(gap);
        };

        const observer = new ResizeObserver(() => {
            calculateGap();
        });

        observer.observe(main);
        observer.observe(top);
        observer.observe(middle);

        // Initial run
        calculateGap();

        return () => observer.disconnect();
    }, [fontSize, state.current]);

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
                searchContext.state.searchShabadPankti.shabad_id == null ||
                (state.baniId ?? 0) > 0
            ) {
                return;
            }

            const searchPankti: Pankti = searchContext.state.searchShabadPankti;

            // load recent shabad if exists
            const shabadId = searchPankti.shabad_id;
            const recentIndex = searchContext.state.recent.findIndex(r => r.shabadId === shabadId);
            if (recentIndex >= 0) {                
                const recentShabad: RecentShabad = searchContext.state.recent[recentIndex];
                const current = recentShabad.panktis.findIndex(
                    (pankti: Pankti) => pankti.id === searchPankti.id
                );
                recentShabad.panktis[current].visited = true;

                dispatch({
                    type: SHABAD_UPDATE,
                    payload: {
                        shabadId: recentShabad.shabadId,
                        panktis: recentShabad.panktis,
                        home: recentShabad.home,
                        current: current,
                    }
                });
                return;
            }

            const instance = await DB.getInstance();
            instance.select(`
                SELECT
                    lines.*,
                    panktis.gurmukhi_speech,
                    panktis.vishraam_idx,
                    panktis.vishraam_ridx,
                    panktis.gurmukhi_words,
                    panktis.gurmukhi_rwords,
                    punjabi.translation as punjabi_translation,
                    english.translation as english_translation,
                    -1 as line_group
                FROM lines
                INNER JOIN panktis ON lines.id = panktis.id
                INNER JOIN shabads ON lines.shabad_id = shabads.id
                LEFT JOIN translations AS punjabi ON lines.id = punjabi.line_id AND (
                    (shabads.source_id = 1 AND punjabi.translation_source_id = 6) OR
                    (shabads.source_id != 1 AND punjabi.translation_source_id IN (8, 11, 13, 15, 17, 19, 21))
                )
                LEFT JOIN translations AS english ON lines.id = english.line_id AND (
                    (shabads.source_id = 1 AND english.translation_source_id = 1) OR
                    (shabads.source_id != 1 AND english.translation_source_id IN (7, 9, 10, 12, 14, 16, 18, 20, 22))
                )
                WHERE lines.shabad_id = '${searchPankti.shabad_id}'
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
                        panktis: formatPanktis(panktis),
                        shabadIds: getShabadIds(panktis),
                        home: current,
                        current: current
                    }
                });

                dispatch({
                    type: SHABAD_UPDATE,
                    payload: {
                        shabadId: searchPankti.shabad_id,
                        panktis: formatPanktis(panktis),
                        shabadIds: getShabadIds(panktis),
                        current: current,
                    }
                });
            });
        };

        loadShabad();
    }, [searchContext.state.searchShabadPankti, state.baniId, dispatch, searchContext.dispatch]);

    const nextPankti = state.panktis[current+1]?.gurmukhi;

    useEffect(() => {
        const resizeFontToFit = () => {
            const element = nextPanktiRef.current;
            if (!element) return;

            const containerWidth = element.parentElement?.clientWidth || 0;
            let currentFontSize = fontSize*0.8;
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
    }, [nextPankti, fontSize]);

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
            fontSize={fontSize}
            className="w-screen h-screen flex flex-col overflow-hidden"
            // style={palette.background}
            style={{
                visibility: (appState.page === PAGE_ANNOUNCEMENT ? 'hidden' : 'visible'),
                backgroundColor: activeThemeName === "Bandi Chorh Diwas" ?  "rgb(200 200 200 / 80%)": "rgb(200 200 200 / 20%)"}}
        >
            <div
                ref={mainRef}
                className={`flex-1 flex flex-col items-start w-full ${activeThemeName === "Bandi Chorh Diwas" ? 'justify-between' : 'justify-start'}`}
            >
                <div ref={topRef} className="flex w-full justify-center">
                    <div className="w-full" style={{marginBottom: `-${fontSize*0.2}px`}}>
                        <FormatAndBreakText
                            key={state.panktis[current]?.gurmukhi || ""}
                            containerClassName="text-center"
                            containerStyle={{
                                color: palette.gurmukhi,
                                fontSize: fontSize + "px",
                                lineHeight: 1.25,
                                fontFamily: "Open Gurbani Akhar",
                                fontWeight: 900
                            }}
                            text={state.panktis[current]?.gurmukhi || ""}
                        />
                    </div>
                </div>

                <div
                    ref={middleRef}
                    className="flex flex-col w-full items-center"
                    style={{ marginTop: middleGap}}
                >
                    { visibility.ਪੰਜਾਬੀ && state.panktis[current]?.punjabi_translation &&
                        <Punjabi
                            key={state.panktis[current]?.punjabi_translation}
                            ref={punjabiRef}
                            fontSize={punjabiFontSize}
                            style={{
                                color: palette.punjabi,
                                display: punjabiClamped ? "-webkit-box" : "block",
                                WebkitLineClamp: punjabiClamped ? 3 : "unset",
                                WebkitBoxOrient: punjabiClamped ? "vertical" : "unset",
                                overflow: punjabiClamped ? "hidden" : "visible",
                                textOverflow: "ellipsis"
                            }}
                        >
                            { state.panktis[current]?.punjabi_translation }
                        </Punjabi>
                    }
                    {
                        visibility.English && state.panktis[current]?.english_translation &&
                        <English
                            key={state.panktis[current]?.english_translation}
                            ref={englishRef}
                            fontSize={englishFontSize}
                            style={{
                                color: palette.english,
                                display: englishClamped ? "-webkit-box" : "block",
                                WebkitLineClamp: englishClamped ? 2 : "unset",
                                WebkitBoxOrient: englishClamped ? "vertical" : "unset",
                                overflow: englishClamped ? "hidden" : "visible",
                                textOverflow: "ellipsis"
                            }}
                        >
                            { state.panktis[current]?.english_translation }
                        </English>
                    }
                </div>
            </div>
            <div className="flex flex-col w-full items-center">
            {
                visibility["Next Pankti"] &&
                nextPankti &&
                <NextPanktiGurmukhi
                    ref={nextPanktiRef}
                    className="gurmukhi-font-2 text-center"
                    fontSize={nextPanktiFontSize}
                    style={{ color: palette.gurmukhi }}
                >
                    { Format.removeVishraams(nextPankti) }
                </NextPanktiGurmukhi>
            }
            </div>
        </Panel>
    );
};

export default ShabadDisplay;
