import { useContext, useEffect, useRef, useState } from "react";
import { SearchContext } from "../../state/providers/SearchProvider";
import Format from "../../utils/Format";
import { DB } from "../../utils/DB";
import styled from "styled-components";
import { Pankti } from "../../models/Pankti";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { SHABAD_UPDATE } from "../../state/ActionTypes";
import { useSettings } from "../../state/providers/SettingContext";
import { updateServerPankti } from "../../utils/TauriCommands";
import FormatAndBreakText from "../../ui/FormatAndBreakText";
import { AppContext, PAGE_SHABAD } from "../../state/providers/AppProvider";

interface PanelProps {
    startSpace: number;
    endSpace: number;
    leftSpace: number;
}

const Panel = styled.div<PanelProps>`
    padding-top: ${({ startSpace }) => `${startSpace}px`};
    padding-left: ${({ leftSpace }) => `${leftSpace}px`};
    padding-right: ${({ leftSpace }) => `${leftSpace}px`};
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
    const searchState = useContext(SearchContext).state;
    const {state, dispatch } = useContext(ShabadContext);
    const {state: appState} = useContext(AppContext);
    const { fontSizes, displaySpacing } = useSettings();
    const current = state.current;

    const nextPanktiRef = useRef<HTMLDivElement>(null);
    const [nextPanktiFontSize, setNextPanktiFontSize] = useState(fontSizes["Next Pankti"]);

    useEffect(() => {
        const sendDataToBackend = async () => {
            if (state.current < 0) return;

            await updateServerPankti(state.panktis[state.current]);  // Call the utility function
        };

        sendDataToBackend();
    }, [state.panktis, state.current]);

    useEffect(() => {
        const loadShabad = async () => {
            if (searchState.searchShabadPankti == null || appState.page !== PAGE_SHABAD) {
                return;
            }

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
                WHERE shabad_id = '${searchState.searchShabadPankti.shabad_id}'
            `).then((panktis: any) => {
                if (! panktis) {
                    return;
                }

                const current = panktis.findIndex(
                    (pankti: Pankti) => pankti.id === searchState.searchShabadPankti?.id
                );

                dispatch({
                    type: SHABAD_UPDATE,
                    payload: {
                        panktis: panktis,
                        current: current,
                    }
                });
            });
        };

        loadShabad();
    }, [searchState]);

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

    if (current < 0) {
        return null;
    }

    // const vishraamStyles = {
    //     heavy: {
    //         color: '#e56c00',
    //     },
    //     medium: {
    //         color: '#01579b',
    //     },
    //     light: {
    //         color: '#01579b',
    //     },
    // };

    return (
        <Panel
            className="w-screen h-screen flex flex-col justify-between overflow-hidden"
            startSpace={displaySpacing.startSpace}
            endSpace={displaySpacing.endSpace}
            leftSpace={displaySpacing.leftSpace}
        >
            <div className="flex-1 flex flex-col items-center w-full">
                <div className="flex flex-row w-full justify-center">
                    <FormatAndBreakText
                        containerClassName="text-black text-center"
                        containerStyle={{
                            fontSize: fontSizes["ਗੁਰਮੁਖੀ"] + "px",
                            lineHeight: 1.3,
                            fontFamily: "Open Gurbani Akhar",
                            fontWeight: 900
                        }}
                        text={state.panktis[current]?.gurmukhi || ""}
                    />
                </div>
                
                <Punjabi
                    className="text-center text-gray-900"
                    fontSize={fontSizes["ਪੰਜਾਬੀ"]}
                    contentSpace={displaySpacing.gurmukhiSpace}
                >
                    { state.panktis[current]?.punjabi_translation }
                </Punjabi>
                <English
                    className="text-center text-gray-900"
                    fontSize={fontSizes["English"]}
                    contentSpace={displaySpacing.translationSpace}
                >
                    { state.panktis[current]?.english_translation }
                </English>
            </div>
            {
                nextPankti &&
                <NextPanktiGurmukhi
                    ref={nextPanktiRef}
                    className="gurmukhi-font-2 text-center text-gray-500"
                    fontSize={nextPanktiFontSize}
                    endSpace={displaySpacing.endSpace}
                    leftSpace={displaySpacing.leftSpace}
                >
                    { Format.removeVishraams(nextPankti) }
                </NextPanktiGurmukhi>
            }
        </Panel>
    );
};

export default ShabadDisplay;
