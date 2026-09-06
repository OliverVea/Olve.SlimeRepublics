// Entry point for the game client (its own Vite entry — see game.html and vite.config.ts,
// so the CRUD bundle carries none of this and vice versa).

import { connect, type Status } from "./connection.js";
import { attachInput } from "./input.js";
import { LatencyTracker } from "./latency.js";
import { encodeClientInput } from "./protocol.js";
import { TileMapRenderer } from "./tile-map.js";

const PING_INTERVAL_MS = 1000;

const canvas = document.querySelector<HTMLCanvasElement>("#world");
const statusEl = document.querySelector<HTMLElement>("#status");
const countEl = document.querySelector<HTMLElement>("#count");
const pingEl = document.querySelector<HTMLElement>("#ping");
if (!canvas) throw new Error("#world canvas missing");

const renderer = new TileMapRenderer(canvas);
renderer.render();

const latency = new LatencyTracker();

function renderPing(): void {
  if (!pingEl) return;
  latency.expire();

  const median = latency.median();
  pingEl.textContent = median === null ? "—" : `${Math.round(median)} ms`;

  // Unanswered pings are the honest signal on a bad link: the median can look fine while
  // every other probe vanishes. Surface that rather than averaging it away.
  const lost = latency.lostCount();
  pingEl.dataset.lost = lost > 0 ? String(lost) : "";
  pingEl.title = lost > 0 ? `${lost} ping(s) unanswered` : "round-trip time, median of last 9";
}

function setStatus(status: Status, detail?: string): void {
  if (!statusEl) return;
  statusEl.dataset.state = status;
  statusEl.textContent = detail ? `${status} — ${detail}` : status;

  // Samples describe a connection that no longer exists; carrying them across a reconnect
  // would show a healthy RTT for a socket that just died.
  if (status !== "open") {
    latency.reset();
    renderPing();
  }
}

const connection = connect({
  onStatus: setStatus,
  onFrame: (frame) => {
    if (frame.world) {
      renderer.render(frame.world);
      if (countEl) countEl.textContent = String(frame.world.slimes.length);
    }

    for (const originTime of frame.pongs) latency.recordPong(originTime);

    // The server may probe us too. Echo its clock reading back untouched — it is meaningless
    // to us, and interpreting it would be comparing two unsynchronised clocks.
    if (frame.pings.length > 0) {
      connection.send(
        encodeClientInput(frame.pings.map((originTime) => ({ kind: "pong", originTime }))),
      );
    }

    if (frame.pongs.length > 0) renderPing();
  },
});

const pingTimer = setInterval(() => {
  connection.send(encodeClientInput([{ kind: "ping", originTime: latency.startPing() }]));
  renderPing();
}, PING_INTERVAL_MS);

// WASD -> MoveEvent frames on the same socket.
const detachInput = attachInput(connection);

window.addEventListener("resize", () => renderer.render());

// One socket is one slime on the server. Without this, every HMR update leaks a connection
// and the world fills with slimes that no browser tab is holding open.
import.meta.hot?.dispose(() => {
  clearInterval(pingTimer);
  detachInput();
  connection.close();
});
