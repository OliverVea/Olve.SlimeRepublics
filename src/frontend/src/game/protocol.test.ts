import { describe, expect, it } from "vitest";
import { Direction } from "../generated/slime-republics.js";
import { decodeClientInput, decodeServerMessage, encodeClientInput } from "./protocol.js";

// A ServerMessage built by flatc itself (`flatc --binary common.fbs frame.json`), not by the
// TypeScript encoder. That is the whole point: a round-trip through our own encoder only
// proves we agree with ourselves, whereas this fails if the schema and src/generated drift
// apart, or if the union-vector layout is read wrongly.
//
//   events_type: [WorldState, PongEvent]
//   events:      [ {slimes: [{1, (3,1)}, {2, (-4,0)}]}, {origin_time: 1234.5} ]
const SERVER_FRAME =
  "14000000534c494d0000000008000c000400080008000000700000000400000002000000280000000c0000" +
  "0000000600120004000600000000000000004a934000000000000006000800040006000000040000000200" +
  "00002000000004000000f0ffffff02000000fcffffff000000000800100004000800080000000100000003" +
  "000000010000000200000001030000";

// events_type: [PongEvent, PingEvent]; events: [{99.25}, {7.5}] — a frame with no WorldState.
const PONG_ONLY_FRAME =
  "14000000534c494d0000000008000c00040008000800000040000000040000000200000028000000" +
  "0c0000000000060012000400060000000000000000001e4000000000000006000c0004000600000000" +
  "00000000d058400200000003020000";

function bytes(hex: string): ArrayBuffer {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out.buffer;
}

describe("decodeServerMessage", () => {
  it("reads a frame produced by flatc, not by our own encoder", () => {
    const frame = decodeServerMessage(bytes(SERVER_FRAME));

    expect(frame.world).toEqual({
      slimes: [
        { id: 1, x: 3, y: 1 },
        { id: 2, x: -4, y: 0 },
      ],
    });
    expect(frame.pongs).toEqual([1234.5]);
    expect(frame.pings).toEqual([]);
  });

  it("keeps negative coordinates signed", () => {
    // Vec2 is int32; reading it unsigned would turn -4 into 4294967292 and put the slime
    // billions of tiles away rather than four to the left.
    const frame = decodeServerMessage(bytes(SERVER_FRAME));
    expect(frame.world?.slimes[1]?.x).toBe(-4);
  });

  it("reports no world at all for a frame that carries none", () => {
    // Also flatc-built: events_type [PongEvent, PingEvent], origin_times 99.25 and 7.5.
    // A world-less frame must yield null, NOT an empty slime list — the renderer treats the
    // two differently, and confusing them blanks the map every time a pong arrives.
    const frame = decodeServerMessage(bytes(PONG_ONLY_FRAME));

    expect(frame.world).toBeNull();
    expect(frame.pongs).toEqual([99.25]);
    expect(frame.pings).toEqual([7.5]);
  });
});

describe("encodeClientInput", () => {
  it("round-trips every direction", () => {
    for (const direction of [Direction.Up, Direction.Down, Direction.Left, Direction.Right]) {
      expect(decodeClientInput(encodeClientInput([{ kind: "move", direction }]).buffer)).toEqual([
        { kind: "move", direction },
      ]);
    }
  });

  // Direction.Up is 0, which is also the field default — FlatBuffers omits a field equal to
  // its default, so an Up event carries no direction field at all and the reader falls back
  // to Up. It round-trips, but a decoder that treats "field absent" as an error breaks on it.
  it("round-trips Up, which serializes as an absent field", () => {
    expect(Direction.Up).toBe(0);
    expect(
      decodeClientInput(encodeClientInput([{ kind: "move", direction: Direction.Up }]).buffer),
    ).toEqual([{ kind: "move", direction: Direction.Up }]);
  });

  it("round-trips ping and pong timestamps exactly, fractions included", () => {
    // origin_time is a double precisely so sub-millisecond precision survives; ulong would
    // have truncated this to 12345.
    const originTime = 12345.678;
    expect(decodeClientInput(encodeClientInput([{ kind: "ping", originTime }]).buffer)).toEqual([
      { kind: "ping", originTime },
    ]);
    expect(decodeClientInput(encodeClientInput([{ kind: "pong", originTime }]).buffer)).toEqual([
      { kind: "pong", originTime },
    ]);
  });

  it("keeps the two union vectors aligned when batching mixed events", () => {
    // The type tags and the offsets are separate vectors; getting them out of step is the
    // failure mode this encoding invites, and the server rejects such a frame outright.
    const events = [
      { kind: "ping", originTime: 1 },
      { kind: "move", direction: Direction.Right },
      { kind: "pong", originTime: 2 },
    ] as const;
    expect(decodeClientInput(encodeClientInput([...events]).buffer)).toEqual(events);
  });

  // The server runs VerifyBuffer<ClientInput>(nullptr). A buffer finished with the "SLIM"
  // identifier (which belongs to ServerMessage) would be rejected, silently, as a bad frame.
  it("does not stamp the ServerMessage file identifier on client input", () => {
    const frame = encodeClientInput([{ kind: "move", direction: Direction.Right }]);
    expect(String.fromCharCode(...frame.slice(4, 8))).not.toBe("SLIM");
  });
});
