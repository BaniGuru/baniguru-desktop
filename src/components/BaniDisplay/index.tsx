import { useContext, useEffect, useMemo, useRef, useState } from "react";
import Format from "../../utils/Format";
import styled from "styled-components";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { useSettings } from "../../state/providers/SettingContext";
import { updateServerPankti } from "../../utils/TauriCommands";
import FormatAndBreakText from "../../ui/FormatAndBreakText";
import { BANI_ACTION_UPDATE, BaniContext } from "../../state/providers/BaniProvider";
import { useThemeColors } from "../../utils/useTheme";
import { useContext as useCtxSelector } from "use-context-selector";

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
    margin-top: ${({ contentSpace }) => `${contentSpace}px`};
    display: flex;
    font-family: "Open Anmol Uni", sans-serif;
    font-weight: 900;
`;

const English = styled.div<FontProps>`
    font-size: ${({ fontSize }) => `${fontSize}px`};
    margin-top: ${({ contentSpace }) => `${contentSpace}px`};
    padding-left: 40px;
    padding-right: 40px;
    font-family: "Noto Sans", sans-serif;
    font-weight: 700;
`;

const BaniDisplay: React.FC = () => {
    const baniContext = useContext(BaniContext);
    const { state } = useCtxSelector(ShabadContext);
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

    const showGroup = state.panktis[state.current]?.show_group;
    let groupPanktis = useMemo(() => {
        return state.panktis.filter(p => p.show_group === showGroup);
    }, [showGroup]);

    let nextPankti = state.panktis[current + 1]?.gurmukhi;
    if (groupPanktis.length > 1) {
        const nextGroupPanktis = state.panktis.filter(p => p.show_group === (showGroup + 1));
        nextPankti = nextGroupPanktis[0]?.gurmukhi;
    }

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

    const containerRef = useRef(null);
    const contentRef = useRef(null);
    const baseFontSize = fontSizes["ਗੁਰਮੁਖੀ"];
    const [fontSize, setFontSize] = useState(baseFontSize);

    useEffect(() => {

        const fitText = () => {
            const container: any = containerRef.current;
            const content: any = contentRef.current;

            if (!container || !content) return;

            const targetHeight = container.clientHeight * 0.7;

            let min = 20;
            let max = baseFontSize;
            let best = max;

            while (min <= max) {

                const mid = Math.floor((min + max) / 2);

                content.querySelectorAll(".gurmukhi-line").forEach((el: HTMLElement) => {
                    (el as HTMLElement).style.fontSize = mid + "px";
                });

                content.querySelectorAll(".translation-line").forEach((el: HTMLElement) => {
                    (el as HTMLElement).style.fontSize = mid * 0.45 + "px";
                });

                const heightFits = content.scrollHeight <= targetHeight;

                // check if any pangti wrapped
                let singleLine = true;

                content.querySelectorAll(".gurmukhi-line").forEach((el: HTMLElement) => {
                    const e = el as HTMLElement;
                    if (e.scrollWidth > e.clientWidth) {
                        singleLine = false;
                    }
                });

                if (heightFits && singleLine) {
                    best = mid;
                    min = mid + 1;
                } else {
                    max = mid - 1;
                }
            }

            setFontSize(best);
        };

        const observer = new ResizeObserver(() => {
            requestAnimationFrame(fitText);
        });

        if (containerRef.current) observer.observe(containerRef.current);

        requestAnimationFrame(fitText);

        return () => observer.disconnect();

    }, [groupPanktis, baseFontSize]);

    let currentIdx = state.current;
    if (groupPanktis.length > 1 && state.panktis[currentIdx].type_id <= 2) {
        currentIdx++;
    }

    const currentPankti = useMemo(() => {
        return state.panktis[currentIdx];
    }, [currentIdx, state.panktis]);

    if (current < 0) {
        return null;
    }

    const cleanWord = (word: string) => {
        return word.replace(/[;,.]+/g, "");
    }

    if ((groupPanktis.length > 1 &&
        (groupPanktis[0].type_id > 2 || groupPanktis[1]?.type_id <= 2)
    ) ||
        groupPanktis.length > 2
    ) {
        if (groupPanktis[0].type_id === 2 && groupPanktis[1].type_id > 2) {
            groupPanktis = groupPanktis.slice(1);
        }

        const processedPanktis = [];

        for (let i = 0; i < groupPanktis.length; i++) {
            const current = groupPanktis[i];

            if (current.join_next && groupPanktis[i + 1]) {
                const next = groupPanktis[i + 1];

                processedPanktis.push({
                    ...current,
                    gurmukhi: current.gurmukhi + " " + next.gurmukhi,
                    punjabi_translation:
                        (current.punjabi_translation || "") +
                        " " +
                        (next.punjabi_translation || ""),
                    english_translation:
                        (current.english_translation || "") +
                        " " +
                        (next.english_translation || ""),
                });

                i++; // skip next pankti
            } else {
                processedPanktis.push(current);
            }
        }

        return (
            <Panel
                ref={containerRef}
                className="w-screen h-screen flex flex-col justify-between overflow-hidden"
                startSpace={0}
                endSpace={displaySpacing.endSpace}
                leftSpace={displaySpacing.leftSpace}
                rightSpace={displaySpacing.rightSpace}
                style={{ backgroundColor: "rgb(200 200 200 / 20%)", paddingTop: '3rem' }}
            >
                <div
                    ref={contentRef}
                    className="flex flex-col w-full justify-center"
                >
                    {processedPanktis.map((pankti, index) => (
                        <div key={index} className="flex flex-col w-full justify-center">

                            <div
                                className="gurmukhi-line flex flex-row justify-center"
                                style={{
                                    whiteSpace: "nowrap",
                                    color: palette.gurmukhi,
                                    fontSize: fontSize + "px",
                                    fontFamily: "Open Gurbani Akhar",
                                    fontWeight: 900,
                                    letterSpacing: '-' + (fontSize * 0.02) + 'px',
                                    marginBottom: (fontSize * 0.01) + 'px',
                                }}
                            >
                                {cleanWord(pankti.gurmukhi)}
                            </div>

                            {pankti.show_translation && (
                                <>
                                    <Punjabi
                                        className="translation-line text-center flex-row justify-center"
                                        fontSize={fontSize * 0.5}
                                        contentSpace={0}
                                        style={{
                                            color: palette.punjabi,
                                        }}
                                    >
                                        {pankti?.punjabi_translation}
                                    </Punjabi>
                                    <English
                                        className="text-center"
                                        fontSize={fontSize * 0.4}
                                        contentSpace={0}
                                        style={{
                                            color: palette.english,
                                            marginBottom: (fontSize * 0.45) + 'px',
                                        }}
                                    >
                                        {pankti?.english_translation}
                                    </English>
                                </>
                            )}

                        </div>
                    ))}
                </div>
                {
                    visibility["Next Pankti"] &&
                    nextPankti &&
                    <NextPanktiGurmukhi
                        ref={nextPanktiRef}
                        className="gurmukhi-font-2 text-center"
                        fontSize={fontSize}
                        endSpace={displaySpacing.endSpace}
                        leftSpace={displaySpacing.leftSpace}
                        style={{ color: palette.gurmukhi, fontSize: (fontSize) + 'px' }}
                    >
                        {Format.removeVishraams(nextPankti)}
                    </NextPanktiGurmukhi>
                }
            </Panel>
        );
    }

    return (
        <Panel
            className="w-screen h-screen flex flex-col justify-between overflow-hidden"
            startSpace={displaySpacing.startSpace}
            endSpace={displaySpacing.endSpace}
            leftSpace={displaySpacing.leftSpace}
            rightSpace={displaySpacing.rightSpace}
            // style={palette.background}
            style={{ backgroundColor: activeThemeName === "Bandi Chorh Diwas" ? "rgb(200 200 200 / 80%)" : "rgb(200 200 200 / 20%)" }}
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
                        text={ currentPankti?.gurmukhi || ""}
                    />
                </div>

                <div className="flex flex-col w-full items-center">
                    {visibility.ਪੰਜਾਬੀ &&
                        <Punjabi
                            className="text-center"
                            fontSize={fontSizes["ਪੰਜਾਬੀ"]}
                            contentSpace={displaySpacing.gurmukhiSpace}
                            style={{ color: palette.punjabi }}
                        >
                            { currentPankti?.punjabi_translation }
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
                            { currentPankti?.english_translation }
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
                    {Format.removeVishraams(nextPankti)}
                </NextPanktiGurmukhi>
            }
        </Panel>
    );
};

export default BaniDisplay;
