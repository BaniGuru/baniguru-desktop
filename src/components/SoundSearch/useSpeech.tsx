import { ErrorStatus, SonioxClient } from "@soniox/speech-to-text-web";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import useShabadPilot from "./useShabadPilot";
import { AppContext, PAGE_ANNOUNCEMENT, PAGE_BANI, PAGE_RECENT, PAGE_SEARCH, PAGE_SHABAD } from "../../state/providers/AppProvider";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import useBaniPilot from "./useBaniPilot";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettings } from "../../state/providers/SettingContext";
import { useContext as useCtxSelector } from "use-context-selector";
import useSearchPilot from "./useSearchPilot";
import { ENV } from "../../utils/env";
import { ApiClient } from "../../utils/apiClient";

const API_KEY = ENV.speechToken;
const API_URL = ENV.apiUrl;
const API_TOKEN = ENV.apiToken;

type TranscriptionError = {
  status: ErrorStatus;
  message: string;
  errorCode: number | undefined;
};

export type RecordState = "Init" | "Running" | "Starting" | "Restarting";

const useSpeech = ({apiClient}: {apiClient: ApiClient|null}) => {
  const sonioxClient = useRef<SonioxClient | null>(null);

  const status = useRef<RecordState>("Init");
  const startPage = useRef<string|null>(null);
  const [speechTokens, setSpeechTokens] = useState<string[]>([]);
  const [error, setError] = useState<TranscriptionError | null>(null);
  const [terms, setTerms] = useState<string[]>([]);
  const [started, setStarted] = useState(false);
  const appContext = useContext(AppContext);
  const shabadContext = useCtxSelector(ShabadContext);

  const transcriptRef = useRef("");
  const listenerRef = useRef(false);
  const [finalText, setFinalText] = useState("");
  const [newFinalToken, setNewFinalToken] = useState<string>("");
  const [nonFinalText, setNonFinalText] = useState("");
  const [lastTokenTime, setLastTokenTime] = useState(0);
  const { autoSearch, audioStream, micName } = useSettings();
  const [silenceSeconds, setSilenceSeconds] = useState(0);
  const [silenceStart, setSilenceStart] = useState<number|null>(null);
  const prevLastEndMsRef = useRef<number|null>(null);

  const startSpeech = useCallback(async() => {
    setStarted(true);

    if (audioStream) {
      await invoke('start_stream', {
        micName: micName,
        apiUrl: API_URL,
        apiToken: API_TOKEN,
      });
    }
  }, [audioStream, micName, API_URL, API_TOKEN]);

  const stopSpeech = useCallback(async () => {
    setStarted(false);

    if (audioStream) {
      await invoke('stop_stream');
    }
  }, [audioStream]);

  useEffect(() => {

    if (listenerRef.current) return;
    listenerRef.current = true;

    let unlistenFn: any;

    listen("soniox_transcript", (event: any) => {

      const { final, partial, end_ms } = event.payload;

      if (final) {
        transcriptRef.current += final.replaceAll('<end>', '');
        setNewFinalToken(final.replaceAll('<end>', ''));
        setFinalText(transcriptRef.current);
      } else {
        setNewFinalToken("");
      }

      setNonFinalText(partial);

      setLastTokenTime(end_ms);

    }).then(fn => {
      unlistenFn = fn;
    });

    return () => {
      if (unlistenFn) unlistenFn();
    };

  }, []);

  useEffect(() => {
    if ((newFinalToken == "" && nonFinalText == "")) {
      return;
    }

    apiClient?.sendToken({
      final: newFinalToken,
      partial: nonFinalText,
      corrected: "",
      status: status.current,
      line_id: "",
      shabad_id: "",
      page: appContext.state.page,
    });
  }, [newFinalToken, nonFinalText, appContext.state.page, apiClient]);

  useEffect(() => {
    const addToken = (final: string, partial: string) => {
      setFinalText(prev => prev + final);
      setNonFinalText(partial);
    };

    (window as any).addToken = addToken;

    return () => {
      delete (window as any).addToken;
    };
  }, []);

  if (sonioxClient.current == null) {
    sonioxClient.current = new SonioxClient({
      apiKey: API_KEY,
    });
  }

  const startTranscription = useCallback(async (panktis: string[]) => {
    if (micName === "") {
      setNonFinalText("Mic not selected.");
      setStarted(false);
      return;
    }

    if (status.current === "Starting" || status.current === "Running") {
      console.log("already started");
      return;
    }

    status.current = 'Starting';
    transcriptRef.current = "";
    setFinalText("");
    setNonFinalText("");
    setSpeechTokens([]);
    setError(null);
    setTerms(panktis);
    startPage.current = appContext.state.page;

    try {
      await invoke('start_soniox', { micName: micName, apiKey: API_KEY, panktis });
    } catch (error) {
      setStarted(false);
      setNonFinalText("Error: could not start.");
      console.error('Error starting Soniox:', error);
      return;
    }

    status.current = 'Running';
    console.log('started');
  }, [
    micName,
    API_KEY,
    setFinalText,
    setNonFinalText,
    setSpeechTokens,
    setError,
    setTerms,
    appContext.state.page,
  ]);

  const stopTranscription = useCallback(async () => {
    try {
        await invoke('stop_soniox');
      } catch (error) {
        console.error('Error stopping Soniox:', error);
        return;
      }

      setSilenceSeconds(0);
      setSilenceStart(null);
      status.current = 'Init';
      startPage.current = null;
      setFinalText("");
      setNonFinalText("");
      console.log('speech stopped');
  }, [setSilenceSeconds, setSilenceStart]);

  const restartTranscript = useCallback(async (panktis: string[]) => {
    if (status.current === "Restarting") {
      console.log("already restarted");
      return;
    }

    startPage.current = appContext.state.page;
    status.current = "Restarting";

    try {
      await invoke('restart_soniox', { micName: micName, apiKey: API_KEY, panktis });
    } catch (error) {
      setStarted(false);
      status.current = 'Init';
      console.error('Error restarting Soniox:', error);
      return;
    }

    transcriptRef.current = "";
    setFinalText("");
    setNonFinalText("");
    setSpeechTokens([]);
    setError(null);
    setTerms(panktis);
    status.current = 'Running';
    console.log('Restrated');
  }, [
    appContext.state.page,
  ]);

  const shabadPilot = useShabadPilot(finalText, nonFinalText, status.current, startPage.current, startTranscription, restartTranscript, silenceSeconds);
  const baniPilot = useBaniPilot(finalText, nonFinalText, status.current, startTranscription, restartTranscript, silenceSeconds);
  const searchPilot = useSearchPilot(finalText, nonFinalText, status.current, startTranscription, restartTranscript);

  const resetText = () => {
    transcriptRef.current = "";
    setFinalText("");
    setNonFinalText("");
  };

  useEffect(() => {
    if (!started && status.current !== 'Init') {
      stopTranscription();
      status.current = 'Init';
      resetText();
    }

    if (started &&
      (
        appContext.state.page === PAGE_RECENT ||
        appContext.state.page === PAGE_BANI ||
        (
          appContext.state.page === PAGE_SEARCH &&
          !autoSearch
        )
      ) &&
      status.current !== 'Init') {
      stopTranscription();
      status.current = 'Init';
    }

    if (started &&
        status.current !== 'Init' &&
        appContext.state.page !== startPage.current &&
        appContext.state.page === PAGE_SEARCH &&
        appContext.state.prev_page === PAGE_SHABAD
    ) {
      startPage.current = appContext.state.page;
    }

    shabadPilot.setActive(
      (appContext.state.page === PAGE_SHABAD ||
        appContext.state.page === PAGE_ANNOUNCEMENT
      ) &&
      started &&
      (shabadContext.state.baniId === null)
    );

    baniPilot.setActive(
      appContext.state.page === PAGE_SHABAD &&
      started &&
      (shabadContext.state.baniId !== null)
    );

    searchPilot.setActive(
      autoSearch &&
      appContext.state.page === PAGE_SEARCH &&
      started
    )
  }, [
    appContext.state.page,
    shabadContext.state.baniId,
    started,
    shabadPilot.setActive,
    baniPilot.setActive,
    resetText,
    autoSearch
  ]);

  const updateLastTokenElapse = useCallback((finalText: string, nonFinalText: string) => {
    // Silence begins when:
    // - we have a final token
    // - AND no nonFinal tokens exist
    // - AND it's a new final token
    if (
      finalText.length > 0 &&
      nonFinalText?.length === 0 &&
      lastTokenTime !== prevLastEndMsRef.current
    ) {
      setSilenceStart(Date.now());
      prevLastEndMsRef.current = lastTokenTime ?? null;
    }

    // Speech resumed → reset everything
    if (nonFinalText.length > 0) {
      setSilenceStart(null);
      setSilenceSeconds(0);
    }
  }, [setSilenceSeconds, prevLastEndMsRef, lastTokenTime, setSilenceSeconds, setSilenceStart]);

  useEffect(() => {
    updateLastTokenElapse(finalText, nonFinalText);
    
  }, [finalText, nonFinalText]);

  useEffect(() => {
    if (!silenceStart) return;

    const interval = setInterval(() => {
      const seconds = Math.floor((Date.now() - silenceStart) / 1000);
      setSilenceSeconds(seconds);
    }, 200);

    return () => clearInterval(interval);
  }, [silenceStart]);

  return {
    started,
    startSpeech,
    stopSpeech,
    speechTokens,
    status,
    terms,
    nonFinalText,
    error
  };
}

export default useSpeech;
