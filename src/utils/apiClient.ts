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
  sendToken: (token: ApiToken) => void;
}

export const apiClient = (): ApiClient => {
  let socket: WebSocket | null = null;

  const connect = () => {
    if (socket && socket.readyState === WebSocket.OPEN) return;

    socket = new WebSocket(
      `wss://singhecloud.com/ws/?token=${ENV.apiToken}&appid=gurbani-explorer`
    );

    socket.onopen = () => {
      console.log("WebSocket connected");
    };

    socket.onmessage = (event) => {
      try {
        JSON.parse(event.data);
      } catch (err) {
        console.error("Invalid WS message:", err);
      }
    };

    socket.onclose = () => {
      console.log("WebSocket disconnected");
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

    if (!final || !partial) return;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn("WebSocket not connected");
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

  return {
    connect,
    disconnect,
    sendToken,
  };
};