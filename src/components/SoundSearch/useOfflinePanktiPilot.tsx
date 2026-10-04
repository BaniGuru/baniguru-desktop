import { useEffect, useState } from "react";
import { SHABAD_PANKTI } from "../../state/ActionTypes";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import { useContext as useCtxSelector } from "use-context-selector";
import { RecordState } from "./useSpeech";
import { findStrongOfflinePanktiMatch } from "./offlinePanktiMatch";

/** Word-based active-Pankti tracking for the offline RNNT transcript. */
const useOfflinePanktiPilot = (
  finalText: string,
  partialText: string,
  status: RecordState,
  startTranscription: (panktis: string[]) => Promise<void>,
) => {
  const [active, setActive] = useState(false);
  const shabadContext = useCtxSelector(ShabadContext);

  useEffect(() => {
    if (!active || shabadContext.state.panktis.length === 0) return;
    if (status === "Init") {
      void startTranscription([]);
      return;
    }
    if (status !== "Running") return;

    const transcript = `${finalText} ${partialText}`.trim();
    if (!transcript) return;

    const match = findStrongOfflinePanktiMatch(shabadContext.state.panktis, transcript);
    if (!match || match.panktiIdx === shabadContext.state.current) return;

    shabadContext.dispatch({
      type: SHABAD_PANKTI,
      payload: { current: match.panktiIdx },
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

  return { setActive };
};

export default useOfflinePanktiPilot;
