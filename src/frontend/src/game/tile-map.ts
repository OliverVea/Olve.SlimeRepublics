// A debug view of the world: a fixed 20x20 tile grid on a 2D canvas, with slimes drawn on
// the tiles they occupy.
//
// This is NOT the game client tech-design §2 describes (three.js WebGPU, isometric, its own
// bundle). It exists to prove the socket + wire format end to end and to have something to
// look at while the simulation grows. When the real renderer arrives it replaces this file;
// protocol.ts and connection.ts stay.
//
// The view never moves: the grid is always the 20 tiles centered on the origin, so a slime
// outside that window is simply not drawn. With 20 tiles there is no exact center tile, so
// the window is [-10, 9] and the origin tile (0,0) is marked.

import { Direction } from "../generated/slime-republics.js";
import { colorForId, labelColorOn } from "./palette.js";
import type { Slime, WorldSnapshot } from "./protocol.js";

const TILE_MIN = -10;
const TILE_COUNT = 20;
const TILE_MAX = TILE_MIN + TILE_COUNT - 1;

// Canvas deltas, NOT simulation deltas. toPixel flips y so +y is up in the world, which
// means Direction.Up is negative canvas y — writing this table in world coordinates and
// flipping it later is how the arrow ends up pointing the wrong way. Direction.None is
// absent on purpose: it is the wire default, so an unset heading draws no arrow rather than
// a confident one.
const HEADING_DELTAS: Partial<Record<Direction, readonly [number, number]>> = {
  [Direction.Up]: [0, -1],
  [Direction.Down]: [0, 1],
  [Direction.Left]: [-1, 0],
  [Direction.Right]: [1, 0],
};

const COLORS = {
  background: "#12141a",
  tile: "#1b1f29",
  tileAlt: "#20242f",
  origin: "#2c3444",
  grid: "#2f3542",
  axis: "#4a5468",
  slimeEdge: "#0f1f18",
};

export class TileMapRenderer {
  private readonly context: CanvasRenderingContext2D;
  private snapshot: WorldSnapshot = { slimes: [] };

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2d canvas context unavailable");
    this.context = context;
  }

  render(snapshot: WorldSnapshot = this.snapshot): void {
    this.snapshot = snapshot;

    // Size the backing store to the CSS box at device resolution, so the grid stays crisp
    // and a resize is picked up without a separate observer.
    const dpr = window.devicePixelRatio || 1;
    const size = Math.max(1, Math.min(this.canvas.clientWidth, this.canvas.clientHeight));
    const pixels = Math.round(size * dpr);
    if (this.canvas.width !== pixels || this.canvas.height !== pixels) {
      this.canvas.width = pixels;
      this.canvas.height = pixels;
    }

    const ctx = this.context;
    const tile = pixels / TILE_COUNT;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, pixels, pixels);

    this.drawTiles(tile, pixels);
    this.drawAxes(tile);

    for (const slime of this.snapshot.slimes) this.drawSlime(slime, tile);
  }

  /** Canvas x for tile x; y is flipped so +y is up, as the simulation means it. */
  private toPixel(tileX: number, tileY: number, tile: number): [number, number] {
    return [(tileX - TILE_MIN) * tile, (TILE_MAX - tileY) * tile];
  }

  private drawTiles(tile: number, pixels: number): void {
    const ctx = this.context;

    for (let y = TILE_MIN; y <= TILE_MAX; y++) {
      for (let x = TILE_MIN; x <= TILE_MAX; x++) {
        const [px, py] = this.toPixel(x, y, tile);
        const checker = (x + y) % 2 === 0 ? COLORS.tile : COLORS.tileAlt;
        ctx.fillStyle = x === 0 && y === 0 ? COLORS.origin : checker;
        ctx.fillRect(px, py, tile, tile);
      }
    }

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= TILE_COUNT; i++) {
      const at = Math.round(i * tile) + 0.5;
      ctx.moveTo(at, 0);
      ctx.lineTo(at, pixels);
      ctx.moveTo(0, at);
      ctx.lineTo(pixels, at);
    }
    ctx.stroke();
  }

  private drawAxes(tile: number): void {
    const ctx = this.context;
    const [originX, originY] = this.toPixel(0, 0, tile);

    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(originX, 0);
    ctx.lineTo(originX, this.canvas.height);
    ctx.moveTo(0, originY + tile);
    ctx.lineTo(this.canvas.width, originY + tile);
    ctx.stroke();
  }

  private drawSlime(slime: Slime, tile: number): void {
    // The window never moves, so a slime can be outside it. Drawing nothing would be a lie:
    // the header would read "slimes: 2" over an empty grid, which looks like a broken socket
    // rather than a slime that walked off. Mark it on the edge it left through instead.
    if (slime.x < TILE_MIN || slime.x > TILE_MAX || slime.y < TILE_MIN || slime.y > TILE_MAX) {
      this.drawOffscreenMarker(slime, tile);
      return;
    }

    const ctx = this.context;
    const [px, py] = this.toPixel(slime.x, slime.y, tile);
    const cx = px + tile / 2;
    const cy = py + tile / 2;

    const fill = colorForId(slime.id);

    // Before the body, so the circle covers the arrow's base and it reads as attached
    // rather than as a separate floating mark.
    this.drawHeading(slime, cx, cy, tile, fill);

    ctx.fillStyle = fill;
    ctx.strokeStyle = COLORS.slimeEdge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, tile * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = labelColorOn(fill);
    ctx.font = `${Math.round(tile * 0.32)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(slime.id), cx, cy);
  }

  /** A small triangle on the circle's edge showing which way the slime faces. Skipped for
   *  Direction.None and for anything a newer server adds, so an unknown heading is simply
   *  not drawn. Not applied to the offscreen marker: that view is already degraded and an
   *  arrow on it is noise. */
  private drawHeading(slime: Slime, cx: number, cy: number, tile: number, fill: string): void {
    const delta = HEADING_DELTAS[slime.heading];
    if (!delta) return;

    const [dx, dy] = delta;
    const ctx = this.context;

    // The body has radius 0.36 tile: the base sits just inside it, the tip just outside.
    const tipX = cx + dx * tile * 0.5;
    const tipY = cy + dy * tile * 0.5;
    const baseX = cx + dx * tile * 0.3;
    const baseY = cy + dy * tile * 0.3;
    // Perpendicular to the heading, giving the base its width.
    const spreadX = -dy * tile * 0.13;
    const spreadY = dx * tile * 0.13;

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX + spreadX, baseY + spreadY);
    ctx.lineTo(baseX - spreadX, baseY - spreadY);
    ctx.closePath();

    ctx.fillStyle = fill;
    ctx.strokeStyle = COLORS.slimeEdge;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }

  /** A hollow mark on the edge tile nearest an off-window slime, plus its distance out. */
  private drawOffscreenMarker(slime: Slime, tile: number): void {
    const ctx = this.context;
    const clampedX = Math.min(Math.max(slime.x, TILE_MIN), TILE_MAX);
    const clampedY = Math.min(Math.max(slime.y, TILE_MIN), TILE_MAX);
    const [px, py] = this.toPixel(clampedX, clampedY, tile);
    const cx = px + tile / 2;
    const cy = py + tile / 2;

    ctx.strokeStyle = colorForId(slime.id);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, tile * 0.26, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = colorForId(slime.id);
    ctx.font = `${Math.round(tile * 0.26)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(slime.id), cx, cy);
  }
}
