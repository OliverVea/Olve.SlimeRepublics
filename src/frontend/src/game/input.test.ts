import { describe, expect, it } from "vitest";
import { Direction } from "../generated/slime-republics.js";
import type { Connection } from "./connection.js";
import { attachInput, directionForKey, KEY_DIRECTIONS } from "./input.js";
import { decodeClientInput } from "./protocol.js";

function fakeConnection(): Connection & { sent: Uint8Array[] } {
  const sent: Uint8Array[] = [];
  return { sent, send: (p) => sent.push(p), close: () => {} };
}

describe("directionForKey", () => {
  it("maps WASD to the four directions", () => {
    expect(directionForKey("w")).toBe(Direction.Up);
    expect(directionForKey("a")).toBe(Direction.Left);
    expect(directionForKey("s")).toBe(Direction.Down);
    expect(directionForKey("d")).toBe(Direction.Right);
  });

  it("is case-insensitive, so shift+W still moves", () => {
    expect(directionForKey("W")).toBe(KEY_DIRECTIONS.w);
  });

  it("ignores unrelated keys", () => {
    expect(directionForKey("q")).toBeNull();
    expect(directionForKey("ArrowUp")).toBeNull();
  });
});

describe("attachInput", () => {
  it("sends a decodable MoveEvent on keydown", () => {
    const connection = fakeConnection();
    const target = new EventTarget();
    attachInput(connection, target);

    target.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));

    expect(connection.sent).toHaveLength(1);
    expect(decodeClientInput(connection.sent[0]!.buffer)).toEqual([
      { kind: "move", direction: Direction.Up },
    ]);
  });

  it("does not hijack browser shortcuts like ctrl+W", () => {
    const connection = fakeConnection();
    const target = new EventTarget();
    attachInput(connection, target);

    target.dispatchEvent(new KeyboardEvent("keydown", { key: "w", ctrlKey: true }));

    expect(connection.sent).toHaveLength(0);
  });

  it("stops sending once detached", () => {
    const connection = fakeConnection();
    const target = new EventTarget();
    const detach = attachInput(connection, target);

    detach();
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));

    expect(connection.sent).toHaveLength(0);
  });
});
