import { FC, Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { useSettings } from "../../state/providers/SettingContext";
import { updateServerPankti } from "../../utils/TauriCommands";
import { BANI_ACTION_UPDATE, BaniContext } from "../../state/providers/BaniProvider";
import { useThemeColors } from "../../utils/useTheme";
import { useContext as useCtxSelector } from "use-context-selector";
import { AppContext } from "../../state/providers/AppProvider";

import backgroundDesign from "./background_design.png";

interface PanktiLike {
    id?: string | number;
    gurmukhi?: string;
    punjabi_translation?: string;
    english_translation?: string;
    show_translation?: boolean;
    show_group?: number;
    type_id?: number;
}

const ORANGE = "#df6b00";
const BLACK = "#1a1a1a";

const Slide = styled.div`
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: #fbf3e6;
`;

const Frame = styled.div`
    width: 100vw;
    height: 100vh;
    position: relative;
    overflow: hidden;

    background-image: url(${backgroundDesign});
    background-size: 100% 100%;
    background-position: center;
    background-repeat: no-repeat;
`;

const Content = styled.div`
    position: relative;
    z-index: 2;

    width: 90vw;
    height: 78vh;

    margin: 0 auto;

    padding-top: clamp(140px, 15vh, 185px);
    padding-bottom: clamp(80px, 8vh, 120px);

    display: grid;
    grid-template-rows:
        minmax(0, 1fr)
        auto
        minmax(0, 1fr)
        auto
        auto;

    row-gap: clamp(18px, 2.2vh, 32px);
`;

const VerseCard = styled.div`
    min-width: 0;
    min-height: 0;
    width: 100%;

    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    text-align: center;
`;

const VerseRow = styled.div<{ single?: boolean }>`
    min-height: 0;

    display: grid;
    grid-template-columns: ${({ single }) =>
        single ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))"};

    column-gap: 12px;

    align-items: start;
    justify-items: center;

    margin-top: 1.2vh;
    padding-bottom: clamp(10px, 1.4vh, 22px);
`;

const GurmukhiLine = styled.div<{ fontSize: number }>`
    width: 100%;

    text-align: center;

    white-space: nowrap;
    overflow: hidden;

    font-size: ${({ fontSize }) => `${fontSize}px`};

    font-family: "Open Gurbani Akhar";
    font-weight: 900;

    letter-spacing: -0.01em;
`;

const PunjabiLine = styled.div<{ fontSize: number }>`
    width: 100%;
    box-sizing: border-box;

    margin-top: ${({ fontSize }) => `${fontSize * 0.25}px`};

    font-size: ${({ fontSize }) => `${fontSize}px`};
    line-height: 1.32;
    padding-block: 0.04em;

    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    text-align: center;
    font-family: "Open Anmol Uni", sans-serif;
    font-weight: 900;
    color: #6f4e2f;
`;

const EnglishLine = styled.div<{ fontSize: number }>`
    width: 100%;
    box-sizing: border-box;

    margin-top: ${({ fontSize }) => `${fontSize * 0.08}px`};

    font-size: ${({ fontSize }) => `${fontSize}px`};
    line-height: 1.28;
    padding-block: 0.03em;

    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    text-align: center;
    font-family: "Noto Serif", serif;
    font-weight: 700;
    color: #6f4e2f;
`;

const NextPanktiLine = styled.div<{ fontSize: number }>`
    position: absolute;
    left: 12vw;
    right: 12vw;
    bottom: clamp(42px, 5.2vh, 72px);
    z-index: 3;

    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    font-size: ${({ fontSize }) => `${fontSize}px`};
    font-family: "Open Gurbani Akhar";
    font-weight: 800;

    color: rgba(111, 78, 47, 0.8);
`;

const DividerRow = styled.div`
    position: relative;

    width: min(48vw, 760px);
    height: 28px;

    margin: clamp(20px, 3vh, 42px) auto auto;

    display: flex;
    align-items: center;
    justify-content: center;

    &::before,
    &::after {
        content: "";
        flex: 1;
        height: 1px;

        background: linear-gradient(
            to right,
            rgba(217,154,68,0),
            rgba(217,154,68,0.85)
        );
    }

    &::after {
        background: linear-gradient(
            to left,
            rgba(217,154,68,0),
            rgba(217,154,68,0.85)
        );
    }
`;

const HiddenMeasureCard = styled(VerseCard)`
    position: fixed;
    left: -99999px;
    top: -99999px;
    visibility: hidden;
    pointer-events: none;

    width: 100%;
    height: 100%;
    overflow: visible;
    justify-content: center;
`;

const BaniGroupDisplay: FC = () => {
    const baniContext = useContext(BaniContext);
    const { state } = useCtxSelector(ShabadContext);
    const { visibility } = useSettings();
    const { fontSize: appFontSize } = useContext(AppContext);
    const { palette } = useThemeColors();

    const current = state.current;

    const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
    const gurmukhiRefs = useRef<(HTMLDivElement | null)[]>([]);
    const punjabiRefs = useRef<(HTMLDivElement | null)[]>([]);
    const englishRefs = useRef<(HTMLDivElement | null)[]>([]);
    const measureRefs = useRef<(HTMLDivElement | null)[]>([]);

    const [fontSize, setFontSize] = useState(appFontSize);

    useEffect(() => {
        const sendDataToBackend = async () => {
            if (state.current < 0) return;
            await updateServerPankti(state.panktis[state.current]);
        };

        sendDataToBackend();
    }, [state.panktis, state.current]);

    useEffect(() => {
        if (state.baniId === null) return;
        if (baniContext.state.banis.findIndex(r => r.baniId === state.baniId) < 0) return;

        baniContext.dispatch({
            type: BANI_ACTION_UPDATE,
            payload: {
                baniId: state.baniId,
                panktis: state.panktis,
                current: state.current,
                home: state.home,
            },
        });
    }, [state.baniId, state.current]);

    const showGroup = state.panktis[current]?.show_group;

    const panktis = useMemo<PanktiLike[]>(() => {
        if (current < 0 || showGroup === undefined) return [];

        let group = state.panktis.filter(p => p.show_group === showGroup);

        if (group[0]?.type_id === 2 && group[1]?.type_id && group[1].type_id > 2) {
            group = group.slice(1);
        }

        return group.slice(0, 4);
    }, [current, showGroup, state.panktis]);

    const nextPankti = useMemo<PanktiLike | undefined>(() => {
        if (current < 0 || !panktis.length) return undefined;

        const lastVisible = panktis[panktis.length - 1];
        const lastIndex = state.panktis.findIndex(p => p.id === lastVisible.id);

        if (lastIndex < 0) return undefined;

        return state.panktis[lastIndex + 1];
    }, [current, panktis, state.panktis]);

    const rows = useMemo(() => {
        if (panktis.length === 1) {
            return [
                [panktis[0]],
                [],
            ];
        }

        if (panktis.length === 2) {
            return [
                [panktis[0]],
                [panktis[1]],
            ];
        }

        return [
            [panktis[0], panktis[1]],
            [panktis[2], panktis[3]],
        ];
    }, [panktis]);

    const groupFitKey = panktis.map(p => p?.id ?? p?.gurmukhi).join("|");

    useLayoutEffect(() => {
        const fitText = () => {
            if (!panktis.length) return;

            const maxSize = appFontSize;
            const minSize = 20;

            let bestSize = minSize;

            for (let size = maxSize; size >= minSize; size -= 1) {
                let fits = true;

                for (let i = 0; i < panktis.length; i++) {
                    const card = cardRefs.current[i];
                    const measure = measureRefs.current[i];

                    if (!card || !measure) continue;

                    measure.style.width = `${card.clientWidth}px`;
                    measure.style.height = `${card.clientHeight}px`;

                    measure
                        .querySelectorAll<HTMLElement>("[data-fit-font]")
                        .forEach(el => {
                            const scale = Number(el.dataset.fitScale || 1);
                            el.style.fontSize = `${size * scale}px`;
                        });

                    const gurmukhi = measure.querySelector<HTMLElement>(
                        "[data-fit-type='gurmukhi']"
                    );

                    if (gurmukhi && gurmukhi.scrollWidth > gurmukhi.clientWidth) {
                        fits = false;
                        break;
                    }

                    if (measure.scrollHeight > measure.clientHeight) {
                        fits = false;
                        break;
                    }
                }

                if (fits) {
                    bestSize = size;
                    break;
                }
            }

            setFontSize(prev => (prev === bestSize ? prev : bestSize));
        };

        const raf = requestAnimationFrame(fitText);

        const handleResize = () => {
            requestAnimationFrame(fitText);
        };

        window.addEventListener("resize", handleResize);

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", handleResize);
        };
    }, [
        appFontSize,
        groupFitKey,
        visibility.ਪੰਜਾਬੀ,
        visibility.English,
    ]);

    if (current < 0 || panktis.length === 0) return null;

    const renderGurmukhiWithVishraam = (text = "") => {
        return text.split(/(\s+)/).map((part, index) => {
            if (/^\s+$/.test(part)) return part;

            const isVishraam = part.includes(";");
            const displayWord = part.replace(/;|[.]|[,]/g, "");

            return (
                <span
                    key={index}
                    style={{
                        color: isVishraam ? ORANGE : palette.gurmukhi || BLACK,
                    }}
                >
                    {displayWord}
                </span>
            );
        });
    };


    const renderVerse = (pankti: PanktiLike | undefined, index: number) => {
        if (!pankti) return <VerseCard />;

        return (
            <Fragment key={pankti.id ?? index}>
                <HiddenMeasureCard
                    ref={el => {
                        measureRefs.current[index] = el;
                    }}
                >
                    <GurmukhiLine
                        data-fit-type="gurmukhi"
                        data-fit-font
                        data-fit-scale="1"
                        fontSize={fontSize}
                        style={{ width: "100%" }}
                    >
                        {pankti.gurmukhi?.replace(/;|[.]/g, "")}
                    </GurmukhiLine>

                    {pankti.show_translation && visibility.ਪੰਜਾਬੀ && (
                        <PunjabiLine
                            data-fit-type="translation"
                            data-fit-font
                            data-fit-scale="0.4"
                            fontSize={fontSize * 0.4}
                        >
                            {pankti.punjabi_translation}
                        </PunjabiLine>
                    )}

                    {pankti.show_translation && visibility.English && (
                        <EnglishLine
                            data-fit-type="translation"
                            data-fit-font
                            data-fit-scale="0.4"
                            fontSize={fontSize * 0.4}
                        >
                            {pankti.english_translation}
                        </EnglishLine>
                    )}
                </HiddenMeasureCard>

                <VerseCard
                    ref={el => {
                        cardRefs.current[index] = el;
                    }}
                >
                    <GurmukhiLine
                        ref={el => {
                            gurmukhiRefs.current[index] = el;
                        }}
                        fontSize={fontSize}
                        style={{ color: palette.gurmukhi || BLACK }}
                    >
                        {renderGurmukhiWithVishraam(pankti.gurmukhi)}
                    </GurmukhiLine>

                    {pankti.show_translation && visibility.ਪੰਜਾਬੀ && (
                        <PunjabiLine
                            ref={el => {
                                punjabiRefs.current[index] = el;
                            }}
                            fontSize={fontSize * 0.4}
                        >
                            {pankti.punjabi_translation}
                        </PunjabiLine>
                    )}

                    {pankti.show_translation && visibility.English && (
                        <EnglishLine
                            ref={el => {
                                englishRefs.current[index] = el;
                            }}
                            fontSize={fontSize * 0.4}
                        >
                            {pankti.english_translation}
                        </EnglishLine>
                    )}
                </VerseCard>
            </Fragment>
        );
    };

    const isSingleColumn = panktis.length <= 2;

    return (
        <Slide>
            <Frame>
                <Content>
                    <VerseRow single={isSingleColumn}>
                        {rows[0].map((pankti, index) =>
                            renderVerse(pankti, index)
                        )}
                    </VerseRow>

                    <DividerRow />
                        {/* <DividerKhanda>☬</DividerKhanda> */}
                    {/* </DividerRow> */}

                    <VerseRow single={isSingleColumn}>
                        {panktis.length > 1 &&
                            rows[1].map((pankti, index) =>
                                renderVerse(
                                    pankti,
                                    panktis.length <= 2 ? index + 1 : index + 2
                                )
                            )}
                    </VerseRow>

                    <DividerRow />
                        {/* <DividerKhanda>☬</DividerKhanda> */}
                    {/* </DividerRow> */}
                </Content>

                {nextPankti?.gurmukhi && (
                    <NextPanktiLine fontSize={Math.max(48, fontSize * 0.38)}>
                        {nextPankti.gurmukhi.replace(/;|[.]|[,]/g, "")}
                    </NextPanktiLine>
                )}
            </Frame>
        </Slide>
    );
};

export default BaniGroupDisplay;