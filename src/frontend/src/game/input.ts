// Keyboard input: WASD -> a MoveEvent carrying a Direction.

import { Direction } from "../generated/slime-republics.js";
import type { Connection } from "./connection.js";
import { encodeClientInput } from "./protocol.js";

/** The one place the key-to-direction mapping lives. */
export const KEY_DIRECTIONS: Readonly<Record<string, Direction>> = {
  w: Direction.Up,
  s: Direction.Down,
  a: Direction.Left,
  d: Direction.Right,
};

export function directionForKey(key: string): Direction | null {
  return KEY_DIRECTIONS[key.toLowerCase()] ?? null;
}

/**
 * Sends one MoveEvent per keypress. Held keys repeat, because the OS key-repeat is a
 * reasonable movement cadence for a tile world and it keeps the client stateless — no
 * held-key set to get out of sync when the window loses focus mid-press.
 */
export function attachInput(
  connection: Connection,
  target: Pick<EventTarget, "addEventListener" | "removeEventListener"> = window,
): () => void {
  const onKeyDown = (event: Event) => {
    const keyboard = event as KeyboardEvent;
    // Never swallow a browser shortcut (ctrl+W, cmd+A) just because the letter matches.
    if (keyboard.ctrlKey || keyboard.metaKey || keyboard.altKey) return;

    const direction = directionForKey(keyboard.key);
    if (direction === null) return;

    keyboard.preventDefault();
    connection.send(encodeClientInput([{ kind: "move", direction }]));
  };

  target.addEventListener("keydown", onKeyDown);
  return () => target.removeEventListener("keydown", onKeyDown);
}
