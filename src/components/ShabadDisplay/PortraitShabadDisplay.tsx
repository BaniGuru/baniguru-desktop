import { Fragment, useLayoutEffect, useRef } from "react";
import type { CSSProperties } from "react";
import styled from "styled-components";
import type { Pankti } from "../../models/Pankti";
import type { ThemeColors } from "../../utils/useTheme";
import Format from "../../utils/Format";

const Presentation = styled.div`
  position: relative; width: 100%; height: 100%; overflow: hidden;
  user-select: none; -webkit-user-select: none;
  .portrait-current {
    position: absolute; left: 47%; right: 4%; top: 7%; bottom: 21%;
    display: flex; align-items: center; justify-content: center;
  }
  .portrait-current-content { width: 100%; text-align: center; overflow-wrap: anywhere; }
  .portrait-gurmukhi {
    width: calc(100% + 12vw); margin-left: -12vw; overflow-wrap: normal;
    font-family: "Open Gurbani Akhar"; font-weight: 700; line-height: 1.35;
    font-size: calc(var(--portrait-font) * var(--portrait-scale, 1) * var(--portrait-gurmukhi-scale, 1));
  }
  .portrait-punjabi, .portrait-english {
    margin-top: calc(var(--portrait-font) * .35 * var(--portrait-scale, 1));
    font-size: calc(var(--portrait-font) * .46 * var(--portrait-scale, 1));
    line-height: 1.5; font-weight: 400;
  }
  .portrait-punjabi { font-family: "Open Anmol Uni", sans-serif; }
  .portrait-english { font-family: "Noto Sans", sans-serif; }
  .portrait-next {
    position: absolute; left: 4%; right: 4%; top: 88%; bottom: 2.5%;
    display: flex; align-items: center; justify-content: center;
  }
  .portrait-next-content {
    white-space: nowrap; text-align: center; font-family: "Open Gurbani Akhar";
    font-weight: 700; line-height: 1.35;
    font-size: calc(var(--portrait-font) * .65 * var(--portrait-scale, 1));
  }
`;

type Props = {
  current: Pankti;
  next?: Pankti;
  fontSize: number;
  palette: ThemeColors;
  showPunjabi: boolean;
  showEnglish: boolean;
  showNext: boolean;
};

const Gurmukhi = ({text, colors}: {text: string; colors?: ThemeColors["vishraam"]}) =>
  <>{text.split(/(\s+)/).map((word, index) => <Fragment key={index}>
    {/\s+/.test(word) ? word : <span style={{color: /;|<>|ੴ/.test(word) ? colors?.heavy
      : /[,.]/.test(word) ? colors?.medium : undefined}}>{Format.removeVishraams(word)}</span>}
  </Fragment>)}</>;

/** Keep the entire current verse and translations clear of the portrait.
 * Fit the bottom preview separately so it never extends over the artwork.
 */
export default function PortraitShabadDisplay({current, next, fontSize, palette,
  showPunjabi, showEnglish, showNext}: Props) {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const fit = () => {
      const shrink = (content: HTMLElement, property: string, fits: () => boolean) => {
        content.style.setProperty(property, "1");
        if (fits()) return;
        let low = 0, high = 1;
        for (let i = 0; i < 10; i++) {
          const scale = (low + high) / 2;
          content.style.setProperty(property, String(scale));
          if (fits()) low = scale;
          else high = scale;
        }
        content.style.setProperty(property, String(low));
      };
      for (const name of ["current", "next"]) {
        const area = element.querySelector<HTMLElement>(`.portrait-${name}`);
        const content = area?.firstElementChild as HTMLElement | undefined;
        if (!area || !content) continue;
        content.style.setProperty("--portrait-scale", "1");
        if (name === "current") {
          const gurmukhi = content.querySelector<HTMLElement>(".portrait-gurmukhi")!;
          // The portrait is narrower beside the verse than beside its lower
          // translations. Use that space, then fit the complete verse to two
          // lines without truncating words or shrinking the translations.
          shrink(gurmukhi, "--portrait-gurmukhi-scale", () =>
            gurmukhi.scrollHeight <= parseFloat(getComputedStyle(gurmukhi).lineHeight) * 2 + 1 &&
            gurmukhi.scrollWidth <= gurmukhi.clientWidth);
        }
        shrink(content, "--portrait-scale", () =>
          content.scrollWidth <= area.clientWidth && content.scrollHeight <= area.clientHeight);
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    let cancelled = false;
    void document.fonts.ready.then(() => { if (!cancelled) fit(); });
    document.fonts.addEventListener("loadingdone", fit);
    return () => {
      cancelled = true;
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", fit);
    };
  }, [current.gurmukhi, current.punjabi_translation, current.english_translation,
    next?.gurmukhi, fontSize, showPunjabi, showEnglish, showNext]);

  return <Presentation ref={root} aria-label="Guru Ramdas Ji shabad display"
    style={{background: palette.background, color: palette.gurmukhi,
      "--portrait-font": `${Math.max(28, fontSize)}px`} as CSSProperties}>
    <div className="portrait-current" aria-label="Current pankti">
      <div className="portrait-current-content">
        <div className="portrait-gurmukhi" lang="pa-Guru"><Gurmukhi text={current.gurmukhi} colors={palette.vishraam}/></div>
        {showPunjabi && current.punjabi_translation && <div className="portrait-punjabi" lang="pa"
          style={{color: palette.punjabi}}>{current.punjabi_translation}</div>}
        {showEnglish && current.english_translation && <div className="portrait-english" lang="en"
          style={{color: palette.english}}>{current.english_translation}</div>}
      </div>
    </div>
    {showNext && next?.gurmukhi && <div className="portrait-next" aria-label="Next pankti">
      <div className="portrait-next-content" lang="pa-Guru">{Format.removeVishraams(next.gurmukhi)}</div>
    </div>}
  </Presentation>;
}
