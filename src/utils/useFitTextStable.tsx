import { useLayoutEffect, useState } from "react";

interface Options {
    maxFontSize: number;
    minFontSize?: number;
    nextRef?: React.RefObject<HTMLElement>;
}

export default function useFitTextStable(
    containerRef: React.RefObject<HTMLElement>,
    contentRef: React.RefObject<HTMLElement>,
    deps: any[],
    { maxFontSize, minFontSize = 20 }: Options
) {
    const [fontSize, setFontSize] = useState(maxFontSize);

    useLayoutEffect(() => {

        const run = async () => {
            const container = containerRef.current;
            const content = contentRef.current;

            if (!container || !content) return;

            const lines = () =>
                Array.from(content.querySelectorAll(".gurmukhi-line")) as HTMLElement[];

            const translations = () =>
                Array.from(content.querySelectorAll(".translation-line")) as HTMLElement[];

            const applySize = (size: number) => {
                content.style.marginBottom = `${maxFontSize*1.5}px`;
    
                const linesElements = lines();

                for (let i = 0; i < linesElements.length; i++) {
                    const el = linesElements[i];

                    el.style.fontFamily = "Open Gurbani Akhar";
                    el.style.fontWeight = '900';
                    el.style.fontSize = `${size}px`;
                    el.style.marginBottom = `${size * 0.1}px`;

                    if (i > 0) {
                        el.style.marginTop = `${size * 0.8}px`;
                    } else {
                        el.style.marginTop = `${size * 0.2}px`;
                    }
                }

                for (const el of translations()) {
                    el.style.fontSize = `${size * 0.35}px`;
                }
            };

            const fits = () => {
                for (const el of lines()) {
                    const parentWidth = el.parentElement?.getBoundingClientRect().width || 0;

                    const style = getComputedStyle(el);
                    const marginLeft = parseFloat(style.marginLeft) || 0;
                    const marginRight = parseFloat(style.marginRight) || 0;
                    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
                    const borderRight = parseFloat(style.borderRightWidth) || 0;

                    const totalWidth = el.scrollWidth + marginLeft + marginRight + borderLeft + borderRight;

                    if (totalWidth > parentWidth) {
                        return false;
                    }
                }

                return content.scrollHeight <= content.clientHeight;
            };

            let low = minFontSize;
            let high = maxFontSize;
            let best = minFontSize;

            while (low <= high) {
                const mid = Math.floor((low + high) / 2);

                applySize(mid);

                // force reflow
                content.offsetHeight;

                if (fits()) {
                    best = mid;
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }

            applySize(best);
            setFontSize(best);
        };

        run();

    }, deps);

    return fontSize;
}