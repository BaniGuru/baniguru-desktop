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
import { AppContext } from "../../state/providers/AppProvider";
import useFitTextToTwoLines from "../../utils/useFitTextToTwoLines";
import useFitTextStable from "../../utils/useFitTextStable";

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
    const { activeThemeName, visibility } = useSettings();
    const { fontSize: appFontSize } = useContext(AppContext);
    const current = state.current;

    const nextPanktiRef = useRef<HTMLDivElement>(null);
    const [nextPanktiFontSize, setNextPanktiFontSize] = useState(appFontSize);
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
            let currentFontSize = appFontSize;
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
    }, [nextPankti, appFontSize]);

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
    const punjabiRef = useRef<HTMLDivElement>(null);
    const { fontSize: punjabiFontSize, isClamped: punjabiClamped } = useFitTextToTwoLines(
        punjabiRef,
        state.panktis[current]?.punjabi_translation ?? '',
        appFontSize * 0.5,
    );

    const englishRef = useRef<HTMLDivElement>(null);
    const { fontSize: englishFontSize, isClamped: englishClamped } = useFitTextToTwoLines(
        englishRef,
        state.panktis[current]?.english_translation ?? '',
        appFontSize * 0.45,
    );

    const fontSize = useFitTextStable(
        containerRef,
        contentRef,
        [groupPanktis, appFontSize],
        {
            maxFontSize: appFontSize,
            minFontSize: 20,
            nextRef: nextPanktiRef,
        }
    );

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
            <div
                ref={containerRef}
                className="w-screen h-screen flex flex-col justify-between overflow-hidden"
                style={{ backgroundColor: "rgb(200 200 200 / 20%)",
                    paddingLeft: (appFontSize * 0.5) + 'px',
                    paddingRight: (appFontSize * 0.5) + 'px',
                    height: window.innerHeight
                }}
            >
                <div
                    ref={contentRef}
                    className="flex flex-col w-full justify-top"
                    style={{
                        height: `${window.innerHeight - appFontSize}px`,
                        overflow: 'hidden',
                        marginTop: `${appFontSize*0.6}px`,
                    }}
                >
                    {processedPanktis.map((pankti) => (
                        <div key={pankti.id} className="flex flex-col w-full justify-center">
                            <div
                                className="gurmukhi-line flex flex-row justify-center"
                                style={{
                                    whiteSpace: "nowrap",
                                    color: palette.gurmukhi,
                                    fontSize: fontSize + "px",
                                    fontFamily: "Open Gurbani Akhar",
                                    fontWeight: 900,
                                    lineHeight: 1,
                                }}
                            >
                                {cleanWord(pankti.gurmukhi)}
                            </div>

                            {pankti.show_translation && (
                                <>
                                    <Punjabi
                                        className="translation-line text-center flex-row justify-center"
                                        fontSize={punjabiFontSize}
                                        contentSpace={fontSize * 0}
                                        style={{
                                            color: palette.punjabi,
                                            display: "-webkit-box",
                                            WebkitLineClamp: 2,
                                            WebkitBoxOrient: "vertical",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis"
                                        }}
                                    >
                                        {pankti?.punjabi_translation}
                                    </Punjabi>
                                    <English
                                        className="translation-line text-center"
                                        fontSize={englishFontSize}
                                        contentSpace={fontSize * 0}
                                        style={{
                                            color: palette.english,
                                            display: "-webkit-box",
                                            WebkitLineClamp: 2,
                                            WebkitBoxOrient: "vertical",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis"
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
                        endSpace={appFontSize * 0.2}
                        leftSpace={appFontSize * 0}
                        style={{ color: palette.gurmukhi }}
                    >
                        {Format.removeVishraams(nextPankti)}
                    </NextPanktiGurmukhi>
                }
            </div>
        );
    }

    return (
        <div
            className="w-screen h-screen flex flex-col justify-between overflow-hidden"
            style={{ 
                backgroundColor: activeThemeName === "Bandi Chorh Diwas" ? "rgb(200 200 200 / 80%)" : "rgb(200 200 200 / 20%)",
            }}
        >
            <div className={`flex-1 flex flex-col items-start w-full ${activeThemeName === "Bandi Chorh Diwas" ? 'justify-between' : 'justify-start'}`}>
                <div className="flex flex-row w-full justify-center">
                    <div className="w-full">
                        <FormatAndBreakText
                            key={ currentPankti?.gurmukhi || ""}
                            containerClassName="text-center"
                            containerStyle={{
                                color: palette.gurmukhi,
                                fontSize: appFontSize + "px",
                                lineHeight: 1.3,
                                fontFamily: "Open Gurbani Akhar",
                                fontWeight: 900,
                                marginTop: fontSize,
                            }}
                            text={ currentPankti?.gurmukhi || ""}
                        />
                    </div>
                </div>

                <div className="flex flex-col w-full items-center">
                    {visibility.ਪੰਜਾਬੀ &&
                        <Punjabi
                            className="text-center"
                            ref={punjabiRef}
                            fontSize={punjabiFontSize}
                            contentSpace={appFontSize * 0.1}
                            style={{
                                color: palette.punjabi,
                                display: punjabiClamped ? "-webkit-box" : "block",
                                WebkitLineClamp: punjabiClamped ? 2 : "unset",
                                WebkitBoxOrient: punjabiClamped ? "vertical" : "unset",
                                overflow: punjabiClamped ? "hidden" : "visible",
                                textOverflow: "ellipsis"
                            }}
                        >
                            { currentPankti?.punjabi_translation }
                        </Punjabi>
                    }
                    {
                        visibility.English &&
                        <English
                            className="text-center"
                            ref={englishRef}
                            fontSize={englishFontSize}
                            contentSpace={appFontSize * 0.1}
                            style={{
                                color: palette.english,
                                display: englishClamped ? "-webkit-box" : "block",
                                WebkitLineClamp: englishClamped ? 2 : "unset",
                                WebkitBoxOrient: englishClamped ? "vertical" : "unset",
                                overflow: englishClamped ? "hidden" : "visible",
                                textOverflow: "ellipsis"
                            }}
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
                    className="gurmukhi-font-2 text-center next-pankti"
                    fontSize={nextPanktiFontSize}
                    endSpace={appFontSize * 0.1}
                    leftSpace={appFontSize * 0.1}
                    style={{ color: palette.gurmukhi }}
                >
                    {Format.removeVishraams(nextPankti)}
                </NextPanktiGurmukhi>
            }
        </div>
    );
};

export default BaniDisplay;
