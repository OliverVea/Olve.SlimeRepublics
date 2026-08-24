import {
  CloseCode,
  decodeReAuthAck,
  decodeServerHello,
  decodeWorldSnapshot,
  encodeMoveIntent,
  encodePong,
  encodeReAuth,
  Opcode,
  type ServerHello,
  type WorldSnapshot,
} from "./protocol.js";

/**
 * `client.ts` — the browser end of the realtime connection.
 *
 * ## The division of labour with HTTP
 * This client never sees a JWT. `getTicket` is the only thing it calls, and that call goes through
 * the app's normal authenticated HTTP path (`oidc.ts` → `Authorization: Bearer …`), which already
 * owns login, refresh and revocation. The socket only ever carries the short-lived, single-use
 * ticket that call returns.
 *
 * That is what makes token refresh work without dropping the connection: when the session nears
 * expiry, this client asks for a *new* ticket over HTTP — implicitly refreshing the underlying
 * token, because that is what the HTTP layer does on its own — and sends it as a `ReAuth` frame.
 * The server re-stamps the connection's deadline and the world state is never lost.
 */

/** Issues a handshake ticket over authenticated HTTP. Wire this to the app's HTTP client. */
export type TicketSource = () => Promise<{ ticket: string; sessionExpiresAtUnixSeconds: number }>;

export interface RealtimeClientOptions {
  /** Base URL of the API. `http(s)` is rewritten to `ws(s)`. */
  baseUrl: string;
  /** Fetches a handshake ticket. Must go through the authenticated HTTP client. */
  getTicket: TicketSource;
  /** The opening frame: which slime is yours. */
  onHello?: (hello: ServerHello) => void;
  /** Called once per tick. Render from this; never mutate positions locally as if authoritative. */
  onSnapshot?: (snapshot: WorldSnapshot) => void;
  /** Called on disconnect with the close code, so the caller can decide whether to retry. */
  onClose?: (code: number, reason: string) => void;
}

/** How far ahead of session expiry to re-auth, leaving room for the HTTP round trip. */
const REAUTH_LEAD_SECONDS = 60;

/** Close codes where reconnecting immediately would just loop. */
const FATAL_CLOSE_CODES: readonly number[] = [CloseCode.ProtocolError];

export class RealtimeClient {
  #socket: WebSocket | null = null;
  #reauthTimer: ReturnType<typeof setTimeout> | null = null;
  #entityId: number | null = null;
  #closed = false;

  constructor(private readonly options: RealtimeClientOptions) {}

  /** The slime this connection controls, once the hello has arrived. */
  get entityId(): number | null {
    return this.#entityId;
  }

  get isConnected(): boolean {
    return this.#socket?.readyState === WebSocket.OPEN;
  }

  /** Fetches a ticket over HTTP, then opens the socket with it. */
  async connect(): Promise<void> {
    this.#closed = false;
    const { ticket, sessionExpiresAtUnixSeconds } = await this.options.getTicket();

    const url = new URL("/ws", this.options.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("ticket", ticket);

    const socket = new WebSocket(url);
    // Without this the browser hands us Blobs and every frame costs an async read.
    socket.binaryType = "arraybuffer";
    this.#socket = socket;

    socket.addEventListener("message", (event) => this.#onMessage(event));
    socket.addEventListener("close", (event) => this.#onClose(event));

    this.#scheduleReAuth(sessionExpiresAtUnixSeconds);
  }

  /** Closes the connection and cancels the pending re-auth. */
  disconnect(): void {
    this.#closed = true;
    this.#clearReAuthTimer();
    this.#socket?.close(1000, "client disconnect");
    this.#socket = null;
  }

  /**
   * Sends a movement direction. Values are clamped to unit length by the server, which also owns
   * the speed — this only ever expresses *where*, never *how fast*.
   */
  sendMoveIntent(x: number, y: number): void {
    if (this.isConnected) {
      this.#socket?.send(encodeMoveIntent(x, y));
    }
  }

  #onMessage(event: MessageEvent): void {
    const view = new DataView(event.data as ArrayBuffer);

    switch (view.getUint8(0)) {
      case Opcode.WorldSnapshot:
        this.options.onSnapshot?.(decodeWorldSnapshot(view));
        break;

      case Opcode.ServerHello: {
        const hello = decodeServerHello(view);
        this.#entityId = hello.entityId;
        this.options.onHello?.(hello);
        break;
      }

      case Opcode.Ping:
        // Answering keeps the server's dead-peer timer from firing. Purely reactive — no state.
        this.#socket?.send(encodePong(view));
        break;

      case Opcode.ReAuthAck:
        this.#scheduleReAuth(decodeReAuthAck(view));
        break;

      default:
        // Forward compatible: a server that learns a new opcode must not break an old client.
        break;
    }
  }

  #onClose(event: CloseEvent): void {
    this.#clearReAuthTimer();
    this.#socket = null;
    this.#entityId = null;
    if (!this.#closed) {
      this.options.onClose?.(event.code, event.reason);
    }
  }

  /**
   * Arms the next re-auth for {@link REAUTH_LEAD_SECONDS} before the session lapses. Fetching a
   * ticket is what drives the HTTP refresh, so the socket's lifetime tracks the token's without
   * this client knowing anything about tokens.
   */
  #scheduleReAuth(sessionExpiresAtUnixSeconds: number): void {
    this.#clearReAuthTimer();

    const secondsUntil =
      sessionExpiresAtUnixSeconds - Math.floor(Date.now() / 1000) - REAUTH_LEAD_SECONDS;
    const delayMs = Math.max(secondsUntil, 1) * 1000;

    this.#reauthTimer = setTimeout(() => void this.#reauth(), delayMs);
  }

  async #reauth(): Promise<void> {
    if (!this.isConnected) return;

    try {
      const { ticket, sessionExpiresAtUnixSeconds } = await this.options.getTicket();
      this.#socket?.send(encodeReAuth(ticket));
      // Armed optimistically off the ticket; the server's ReAuthAck re-arms it authoritatively.
      this.#scheduleReAuth(sessionExpiresAtUnixSeconds);
    } catch {
      // The refresh failed, so the session is genuinely over. Let the server's AuthExpired close
      // land rather than guessing here — it is the side that decides.
    }
  }

  #clearReAuthTimer(): void {
    if (this.#reauthTimer !== null) {
      clearTimeout(this.#reauthTimer);
      this.#reauthTimer = null;
    }
  }
}

/** True when the close code means retrying is pointless. */
export function isFatalClose(code: number): boolean {
  return FATAL_CLOSE_CODES.includes(code);
}
