// Round-trip time, measured by echoing our own clock off the server.
//
// We send performance.now() in a PingEvent; the server returns it verbatim in a PongEvent.
// RTT is then now - origin_time, both readings from *our* clock — so no clock synchronisation
// is needed, and none is attempted. The value is meaningless to the server, which is why it
// only ever echoes it.
//
// Reported as a median, not a mean: on a congested link one 3-second stall would drag a mean
// for a long time and misrepresent the connection you actually have.

const DEFAULT_WINDOW = 9;
const DEFAULT_TIMEOUT_MS = 5000;

export interface LatencyOptions {
  /** How many recent samples the median is taken over. */
  window?: number;
  /** A ping unanswered for this long is written off, so a dropped pong cannot stall the readout. */
  timeoutMs?: number;
  now?: () => number;
}

export class LatencyTracker {
  private readonly window: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  /** origin_time of every ping still awaiting a pong. */
  private outstanding = new Set<number>();
  private samples: number[] = [];
  private lost = 0;

  constructor(options: LatencyOptions = {}) {
    this.window = options.window ?? DEFAULT_WINDOW;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? (() => performance.now());
  }

  /** Stamps a ping and records it as outstanding. Returns the origin_time to put on the wire. */
  startPing(): number {
    const originTime = this.now();
    this.outstanding.add(originTime);
    return originTime;
  }

  /** Completes a sample. Ignores an origin_time we never sent, or one already timed out. */
  recordPong(originTime: number): void {
    if (!this.outstanding.delete(originTime)) return;

    this.samples.push(this.now() - originTime);
    if (this.samples.length > this.window) this.samples.shift();
  }

  /** Writes off pings that have gone unanswered. Call before reading, or on a timer. */
  expire(): void {
    const cutoff = this.now() - this.timeoutMs;
    for (const originTime of this.outstanding) {
      if (originTime < cutoff) {
        this.outstanding.delete(originTime);
        this.lost++;
      }
    }
  }

  /** Everything a socket drop invalidates: samples describe a connection that no longer exists. */
  reset(): void {
    this.outstanding.clear();
    this.samples = [];
    this.lost = 0;
  }

  /** Median RTT in ms, or null before the first pong. */
  median(): number | null {
    if (this.samples.length === 0) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
      : (sorted[middle] as number);
  }

  /** Pings sent that were never answered within the timeout. */
  lostCount(): number {
    return this.lost;
  }

  pendingCount(): number {
    return this.outstanding.size;
  }
}
