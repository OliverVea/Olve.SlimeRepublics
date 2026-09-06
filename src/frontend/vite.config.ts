import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// In dev, the browser talks to the Vite dev server (same origin) and Vite proxies the
// API paths to the real backend — no CORS, no base-URL juggling in the component.
//
// The game client does NOT go through this proxy: it opens a WebSocket straight at the C++
// game server, which the /api proxy buys nothing for. Its default target is port 9001 on
// whatever host served the page (so LAN/tailnet access works); VITE_WS_URL overrides it.
//
//   VITE_API_TARGET   backend the dev proxy forwards to (default: the port-forward from
//                     `kubectl port-forward svc/olve-slimerepublics 18080:80`, or a local
//                     `dotnet run`). On the tailnet: https://olve-slimerepublics-beta.ovea.pro
//
// In a production build the component reads VITE_API_BASE_URL (falling back to same-origin),
// so deploy the static bundle behind the same host that serves the API, or set it explicitly.
export default defineConfig(() => {
  const target = process.env.VITE_API_TARGET ?? "http://localhost:18080";
  return {
    server: {
      // Bind every interface, not just loopback, so the app can be opened from another device
      // on the LAN/tailnet. The game client derives its socket host from the page URL, so a
      // phone hitting http://<this-machine>:5173/game.html reaches the right game server.
      host: "0.0.0.0",
      // Binding 0.0.0.0 is not enough on its own: Vite's DNS-rebinding guard rejects any request
      // whose Host header is a name rather than an IP or localhost ("Blocked request. This host
      // is not allowed"), so http://<hostname>:5173 fails while the LAN IP works. Allow any name
      // — this is a dev server on a trusted network, and the alternative is baking one machine's
      // hostname into a config that every other machine also reads.
      allowedHosts: true,
      // The SPA calls the API under /api (same-origin); Vite forwards that to the backend.
      proxy: {
        "/api": { target, changeOrigin: true },
      },
    },
    // Two entry points: index.html is the CRUD/admin SPA, game.html the game client. Keeping
    // them separate is what stops the game bundle carrying the admin UI (and vice versa) —
    // Vite only picks up extra HTML entries if they are listed here.
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          game: resolve(__dirname, "game.html"),
        },
      },
    },
    // Unit tests are opt-in (`npm test`) and live next to the source they cover
    // (e.g. src/base-element.test.ts). happy-dom gives custom elements a shadow DOM.
    test: {
      environment: "happy-dom",
      include: ["src/**/*.{test,spec}.ts"],
    },
  };
});
