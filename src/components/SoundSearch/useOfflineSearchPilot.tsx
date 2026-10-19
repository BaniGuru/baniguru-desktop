import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useContext as useCtxSelector } from "use-context-selector";
import { AppContext } from "../../state/providers/AppProvider";
import { SearchContext } from "../../state/providers/SearchProvider";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { SEARCH_SHABAD_PANKTI, SET_APP_PAGE, SET_PANKTIS, SHABAD_RESET, SHABAD_UPDATE } from "../../state/ActionTypes";
import { DB } from "../../utils/DB";
import { gurbaniSearch } from "../../utils/gurbaniSearch";
import { Pankti } from "../../models/Pankti";
import { RecordState } from "./useSpeech";
import { rankOfflinePanktis } from "./offlinePanktiMatch";
import { BANI_ACTION_Add, BANI_ACTION_UPDATE, BaniContext } from "../../state/providers/BaniProvider";
import { getShabadIds } from "../../utils/shabadUtil";
import { loadBaniPanktis } from "../../utils/baniPanktis";
import { useSettings } from "../../state/providers/SettingContext";
import { buildOfflineSearchQueries } from "./offlinePanktiMatch";
import { decideOfflineSearch, needsOfflineSearch, PendingOfflineSearch } from "./offlineSearchDecision";

