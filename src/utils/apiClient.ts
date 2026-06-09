import { SELECT_PANKTI, SET_APP_PAGE } from "../state/ActionTypes";
import { ENV } from "./env";
import * as Sentry from "@sentry/react";

export type ApiToken = {
  final: string;
  partial: string;
  corrected: string | null;
  status: string;
  line_id: string;
  shabad_id: string;
  page: string;
};

export type SpeechCommand = "start" | "pause" | "resume" | "stop";

export interface ApiClient {
  connect: () => void;
  disconnect: () => void;
  isOpen: () => boolean;
  setSpeechCommandHandler: (handler: ((command: SpeechCommand) => void) | null) => void;
  sendSpeechCommand: (command: SpeechCommand) => void;
  sendToken: (token: ApiToken) => void;
  sendPage: (page: string) => void;
  sendPankti: (shabadId: string, current: number, home: number, baniId: number|null, visited: number[]) => void;
  sendSearchPanktis: (ids: string[]) => void;
}

export const apiClient = (
  apiToken: string,
  shabadDispatch: React.Dispatch<any>,
  appDispatch: React.Dispatch<any>,
  setSearchTerm: any,
  searchDispatch: React.Dispatch<any>
): ApiClient => {
  let socket: WebSocket | null = null;
  let speechCommandHandler: ((command: SpeechCommand) => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let manuallyClosed = false;
  let reconnectAttempt = 0;

  const BASE_RECONNECT_MS = 5000;
  const MAX_RECONNECT_MS = 300000;

  const scheduleReconnect = () => {
    if (manuallyClosed) return;
    if (reconnectTimer) return;

    const delay = Math.min(
      BASE_RECONNECT_MS * 2 ** reconnectAttempt,
      MAX_RECONNECT_MS
    );

    reconnectAttempt += 1;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const isOpen = (): boolean => {
    return (socket && socket.readyState === WebSocket.OPEN) ?? false;
  }

  const connect = () => {
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    manuallyClosed = false;

    socket = new WebSocket(
      `${ENV.wssApiUrl}?token=${apiToken}&appid=gurbani-explorer`
    );

    socket.onopen = () => {
      console.log("WebSocket connected");
      reconnectAttempt = 0;
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "pankti") {
          const { c, h } = data;
          shabadDispatch({
            type: "SHABAD_HOME_WITH_PANKTI",
            payload: {
              current: c,
              home: h
            },
          });
        } else if (data.type === "page") {
          if (data.p  === 'search') {
            setSearchTerm('');
          }
          appDispatch({
              type: SET_APP_PAGE,
              payload: {
                  page: data.p,
                  show_panel: false,
              }
          });
        } else if (data.type === "search-term") {
          setSearchTerm(data.s);
        } else if (data.type === 'search-select') {
          searchDispatch({
            type: SELECT_PANKTI,
            payload: {
              id: data.id
            }
          });
          appDispatch({
              type: SET_APP_PAGE,
              payload: { page: "shabad", show_panel: false }
          });
        } else if (data.type === "speech") {
          const command = data.command as SpeechCommand;

          if (["start", "pause", "resume", "stop"].includes(command)) {
            speechCommandHandler?.(command);
          }
        }
      } catch (err) {
        console.error("Invalid WS message:", err);
      }
    };

    socket.onclose = (event) => {
      console.log("WebSocket disconnected");
      Sentry.captureMessage("WebSocket closed", {
        level: "warning",
        extra: {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        },
      });

      socket = null;
      scheduleReconnect();
    };

    socket.onerror = (err) => {
      console.error("WebSocket error:", err);
      Sentry.captureMessage("WebSocket error");
    };
  };

  const disconnect = () => {
    manuallyClosed = true;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    socket?.close();
    socket = null;
  };

  const sendToken = (token: ApiToken) => {
    const final = token.final?.trim() || "";
    const partial = token.partial?.trim() || "";

    if (!final && !partial) return;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "token",
        t: final,
        pt: partial,
        ct: token.corrected,
        st: token.status === "Running" ? "rn" : "nt",
        lid: token.line_id,
        sid: token.shabad_id,
        p: token.page,
      })
    );
  };

  const sendPage = (page: string) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn("WebSocket not connected");
      return;
    }

    socket.send(JSON.stringify({ type: "page", p: page }));
  };

  const sendPankti = (shabadId: string, current: number, home: number, baniId: number|null, visited: number[]) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify({
      type: "pankti",
      s: shabadId,
      c: current,
      h: home,
      b: baniId,
      visited: visited,
    }));
  }

  const sendSearchPanktis = (ids: string[]) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn("WebSocket not connected");
      return;
    }

    socket.send(JSON.stringify({
      type: "search-p",
      p: ids,
    }));
  }

  const setSpeechCommandHandler = (
    handler: ((command: SpeechCommand) => void) | null
  ) => {
    speechCommandHandler = handler;
  };

  const sendSpeechCommand = (command: SpeechCommand) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn("WebSocket not connected");
      return;
    }

    socket.send(JSON.stringify({
      type: "speech",
      command,
    }));
  };

  return {
    connect,
    disconnect,
    isOpen,
    setSpeechCommandHandler,
    sendSpeechCommand,
    sendToken,
    sendPage,
    sendPankti,
    sendSearchPanktis,
  };
};