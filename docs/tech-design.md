# Technical Design

High-level architecture and the components the system is assembled from. Detail lives elsewhere:

| For | See |
|---|---|
| What the game is meant to be | [docs/game-design-document.md](game-design-document.md) |

---

## 1. Architecture

One C++ process owns one world. It runs a single event loop: uWebSockets polls the sockets, and a
timer on the same loop advances the simulation at 20 Hz. Browsers connect over a WebSocket and
exchange FlatBuffers messages defined in one shared schema.

```
browser (TypeScript client)
   │  WebSocket, FlatBuffers
   ▼
transport  ── decodes frames, enqueues events ──►  event queue
(uWebSockets)                                          │
   ▲                                                   ▼
   └──── broadcasts WorldState each tick ◄──── game (EnTT world, 20 Hz tick)
```

Socket callbacks never touch the world. They enqueue events, and the tick applies them, so ordering
belongs to the simulation rather than to packet arrival.

---

## 2. Components

| Component | Where | What it does |
|---|---|---|
| **Game** | `src/backend-cpp/src/game/` | The simulation: an EnTT entity registry, the event queue, and `GameManager::Tick`. Must not reference the network; the `slime_world` CMake target does not link uWebSockets, so a violation is a link error. |
| **Transport** | `src/backend-cpp/src/transport/` | The codec: encodes the `WorldState` broadcast and pongs, and maps wire enums to game types, rejecting out-of-range values. |
| **Server entry** | `src/backend-cpp/src/main.cpp` | Wires the uWebSockets app, the tick timer and the codec onto one loop. Every incoming frame goes through the FlatBuffers verifier before it is read. One socket is one slime: spawned on open, despawned on close. |
| **Users** | `src/backend-cpp/src/users/` | Account login, in progress. Passwords are hashed with libsodium (Argon2); an unknown email is verified against a dummy hash so login timing does not reveal which accounts exist. The user store is still a stub. |
| **Schema** | `src/schema/` | The API contract. `common.fbs` defines every client and server message. The C++ side is generated at build time; the TypeScript side by `generate.sh`, committed. |
| **Client** | `src/frontend/` | Vanilla TypeScript, Vite, Vitest, Biome. Connects, decodes `WorldState`, sends input and pings. `tile-map.ts` is a debug renderer; the real renderer (see below) replaces that one file. |
| **Tests** | `src/backend-cpp/tests/`, `src/frontend/src/**/*.test.ts` | Catch2 on the server; Vitest on the client, including a frame captured off the running server so wire-format drift fails a test. |

---

## 3. Cross-cutting constraints

The handful of rules that shape everything else:

- **One game server owns one game world.** A *tile* is one slime's space; a *sector* is an n×n
  block of tiles; a *world* is the set of sectors that forms one board. A world lives entirely in
  one process's memory, so exactly one process may serve it. A second process would not share the load; it would run a
  *second, divergent copy*, and players would silently split between them. Growing past one world
  means adding game servers, never replicas of one. The cost of the rule is that every restart
  disconnects everyone on that world.
- **We do not own the engine layer.** Scene graph, glTF loading, lights, shadow maps, culling,
  camera, post-processing: three.js's, not ours. This rule exists because `Olve.Trains` grew an
  `Olve.Engine3D` and an asset pipeline of its own, and paid for them in multi-day debugging of
  things every engine already solves. A bespoke render pass is the same commitment wearing a
  different hat. If a feature needs one, that is a decision to make deliberately and reluctantly,
  not a detail to slide into.
- **Art targets what the renderer gives us for free.** Low-poly, vertex-coloured, untextured — no UV
  unwrapping, no texture atlas, no MSDF, no model-format pipeline. The asset pipeline that does not
  exist cannot fall behind.
- **The pixel-art passes are staged, and each one is optional.** The game ships first with no custom
  passes at all: flat/toon shading, built-in lighting and shadows, isometric camera. The pixel
  identity lives in the 2D UI layer, which is cheap. If the 3D world should also read as pixel art,
  the passes go in one at a time, each behind a flag, cheapest-first: **resolution lock**, then
  **palette quantization**, then **depth/normal outlines**. Any one of them stalling means shipping
  without it, not blocking on it. Technique reference:
  [the TowerKeep/Pixel Perfect notes](sources/2026-08-24_towerkeep_pixel_perfect.md).
- **The camera is isometric and does not rotate.** Note the reason, because it changed: this is now
  an *art and gameplay* constraint, not a rendering one. Tall geometry occludes slimes, occlusion
  creates demand for a rotating camera, and a game built around a free camera cannot cheaply be
  locked later. Keeping it locked also leaves the pixel passes viable, since rotation is the one
  thing pixel-perfect rendering has no answer for — but that is now a bonus rather than the
  justification.
