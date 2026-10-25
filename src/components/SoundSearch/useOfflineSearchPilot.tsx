import { useCallback, useContext, useEffect, useRef, useState, MutableRefObject } from "react";
import { useContext as useCtxSelector } from "use-context-selector";
import { AppContext } from "../../state/providers/AppProvider";
import { SearchContext } from "../../state/providers/SearchProvider";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { SEARCH_SHABAD_PANKTI, SET_APP_PAGE, SET_PANKTIS, SHABAD_RESET, SHABAD_UPDATE } from "../../state/ActionTypes";
import { DB } from "../../utils/DB";
import { gurbaniSearch } from "../../utils/gurbaniSearch";
import { Pankti } from "../../models/Pankti";
import { RecordState } from "./useSpeech";
import { normalizeOfflineText, rankOfflinePanktis } from "./offlinePanktiMatch";
import { BANI_ACTION_Add, BANI_ACTION_UPDATE, BaniContext } from "../../state/providers/BaniProvider";
import { getShabadIds } from "../../utils/shabadUtil";
import { loadBaniPanktis } from "../../utils/baniPanktis";
import { useSettings } from "../../state/providers/SettingContext";
import { buildOfflineSearchQueries } from "./offlinePanktiMatch";
import { decideOfflineSearch, needsOfflineSearch, PendingOfflineSearch, relocationShabadIds } from "./offlineSearchDecision";

import { OfflinePilotCursor } from "./offlinePilotCursor";
import { stabilizeOfflineSearchResults, OfflineSearchResults } from "./offlineSearchResults";

