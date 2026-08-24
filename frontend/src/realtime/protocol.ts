/**
 * `protocol.ts` — the browser half of the binary wire format defined in
 * `src/Olve.SlimeRepublics/Realtime/RealtimeProtocol.cs`.
 *
 * This file is hand-written on purpose. `api.json` describes the HTTP surface and Kiota generates
 * a client from it, but OpenAPI has no vocabulary for an upgraded connection — so the realtime
 * protocol has no generated client and never will. **The two files are a contract with no compiler
 * enforcing it: change one and you must change the other.** The server's
 * `RealtimeProtocolTests` pin the layout by byte offset so a drift here fails loudly there.
 *
 * Everything is little-endian, matching `BinaryPrimitives.Write*LittleEndian` on the server and
 * `DataView`'s `littleEndian = true` here.
 */

/** Opcodes ≤ this are session control; above it is state (`0x10+`) and intent (`0x20+`). */
export const CONTROL_RANGE_END = 0x0f;

export const Opcode = {
  /** Server → client, once: your entity id, the tick rate, and when your auth lapses. */
  ServerHello: 0x01,
  /** Client → server: a fresh ticket, extending this connection's auth in place. */
  ReAuth: 0x02,
  /** Server → client: re-auth accepted, here is the new deadline. */
  ReAuthAck: 0x03,
  /** Server → client: echo this timestamp back. */
  Ping: 0x04,
  /** Client → server: the echoed {@link Opcode.Ping} timestamp. */
  Pong: 0x05,
  /** Server → client: authoritative world state for one tick. */
  WorldSnapshot: 0x10,
  /** Client → server: desired direction. Carries no entity id — the server knows who you are. */
  MoveIntent: 0x20,
} as const;

/** Close codes in the application-reserved 4000–4999 range. */
export const CloseCode = {
  /** Auth deadline passed with no re-auth. Refresh over HTTP, then reconnect. */
  AuthExpired: 4001,
  /** Malformed frame — a bug on one side. Do not reconnect in a loop. */
  ProtocolError: 4002,
  /** This client fell too far behind the tick stream. Reconnect after a backoff. */
  TooSlow: 4003,
  /** No frame reached the server within its timeout. Reconnect. */
  HeartbeatTimeout: 4004,
  /** Server at capacity. Reconnect after a backoff. */
  ServerFull: 4005,
} as const;

const SNAPSHOT_HEADER_SIZE = 7;
const SNAPSHOT_ENTRY_SIZE = 12;

/** One slime's authoritative position for a given tick. */
export interface Slime {
  id: number;
  x: number;
  y: number;
}

/** A decoded {@link Opcode.WorldSnapshot}. */
export interface WorldSnapshot {
  tick: number;
  slimes: Slime[];
}

/** The connection's opening frame. */
export interface ServerHello {
  entityId: number;
  tickHz: number;
  /** Unix seconds. Schedule the HTTP refresh and follow-up re-auth against this. */
  authExpiresAt: number;
}

export function decodeServerHello(view: DataView): ServerHello {
  return {
    entityId: view.getUint32(1, true),
    tickHz: view.getUint8(5),
    authExpiresAt: Number(view.getBigInt64(6, true)),
  };
}

export function decodeWorldSnapshot(view: DataView): WorldSnapshot {
  const count = view.getUint16(5, true);
  const slimes: Slime[] = new Array(count);

  for (let i = 0; i < count; i++) {
    const offset = SNAPSHOT_HEADER_SIZE + i * SNAPSHOT_ENTRY_SIZE;
    slimes[i] = {
      id: view.getUint32(offset, true),
      x: view.getFloat32(offset + 4, true),
      y: view.getFloat32(offset + 8, true),
    };
  }

  return { tick: view.getUint32(1, true), slimes };
}

/** Reads the new auth deadline (unix seconds) out of a {@link Opcode.ReAuthAck}. */
export function decodeReAuthAck(view: DataView): number {
  return Number(view.getBigInt64(1, true));
}

/** Builds the {@link Opcode.Pong} answering a {@link Opcode.Ping}, echoing its timestamp verbatim. */
export function encodePong(pingFrame: DataView): ArrayBuffer {
  const buffer = new ArrayBuffer(9);
  const view = new DataView(buffer);
  view.setUint8(0, Opcode.Pong);
  view.setBigInt64(1, pingFrame.getBigInt64(1, true), true);
  return buffer;
}

/**
 * Builds a {@link Opcode.MoveIntent}. The server normalises anything longer than unit length and
 * applies its own speed, so the magnitude here only expresses intent below full throttle.
 */
export function encodeMoveIntent(x: number, y: number): ArrayBuffer {
  const buffer = new ArrayBuffer(9);
  const view = new DataView(buffer);
  view.setUint8(0, Opcode.MoveIntent);
  view.setFloat32(1, x, true);
  view.setFloat32(5, y, true);
  return buffer;
}

/** Builds a {@link Opcode.ReAuth} carrying a freshly issued ticket. */
export function encodeReAuth(ticket: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(ticket);
  const buffer = new ArrayBuffer(1 + encoded.byteLength);
  const bytes = new Uint8Array(buffer);
  bytes[0] = Opcode.ReAuth;
  bytes.set(encoded, 1);
  return buffer;
}
