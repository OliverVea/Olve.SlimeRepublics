// Gameplay smoke test: a few bots join a deployed server, hop around, and check the game
// actually works end to end. Run by the pipeline's bot-smoke step against beta before prod;
// `npm run smoke` runs it locally (SMOKE_URL / SMOKE_ORIGIN point it elsewhere).
//
// Passes only if every bot:
//   - connects, and stays connected for the whole run;
//   - receives world snapshots at close to the server's tick rate;
//   - sees its own slime move in response to its inputs;
//   - sees every other bot's slime (they share one world).
//
// Uses Node's built-in WebSocket, which, unlike a browser's, takes an Origin header; nginx
// refuses a handshake whose Origin is not the page's own.

import { decodeServerMessage, encodeClientInput } from "../src/game/protocol.js";
import { Direction } from "../src/generated/slime-republics.js";

const URL = process.env.SMOKE_URL ?? "wss://slimes-beta.ovea.pro/ws";
const ORIGIN = process.env.SMOKE_ORIGIN ?? new globalThis.URL(URL.replace(/^ws/, "http")).origin;
const BOTS = Number(process.env.SMOKE_BOTS ?? 3);
const SECONDS = Number(process.env.SMOKE_SECONDS ?? 60);

const TICK_HZ = 20;
// Generous: a snapshot rate this far below the tick rate means the server or the path to it
// is struggling, not jitter.
const MIN_SNAPSHOT_RATE = TICK_HZ * 0.75;
const HOP_MS = 400;
const CONNECT_TIMEOUT_MS = 10_000;
const DIRECTIONS = [Direction.Up, Direction.Down, Direction.Left, Direction.Right];

interface Bot {
  name: string;
  socket: WebSocket;
  id: number | null;
  snapshots: number;
  moves: number;
  firstPosition: string | null;
  lastPosition: string | null;
  positionsSeen: Set<string>;
  lastSeenIds: Set<number>;
  closedEarly: string | null;
}

const started = Date.now();
const log = (message: string) =>
  console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`);

function join(name: string): Promise<Bot> {
  return new Promise((resolve, reject) => {
    // Node's WebSocket takes an options object with headers; the DOM typings don't know that.
    const socket = new WebSocket(URL, { headers: { Origin: ORIGIN } } as unknown as string[]);
    socket.binaryType = "arraybuffer";

    const bot: Bot = {
      name,
      socket,
      id: null,
      snapshots: 0,
      moves: 0,
      firstPosition: null,
      lastPosition: null,
      positionsSeen: new Set(),
      lastSeenIds: new Set(),
      closedEarly: null,
    };

    const timeout = setTimeout(
      () => reject(new Error(`${name}: not identified within ${CONNECT_TIMEOUT_MS} ms`)),
      CONNECT_TIMEOUT_MS,
    );

    socket.onmessage = (event) => {
      const frame = decodeServerMessage(event.data as ArrayBuffer);
      if (frame.pings.length > 0) {
        socket.send(
          encodeClientInput(frame.pings.map((originTime) => ({ kind: "pong", originTime }))),
        );
      }
      if (!frame.world) return;

      bot.snapshots++;
      const ids = new Set(frame.world.slimes.map((slime) => slime.id));
      bot.lastSeenIds = ids;

      if (bot.id === null && ids.size > 0) {
        // There is no "this is you" message. The server spawns a slime on open and ids only
        // grow, so while bots join one at a time, a bot's slime is the newest in its first
        // snapshot.
        bot.id = Math.max(...ids);
        clearTimeout(timeout);
        log(`${name} joined as slime(${bot.id}); ${ids.size} slime(s) in the world`);
        resolve(bot);
      }

      const mine = frame.world.slimes.find((slime) => slime.id === bot.id);
      if (mine) {
        const position = `${mine.x},${mine.y}`;
        bot.firstPosition ??= position;
        bot.lastPosition = position;
        bot.positionsSeen.add(position);
      }
    };

    socket.onclose = (event) => {
      clearTimeout(timeout);
      if (!stopping) {
        bot.closedEarly = `code ${event.code}${event.reason ? ` (${event.reason})` : ""}`;
        log(`${name} disconnected early: ${bot.closedEarly}`);
      }
      reject(new Error(`${name}: closed before joining (code ${event.code})`));
    };
  });
}

let stopping = false;

async function main(): Promise<number> {
  log(`smoke: ${BOTS} bot(s) for ${SECONDS}s against ${URL} (Origin ${ORIGIN})`);

  // One at a time, so each bot's "newest slime" is its own.
  const bots: Bot[] = [];
  for (let i = 1; i <= BOTS; i++) bots.push(await join(`bot${i}`));

  const joinedAt = Date.now();
  for (const bot of bots) bot.snapshots = 0;

  const hop = setInterval(() => {
    for (const bot of bots) {
      if (bot.socket.readyState !== WebSocket.OPEN) continue;
      const direction = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
      bot.socket.send(encodeClientInput([{ kind: "move", direction }]));
      bot.moves++;
    }
  }, HOP_MS);

  const progress = setInterval(() => {
    const summary = bots.map((bot) => `${bot.name}@${bot.lastPosition}`).join(" ");
    log(`playing: ${summary}`);
  }, 15_000);

  await new Promise((resolve) => setTimeout(resolve, SECONDS * 1000));
  clearInterval(hop);
  clearInterval(progress);

  const elapsed = (Date.now() - joinedAt) / 1000;
  const botIds = bots.map((bot) => bot.id);
  const failures: string[] = [];

  for (const bot of bots) {
    const rate = bot.snapshots / elapsed;
    const unseen = botIds.filter((id) => id !== null && !bot.lastSeenIds.has(id));
    log(
      `${bot.name} slime(${bot.id}): ${bot.moves} moves, ${bot.positionsSeen.size} distinct ` +
        `positions, ${bot.firstPosition} -> ${bot.lastPosition}, ${rate.toFixed(1)} snapshots/s`,
    );

    if (bot.closedEarly) failures.push(`${bot.name} disconnected early: ${bot.closedEarly}`);
    if (rate < MIN_SNAPSHOT_RATE) {
      failures.push(`${bot.name} got ${rate.toFixed(1)} snapshots/s, want >= ${MIN_SNAPSHOT_RATE}`);
    }
    if (bot.positionsSeen.size < 2) failures.push(`${bot.name}'s slime never moved`);
    if (unseen.length > 0) failures.push(`${bot.name} cannot see slime(s) ${unseen.join(", ")}`);
  }

  stopping = true;
  for (const bot of bots) bot.socket.close(1000);

  if (failures.length > 0) {
    for (const failure of failures) log(`FAIL: ${failure}`);
    return 1;
  }
  log("PASS");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    log(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
