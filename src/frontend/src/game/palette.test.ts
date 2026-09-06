import { describe, expect, it } from "vitest";
import { colorForId, labelColorOn } from "./palette.js";

describe("colorForId", () => {
  it("is stable for an id", () => {
    expect(colorForId(3)).toBe(colorForId(3));
  });

  it("gives adjacent ids different colours", () => {
    const colors = [1, 2, 3, 4, 5].map(colorForId);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("cycles every 10 ids", () => {
    expect(colorForId(13)).toBe(colorForId(3));
  });

  it("handles id 0 and large uint32 ids", () => {
    expect(colorForId(0)).toMatch(/^#[0-9a-f]{6}$/);
    expect(colorForId(4294967295)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("labelColorOn", () => {
  it("goes dark on light fills and light on dark fills", () => {
    expect(labelColorOn("#bcbd22")).toBe("#10131a"); // olive
    expect(labelColorOn("#1f77b4")).toBe("#f2f5fa"); // blue
  });
});
