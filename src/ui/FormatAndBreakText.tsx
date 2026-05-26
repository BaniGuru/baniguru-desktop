import { useRef, useState, CSSProperties, Fragment, useLayoutEffect, useMemo } from "react";
import { useSettings } from "../state/providers/SettingContext";

type Props = {
  text: string;
  containerClassName?: string;
  containerStyle?: CSSProperties;
};

const FormatAndBreakText: React.FC<Props> = ({
  text,
  containerClassName = "",
  containerStyle = {},
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<string[][]>([]);
  const [isMeasured, setIsMeasured] = useState(false);
  const [adjustedFontSize, setAdjustedFontSize] = useState<number | null>(null);
  const { activeThemeName } = useSettings();

  const vishraamStyles = useMemo(() => {
    if (activeThemeName === "Dark" || activeThemeName === "Darker") {
      return {
        heavy: { color: "#FB8C00" },
        medium: { color: "#019FEF" },
        light: { color: "#029FFF" },
      };
    }

    if (activeThemeName === "Blue") {
      return {
        heavy: { color: "#FB8C00" },
        medium: { color: "#019FEF" },
        light: { color: "#019FEF" },
      }
    }

    if (activeThemeName === "Sepia") {
      return {
        heavy: { color: "#ec5e07" },
        medium: { color: "#1065a7" },
        light: { color: "#1273bc" },
      };
    }

    return {
      heavy: { color: "#e56c00" },
      medium: { color: "#01579b" },
      light: { color: "#01579b" },
    }
  }, [activeThemeName]);

  useLayoutEffect(() => {
    setIsMeasured(false);

    if (!containerRef.current || !text) {
      setLines([]);
      return;
    }

    const words = text.trim().split(/\s+/);
    const containerWidth = containerRef.current.clientWidth;
    if (!containerWidth) {
      requestAnimationFrame(() => {
        setIsMeasured(false);
      });
      return;
    }

    const measurer = document.createElement("span");
    measurer.style.visibility = "hidden";
    measurer.style.position = "absolute";
    measurer.style.whiteSpace = "nowrap";

    const computedStyle = window.getComputedStyle(containerRef.current);

    const baseFontSize =
      typeof computedStyle.fontSize === "string"
        ? parseFloat(computedStyle.fontSize)
        : 16;

    measurer.style.fontSize = `${baseFontSize}px`;
    measurer.style.fontFamily = computedStyle.fontFamily;
    measurer.style.fontWeight = computedStyle.fontWeight;
    measurer.style.letterSpacing = computedStyle.letterSpacing;

    document.body.appendChild(measurer);

    // ---- STEP 0: CHECK IF FITS IN ONE LINE ----
    measurer.textContent = text;

    if (measurer.offsetWidth <= containerWidth) {
      document.body.removeChild(measurer);

      setLines([words]);
      setAdjustedFontSize(null);
      setIsMeasured(true);
      return;
    }

    // ---- STEP 1: SMART SPLIT (STRICT) ----
    let linesArr: string[][] | null = null;

    const mid = words.length / 2;

    // ---- 1. FIND VALID ']' (NOT NEAR END) ----
    const bracketIndexes = words
      .map((w, i) => (/^\]+$/.test(w) ? i : -1)) // only pure ']'
      .filter((i) => i !== -1)
      .filter((i) => i < words.length - 2); // ignore near-end

    if (bracketIndexes.length > 0) {
      let bestIndex = bracketIndexes[0];
      let minDiff = Math.abs(bestIndex - mid);

      bracketIndexes.forEach((idx) => {
        const diff = Math.abs(idx - mid);
        if (diff < minDiff) {
          minDiff = diff;
          bestIndex = idx;
        }
      });

      linesArr = [
        words.slice(0, bestIndex + 1),
        words.slice(bestIndex + 1),
      ];
    } else {
      // ---- 2. CHECK ';' ----
      const vishraamIndexes = words
        .map((w, i) => (/;$/.test(w) ? i : -1))
        .filter((i) => i !== -1);

      if (vishraamIndexes.length > 0) {
        let bestIndex = vishraamIndexes[0];
        let minDiff = Math.abs(bestIndex - mid);

        vishraamIndexes.forEach((idx) => {
          const diff = Math.abs(idx - mid);
          if (diff < minDiff) {
            minDiff = diff;
            bestIndex = idx;
          }
        });

        linesArr = [
          words.slice(0, bestIndex + 1),
          words.slice(bestIndex + 1),
        ];
      }
    }

    // ---- 3. NO VALID SPLIT → FALLBACK TO BALANCED SPLIT ----
    if (!linesArr) {
      const mid = Math.floor(words.length / 2);

      linesArr = [
        words.slice(0, mid),
        words.slice(mid),
      ];
    }

    document.body.removeChild(measurer);

    setLines(linesArr);

    // ---- STEP 2: RESIZE AFTER RENDER ----
    requestAnimationFrame(() => {
      if (!containerRef.current) return;

      const container = containerRef.current;
      const containerWidth = container.clientWidth;

      let size =
        typeof containerStyle.fontSize === "string"
          ? parseFloat(containerStyle.fontSize)
          : baseFontSize;

      const minSize = 40;

      container.style.fontSize = `${size}px`;

      const isOverflowing = () => {
        return Array.from(container.children).some(
          (line) => (line as HTMLElement).scrollWidth > containerWidth
        );
      };

      while (isOverflowing() && size > minSize) {
        size -= 1;
        container.style.fontSize = `${size}px`;
      }

      setAdjustedFontSize(size);
    });

    setIsMeasured(true);
  }, [text, containerRef.current?.clientWidth]);

  const cleanWord = (word: string) =>
    word.replace(/[;,.\s]+$/, "");

  const getColorStyle = (word: string): CSSProperties => {
    if (word.endsWith(";")) return vishraamStyles.heavy;
    if (word.endsWith(".")) return vishraamStyles.medium;
    if (word.endsWith(",")) return vishraamStyles.light;
    return {};
  };

  if (!isMeasured) {
    return <div ref={containerRef} style={{ visibility: "hidden" }} />;
  }

  return (
    <div
      ref={containerRef}
      className={containerClassName}
      style={{
        width: "100%",
        ...containerStyle,
        ...(adjustedFontSize
          ? { fontSize: `${adjustedFontSize}px` }
          : {}),
      }}
    >
      {lines.map((line, i) => (
        <div key={i} style={{ whiteSpace: "nowrap" }}>
          {line.map((word, j) => (
            <Fragment key={j}>
              <span style={getColorStyle(word)}>
                {cleanWord(word)}
              </span>
              {j !== line.length - 1 && " "}
            </Fragment>
          ))}
        </div>
      ))}
    </div>
  );
};

export default FormatAndBreakText;