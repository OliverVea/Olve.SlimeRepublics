import { describe, expect, it } from "vitest";
import { resolveUrl } from "./connection.js";

describe("resolveUrl", () => {
  it("resolves a bare path against an https page as wss", () => {
    expect(resolveUrl("/ws", { protocol: "https:", host: "slimes.ovea.pro" })).toBe(
      "wss://slimes.ovea.pro/ws",
    );
  });

  it("keeps the page's port and uses ws for an http page", () => {
    expect(resolveUrl("/ws", { protocol: "http:", host: "localhost:8080" })).toBe(
      "ws://localhost:8080/ws",
    );
  });

  it("passes a full URL through untouched", () => {
    expect(resolveUrl("ws://example:9001", { protocol: "https:", host: "slimes.ovea.pro" })).toBe(
      "ws://example:9001",
    );
  });
});
