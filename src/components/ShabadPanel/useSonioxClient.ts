import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  SonioxClient,
  type ErrorStatus,
  type RecorderState,
  type Token,
  type TranslationConfig,
} from "@soniox/speech-to-text-web";
import { cleanTokens } from "../../utils/autoPilotHelpers";
import { AppContext } from "../../state/providers/AppProvider";

interface UseSonioxClientOptions {
  apiKey: string | (() => Promise<string>);
  translationConfig?: TranslationConfig;
  onStarted?: () => void;
  onFinished?: () => void;
}

type TranscriptionError = {
  status: ErrorStatus;
  message: string;
  errorCode: number | undefined;
};

// useTranscribe hook wraps Soniox speech-to-text-web SDK.
export default function useSonioxClient({
  apiKey,
  translationConfig,
  onStarted,
  onFinished,
}: UseSonioxClientOptions) {
  const sonioxClient = useRef<SonioxClient | null>(null);

  
  const {terms} = useContext(AppContext);

  if (sonioxClient.current == null) {
    sonioxClient.current = new SonioxClient({
      apiKey: apiKey,
    });
  }

  const [state, setState] = useState<RecorderState>("Init");
  const [finalTokens, setFinalTokens] = useState<Token[]>([]);
  const [nonFinalTokens, setNonFinalTokens] = useState<Token[]>([]);
  const [error, setError] = useState<TranscriptionError | null>(null);
  const prevTermsRef: any = useRef();

  // useEffect(() => {
  //   const handleTranscription = async () => {
  //     if (terms.length <= 0) return;

  //     // Don't run if terms are the same as previous
  //     if (JSON.stringify(terms) === JSON.stringify(prevTermsRef.current)) {
  //       return;
  //     }

  //     sonioxClient.current?.cancel();
  //     await startTranscription(terms);
  //     prevTermsRef.current = terms;
  //   };

  //   handleTranscription();
  // }, [terms]);

  const searchTerms = [
    "ਬੈਰਾਗ",
    "ਚਾਉ",
    
  ]

  const startTranscription = useCallback(async (terms: string[]) => {
    setFinalTokens([]);
    setNonFinalTokens([]);
    setError(null);

    // First message we send contains configuration. Here we set if we set if we
    // are transcribing or translating. For translation we also set if it is
    // one-way or two-way.
    sonioxClient.current?.start({
      model: "stt-rt-v4",
      languageHints: ['pa'],
      // language_hints_strict: true,
      enableLanguageIdentification: false,
    //   enableSpeakerDiarization: true,
      enableEndpointDetection: true,
      translation: translationConfig || undefined,
      context: {
        general: [{
          key: "topic", value: "sikh gurbani kirtan"
        }],
        terms: terms.length < 1 ? searchTerms : terms
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
        setState(newState);
      },

      // When we receive some tokens back, sort them based on their status --
      // is it final or non-final token.
      onPartialResult(result) {
        const newFinalTokens: Token[] = [];
        const newNonFinalTokens: Token[] = [];

        let nonFinalText = "";

        for (const token of result.tokens) {
          if (token.is_final) {
            newFinalTokens.push(token);
          } else {
            newNonFinalTokens.push(token);
            nonFinalText += token.text;
          }
        }

        setFinalTokens((previousTokens) => [
          ...previousTokens,
          ...newFinalTokens,
        ]);
        setNonFinalTokens(newNonFinalTokens);
      },
    });
  }, [onFinished, onStarted, translationConfig]);

  const stopTranscription = useCallback(() => {
    sonioxClient.current?.stop();
  }, []);

  useEffect(() => {
    return () => {
      sonioxClient.current?.cancel();
    };
  }, []);

  return {
    startTranscription,
    stopTranscription,
    state,
    finalTokens,
    nonFinalTokens,
    error,
  };
}