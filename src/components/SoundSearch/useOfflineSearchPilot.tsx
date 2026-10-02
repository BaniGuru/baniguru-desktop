import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useContext as useCtxSelector } from "use-context-selector";
import { AppContext } from "../../state/providers/AppProvider";
import { SearchContext } from "../../state/providers/SearchProvider";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { SEARCH_SHABAD_PANKTI, SET_APP_PAGE, SET_PANKTIS, SHABAD_RESET } from "../../state/ActionTypes";
import { DB } from "../../utils/DB";
import { gurbaniSearch } from "../../utils/gurbaniSearch";
import { Pankti } from "../../models/Pankti";
import { RecordState } from "./useSpeech";
import { rankOfflinePanktis, selectOfflinePankti } from "./offlinePanktiMatch";

/** Search-only pilot used by the bundled offline ASR path. */
const useOfflineSearchPilot = (
  finalText: string,
  partialText: string,
  status: RecordState,
  startTranscription: (panktis: string[]) => Promise<void>,
) => {
  const [active, setActive] = useState(false);
  const { searchTerm, dispatch: searchDispatch } = useContext(SearchContext);
  const { dispatch: shabadDispatch } = useCtxSelector(ShabadContext);
  const { dispatch: appDispatch } = useContext(AppContext);
  const requestId = useRef(0);
  const lastSpeech = useRef("");

  const loadPanktis = useCallback(async (ids: string[]): Promise<Pankti[]> => {
    if (!ids.length) return [];
    const db = await DB.getInstance();
    const quoted = ids.map(id => `'${id.replaceAll("'", "''")}'`).join(",");
    const rows: any[] = await db.select(`
      SELECT lines.*, panktis.gurmukhi_speech, panktis.vishraam_idx,
             panktis.vishraam_ridx, panktis.gurmukhi_words, panktis.gurmukhi_rwords
      FROM lines
      INNER JOIN panktis ON lines.id = panktis.id
      WHERE lines.id IN (${quoted})
    `);
    const byId = new Map(rows.map(row => [row.id, {
      ...row,
      gurmukhi_words: JSON.parse(row.gurmukhi_words || "[]"),
      gurmukhi_rwords: JSON.parse(row.gurmukhi_rwords || "[]"),
    }]));
    return ids.map(id => byId.get(id)).filter(Boolean) as Pankti[];
  }, []);

  useEffect(() => {
    if (!active) {
      requestId.current += 1; // invalidate any search already in flight
      lastSpeech.current = "";
      return;
    }
    if (status === "Init") startTranscription([]);
    if (searchTerm) return;

    const speech = `${finalText} ${partialText}`.replace(/\s+/g, " ").trim();
    if (speech.split(" ").filter(Boolean).length < 2 || speech === lastSpeech.current) return;
    lastSpeech.current = speech;
    const myRequest = ++requestId.current;

    const run = async () => {
      const rawCandidates = await gurbaniSearch.search([speech], "search");
      if (myRequest !== requestId.current || !active) return;

      const candidates = rawCandidates.slice(0, 20);
      const selected = selectOfflinePankti(speech, candidates);
      const ranked = rankOfflinePanktis(speech, candidates).slice(0, 8);
      const panktis = await loadPanktis(ranked.map(row => row.id));
      if (myRequest !== requestId.current || !active) return;

      if (selected) {
        const pankti = panktis.find(row => row.id === selected.id);
        if (!pankti) return;
        shabadDispatch({ type: SHABAD_RESET });
        searchDispatch({ type: SEARCH_SHABAD_PANKTI, payload: { pankti } });
        appDispatch({ type: SET_APP_PAGE, payload: { page: "shabad", prev_page: "search", show_panel: false } });
        return;
      }

      // Ambiguous speech stays on Search and shows the best choices instead of
      // jumping to the wrong shabad.
      if (panktis.length) searchDispatch({ type: SET_PANKTIS, payload: panktis });
    };

    run().catch(error => console.error("Offline pankti search failed", error));
  }, [active, finalText, partialText, status, startTranscription, searchTerm, loadPanktis, shabadDispatch, searchDispatch, appDispatch]);

  return { setActive };
};

export default useOfflineSearchPilot;
