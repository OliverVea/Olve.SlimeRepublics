import { describe, expect, it } from "vitest";
import { LatencyTracker } from "./latency.js";

/** Controllable clock — real timing would make these tests flaky for no benefit. */
function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("LatencyTracker", () => {
  it("has no reading before the first pong", () => {
    expect(new LatencyTracker().median()).toBeNull();
  });

  it("measures a round trip", () => {
    const c = clock();
    const tracker = new LatencyTracker({ now: c.now });

    const ping = tracker.startPing();
    c.advance(120);
    tracker.recordPong(ping);

    expect(tracker.median()).toBe(120);
  });

  it("takes the median, so one stall does not dominate", () => {
    const c = clock();
    const tracker = new LatencyTracker({ now: c.now });

    for (const rtt of [100, 100, 3000, 100, 100]) {
      const ping = tracker.startPing();
      c.advance(rtt);
      tracker.recordPong(ping);
      c.advance(1);
    }

    // A mean would read ~680 ms and describe a connection nobody has.
    expect(tracker.median()).toBe(100);
  });

  it("keeps only the most recent samples", () => {
    const c = clock();
    const tracker = new LatencyTracker({ window: 3, now: c.now });

    for (const rtt of [500, 500, 500, 10, 10, 10]) {
      const ping = tracker.startPing();
      c.advance(rtt);
      tracker.recordPong(ping);
      c.advance(1);
    }

    expect(tracker.median()).toBe(10);
  });

  it("ignores a pong it never asked for", () => {
    const tracker = new LatencyTracker({ now: clock().now });
    tracker.recordPong(12345);
    expect(tracker.median()).toBeNull();
  });

  it("ignores a duplicated pong, so one reply cannot be counted twice", () => {
    const c = clock();
    const tracker = new LatencyTracker({ now: c.now });

    const ping = tracker.startPing();
    c.advance(50);
    tracker.recordPong(ping);
    c.advance(500);
    tracker.recordPong(ping);

    expect(tracker.median()).toBe(50);
  });

  it("writes off an unanswered ping instead of waiting forever", () => {
    const c = clock();
    const tracker = new LatencyTracker({ timeoutMs: 1000, now: c.now });

    tracker.startPing();
    expect(tracker.pendingCount()).toBe(1);

    c.advance(1500);
    tracker.expire();

    expect(tracker.pendingCount()).toBe(0);
    expect(tracker.lostCount()).toBe(1);
  });

  it("does not credit a pong that arrives after its ping expired", () => {
    const c = clock();
    const tracker = new LatencyTracker({ timeoutMs: 1000, now: c.now });

    const ping = tracker.startPing();
    c.advance(1500);
    tracker.expire();
    tracker.recordPong(ping);

    // Counting it would report a 1500 ms RTT as a live sample long after we gave up on it.
    expect(tracker.median()).toBeNull();
  });

  it("drops everything on reset, since samples describe a dead socket", () => {
    const c = clock();
    const tracker = new LatencyTracker({ now: c.now });

    const ping = tracker.startPing();
    c.advance(30);
    tracker.recordPong(ping);
    tracker.reset();

    expect(tracker.median()).toBeNull();
    expect(tracker.lostCount()).toBe(0);
    expect(tracker.pendingCount()).toBe(0);
  });
});