/** Search-only pilot used by the bundled offline ASR path. */
const useOfflineSearchPilot = (
  finalText: string,
  partialText: string,
  status: RecordState,
  startTranscription: (panktis: string[]) => Promise<void>,
  observationMs = 0,
  tracking?: MutableRefObject<OfflinePilotCursor>,
) => {
  const [active, setActive] = useState(false);
  const { searchTerm, dispatch: searchDispatch } = useContext(SearchContext);
  const { state: displayState, dispatch: shabadDispatch } = useCtxSelector(ShabadContext);
  const { state: baniState, dispatch: baniDispatch } = useContext(BaniContext);
  const { state: appState, dispatch: appDispatch } = useContext(AppContext);
  const { kirtanMode } = useSettings();
  const loadPanktis = useCallback(async (ids: string[], shabads:string[] = []): Promise<Pankti[]> => {
    if (!ids.length && !shabads.length) return [];
    const db = await DB.getInstance();
    const quoted = ids.map(id => `'${id.replaceAll("'", "''")}'`).join(",");
    const shabadIds = shabads.map(id => `'${id.replaceAll("'", "''")}'`).join(",");
    const rows: any[] = await db.select(`
      SELECT lines.*, panktis.source_id, panktis.gurmukhi_speech, panktis.vishraam_idx,
             panktis.vishraam_ridx, panktis.gurmukhi_words, panktis.gurmukhi_rwords,
             bani_lines.bani_id, banis.name_gurmukhi AS bani_name_gurmukhi
      FROM lines
      INNER JOIN panktis ON lines.id = panktis.id
      LEFT JOIN bani_lines ON bani_lines.line_id = panktis.id
      LEFT JOIN banis ON banis.id = bani_lines.bani_id
      WHERE ${ids.length ? `lines.id IN (${quoted})` : "0"}
        OR ${shabads.length ? `lines.shabad_id IN (${shabadIds})` : "0"}
      ORDER BY bani_lines.bani_id
    `);
    const byId = new Map<string, any>();
    for (const row of rows) {
      const existing = byId.get(row.id) ?? {
        ...row,
        gurmukhi_words: JSON.parse(row.gurmukhi_words || "[]"),
        gurmukhi_rwords: JSON.parse(row.gurmukhi_rwords || "[]"),
        bani_ids: [],
        bani_names: [],
      };
      if (row.bani_id != null && !existing.bani_ids.includes(Number(row.bani_id))) {
        existing.bani_ids.push(Number(row.bani_id));
      }
      if (row.bani_name_gurmukhi && !existing.bani_names.includes(row.bani_name_gurmukhi)) {
        existing.bani_names.push(row.bani_name_gurmukhi);
      }
      byId.set(row.id, existing);
    }
    const selected = new Set(ids);
    return [...ids.map(id => byId.get(id)).filter(Boolean),
      ...[...byId.values()].filter(row => !selected.has(row.id))] as Pankti[];
  }, []);

  // Stream updates replace this snapshot. Searches run one at a time and read
  // the latest snapshot on each tick; a slower database call cannot be
  // invalidated forever by faster ASR events.
  const latest = useRef({finalText,partialText,status,startTranscription,searchTerm,
    displayState,baniState,appState,kirtanMode,observationMs});
  latest.current = {finalText,partialText,status,startTranscription,searchTerm,
    displayState,baniState,appState,kirtanMode,observationMs};

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let busy = false;
    let starting = false;
    let lastRun = {key:"",observationMs:-1};
    let contextKey = "";
    let pending: PendingOfflineSearch = null;
    let cached: {speech:string;rows:Pankti[];at:number;relocation?:boolean} | null = null;
    let results: OfflineSearchResults<Pankti> = {rows:[],publishedAt:0};

    const run = async () => {
      if (cancelled || busy) return;
      const args = latest.current;
      if (args.status === "Init") {
        if (!starting) {
          starting = true;
          try { await args.startTranscription([]); }
          catch (error) { starting = false; console.error("Could not start offline transcription",error); }
        }
        return;
      }
      starting = false;
      if (args.status !== "Running" || (args.appState.page === "search" && args.searchTerm.trim()) || !DB.getDbPath()) return;
      const fullSpeech = args.finalText.trim() || args.partialText.trim();
      const speech = fullSpeech.split(/\s+/).filter(Boolean).slice(-32).join(" ");
      const onSearch = args.appState.page === "search";
      const lastEvidence = tracking?.current.lastStrongEvidenceMs ?? tracking?.current.lastEvidenceMs ?? args.observationMs;
      const context = onSearch ? {shabadId:null,baniId:null,panktis:[]} : {
        shabadId:args.displayState.shabadId,baniId:args.displayState.baniId,
        panktis:args.displayState.panktis,current:args.displayState.current,
        recovering:!args.kirtanMode && args.observationMs - lastEvidence >= 10_000 &&
          normalizeOfflineText(fullSpeech).split(" ").length > (tracking?.current.lastStrongTokenEnd ?? -1) + 4,
        relocating:!args.kirtanMode && args.observationMs - lastEvidence >= 12_000,
      };
      const mode = `${args.appState.page}:${context.shabadId}:${context.baniId}:${context.current}:${context.recovering}:${context.relocating}`;
      if (contextKey !== mode) {
        pending = null;
        if (onSearch) {
          results = {rows:[],publishedAt:0};
          if (cached?.speech !== speech) cached = null;
          searchDispatch({type:SET_PANKTIS,payload:[]});
        }
        contextKey = mode;
      }
      if (!needsOfflineSearch(speech,context,args.kirtanMode)) { pending = null; return; }
      const key = `${mode}:${speech}`;
      const queryDue = !cached || ((cached.speech !== speech || !cached.rows.length) && Date.now() - cached.at >= 900);
      const awaiting = pending || results.challenger || (results.refreshAfter != null && args.observationMs >= results.refreshAfter);
      if (lastRun.key === key && (!awaiting || lastRun.observationMs === args.observationMs) && !queryDue) return;
      busy = true;
      try {
        let candidates = cached?.rows ?? [];
        if (queryDue) {
          const found = (await gurbaniSearch.search(buildOfflineSearchQueries(speech),"search")).slice(0,120);
          if (cancelled) return;
          candidates = await loadPanktis(found.map(row => row.id));
          cached = {speech,rows:candidates,at:Date.now()};
        }
        if (context.relocating && !cached?.relocation) {
          const neighbors = await loadPanktis([],relocationShabadIds(speech,candidates));
          const merged = new Map([...candidates,...neighbors].map(row => [row.id,row]));
          candidates = [...merged.values()];
          if (cached) cached = {...cached,rows:candidates,relocation:true};
        }
        if (cancelled || latest.current.appState.page !== args.appState.page ||
            latest.current.displayState.shabadId !== args.displayState.shabadId ||
            latest.current.displayState.current !== args.displayState.current ||
            latest.current.searchTerm !== args.searchTerm) return;
        lastRun = {key,observationMs:args.observationMs};
        if (onSearch) {
          const ranked = rankOfflinePanktis(speech,candidates).slice(0,8)
            .map(row => candidates.find(pankti => pankti.id === row.id)!).filter(Boolean);
          const stable = stabilizeOfflineSearchResults(results,ranked,args.observationMs);
          if (stable.rows !== results.rows) searchDispatch({type:SET_PANKTIS,payload:stable.rows});
          results = stable;
        }
        const decision = decideOfflineSearch(speech,candidates,context,args.kirtanMode,pending,args.observationMs);
        pending = decision.pending;
        const pankti = decision.selection?.row as Pankti | undefined;
        if (!pankti) return;
        const baniId = decision.selection!.baniId;
        if (baniId) {
          const baniPanktis = await loadBaniPanktis(baniId);
          if (cancelled || latest.current.appState.page !== args.appState.page ||
              latest.current.displayState.shabadId !== args.displayState.shabadId ||
              latest.current.displayState.current !== args.displayState.current ||
              latest.current.searchTerm !== args.searchTerm) return;
          const current = baniPanktis.findIndex(row => row.id === pankti.id);
          if (current < 0) return;
          const payload = {baniId,panktis:baniPanktis,shabadIds:getShabadIds(baniPanktis),current,home:current};
          baniDispatch({type:args.baniState.banis.some(bani => bani.baniId === baniId) ? BANI_ACTION_UPDATE : BANI_ACTION_Add,payload});
          shabadDispatch({type:SHABAD_UPDATE,payload});
        } else {
          shabadDispatch({type:SHABAD_RESET});
          searchDispatch({type:SEARCH_SHABAD_PANKTI,payload:{pankti}});
        }
        if (tracking) {
          tracking.current.lastStrongEvidenceMs = args.observationMs;
          tracking.current.lastStrongTokenEnd = normalizeOfflineText(fullSpeech).split(" ").length - 1;
          tracking.current.pending = null;
          tracking.current.recovery = undefined;
        }
        appDispatch({type:SET_APP_PAGE,payload:{page:"shabad",prev_page:"search",show_panel:true}});
      } catch (error) {
        // Leave this speech eligible for retry, including when the DB/index
        // becomes ready without another word being emitted.
        lastRun = {key:"",observationMs:-1};
        cached = null;
        console.error("Offline pankti search failed",error);
      } finally { busy = false; }
    };
    void run();
    const timer = setInterval(() => { void run(); },340);
    return () => {cancelled = true;clearInterval(timer);};
  }, [active,loadPanktis,baniDispatch,shabadDispatch,searchDispatch,appDispatch,tracking]);

  return { setActive };
};

export default useOfflineSearchPilot;
