import { useRef, useState, CSSProperties, Fragment, useLayoutEffect } from "react";

const vishraamStyles = {
  heavy: {
    color: "#e56c00",
  },
  medium: {
    color: "#01579b",
  },
  light: {
    color: "#01579b",
  },
};

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

  useLayoutEffect(() => {
    setIsMeasured(false);
    if (!containerRef.current || !text) {
      setLines([]);
      return;
    }

    const words = text.trim().split(/\s+/);
    const containerWidth = containerRef.current.clientWidth;

    const measurer = document.createElement("span");
    measurer.style.visibility = "hidden";
    measurer.style.position = "absolute";
    measurer.style.whiteSpace = "nowrap";

    const computedStyle = window.getComputedStyle(containerRef.current);
    measurer.style.fontSize = computedStyle.fontSize || "16px";
    measurer.style.fontFamily = computedStyle.fontFamily || "inherit";
    measurer.style.fontWeight = computedStyle.fontWeight || "normal";
    measurer.style.letterSpacing = computedStyle.letterSpacing || "normal";

    document.body.appendChild(measurer);

    measurer.textContent = text.trim();

    // break 2 lines
    let lineBreak = false;
    if (measurer.offsetWidth > containerWidth && measurer.offsetWidth < (2 * containerWidth)) {
      lineBreak = true;
    }

    // skip lines with less width or greater than 2 widths
    if (!lineBreak) {
      setIsMeasured(true);
      setLines([words]);
      return;
    }

    // for lines with 2 widths find lines
    measurer.textContent = "";
    let lineWords: string[] = [];
    let linesArr: string[][] = [];
    let breakWord = -1;
    words.map((word, i) => {
      if (i > 0) {
        measurer.textContent += " ";
      }

      measurer.textContent += word;
      if (measurer.offsetWidth > containerWidth) {
        const lineWordsArr = lineWords.slice(0, breakWord + 1);
        if (lineWordsArr.length > 0) {
          linesArr.push(lineWordsArr);
        }
        lineWords = lineWords.slice(breakWord + 1);
        measurer.textContent = word;
        lineWords.push(word);
      } else {
        breakWord = word.endsWith(";") ? i : breakWord;
        lineWords.push(word);
      }
    });

    measurer.textContent = "";
    if (lineWords.length > 0) {
      linesArr.push(lineWords);
    }

    document.body.removeChild(measurer);

    setLines(linesArr);
    setIsMeasured(true);
  }, [text]);

  const cleanWord = (word: string) => word.replace(/[;,.\s]+$/, "");

  const getColorStyle = (word: string): CSSProperties => {
    if (word.endsWith(";")) return vishraamStyles.heavy;
    if (word.endsWith(".")) return vishraamStyles.medium;
    if (word.endsWith(",")) return vishraamStyles.light;
    return {};
  };

  const forceNoWrap = isMeasured && lines.length === 2;

  if (!isMeasured) {
    return <div ref={containerRef} style={{ visibility: "hidden" }} />;
  }

  const words = text.split(/\s+/);

  return (
    <div
      ref={containerRef}
      className={containerClassName}
      style={{ width: "100%", ...containerStyle }}
    >
      {forceNoWrap ? (
        lines.map((lineWords, lineIndex) => (
          <div key={lineIndex} className="whitespace-nowrap">
            {lineWords.map((word, i) => (
              <Fragment key={i}>
                <span
                  className="whitespace-nowrap"
                  style={getColorStyle(word)}
                >
                  {cleanWord(word)}
                </span>
                {i !== lineWords.length - 1 && <span>&nbsp;</span>}
              </Fragment>
            ))}
          </div>
        ))
      ) : (
        <div>
          {words.map((word, i) => (
            <Fragment key={i}>
              <span style={getColorStyle(word)}>{cleanWord(word)}</span>
              {i !== words.length - 1 && " "}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );

};

export default FormatAndBreakText;
