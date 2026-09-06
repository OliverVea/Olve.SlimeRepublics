// Wire encoding and decoding. The only file in src/game that touches src/generated/**.
//
// FlatBuffers accessors are views over the received buffer, so nothing here may hand one out:
// the buffer is reused as soon as the next frame arrives. Decode eagerly into plain objects
// and let the rest of the client stay unaware that FlatBuffers exists at all.
//
// The schema uses unions directly as vector elements, which costs the generated accessors
// their types — ServerMessage.events(i) is declared `(index: number, obj: any) => any`. The
// narrowing that flatc would have given us with a wrapper table is done by hand here, and
// nowhere else.

import { Builder, ByteBuffer } from "flatbuffers";
import {
  ClientEvent,
  ClientInput,
  type Direction,
  MoveEvent,
  PingEvent,
  PongEvent,
  ServerEvent,
  ServerMessage,
  WorldState,
} from "../generated/slime-republics.js";

export interface Slime {
  id: number;
  x: number;
  y: number;
}

export interface WorldSnapshot {
  slimes: Slime[];
}

/** Everything one server frame carried. Any of these may be empty. */
export interface ServerFrame {
  /** The latest world snapshot in the frame, or null if it carried none. */
  world: WorldSnapshot | null;
  /** origin_time values coming back from pings we sent — each completes an RTT sample. */
  pongs: number[];
  /** origin_time values the server wants echoed back. Opaque: never interpret, only return. */
  pings: number[];
}

// ------------------------------------------------------------------- decoding

function readWorldState(state: WorldState): WorldSnapshot {
  const slimes: Slime[] = [];
  for (let i = 0; i < state.slimesLength(); i++) {
    const slime = state.slimes(i);
    const position = slime?.position();
    if (!slime || !position) continue;
    slimes.push({ id: slime.id(), x: position.x(), y: position.y() });
  }
  return { slimes };
}

export function decodeServerMessage(data: ArrayBuffer): ServerFrame {
  const message = ServerMessage.getRootAsServerMessage(new ByteBuffer(new Uint8Array(data)));

  const frame: ServerFrame = { world: null, pongs: [], pings: [] };

  for (let i = 0; i < message.eventsLength(); i++) {
    switch (message.eventsType(i)) {
      case ServerEvent.WorldState: {
        const state = message.events(i, new WorldState()) as WorldState | null;
        if (state) frame.world = readWorldState(state);
        break;
      }
      case ServerEvent.PongEvent: {
        const pong = message.events(i, new PongEvent()) as PongEvent | null;
        if (pong) frame.pongs.push(pong.originTime());
        break;
      }
      case ServerEvent.PingEvent: {
        const ping = message.events(i, new PingEvent()) as PingEvent | null;
        if (ping) frame.pings.push(ping.originTime());
        break;
      }
      // ServerEvent.NONE, and anything a newer server adds: ignored rather than fatal, so an
      // older client keeps rendering against a newer server instead of going dark.
      default:
        break;
    }
  }

  return frame;
}

// ------------------------------------------------------------------- encoding

export type OutgoingEvent =
  | { kind: "move"; direction: Direction }
  | { kind: "ping"; originTime: number }
  | { kind: "pong"; originTime: number };

/**
 * Client -> server: a ClientInput carrying the given events.
 *
 * A union vector is two parallel vectors — the type tags and the offsets — which must be the
 * same length and in the same order, or the server's VerifyClientEventVector rejects the frame.
 *
 * Finished WITHOUT a file identifier: "SLIM" belongs to ServerMessage (the schema's root_type),
 * and the server verifies this buffer with VerifyBuffer<ClientInput>(nullptr) — a nullptr
 * identifier means it expects none. Stamping one here makes every frame fail verification.
 */
export function encodeClientInput(events: OutgoingEvent[]): Uint8Array<ArrayBuffer> {
  const builder = new Builder(128);

  const types: ClientEvent[] = [];
  const offsets: number[] = [];

  for (const event of events) {
    switch (event.kind) {
      case "move":
        types.push(ClientEvent.MoveEvent);
        offsets.push(MoveEvent.createMoveEvent(builder, event.direction));
        break;
      case "ping":
        types.push(ClientEvent.PingEvent);
        offsets.push(PingEvent.createPingEvent(builder, event.originTime));
        break;
      case "pong":
        types.push(ClientEvent.PongEvent);
        offsets.push(PongEvent.createPongEvent(builder, event.originTime));
        break;
    }
  }

  const typesOffset = ClientInput.createEventsTypeVector(builder, types);
  const eventsOffset = ClientInput.createEventsVector(builder, offsets);

  ClientInput.startClientInput(builder);
  ClientInput.addEventsType(builder, typesOffset);
  ClientInput.addEvents(builder, eventsOffset);
  builder.finish(ClientInput.endClientInput(builder));

  // Copy rather than hand out asUint8Array()'s view: that view aliases the builder's internal
  // buffer, and its ArrayBufferLike type is not what WebSocket.send accepts.
  return new Uint8Array(builder.asUint8Array());
}

/** Decodes what encodeClientInput produced. Exists so a test can prove the round trip. */
export function decodeClientInput(data: ArrayBufferLike): OutgoingEvent[] {
  const input = ClientInput.getRootAsClientInput(new ByteBuffer(new Uint8Array(data)));

  const events: OutgoingEvent[] = [];
  for (let i = 0; i < input.eventsLength(); i++) {
    switch (input.eventsType(i)) {
      case ClientEvent.MoveEvent: {
        const move = input.events(i, new MoveEvent()) as MoveEvent | null;
        if (move) events.push({ kind: "move", direction: move.direction() });
        break;
      }
      case ClientEvent.PingEvent: {
        const ping = input.events(i, new PingEvent()) as PingEvent | null;
        if (ping) events.push({ kind: "ping", originTime: ping.originTime() });
        break;
      }
      case ClientEvent.PongEvent: {
        const pong = input.events(i, new PongEvent()) as PongEvent | null;
        if (pong) events.push({ kind: "pong", originTime: pong.originTime() });
        break;
      }
      default:
        break;
    }
  }
  return events;
}
