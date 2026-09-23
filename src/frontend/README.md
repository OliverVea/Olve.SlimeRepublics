# frontend: the game client

A vanilla TypeScript client, no framework. It connects to the C++ game server over a WebSocket,
decodes the FlatBuffers `WorldState` broadcast at 20 Hz, draws the slimes, and sends input.

## Run it

```bash
../backend/build/slime_server    # ws://localhost:9001
npm install
npm run dev                         # http://localhost:5173
```

`VITE_WS_URL` overrides the socket URL. By default the client connects to port 9001 on whatever
host served the page, so a phone on the LAN reaches the right server.

## Layout

```
frontend/
├─ index.html          the game page
├─ vite.config.ts      dev server + test config
└─ src/
   ├─ game/
   │  ├─ main.ts       entry: wires the connection, input and renderer
   │  ├─ protocol.ts   bytes <-> game types; the ONLY file that touches src/generated/**
   │  ├─ connection.ts socket lifecycle, reconnect with backoff
   │  ├─ input.ts      WASD -> MoveEvent
   │  ├─ latency.ts    ping/pong round-trip tracking
   │  └─ tile-map.ts   debug renderer: a fixed 20x20 canvas grid centered on the origin
   └─ generated/       GENERATED FlatBuffers types (../schema/generate.sh), committed
```

**`tile-map.ts` is a debug view, not the final renderer** (three.js, isometric; see
[docs/tech-design.md](../../docs/tech-design.md)). It exists to prove the socket and the wire
format end to end. When the real renderer lands it replaces that one file; `protocol.ts` and
`connection.ts` are unaffected, which is why the seam is there.

Two things about the server worth knowing before debugging against it:

- **One socket is one slime.** The server spawns a slime on open and despawns it on close, so
  a reconnect gets a *new* id — the client cannot reclaim its old one. `main.ts` disposes the
  socket on HMR for the same reason; without that, every hot update leaks a slime.
- **`WorldState.events` is always empty.** The `EventData` union in `common.fbs` currently has
  no members and the server never encodes the vector. An empty `events` is not a decode failure.

### Input and latency

WASD sends a `ClientInput` per keypress carrying one `MoveEvent` (`w`→`Up`, `s`→`Down`,
`a`→`Left`, `d`→`Right`, mapped in `KEY_DIRECTIONS` in `input.ts`). Held keys repeat on the OS
key-repeat, which keeps the client stateless — no held-key set to fall out of sync when the
window loses focus mid-press.

The client also pings once a second. `PingEvent.origin_time` is our own `performance.now()`;
the server echoes it back verbatim in a `PongEvent` and we compute `now - origin_time`. Both
readings come from **one clock**, so no clock synchronisation is needed — and the value is
meaningless to the server, which is why it must only ever echo it. Ping and Pong are in both
unions, so the server may probe us too; `main.ts` echoes those back untouched.

`LatencyTracker` reports a **median** of the last 9 samples, not a mean: on a congested link a
single multi-second stall would drag a mean for minutes and describe a connection nobody has.
Pings unanswered for 5 s are written off and counted, and the readout turns orange — a healthy
median over a link dropping half its probes is a lie. Samples are discarded on disconnect,
since they describe a socket that no longer exists.

Two things a decoder on the other side has to get right:

- **`Direction.Up` is `0`, which is also the field default**, and FlatBuffers omits any field
  equal to its default. An `Up` event carries **no `direction` field at all** and readers fall
  back to `Up`. That round-trips correctly, but treating "field absent" as an error breaks
  exactly one of the four keys.
- **A union vector is two parallel vectors** (`events_type` and `events`) that must match in
  length and order, or `VerifyClientEventVector` rejects the frame outright.

`src/game/protocol.test.ts` decodes a frame captured verbatim off the running server, rather
than one built by the TypeScript encoder — so it fails if the C++ wire format drifts (a
`Vec2` int/float change, say) without `src/generated` being regenerated.

## Build, test, lint

```bash
npm run build      # tsc --noEmit + vite build -> dist/
npm test           # Vitest, tests live next to the source (*.test.ts)
npm run lint       # Biome lint + format check
npm run format     # apply Biome fixes
```

`src/generated/**` is excluded from Biome; it is not ours to lint.
