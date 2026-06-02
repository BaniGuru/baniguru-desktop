import { SELECT_PANKTI, SET_APP_PAGE } from "../state/ActionTypes";
import { ENV } from "./env";

export type ApiToken = {
  final: string;
  partial: string;
  corrected: string | null;
  status: string;
  line_id: string;
  shabad_id: string;
  page: string;
};

export interface ApiClient {
  connect: () => void;
  disconnect: () => void;
  isOpen: () => boolean;
  sendToken: (token: ApiToken) => void;
  sendPage: (page: string) => void;
  sendPankti: (shabadId: string, current: number, home: number, baniId: number|null, visited: number[]) => void;
  sendSearchPanktis: (ids: string[]) => void;
}

export const apiClient = (shabadDispatch: React.Dispatch<any>, appDispatch: React.Dispatch<any>, setSearchTerm: any,
  searchDispatch: React.Dispatch<any>
): ApiClient => {
  let socket: WebSocket | null = null;

  const isOpen = (): boolean => {
    return (socket && socket.readyState === WebSocket.OPEN) ?? false;
  }

  const connect = () => {
    if (socket && socket.readyState === WebSocket.OPEN) return;

    socket = new WebSocket(
      `${ENV.wssApiUrl}?token=${ENV.apiToken}&appid=gurbani-explorer`
    );

    socket.onopen = () => {
      console.log("WebSocket connected");
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
                  show_panel: data.p === 'search' ? true : false,
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
        }
      } catch (err) {
        console.error("Invalid WS message:", err);
      }
    };

    socket.onclose = () => {
      console.log("WebSocket disconnected");
      // check reconnection
      // setTimeout(connect, 1000);
    };

    socket.onerror = (err) => {
      console.error("WebSocket error:", err);
    };
  };

  const disconnect = () => {
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

  return {
    connect,
    disconnect,
    isOpen,
    sendToken,
    sendPage,
    sendPankti,
    sendSearchPanktis,
  };
};