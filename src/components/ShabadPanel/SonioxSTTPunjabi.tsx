import { useEffect } from "react";
import useSonioxClient from "./useSonioxClient";
import { useBaniPilot } from "../../utils/useBaniPilot";
import { cleanTokens } from "../../utils/autoPilotHelpers";
// import { AppContext } from "../../state/providers/AppProvider";

const API_KEY = "";


interface SonioxSTTPunjabiProps {
  speechTerms: string[];
  baniId: any;
}

const SonioxSTTPunjabi: React.FC<SonioxSTTPunjabiProps> = ({speechTerms}) => {
  const {
    startTranscription,
    stopTranscription,
    state,
    finalTokens,
    nonFinalTokens,
    error,
  } = useSonioxClient({
    apiKey: API_KEY,
    translationConfig: undefined,
    onStarted: () => console.log("Transcription started"),
    onFinished: () => console.log("Transcription finished"),
  });

  const {setSpeech, status} = useBaniPilot();

  useEffect(() => {
    const rawTokens = [...finalTokens, ...nonFinalTokens];

    setSpeech({
      tokens: cleanTokens(rawTokens),
      rawTokens,
      finalised: nonFinalTokens.length <= 0,
      endedAt: nonFinalTokens.length <= 0 
        ? (finalTokens.length > 0 ? finalTokens[finalTokens.length - 1]?.end_ms ?? 0 : 0) 
        : (nonFinalTokens[nonFinalTokens.length - 1].end_ms ?? 0),
    });
  }, [nonFinalTokens, finalTokens, setSpeech, cleanTokens]);

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif" }}>
    status: {status}
      <div style={{ marginBottom: 10 }}>
        Auto Pilot:
        <button
          onClick={() => startTranscription(speechTerms)}
          disabled={state === "Running"}
          style={{ marginRight: 10, marginLeft: 10, background: '#ccc', borderRadius: '5', border: '1px solid black', padding: "0 10px 0 10px" }}
        >
          Start
        </button>
        <button
          onClick={stopTranscription}
          disabled={state === "Init"}
          style={{ marginRight: 10, marginLeft: 10, background: '#ccc', borderRadius: '5', border: '1px solid black', padding: "0 10px 0 10px" }}
        >
          Stop
        </button>
        <span style={{marginLeft: 10}}>
          <strong>Status:</strong> {state}
        </span>
      </div>

      {state !== 'Init' &&
        <div style={{ marginBottom: 10 }}>
          <p style={{ background: "#f3f3f3", padding: 10 }}>
            Partial Tokens: {nonFinalTokens.map((t) => t.text).join("")}
          </p>
        </div>
      }

      {error && (
        <div style={{ color: "red" }}>
          <strong>Error:</strong> {error.message} (code: {error.errorCode})
        </div>
      )}
    </div>
  );
};

export default SonioxSTTPunjabi;
