import { useEffect, useRef, useState } from "react";
import { SHABAD_PANKTI } from "../../state/ActionTypes";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { useContext as useCtxSelector } from "use-context-selector";
import { RecordState } from "./useSpeech";
import { buildOfflineShabadMatchSequence, findCompletedOfflinePankti, findStrongOfflinePanktiMatch, stabilizeOfflinePanktiMatch } from "./offlinePanktiMatch";
import { useSettings } from "../../state/providers/SettingContext";
import { DB } from "../../utils/DB";
import { formatPanktis } from "../../utils/shabadUtil";
import { Pankti } from "../../models/Pankti";

type PreloadedShabad = { currentShabadId: string; shabadId: string; panktis: Pankti[] };

/** Word-based active-Pankti tracking for the offline RNNT transcript. */
const useOfflinePanktiPilot = (
  finalText: string,
  partialText: string,
  status: RecordState,
  startTranscription: (panktis: string[]) => Promise<void>,
) => {
  const [active, setActive] = useState(false);
  const shabadContext = useCtxSelector(ShabadContext);
  const { kirtanMode } = useSettings();
  const pendingMatch = useRef<ReturnType<typeof stabilizeOfflinePanktiMatch>["pending"]>(null);
  const lastAdvancedTokenEnd = useRef(-1);
  const [preloadedNextShabad, setPreloadedNextShabad] = useState<PreloadedShabad | null>(null);
  const shabadId = shabadContext.state.shabadId;
  const baniId = shabadContext.state.baniId;

  // Keep the next canonical Shabad ready while the current one is displayed.
  // Once it becomes current, this effect automatically preloads its successor.
  useEffect(() => {
    let cancelled = false;
    setPreloadedNextShabad(null);
    if (!active || baniId != null || !shabadId) return;

    const preload = async () => {
      try {
        const db = await DB.getInstance();
        const escapedShabadId = shabadId.replaceAll("'", "''");
        const rows: any[] = await db.select(`
          SELECT
            lines.*,
            panktis.gurmukhi_speech,
            panktis.vishraam_idx,
            panktis.vishraam_ridx,
            panktis.gurmukhi_words,
            panktis.gurmukhi_rwords,
            punjabi.translation AS punjabi_translation,
            english.translation AS english_translation,
            -1 AS line_group
          FROM shabads AS current_shabad
          INNER JOIN shabads AS next_shabad
            ON next_shabad.source_id = current_shabad.source_id
            AND next_shabad.order_id = (
              SELECT MIN(order_id)
              FROM shabads
              WHERE source_id = current_shabad.source_id
                AND order_id > current_shabad.order_id
            )
          INNER JOIN lines ON lines.shabad_id = next_shabad.id
          INNER JOIN panktis ON panktis.id = lines.id
          LEFT JOIN translations AS punjabi ON lines.id = punjabi.line_id AND (
            (next_shabad.source_id = 1 AND punjabi.translation_source_id = 6) OR
            (next_shabad.source_id != 1 AND punjabi.translation_source_id IN (8, 11, 13, 15, 17, 19, 21, 23))
          )
          LEFT JOIN translations AS english ON lines.id = english.line_id AND (
            (next_shabad.source_id = 1 AND english.translation_source_id = 1) OR
            (next_shabad.source_id != 1 AND english.translation_source_id IN (7, 9, 10, 12, 14, 16, 18, 20, 22, 24))
          )
          WHERE current_shabad.id = '${escapedShabadId}'
          ORDER BY lines.order_id
        `);
        if (cancelled || !rows?.length) return;

        const panktis = formatPanktis(rows) as Pankti[];
        panktis.forEach(pankti => { pankti.visited = false; });
        setPreloadedNextShabad({
          currentShabadId: shabadId,
          shabadId: String(rows[0].shabad_id),
          panktis,
        });
      } catch (error) {
        console.error("Could not preload the next offline Shabad", error);
      }
    };

    void preload();
    return () => { cancelled = true; };
  }, [active, baniId, shabadId]);

  useEffect(() => {
    if (!active || shabadContext.state.panktis.length === 0) return;
    if (status === "Init") {
      void startTranscription([]);
      return;
    }
    if (status !== "Running") return;

    // The offline final transcript already contains both committed and
    // provisional words merged by audio timestamp.
    const transcript = [finalText, partialText].filter(Boolean).join(" ").trim();
    if (!transcript) return;

    const current = shabadContext.state.current;
    const nextIsReady = baniId == null &&
      preloadedNextShabad?.currentShabadId === shabadId;
    const matchSequence = nextIsReady
      ? buildOfflineShabadMatchSequence(shabadContext.state.panktis, preloadedNextShabad.panktis)
      : { panktis: shabadContext.state.panktis, skippedNextPanktis: 0 };
    const match = !kirtanMode
      ? findCompletedOfflinePankti(shabadContext.state.panktis, transcript, current) ??
        findStrongOfflinePanktiMatch(matchSequence.panktis, transcript, 2, current)
      : findStrongOfflinePanktiMatch(matchSequence.panktis, transcript, 2, current);
    if (
      match &&
      match.panktiIdx > current &&
      match.tokenEndIndex <= lastAdvancedTokenEnd.current
    ) {
      pendingMatch.current = null;
      return;
    }
    const next = stabilizeOfflinePanktiMatch(
      current,
      match,
      pendingMatch.current,
      3,
    );
    pendingMatch.current = next.pending;
    if (next.currentIdx === shabadContext.state.current) return;
    lastAdvancedTokenEnd.current = match?.tokenEndIndex ?? lastAdvancedTokenEnd.current;

    if (
      nextIsReady &&
      next.currentIdx >= shabadContext.state.panktis.length
    ) {
      const nextCurrent = next.currentIdx - shabadContext.state.panktis.length +
        matchSequence.skippedNextPanktis;
      shabadContext.dispatch({
        type: "SHABAD_UPDATE",
        payload: {
          baniId: null,
          shabadId: preloadedNextShabad.shabadId,
          shabadIds: [preloadedNextShabad.shabadId],
          panktis: preloadedNextShabad.panktis,
          current: nextCurrent,
          home: nextCurrent,
        },
      });
      return;
    }

    shabadContext.dispatch({
      type: SHABAD_PANKTI,
      payload: { current: next.currentIdx },
    });
  }, [
    active,
    finalText,
    partialText,
    status,
    startTranscription,
    shabadContext.state.current,
    shabadContext.state.shabadId,
    shabadContext.state.baniId,
    shabadContext.state.panktis,
    shabadContext.dispatch,
    kirtanMode,
    preloadedNextShabad,
  ]);

  useEffect(() => {
    if (!active) {
      pendingMatch.current = null;
      lastAdvancedTokenEnd.current = -1;
    }
  }, [active]);

  return { setActive };
};

export default useOfflinePanktiPilot;
