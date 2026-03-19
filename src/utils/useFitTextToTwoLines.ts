import { useLayoutEffect, useState } from "react";

const useFitTextToTwoLines = (
    ref: React.RefObject<HTMLElement>,
    text: string,
    baseFontSize: number,
    minScale: number = 0.7
) => {
    const [fontSize, setFontSize] = useState(baseFontSize);
    const [isClamped, setIsClamped] = useState(false);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || !text) return;

        let frameId: number;

        const fit = () => {
            if (!el) return;

            let size = baseFontSize;
            const minSize = Math.max(10, baseFontSize * minScale);

            el.style.fontSize = `${size}px`;

            const getLineHeight = () => {
                const computed = window.getComputedStyle(el);
                return computed.lineHeight === "normal"
                    ? parseFloat(computed.fontSize) * 1.4
                    : parseFloat(computed.lineHeight);
            };

            const isOverflowing = () => {
                const lh = getLineHeight();
                const lines = Math.round(el.scrollHeight / lh);
                return lines > 2;
            };

            // shrink
            while (isOverflowing() && size > minSize) {
                size -= size > 40 ? 2 : 1;
                el.style.fontSize = `${size}px`;
            }

            // check if still overflowing at min
            const stillOverflowing = isOverflowing();

            setFontSize(size);
            setIsClamped(stillOverflowing);
        };

        fit();

        const handleResize = () => {
            cancelAnimationFrame(frameId);
            frameId = requestAnimationFrame(fit);
        };

        window.addEventListener("resize", handleResize);

        return () => {
            cancelAnimationFrame(frameId);
            window.removeEventListener("resize", handleResize);
        };
    }, [text, baseFontSize, minScale]);

    return { fontSize, isClamped };
};

export default useFitTextToTwoLines;