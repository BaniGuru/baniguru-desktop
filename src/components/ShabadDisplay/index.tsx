import { useContext, useEffect, useRef, useState } from "react";
import { SearchContext } from "../../state/providers/SearchProvider";
import Format from "../../utils/Format";
import { DB } from "../../utils/DB";
import styled from "styled-components";
import { Pankti } from "../../models/Pankti";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { RECENT_SEARCH_UPDATE, RECENT_VISITED_UPDATE, SHABAD_UPDATE } from "../../state/ActionTypes";
import { useSettings } from "../../state/providers/SettingContext";
import { updateServerPankti } from "../../utils/TauriCommands";
import FormatAndBreakText from "../../ui/FormatAndBreakText";
import { AppContext, PAGE_SHABAD } from "../../state/providers/AppProvider";
import { BANI_ACTION_UPDATE, BaniContext } from "../../state/providers/BaniProvider";
import { useThemeColors } from "../../utils/useTheme";

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
            className="w-screen h-screen flex flex-col justify-between overflow-hidden"
            startSpace={displaySpacing.startSpace}
            endSpace={displaySpacing.endSpace}
            leftSpace={displaySpacing.leftSpace}
            rightSpace={displaySpacing.rightSpace}
            // style={palette.background}
            style={{backgroundColor: activeThemeName === "Bandi Chorh Diwas" ?  "rgb(200 200 200 / 80%)": "rgb(200 200 200 / 20%)"}}
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
        </Panel>
    );
};

export default ShabadDisplay;
