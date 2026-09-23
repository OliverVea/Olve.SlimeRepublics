import { defineConfig } from "vitest/config";

// The client opens a WebSocket straight at the C++ game server. Its default target is port
// 9001 on whatever host served the page (so LAN/tailnet access works); VITE_WS_URL overrides it.
export default defineConfig({
  server: {
    // Bind every interface, not just loopback, so the game can be opened from another device
    // on the LAN/tailnet. The client derives its socket host from the page URL, so a phone
    // hitting http://<this-machine>:5173/ reaches the right game server.
    host: "0.0.0.0",
    // Binding 0.0.0.0 is not enough on its own: Vite's DNS-rebinding guard rejects any request
    // whose Host header is a name rather than an IP or localhost ("Blocked request. This host
    // is not allowed"). Allow any name: this is a dev server on a trusted network.
    allowedHosts: true,
  },
  // Unit tests live next to the source they cover (e.g. src/game/protocol.test.ts).
  test: {
    environment: "happy-dom",
    include: ["src/**/*.{test,spec}.ts"],
  },
});
