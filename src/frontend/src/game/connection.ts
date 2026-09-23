// Socket lifecycle: connect, decode, reconnect with backoff.
//
// In dev this talks to the C++ game server directly on its own port. Deployed, nginx serves
// the page and proxies /ws to the server, and the build sets VITE_WS_URL to that bare path.
//
// One connection is one slime. The server spawns a slime on open and despawns it on close
// (see backend/main.cpp), so a reconnect gets a *new* id; there is no way to reclaim the
// old one and the client must not assume its id is stable across drops.

import { decodeServerMessage, type ServerFrame } from "./protocol.js";

export type Status = "connecting" | "open" | "closed";

export interface ConnectionOptions {
  url?: string;
  onFrame: (frame: ServerFrame) => void;
  onStatus?: (status: Status, detail?: string) => void;
}

export interface Connection {
  /** Sends a frame if the socket is open; a no-op otherwise (a drop must not throw at callers). */
  send(payload: Uint8Array<ArrayBuffer>): void;
  close(): void;
}

const DEFAULT_PORT = 9001;
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5000;

// Derived from the page rather than hardcoded to localhost, so opening the app from a phone
// or another machine reaches *that* server and not the visiting device's own loopback. The
// scheme follows the page's, because a browser blocks ws:// from an https:// page.
function defaultUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.hostname}:${DEFAULT_PORT}`;
}

/** Resolves a bare path such as "/ws" against the page's origin; full URLs pass through. */
export function resolveUrl(url: string, page: Pick<Location, "protocol" | "host">): string {
  if (!url.startsWith("/")) return url;
  const scheme = page.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${page.host}${url}`;
}

export function connect(options: ConnectionOptions): Connection {
  const url = resolveUrl(
    options.url ?? import.meta.env.VITE_WS_URL ?? defaultUrl(),
    window.location,
  );

  let socket: WebSocket | null = null;
  let retryMs = RECONNECT_MIN_MS;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const status = (s: Status, detail?: string) => options.onStatus?.(s, detail);

  function open(): void {
    if (disposed) return;

    status("connecting", url);
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    socket = ws;

    ws.onopen = () => {
      retryMs = RECONNECT_MIN_MS;
      status("open", url);
    };

    ws.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      options.onFrame(decodeServerMessage(event.data));
    };

    // onerror carries no useful detail in browsers; the close that follows reports the state.
    ws.onclose = () => {
      socket = null;
      if (disposed) return;
      status("closed", `retrying in ${retryMs} ms`);
      retryTimer = setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, RECONNECT_MAX_MS);
    };
  }

  open();

  return {
    send(payload: Uint8Array<ArrayBuffer>) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(payload);
    },
    close() {
      disposed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      // Drop the handler first: this close is intentional, so it must not schedule a retry.
      if (socket) {
        socket.onclose = null;
        socket.close();
        socket = null;
      }
      status("closed", "disposed");
    },
  };
}