/** Search-only pilot used by the bundled offline ASR path. */
const useOfflineSearchPilot = (
  finalText: string,
  partialText: string,
  status: RecordState,
  startTranscription: (panktis: string[]) => Promise<void>,
  observationMs = 0,
) => {
  const [active, setActive] = useState(false);
  const { searchTerm, dispatch: searchDispatch } = useContext(SearchContext);
  const { state: displayState, dispatch: shabadDispatch } = useCtxSelector(ShabadContext);
  const { state: baniState, dispatch: baniDispatch } = useContext(BaniContext);
  const { dispatch: appDispatch } = useContext(AppContext);
  const { kirtanMode } = useSettings();
  const requestId = useRef(0);
  const lastSpeech = useRef("");
  const pendingSearch = useRef<PendingOfflineSearch>(null);
  const cachedCandidates = useRef<{ speech: string; rows: Pankti[] } | null>(null);

  const loadPanktis = useCallback(async (ids: string[]): Promise<Pankti[]> => {
    if (!ids.length) return [];
    const db = await DB.getInstance();
    const quoted = ids.map(id => `'${id.replaceAll("'", "''")}'`).join(",");
    const rows: any[] = await db.select(`
      SELECT lines.*, panktis.gurmukhi_speech, panktis.vishraam_idx,
             panktis.vishraam_ridx, panktis.gurmukhi_words, panktis.gurmukhi_rwords,
             bani_lines.bani_id, banis.name_gurmukhi AS bani_name_gurmukhi
      FROM lines
      INNER JOIN panktis ON lines.id = panktis.id
      LEFT JOIN bani_lines ON bani_lines.line_id = panktis.id
      LEFT JOIN banis ON banis.id = bani_lines.bani_id
      WHERE lines.id IN (${quoted})
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
    return ids.map(id => byId.get(id)).filter(Boolean) as Pankti[];
  }, []);

  useEffect(() => {
    if (!active) {
      requestId.current += 1; // invalidate any search already in flight
      lastSpeech.current = "";
      pendingSearch.current = null;
      cachedCandidates.current = null;
      return;
    }
    if (status === "Init") startTranscription([]);
    if (searchTerm) return;

    // Offline finalText is rebuilt from the accumulated timed-word history on
    // every rolling ASR event. Searching only partialText throws away the
    // preceding Panktis needed to identify a Kirtan Shabad reliably.
    const latestText = finalText.trim() || partialText.trim();
    const words = latestText
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean)
      .slice(-32);
    const speech = words.join(" ");
    const sameSpeech = speech === lastSpeech.current;
    if (speech.split(" ").filter(Boolean).length < 2 || (sameSpeech && !pendingSearch.current)) return;
    lastSpeech.current = speech;
    const context = {
      shabadId: displayState.shabadId,
      baniId: displayState.baniId,
      panktis: displayState.panktis,
    };
    if (!needsOfflineSearch(speech, context, kirtanMode)) {
      requestId.current += 1;
      pendingSearch.current = null;
      return;
    }
    const myRequest = ++requestId.current;

    // Fuse is more reliable with several phrase-sized searches than with one
    // long sentence spanning multiple panktis. Ranking still uses the whole
    // recent transcript window below.
    const searchQueries = buildOfflineSearchQueries(speech);

    const run = async () => {
      let loadedCandidates: Pankti[];
      if (sameSpeech && cachedCandidates.current?.speech === speech) {
        loadedCandidates = cachedCandidates.current.rows;
      } else {
        const candidates = (await gurbaniSearch.search(searchQueries, "search")).slice(0, 120);
        if (myRequest !== requestId.current || !active) return;
        loadedCandidates = await loadPanktis(candidates.map(row => row.id));
        cachedCandidates.current = {speech,rows:loadedCandidates};
      }
      if (myRequest !== requestId.current || !active) return;

      const rankedPanktis = (context.panktis.length ? [] : rankOfflinePanktis(speech, loadedCandidates))
        .slice(0, 8)
        .map(row => loadedCandidates.find(pankti => pankti.id === row.id))
        .filter(Boolean) as Pankti[];
      // Prefer accumulated evidence across multiple Panktis to a one-line
      // match so repeated lines and noisy suffixes do not trigger a fallback.
      const decision = decideOfflineSearch(speech, loadedCandidates, context, kirtanMode, pendingSearch.current, observationMs);
      pendingSearch.current = decision.pending;
      const selectedId = decision.selection?.row.id;

      if (selectedId) {
        const pankti = loadedCandidates.find(row => row.id === selectedId);
        if (!pankti) return;

        const baniId = decision.selection?.baniId;
        if (baniId) {
          const baniPanktis = await loadBaniPanktis(baniId);
          if (myRequest !== requestId.current || !active) return;
          const current = baniPanktis.findIndex(row => String(row.id) === String(pankti.id));
          if (current >= 0) {
            const payload = {
              baniId,
              panktis: baniPanktis,
              shabadIds: getShabadIds(baniPanktis),
              current,
              home: current,
            };
            if (baniState.banis.some(recent => recent.baniId === baniId)) {
              baniDispatch({ type: BANI_ACTION_UPDATE, payload });
            } else {
              baniDispatch({ type: BANI_ACTION_Add, payload });
            }
            shabadDispatch({ type: SHABAD_RESET });
            shabadDispatch({ type: SHABAD_UPDATE, payload: {
              ...payload,
              panktis: baniPanktis,
            } });
            appDispatch({ type: SET_APP_PAGE, payload: { page: "shabad", prev_page: "search", show_panel: true } });
            return;
          }
        }

        shabadDispatch({ type: SHABAD_RESET });
        searchDispatch({ type: SEARCH_SHABAD_PANKTI, payload: { pankti } });
        appDispatch({ type: SET_APP_PAGE, payload: { page: "shabad", prev_page: "search", show_panel: true } });
        return;
      }

      // Ambiguous speech stays on Search and shows the best choices instead of
      // jumping to the wrong shabad.
      if (rankedPanktis.length) searchDispatch({ type: SET_PANKTIS, payload: rankedPanktis });
    };

    run().catch(error => console.error("Offline pankti search failed", error));
  }, [active, finalText, partialText, status, startTranscription, searchTerm, loadPanktis, loadBaniPanktis, baniState.banis, baniDispatch, shabadDispatch, searchDispatch, appDispatch, kirtanMode, displayState.shabadId, displayState.baniId, displayState.panktis, observationMs]);

  return { setActive };
};

export default useOfflineSearchPilot;
