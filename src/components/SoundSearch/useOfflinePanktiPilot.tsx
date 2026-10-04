import { useEffect, useRef, useState } from "react";
import { SHABAD_PANKTI } from "../../state/ActionTypes";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { useContext as useCtxSelector } from "use-context-selector";
import { RecordState } from "./useSpeech";
import { findStrongOfflinePanktiMatch, stabilizeOfflinePanktiMatch } from "./offlinePanktiMatch";

/** Word-based active-Pankti tracking for the offline RNNT transcript. */
const useOfflinePanktiPilot = (
  finalText: string,
  partialText: string,
  status: RecordState,
  startTranscription: (panktis: string[]) => Promise<void>,
) => {
  const [active, setActive] = useState(false);
  const shabadContext = useCtxSelector(ShabadContext);
  const pendingMatch = useRef<ReturnType<typeof stabilizeOfflinePanktiMatch>["pending"]>(null);

  useEffect(() => {
    if (!active || shabadContext.state.panktis.length === 0) return;
    if (status === "Init") {
      void startTranscription([]);
      return;
    }
    if (status !== "Running") return;

    // The offline final transcript already contains both committed and
    // provisional words merged by audio timestamp.
    const transcript = finalText.trim() || partialText.trim();
    if (!transcript) return;

    const match = findStrongOfflinePanktiMatch(
      shabadContext.state.panktis,
      transcript,
      2,
      shabadContext.state.current,
    );
    const next = stabilizeOfflinePanktiMatch(
      shabadContext.state.current,
      match,
      pendingMatch.current,
    );
    pendingMatch.current = next.pending;
    if (next.currentIdx === shabadContext.state.current) return;

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
    shabadContext.state.panktis,
    shabadContext.dispatch,
  ]);

  useEffect(() => {
    if (!active) pendingMatch.current = null;
  }, [active]);

  return { setActive };
};

export default useOfflinePanktiPilot;
