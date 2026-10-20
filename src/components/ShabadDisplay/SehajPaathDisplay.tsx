import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import styled from "styled-components";
import { Pankti } from "../../models/Pankti";
import { ThemeColors } from "../../utils/useTheme";
import { getPaathSource, loadPaathAng, PaathAng, PaathAngCache, paathAngRange, PaathSource } from "../../utils/paathAngs";
import Format from "../../utils/Format";

const Reader = styled.div`
  height: 100%; width: 100%; overflow: hidden; display: flex; flex-direction: column;
  .paath-scroll { overflow-y: auto; overflow-anchor: none; flex: 1; min-height: 0; padding: 0 3vw 32vh; }
  .paath-columns { display: grid; grid-template-columns: var(--paath-columns); gap: 1.6rem; }
  .paath-line { padding: 18px 14px; border-bottom: 1px solid currentColor; border-bottom-color: #8884;
    border-left: 4px solid transparent; scroll-margin-top: 18vh; cursor: pointer; }
  .paath-line[aria-current="true"] { background: #8882; border-left-color: currentColor; }
  .paath-line > div { min-width: 0; overflow-wrap: anywhere; }
  .paath-toolbar { display: flex; gap: 16px; align-items: center; padding: 10px 3vw; flex: none; }
  button { border: 1px solid currentColor; border-radius: 6px; padding: 5px 12px; }
  button:disabled { opacity: .5; }
  .paath-headings { padding: 8px 14px; position: sticky; top: 0; background: var(--paath-heading-bg, #fff); z-index: 1; }
  @media (prefers-reduced-motion: reduce) { .paath-scroll { scroll-behavior: auto; } }
`;

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

