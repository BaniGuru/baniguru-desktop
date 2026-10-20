import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import styled from "styled-components";
import { Pankti } from "../../models/Pankti";
import { ThemeColors } from "../../utils/useTheme";
import { getPaathSource, loadPaathAng, PaathAng, PaathAngCache, paathAngRange, PaathSource } from "../../utils/paathAngs";
import Format from "../../utils/Format";

const Reader = styled.div`
  position: relative; height: 100%; width: 100%; overflow: hidden; display: flex;
  .paath-scroll { overflow-y: auto; overflow-anchor: none; scroll-behavior: auto;
    flex: 1; min-height: 0; padding: 0 5.4vw 32vh; }
  .paath-scroll[data-following="true"] { padding-bottom: 100vh; }
  .paath-line { height: calc(var(--paath-viewport-height, 100vh) / 4); box-sizing: border-box;
    padding: 10px 0 22px; cursor: pointer; overflow-wrap: anywhere; overflow: hidden; }
  .paath-line:focus-visible { outline: 2px solid #888; outline-offset: 4px; }
  .paath-translation { margin-top: calc(6px * var(--paath-text-scale, 1)); }
  .paath-ang-heading { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .paath-toolbar { position: absolute; right: 16px; top: 12px; z-index: 1;
    display: flex; gap: 12px; align-items: center; padding: 8px 12px;
    background: var(--paath-controls-bg, #eee); border-radius: 8px; max-width: 85%; }
  button { border: 1px solid currentColor; border-radius: 6px; padding: 5px 12px; }
  button:disabled { opacity: .5; }
`;

type ScrollAnimation = { frame: number; from: number; to: number; start: number; duration: number };

const PaathGurmukhi = ({text}: {text:string}) => <>{text.split(/(\s+)/).map((word,index) =>
  <Fragment key={index}>{/\s+/.test(word) ? word :
    <span style={{color:/;|<>|ੴ/.test(word) ? "#e65c00" : /[,.]/.test(word) ? "#2ca44f" : undefined}}>
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

/** Read four panktis at a time, advancing the passage when speech reaches row three. */
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
    const key = `${viewport.clientWidth}:${viewport.clientHeight}:${fontSize}:${showPunjabi}:${showEnglish}:${fontRevision.current}`;
    // Fit a complete Ang once, before it is read. All its panktis inherit one
    // shared scale, including short lines, so advancing never changes the font.
    for (const page of viewport.querySelectorAll<HTMLElement>("section[data-ang]")) {
      const rows = Array.from(page.querySelectorAll<HTMLElement>(".paath-line"));
      if (!rows.length) continue;
      const pageKey = `${key}:${rows.length}:${rows[0].dataset.lineId}:${rows[rows.length - 1].dataset.lineId}`;
      if (page.dataset.paathFit === pageKey) continue;
      const style = getComputedStyle(rows[0]);
      const available = rows[0].clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const contents = rows.map(row => row.querySelector<HTMLElement>(".paath-line-content")!);
      const fits = () => contents.every(content => content.scrollHeight <= available);
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
    }
  }, [fontSize,showPunjabi,showEnglish]);

  const alignActive = useCallback((instant = false): void => {
    const viewport = scrollRef.current;
    if (!viewport || !following) return;
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
    const viewport = scrollRef.current;
    if (!viewport) return;
    fitAngs();
    if (manualAnchor.current) {
      const anchor = manualAnchor.current;
      const row = Array.from(viewport.querySelectorAll<HTMLElement>("[data-line-id]"))
        .find(row => row.dataset.lineId === anchor.id);
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
  }, [pages,current.id,alignActive,fitAngs]);

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

  const fallbackIndex = fallbackPanktis.findIndex(row => row.id === current.id);
  const loadedCurrent = pages.some(page => page.ang === activeAng);
  const shown = pages.length && (!following || loadedCurrent) ? pages : [{ang:activeAng,
    panktis:fallbackIndex < 0 ? [current] : fallbackPanktis.slice(Math.max(0,fallbackIndex - 3),fallbackIndex + 12)}];
  const dark = palette.gurmukhi !== "#000000" && !["#1A191A","#000"].includes(palette.gurmukhi);
  const gurmukhiSize = Math.max(28,Math.min(60,fontSize));
  const translationSize = Math.max(18,Math.min(30,fontSize * .55));
  return <Reader aria-label="Sehaj paath reader" style={{color:palette.gurmukhi,
    backgroundColor:palette.background === "none" ? "#e7e7e7" : undefined,
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
      {shown.map(page => <section key={page.ang} data-ang={page.ang} aria-label={`${source?.pageName ?? "Ang"} ${page.ang}`}>
        <h2 className="paath-ang-heading">{source?.pageName ?? "Ang"} {page.ang}</h2>
        {page.panktis.map(pankti => <div key={pankti.id} role="button" tabIndex={0}
          data-line-id={pankti.id} className="paath-line" aria-current={pankti.id === current.id ? "true" : undefined}
          onClick={() => { forceAlign.current = true; setFollowing(true); onSelect(pankti); }}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); forceAlign.current = true; setFollowing(true); onSelect(pankti); } }}>
          <div className="paath-line-content">
            <div lang="pa-Guru" style={{fontFamily:"Open Gurbani Akhar",fontSize:`calc(${gurmukhiSize}px * var(--paath-text-scale, 1))`,lineHeight:1.35}}><PaathGurmukhi text={pankti.gurmukhi} /></div>
            {showPunjabi && <div className="paath-translation" lang="pa" style={{fontFamily:"Open Anmol Uni, sans-serif",fontSize:`calc(${translationSize}px * var(--paath-text-scale, 1))`,lineHeight:1.45,color:palette.punjabi}}>{pankti.punjabi_translation || "—"}</div>}
            {showEnglish && <div className="paath-translation" lang="en" style={{fontFamily:"Noto Sans, sans-serif",fontSize:`calc(${translationSize}px * var(--paath-text-scale, 1))`,lineHeight:1.45,color:palette.english}}>{pankti.english_translation || "—"}</div>}
          </div>
        </div>)}
      </section>)}
      <div ref={endRef} style={{height:1}} />
      {more && <button onClick={browseNext} disabled={loading}>Next {source?.pageName.toLowerCase() ?? "ang"}</button>}
    </div>
  </Reader>;
}
