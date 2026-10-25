import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import styled from "styled-components";
import { Pankti } from "../../models/Pankti";
import { ThemeColors } from "../../utils/useTheme";
import { getPaathSource, loadPaathAng, PaathAng, PaathAngCache, paathAngRange, PaathSource } from "../../utils/paathAngs";
import Format from "../../utils/Format";
import { joinedPaathTranslation, paathDisplayRows } from "../../utils/paathDisplayRows";

const Reader = styled.div`
  position: relative; height: 100%; width: 100%; overflow: hidden; display: flex; box-sizing: border-box;
  .paath-scroll { overflow-y: auto; overflow-anchor: none; scroll-behavior: auto;
    flex: 1; min-height: 0; padding: 0 var(--paath-inline-inset, 5.4vw) 32vh; }
  .paath-scroll[data-following="true"] { padding-bottom: 0; }
  .paath-scroll[data-following="true"]::after { content: ""; display: block; height: 100vh; }
  .paath-line { height: calc(var(--paath-viewport-height, 100vh) / 4); box-sizing: border-box;
    padding: var(--paath-row-top, 10px) 0 var(--paath-row-gap, 22px); cursor: pointer; overflow-wrap: anywhere; overflow: hidden; }
  .paath-line:focus-visible { outline: 2px solid #888; outline-offset: 4px; }
  .paath-translation { margin-top: calc(var(--paath-translation-gap, 6px) * var(--paath-text-scale, 1)); }
  .paath-ang-heading { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .paath-toolbar { position: absolute; right: 16px; top: 12px; z-index: 1;
    display: flex; gap: 12px; align-items: center; padding: 8px 12px;
    background: var(--paath-controls-bg, #eee); border-radius: 8px; max-width: 85%; }
  button { border: 1px solid currentColor; border-radius: 6px; padding: 5px 12px; }
  button:disabled { opacity: .5; }
`;

type ScrollAnimation = { frame: number; from: number; to: number; start: number; duration: number };

const PaathGurmukhi = ({text,colors}: {text:string;colors?:ThemeColors["vishraam"]}) => <>{text.split(/(\s+)/).map((word,index) =>
  <Fragment key={index}>{/\s+/.test(word) ? word :
    <span style={{color:/;|<>|ੴ/.test(word) ? colors?.heavy ?? "#e65c00" : /[,.]/.test(word) ? colors?.medium ?? "#2ca44f" : undefined}}>
      {Format.removeVishraams(word)}
    </span>}</Fragment>
)}</>;

type Props = {
  current: Pankti;
  fallbackPanktis: Pankti[];
  fontSize: number;
  palette: ThemeColors;
  showPunjabi: boolean;
  showEnglish: boolean;
  onSelect: (pankti: Pankti) => void;
  resolveSource?: typeof getPaathSource;
  loadAng?: typeof loadPaathAng;
};

