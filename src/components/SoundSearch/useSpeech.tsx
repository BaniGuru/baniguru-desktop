import { ErrorStatus, RecorderState, SonioxClient } from "@soniox/speech-to-text-web";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import useShabadPilot from "./useShabadPilot";
import { AppContext, PAGE_ANNOUNCEMENT, PAGE_BANI, PAGE_RECENT, PAGE_SEARCH, PAGE_SHABAD } from "../../state/providers/AppProvider";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import useBaniPilot from "./useBaniPilot";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettings } from "../../state/providers/SettingContext";
import { useContext as useCtxSelector } from "use-context-selector";

const API_KEY = "";

type TranscriptionError = {
  status: ErrorStatus;
  message: string;
  errorCode: number | undefined;
};

const useSpeech = () => {
  const sonioxClient = useRef<SonioxClient | null>(null);

  const [status, setStatus] = useState<RecorderState>("Init");
  const [speechTokens, setSpeechTokens] = useState<string[]>([]);
  const [error, setError] = useState<TranscriptionError | null>(null);
  const [terms, setTerms] = useState<string[]>([]);
  const [started, setStarted] = useState(false);

  const transcriptRef = useRef("");
  const listenerRef = useRef(false);
  const [finalText, setFinalText] = useState("");
  const [nonFinalText, setNonFinalText] = useState("");
  const [lastTokenTime, setLastTokenTime] = useState(0);

  useEffect(() => {

    if (listenerRef.current) return;
    listenerRef.current = true;

    let unlistenFn: any;

    listen("soniox_transcript", (event: any) => {

      const { final, partial, end_ms } = event.payload;

      if (final) {
        transcriptRef.current += final.replaceAll('<end>', '');
        setFinalText(transcriptRef.current);
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
    const addToken = (final: string, partial: string) => {
      setFinalText(prev => prev + final);
      setNonFinalText(partial);
    };

    (window as any).addToken = addToken;

    return () => {
      delete (window as any).addToken;
    };
  }, []);

  const [silenceSeconds, setSilenceSeconds] = useState(0);
  const [silenceStart, setSilenceStart] = useState<number|null>(null);
  const prevLastEndMsRef = useRef<number|null>(null);
  const {micName} = useSettings();

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

    if (status === 'Running') {
      console.log('Alert: Already started.');
      return;
    }

    transcriptRef.current = "";
    setFinalText("");
    setNonFinalText("");
    setSpeechTokens([]);
    setError(null);
    setTerms(panktis);
    setStatus('Running');

    try {
      await invoke('start_soniox', { micName: micName, apiKey: API_KEY, panktis });
    } catch (error) {
      console.error('Error starting Soniox:', error);
      return;
    }

    console.log('started');
  }, [
    status,
    micName,
    API_KEY,
    setFinalText,
    setNonFinalText,
    setSpeechTokens,
    setError,
    setTerms,
    setStatus
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
      setStatus('Init');
      console.log('speech stopped')
  }, [setStatus, setSilenceSeconds, setSilenceStart]);

  const restartTranscript = useCallback(async (panktis: string[]) => {
    try {
      await invoke('restart_soniox', { micName: micName, apiKey: API_KEY, panktis });
    } catch (error) {
      setStarted(false);
      setStatus('Init');
      console.error('Error restarting Soniox:', error);
      return;
    }

    transcriptRef.current = "";
    setFinalText("");
    setNonFinalText("");
    setSpeechTokens([]);
    setError(null);
    setTerms(panktis);
    setStatus('Running');
    console.log('Restrated');
  }, [
    setStarted,
    setStarted,
    setFinalText,
    setNonFinalText,
    setSpeechTokens,
    setError,
    setTerms,
    setStatus,
  ]);

  const appContext = useContext(AppContext);
  const shabadContext = useCtxSelector(ShabadContext);

  const shabadPilot = useShabadPilot(finalText, nonFinalText, status, startTranscription, silenceSeconds);
  const baniPilot = useBaniPilot(finalText, nonFinalText, status, startTranscription, restartTranscript, silenceSeconds);

  const resetText = () => {
    transcriptRef.current = "";
    setFinalText("");
    setNonFinalText("");
  };

  useEffect(() => {
    if (!started && status !== 'Init') {
      stopTranscription();
      setStatus('Init');
      resetText();
    }

    if (started &&
      (
        appContext.state.page === PAGE_SEARCH ||
        appContext.state.page === PAGE_RECENT ||
        appContext.state.page === PAGE_BANI
      ) &&
      status !== 'Init') {
      stopTranscription();
      setStatus('Init');
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
  }, [
    appContext.state.page,
    shabadContext.state.baniId,
    status,
    started,
    shabadPilot.setActive,
    baniPilot.setActive,
    resetText,
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
    setStarted,
    speechTokens,
    status,
    terms,
    nonFinalText,
    error
  };
}

export default useSpeech;
