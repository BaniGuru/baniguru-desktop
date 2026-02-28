import { ErrorStatus, RecorderState, SonioxClient, Token } from "@soniox/speech-to-text-web";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import useShabadPilot from "./useShabadPilot";
import { AppContext, PAGE_BANI, PAGE_SEARCH, PAGE_SHABAD } from "../../state/providers/AppProvider";
import { ShabadContext } from "../../state/providers/ShabadProvider";
import useBaniPilot from "./useBaniPilot";

const API_KEY = "";

type TranscriptionError = {
  status: ErrorStatus;
  message: string;
  errorCode: number | undefined;
};

const useSpeech = () => {
  const sonioxClient = useRef<SonioxClient | null>(null);
  const prevTermsRef: any = useRef();

  const [status, setStatus] = useState<RecorderState>("Init");
  const [finalTokens, setFinalTokens] = useState<Token[]>([]);
  const [speechTokens, setSpeechTokens] = useState<string[]>([]);
  const [nonFinalTokens, setNonFinalTokens] = useState<Token[]>([]);
  const [error, setError] = useState<TranscriptionError | null>(null);
  const [terms, setTerms] = useState<string[]>([]);
  const [restart, setRestart] = useState(false);
  const [started, setStarted] = useState(false);

  if (sonioxClient.current == null) {
    sonioxClient.current = new SonioxClient({
      apiKey: API_KEY,
    });
  }

  const onStarted = () => {
    if (restart) setRestart(false);

    console.log('speech started.');
  };

  const onFinished = () => {
    if (restart) {
      startTranscription(terms);
      setRestart(false);

      console.log('speech restarted.');
      return;
    }

    console.log('speech stopped.');
  };

  const startTranscription = useCallback(async (panktis: string[]) => {
    // console.log('start: ', panktis);setStatus('Running');return;
    if (status === 'Running') {
      console.log('Alert: Already started.');
      return;
    }

    setSpeechTokens([]);
    setFinalTokens([]);
    setNonFinalTokens([]);
    setError(null);
    setTerms(panktis);

    sonioxClient.current?.start({
      model: "stt-rt-v4",
      languageHints: ['pa'],
      enableEndpointDetection: false, // check
      enableLanguageIdentification: false,
      translation: undefined,
      context: {
        general: [{
          key: "topic", value: "sikh gurbani kirtan"
        }],
        terms: panktis
      },

      onFinished: onFinished,
      onStarted: onStarted,

      onError: (
        status: ErrorStatus,
        message: string,
        errorCode: number | undefined,
      ) => {
        setError({ status, message, errorCode });
      },

      onStateChange: ({ newState }) => {
        setStatus(newState);
      },

      onPartialResult(result) {
        const newFinalTokens: Token[] = [];
        const newNonFinalTokens: Token[] = [];

        for (const token of result.tokens) {
          if (token.is_final) {
            newFinalTokens.push(token);
          } else {
            newNonFinalTokens.push(token);
          }
        }

        setFinalTokens((previousTokens) => [
          ...previousTokens,
          ...newFinalTokens,
        ]);

        setNonFinalTokens(newNonFinalTokens);
      },
    });
  }, [onFinished, onStarted]);

  const stopTranscription = useCallback(() => {
    setRestart(false);
    sonioxClient.current?.stop();
  }, []);

  const appContext = useContext(AppContext);
  const shabadContext = useContext(ShabadContext);

  // const testSpeechTokens = ['ਧੰਨੁ ਧੰਨੁ ਰਾਮਦਾਸ ਗੁਰੁ, ਧੰਨੁ ਧੰਨੁ ਰਾਮਦਾਸ ਗੁਰੁ, ਜਿਨਿ ਸਿਰਿਆ ਤਿਨੈ ਸਵਾਰਿਆ'];
  const shabadPilot = useShabadPilot(speechTokens, status, startTranscription);
  const baniPilot = useBaniPilot(speechTokens, status, startTranscription, stopTranscription);

  useEffect(() => {
    if (!started && status !== 'Init') {
      stopTranscription();
      setStatus('Init');
    }

    if (started && appContext.state.page === PAGE_SEARCH && status !== 'Init') {
      stopTranscription();
      setStatus('Init');
    }

    if (started && appContext.state.page === PAGE_BANI && status !== 'Init') {
      stopTranscription();
      setStatus('Init');
    }

    shabadPilot.setActive(
      appContext.state.page === PAGE_SHABAD &&
      started &&
      (shabadContext.state.baniId === null)
    );

    baniPilot.setActive(
      appContext.state.page === PAGE_SHABAD &&
      started &&
      (shabadContext.state.baniId !== null)
    );
  }, [appContext.state.page, started]);

  useEffect(() => {
    const handleTranscription = async () => {
      if (terms.length <= 0) return;

      // Don't run if terms are the same as previous
      if (JSON.stringify(terms) === JSON.stringify(prevTermsRef.current)) {
        return;
      }

      setRestart(true);
      sonioxClient.current?.cancel();

      // todo: wait for finish
      //   while(sonioxClient.current?.state !== "Finished") {
      //     continue;
      //   }

      //   await startTranscription(terms);
      prevTermsRef.current = terms;
    };

    handleTranscription();
  }, [terms]);

  useEffect(() => {
    return () => {
      sonioxClient.current?.cancel();
    };
  }, []);

  useEffect(() => {
    let text = '';
    [...finalTokens, ...nonFinalTokens].forEach((token) => {
      text += token.text;
    });

    text = text.replaceAll('<end>', '');
    text = text.replaceAll('  ', ' ');

    if (text.trim() == "") {
      setSpeechTokens([]);
    }

    setSpeechTokens(text.trim().split("।"));
  }, [finalTokens, nonFinalTokens]);

  return {
    started,
    setStarted,
    speechTokens,
    status,
    terms,
    finalTokens,
    nonFinalTokens,
    error
  };
}

export default useSpeech;