/** Read four rows at a time, advancing the passage when speech reaches row three. */
export default function SehajPaathDisplay({current, fallbackPanktis, fontSize, palette,
  showPunjabi, showEnglish, onSelect, resolveSource = getPaathSource, loadAng = loadPaathAng}: Props) {
  const [pages, setPages] = useState<PaathAng[]>([]);
  const [source, setSource] = useState<PaathSource | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [following, setFollowing] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const cache = useRef<{source: number; pages: PaathAngCache} | null>(null);
  const request = useRef(0);
  const manualAnchor = useRef<{id:string; top:number} | null>(null);
  const positioned = useRef(false);
  const forceAlign = useRef(false);
  const animation = useRef<ScrollAnimation | null>(null);
  const fontRevision = useRef(0);
  const currentRef = useRef(current);
  currentRef.current = current;
  const activeAng = Number(current.source_page);
  const appearance = palette.reader;
  const fallbackIndex = fallbackPanktis.findIndex(row => row.id === current.id);
  const loadedCurrent = pages.some(page => page.ang === activeAng);
  const shown = pages.length && (!following || loadedCurrent) ? pages : [{ang:activeAng,
    panktis:fallbackIndex < 0 ? [current] : fallbackPanktis.slice(Math.max(0,fallbackIndex - 3),fallbackIndex + 12)}];
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const [adaptivePairs,setAdaptivePairs] = useState<Set<string>>(new Set());
  const adaptivePairsRef = useRef(adaptivePairs);
  adaptivePairsRef.current = adaptivePairs;
  const pairingPending = useRef(false);
  const measuredAngs = useRef(new Map<number,{key:string;scale:string;pairs:Set<string>}>());

  const stopScroll = useCallback(() => {
    if (animation.current) cancelAnimationFrame(animation.current.frame);
    animation.current = null;
  }, []);

  const pauseFollowing = useCallback(() => {
    stopScroll();
    setFollowing(false);
  }, [stopScroll]);

  useEffect(() => {
    let cancelled = false;
    resolveSource(current.shabad_id).then(value => {
      if (!cancelled) {
        setSource(previous => previous?.id === value?.id && previous?.length === value?.length ? previous : value);
        if (!value) setError("Could not locate this ang.");
      }
    }).catch(() => { if (!cancelled) setError("Could not load paath. Select Retry to try again."); });
    return () => { cancelled = true; };
  }, [current.shabad_id, resolveSource]);

  const loadWindow = useCallback(async (ang: number, preservePosition = false) => {
    if (!source || !Number.isInteger(ang) || ang < 1 || ang > source.length) return;
    const myRequest = ++request.current;
    if (cache.current?.source !== source.id) {
      cache.current = {source:source.id,pages:new PaathAngCache(page => loadAng(source.id,page))};
      setPages([]);
      stopScroll();
      positioned.current = false;
    }
    setLoading(true);
    setError("");
    try {
      const next = await cache.current.pages.window(paathAngRange(ang,source.length));
      if (myRequest !== request.current) return;
      const viewport = scrollRef.current;
      if (viewport && (preservePosition || following)) {
        const top = viewport.getBoundingClientRect().top;
        const retained = new Set(next.flatMap(page => page.panktis.map(pankti => pankti.id)));
        const rows = Array.from(viewport.querySelectorAll<HTMLElement>("[data-line-id]"));
        const anchor = rows.find(row => row.getBoundingClientRect().bottom > top + 30 && retained.has(row.dataset.lineId!))
          ?? (following ? rows.find(row => row.getAttribute("aria-current") === "true" && retained.has(row.dataset.lineId!)) : undefined);
        if (anchor) manualAnchor.current = {id:anchor.dataset.lineId!,top:anchor.getBoundingClientRect().top};
      }
      setPages(next);
    } catch {
      if (myRequest === request.current) setError("Could not load the next ang. Select Retry to try again.");
    } finally {
      if (myRequest === request.current) setLoading(false);
    }
  }, [source,loadAng,following,stopScroll]);

  useEffect(() => {
    if (following) void loadWindow(activeAng);
  }, [activeAng,loadWindow,following]);
  useEffect(() => () => { request.current++; stopScroll(); }, [stopScroll]);

  const fitAngs = useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    viewport.style.setProperty("--paath-viewport-height",`${viewport.clientHeight}px`);
    const key = `${viewport.clientWidth}:${viewport.clientHeight}:${fontSize}:${showPunjabi}:${showEnglish}:${fontRevision.current}:${JSON.stringify(appearance)}`;
    const canonical = paathDisplayRows(shownRef.current);
    const retainedAngs = new Set(canonical.map(page => page.ang));
    for (const ang of measuredAngs.current.keys()) if (!retainedAngs.has(ang)) measuredAngs.current.delete(ang);
    const plannedPairs = new Set<string>();
    // Fit a complete Ang once, before it is read. All its panktis inherit one
    // shared scale, including short lines, so advancing never changes the font.
    for (const page of viewport.querySelectorAll<HTMLElement>("section[data-ang]")) {
      const rows = Array.from(page.querySelectorAll<HTMLElement>(".paath-line"));
      if (!rows.length) continue;
      const ang = Number(page.dataset.ang);
      const raw = canonical.find(item => item.ang === ang)!;
      const measurementKey = `${key}:${raw.rows.map(row => row.map(pankti =>
        `${pankti.id}:${Number(Boolean(pankti.paath_keep_single))}`).join("+")).join(",")}`;
      const cached = measuredAngs.current.get(ang);
      if (cached?.key === measurementKey) {
        page.style.setProperty("--paath-text-scale",cached.scale);
        cached.pairs.forEach(id => plannedPairs.add(id));
        continue;
      }
      const pageKey = `${key}:${rows.map(row => row.dataset.lineIds).join(",")}`;
      const style = getComputedStyle(rows[0]);
      const available = rows[0].clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const template = rows[0].querySelector<HTMLElement>(".paath-line-content")!;
      const measurement = document.createElement("div");
      measurement.setAttribute("aria-hidden","true");
      Object.assign(measurement.style,{position:"absolute",visibility:"hidden",pointerEvents:"none",width:`${template.clientWidth}px`});
      page.appendChild(measurement);
      // Refit the original singles (and canonical Sukhmani pairs), never the
      // previously adaptive pairs. Otherwise resizing could shrink the font
      // just to preserve a pair that no longer fits at the selected size.
      const contents = raw.rows.map(row => {
        const content = template.cloneNode(true) as HTMLElement;
        const gurmukhi = content.querySelector<HTMLElement>('[lang="pa-Guru"]')!;
        gurmukhi.textContent = Format.removeVishraams(row.map(pankti => pankti.gurmukhi).join(" "));
        gurmukhi.style.whiteSpace = row.length === 2 ? "nowrap" : "normal";
        for (const [lang,field] of [["pa","punjabi_translation"],["en","english_translation"]] as const) {
          const translation = content.querySelector<HTMLElement>(`[lang="${lang}"]`);
          if (translation) translation.textContent = joinedPaathTranslation(row,field);
        }
        measurement.appendChild(content);
        return content;
      });
      const fits = () => contents.every(content => content.scrollHeight <= available && content.scrollWidth <= content.clientWidth);
      page.style.setProperty("--paath-text-scale","1");
      if (!fits()) {
        let low = 0, high = 1;
        for (let i = 0; i < 9; i++) {
          const scale = (low + high) / 2;
          page.style.setProperty("--paath-text-scale",String(scale));
          if (fits()) low = scale;
          else high = scale;
        }
        page.style.setProperty("--paath-text-scale",String(low));
      }
      page.dataset.paathFit = pageKey;
      // Measure the actual font and joined translations at this ang's chosen
      // size. Pairing never shrinks text simply to make another line fit.
      const probe = template.cloneNode(true) as HTMLElement;
      probe.setAttribute("aria-hidden","true");
      Object.assign(probe.style,{position:"absolute",visibility:"hidden",pointerEvents:"none",width:`${template.clientWidth}px`});
      measurement.appendChild(probe);
      const gurmukhi = probe.querySelector<HTMLElement>('[lang="pa-Guru"]')!;
      const font = getComputedStyle(gurmukhi);
      const canvas = document.createElement("canvas").getContext("2d")!;
      canvas.font = `${font.fontWeight} ${font.fontSize} ${font.fontFamily}`;
      const pairs = new Set<string>();
      paathDisplayRows([{ang,panktis:raw.rows.flat()}],(first,second) => {
        const text = Format.removeVishraams(`${first.gurmukhi} ${second.gurmukhi}`);
        if (canvas.measureText(text).width > template.clientWidth - 2) return false;
        gurmukhi.textContent = text;
        gurmukhi.style.whiteSpace = "nowrap";
        for (const [lang,field] of [["pa","punjabi_translation"],["en","english_translation"]] as const) {
          const translation = probe.querySelector<HTMLElement>(`[lang="${lang}"]`);
          if (translation) translation.textContent = joinedPaathTranslation([first,second],field);
        }
        if (probe.scrollHeight > available || probe.scrollWidth > probe.clientWidth) return false;
        pairs.add(first.id);
        return true;
      });
      measurement.remove();
      measuredAngs.current.set(ang,{key:measurementKey,scale:page.style.getPropertyValue("--paath-text-scale"),pairs});
      pairs.forEach(id => plannedPairs.add(id));
    }
    const previous = adaptivePairsRef.current;
    if (previous.size !== plannedPairs.size || [...previous].some(id => !plannedPairs.has(id))) {
      const beforeCurrent = new Set(shownRef.current.flatMap(page => page.panktis)
        .filter(pankti => pankti.source_page <= currentRef.current.source_page).map(pankti => pankti.id));
      if ([...previous,...plannedPairs].some(id => beforeCurrent.has(id) && previous.has(id) !== plannedPairs.has(id))) {
        stopScroll();
        positioned.current = false;
      }
      adaptivePairsRef.current = plannedPairs;
      pairingPending.current = true;
      setAdaptivePairs(plannedPairs);
    }
  }, [fontSize,showPunjabi,showEnglish,appearance,stopScroll]);

  const alignActive = useCallback((instant = false): void => {
    const viewport = scrollRef.current;
    if (!viewport || !following || pairingPending.current) return;
    const row = viewport.querySelector<HTMLElement>("[aria-current=true]");
    if (!row) return;
    const offset = row.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    const force = forceAlign.current;
    // Let the reader finish a gentle two-line advance. New ASR observations
    // during it do not chase the next line or restart the easing.
    if (!instant && !force && animation.current) return;
    if (!instant && !force && offset >= -1 && offset < viewport.clientHeight / 2 - 1) return;
    forceAlign.current = false;
    const target = Math.max(0,Math.min(viewport.scrollHeight - viewport.clientHeight,viewport.scrollTop + offset));
    stopScroll();
    if (Math.abs(target - viewport.scrollTop) < 1) return;
    if (instant || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      viewport.scrollTop = target;
      return;
    }
    const next: ScrollAnimation = {frame:0,from:viewport.scrollTop,to:target,start:performance.now(),
      duration:Math.max(1600,Math.min(2400,Math.abs(target - viewport.scrollTop) * 4))};
    animation.current = next;
    const step = (now: number) => {
      if (animation.current !== next) return;
      const t = Math.min(1,(now - next.start) / next.duration);
      const eased = t * t * (3 - 2 * t);
      viewport.scrollTop = next.from + (next.to - next.from) * eased;
      if (t < 1) next.frame = requestAnimationFrame(step);
      else {
        animation.current = null;
        // If speech has already reached the third row of the new passage,
        // start its next advance only after this one has finished.
        alignActive();
      }
    };
    next.frame = requestAnimationFrame(step);
  }, [following,stopScroll]);

  useLayoutEffect(() => {
    // A theme can change the reading area's insets and all row heights.
    // Re-anchor the current pankti before resuming normal batch scrolling.
    stopScroll();
    positioned.current = false;
  }, [appearance,stopScroll]);

  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    fitAngs();
    // Position once the measured row plan is actually in the DOM. Aligning
    // the old singles first would animate again when their pairs appear.
    if (adaptivePairsRef.current !== adaptivePairs) return;
    pairingPending.current = false;
    if (manualAnchor.current) {
      const anchor = manualAnchor.current;
      const row = Array.from(viewport.querySelectorAll<HTMLElement>("[data-line-id]"))
        .find(row => row.dataset.lineIds?.split(" ").includes(anchor.id));
      if (row) {
        const delta = row.getBoundingClientRect().top - anchor.top;
        viewport.scrollTop += delta;
        if (animation.current) {
          animation.current.from += delta;
          animation.current.to += delta;
        }
      }
      manualAnchor.current = null;
    }
    alignActive(!positioned.current);
    if (viewport.querySelector("[aria-current=true]")) positioned.current = true;
  }, [pages,current.id,alignActive,fitAngs,adaptivePairs]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    let cancelled = false;
    const observer = new ResizeObserver(() => { fitAngs(); alignActive(); });
    observer.observe(viewport);
    const row = viewport.querySelector<HTMLElement>("[aria-current=true]");
    if (row) observer.observe(row);
    void document.fonts.ready.then(() => {
      if (!cancelled) {
        if (fontRevision.current === 0) fontRevision.current = 1;
        fitAngs(); alignActive();
      }
    });
    const fontsLoaded = () => { fontRevision.current++; fitAngs(); alignActive(); };
    document.fonts.addEventListener("loadingdone",fontsLoaded);
    return () => { cancelled = true; observer.disconnect(); document.fonts.removeEventListener("loadingdone",fontsLoaded); };
  }, [pages,current.id,alignActive,following,fitAngs]);

  const nextAng = pages.length ? pages[pages.length - 1].ang + 1 : activeAng + 1;
  const more = Boolean(source && nextAng <= source.length);
  const browseNext = useCallback(() => {
    if (!loading && more) { pauseFollowing(); void loadWindow(nextAng - 1,true); }
  }, [loading,more,loadWindow,nextAng,pauseFollowing]);
  useEffect(() => {
    if (following || !more || loading || !endRef.current || !scrollRef.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) browseNext();
    }, {root:scrollRef.current,rootMargin:"0px 0px 180px 0px"});
    observer.observe(endRef.current);
    return () => observer.disconnect();
  }, [following,more,loading,browseNext]);

  const displayPages = paathDisplayRows(shown,first => adaptivePairs.has(first.id));
  const dark = !appearance && palette.gurmukhi !== "#000000" && !["#1A191A","#000"].includes(palette.gurmukhi);
  const gurmukhiSize = Math.max(28,Math.min(appearance?.gurmukhiMaxSize ?? 60,fontSize * (appearance?.gurmukhiRatio ?? 1)));
  const translationSize = Math.max(18,Math.min(appearance?.translationMaxSize ?? 30,fontSize * (appearance?.translationRatio ?? .55)));
  return <Reader aria-label="Sehaj paath reader" style={{color:palette.gurmukhi,
    background:appearance ? palette.background : undefined,
    backgroundColor:palette.background === "none" ? "#e7e7e7" : undefined,
    paddingTop:appearance ? `${appearance.topInsetVh}vh` : undefined,
    paddingBottom:appearance ? `${appearance.bottomInsetVh}vh` : undefined,
    "--paath-inline-inset":appearance ? `${appearance.inlineInsetVw}vw` : undefined,
    "--paath-row-top":appearance ? "0px" : undefined,
    "--paath-row-gap":appearance ? `${appearance.rowGapPx}px` : undefined,
    "--paath-translation-gap":appearance ? `${appearance.translationGapPx}px` : undefined,
    "--paath-controls-bg":dark ? "#20242a" : "#eee"} as React.CSSProperties}>
    {(!following || error || (loading && !pages.length)) && <div className="paath-toolbar">
      {!following && <span>{source?.pageName ?? "Ang"} {activeAng}</span>}
      {!following && <button onClick={() => { forceAlign.current = true; setFollowing(true); void loadWindow(Number(currentRef.current.source_page)); }}>Follow paath</button>}
      {loading && <span role="status">Loading…</span>}
      {error && <><span role="alert">{error}</span><button onClick={() => {
        if (source) void loadWindow(activeAng);
        else resolveSource(current.shabad_id).then(setSource).catch(() => setError("Could not load paath. Please retry."));
      }}>Retry</button></>}
    </div>}
    <div ref={scrollRef} className="paath-scroll" data-following={following} tabIndex={0} aria-label="Paath panktis"
      onWheel={pauseFollowing} onTouchStart={pauseFollowing}
      onPointerDown={event => { if (event.target === scrollRef.current) pauseFollowing(); }}
      onKeyDown={event => {
        if (["ArrowDown","ArrowUp","PageDown","PageUp","Home","End"].includes(event.key)) {
          event.stopPropagation(); pauseFollowing();
        }
      }}>
      {displayPages.map(page => <section key={page.ang} data-ang={page.ang} aria-label={`${source?.pageName ?? "Ang"} ${page.ang}`}>
        <h2 className="paath-ang-heading">{source?.pageName ?? "Ang"} {page.ang}</h2>
        {page.rows.map(row => <div key={row[0].id} role="button" tabIndex={0}
          data-line-id={row[0].id} data-line-ids={row.map(pankti => pankti.id).join(" ")} className="paath-line"
          aria-current={row.some(pankti => pankti.id === current.id) ? "true" : undefined}
          onClick={() => { forceAlign.current = true; setFollowing(true); onSelect(row[0]); }}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); forceAlign.current = true; setFollowing(true); onSelect(row[0]); } }}>
          <div className="paath-line-content">
            <div lang="pa-Guru" style={{fontFamily:"Open Gurbani Akhar",fontWeight:appearance?.gurmukhiWeight,
              fontSize:`calc(${gurmukhiSize}px * var(--paath-text-scale, 1))`,whiteSpace:row.length === 2 ? "nowrap" : undefined,
              lineHeight:appearance?.gurmukhiLineHeight ?? 1.35}}><PaathGurmukhi text={row.map(pankti => pankti.gurmukhi).join(" ")} colors={palette.vishraam} /></div>
            {showPunjabi && <div className="paath-translation" lang="pa" style={{fontFamily:"Open Anmol Uni, sans-serif",fontSize:`calc(${translationSize}px * var(--paath-text-scale, 1))`,lineHeight:appearance?.translationLineHeight ?? 1.45,color:palette.punjabi}}>{joinedPaathTranslation(row,"punjabi_translation")}</div>}
            {showEnglish && <div className="paath-translation" lang="en" style={{fontFamily:"Noto Sans, sans-serif",fontSize:`calc(${translationSize}px * var(--paath-text-scale, 1))`,lineHeight:appearance?.translationLineHeight ?? 1.45,color:palette.english}}>{joinedPaathTranslation(row,"english_translation")}</div>}
          </div>
        </div>)}
      </section>)}
      <div ref={endRef} style={{height:1}} />
      {more && <button onClick={browseNext} disabled={loading}>Next {source?.pageName.toLowerCase() ?? "ang"}</button>}
    </div>
  </Reader>;
}