/** Read ahead independently of the ASR highlight; retain only four adjacent angs. */
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
  const previousFirstAng = useRef<number>();
  const currentRef = useRef(current);
  currentRef.current = current;
  const activeAng = Number(current.source_page);

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
      previousFirstAng.current = undefined;
    }
    setLoading(true);
    setError("");
    try {
      const next = await cache.current.pages.window(paathAngRange(ang,source.length));
      if (myRequest !== request.current) return;
      const viewport = scrollRef.current;
      if (preservePosition && viewport) {
        const top = viewport.getBoundingClientRect().top;
        const anchor = Array.from(viewport.querySelectorAll<HTMLElement>("[data-line-id]"))
          .find(row => row.getBoundingClientRect().bottom > top + 30 &&
            next.some(page => page.panktis.some(pankti => pankti.id === row.dataset.lineId)));
        if (anchor) manualAnchor.current = {id:anchor.dataset.lineId!,top:anchor.getBoundingClientRect().top};
      }
      setPages(next);
    } catch {
      if (myRequest === request.current) setError("Could not load the next ang. Select Retry to try again.");
    } finally {
      if (myRequest === request.current) setLoading(false);
    }
  }, [source,loadAng]);

  useEffect(() => {
    if (following) void loadWindow(activeAng);
  }, [activeAng,loadWindow,following]);
  useEffect(() => () => { request.current++; }, []);

  const alignActive = useCallback((instant = false) => {
    const viewport = scrollRef.current;
    if (!viewport || !following) return;
    const row = viewport.querySelector<HTMLElement>("[aria-current=true]");
    if (!row) return;
    const offset = row.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    if (offset < viewport.clientHeight * .16 || offset > viewport.clientHeight * .42) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      viewport.scrollTo({top:viewport.scrollTop + offset - viewport.clientHeight * .25,
        behavior:instant || reduced ? "auto" : "smooth"});
    }
  }, [following]);

  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    if (manualAnchor.current) {
      const anchor = manualAnchor.current;
      const row = Array.from(viewport.querySelectorAll<HTMLElement>("[data-line-id]"))
        .find(row => row.dataset.lineId === anchor.id);
      if (row) viewport.scrollTop += row.getBoundingClientRect().top - anchor.top;
      manualAnchor.current = null;
    }
    const pageChanged = previousFirstAng.current !== pages[0]?.ang;
    previousFirstAng.current = pages[0]?.ang;
    alignActive(pageChanged);
  }, [pages,current.id,alignActive]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport || !following) return;
    let cancelled = false;
    const observer = new ResizeObserver(() => alignActive(true));
    observer.observe(viewport);
    const row = viewport.querySelector<HTMLElement>("[aria-current=true]");
    if (row) observer.observe(row);
    void document.fonts.ready.then(() => { if (!cancelled) alignActive(true); });
    return () => { cancelled = true; observer.disconnect(); };
  }, [pages,current.id,alignActive,following,showPunjabi,showEnglish,fontSize]);

  const nextAng = pages.length ? pages[pages.length - 1].ang + 1 : activeAng + 1;
  const more = Boolean(source && nextAng <= source.length);
  const browseNext = useCallback(() => {
    if (!loading && more) { setFollowing(false); void loadWindow(nextAng - 1,true); }
  }, [loading,more,loadWindow,nextAng]);
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
  const columns = `minmax(0, 1.2fr)${showPunjabi ? " minmax(0, 1fr)" : ""}${showEnglish ? " minmax(0, 1fr)" : ""}`;
  const dark = palette.gurmukhi !== "#000000" && !["#1A191A","#000"].includes(palette.gurmukhi);
  const gurmukhiSize = Math.max(22,Math.min(48,fontSize * .65));
  const translationSize = Math.max(16,Math.min(28,fontSize * .36));
  return <Reader aria-label="Sehaj paath reader" style={{color:palette.gurmukhi,
    "--paath-columns":columns,"--paath-heading-bg":dark ? "#20242a" : "#f3f3f1"} as React.CSSProperties}>
    <div className="paath-toolbar">
      <span aria-live="polite">{source?.pageName ?? "Ang"} {activeAng}</span>
      {!following && <button onClick={() => { setFollowing(true); void loadWindow(Number(currentRef.current.source_page)); }}>Follow paath</button>}
      {loading && <span role="status">Loading…</span>}
      {error && <><span role="alert">{error}</span><button onClick={() => {
        if (source) void loadWindow(activeAng);
        else resolveSource(current.shabad_id).then(setSource).catch(() => setError("Could not load paath. Please retry."));
      }}>Retry</button></>}
    </div>
    <div ref={scrollRef} className="paath-scroll" tabIndex={0} aria-label="Paath panktis"
      onWheel={() => setFollowing(false)} onTouchStart={() => setFollowing(false)}
      onPointerDown={event => { if (event.target === scrollRef.current) setFollowing(false); }}
      onKeyDown={event => {
        if (["ArrowDown","ArrowUp","PageDown","PageUp","Home","End"].includes(event.key)) {
          event.stopPropagation(); setFollowing(false);
        }
      }}>
      <div className="paath-columns paath-headings" style={{fontSize:16}}>
        <div>ਗੁਰਮੁਖੀ</div>{showPunjabi && <div>ਪੰਜਾਬੀ ਅਰਥ</div>}{showEnglish && <div>English translation</div>}
      </div>
      {shown.map(page => <section key={page.ang} data-ang={page.ang} aria-label={`${source?.pageName ?? "Ang"} ${page.ang}`}>
        <h2 style={{padding:"22px 14px 8px",fontSize:20}}>{source?.pageName ?? "Ang"} {page.ang}</h2>
        {page.panktis.map(pankti => <div key={pankti.id} role="button" tabIndex={0}
          data-line-id={pankti.id} className="paath-columns paath-line" aria-current={pankti.id === current.id ? "true" : undefined}
          onClick={() => { setFollowing(true); onSelect(pankti); }}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); setFollowing(true); onSelect(pankti); } }}>
          <div lang="pa-Guru" style={{fontFamily:"Open Gurbani Akhar",fontSize:gurmukhiSize,lineHeight:1.45}}>{Format.removeVishraams(pankti.gurmukhi)}</div>
          {showPunjabi && <div lang="pa" style={{fontFamily:"Open Anmol Uni, sans-serif",fontSize:translationSize,lineHeight:1.6,color:palette.punjabi}}>{pankti.punjabi_translation || "—"}</div>}
          {showEnglish && <div lang="en" style={{fontFamily:"Noto Sans, sans-serif",fontSize:translationSize,lineHeight:1.55,color:palette.english}}>{pankti.english_translation || "—"}</div>}
        </div>)}
      </section>)}
      <div ref={endRef} style={{height:1}} />
      {more && <button onClick={browseNext} disabled={loading}>Next {source?.pageName.toLowerCase() ?? "ang"}</button>}
    </div>
  </Reader>;
}
