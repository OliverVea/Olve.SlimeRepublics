# Realtime

How Olve.SlimeRepublics talks to its clients.

The design goal is a socket cheap enough to run at simulation frequency for hundreds of
connections, with the credential lifecycle left entirely to HTTP. What is built today is a thin
slice — connect, authenticate, move a slime, watch everyone else's — but the decisions below are
the ones that are expensive to reverse, so they are made now rather than discovered later.

---

## 1. Why raw WebSockets rather than SignalR

SignalR gives you hub method dispatch, automatic reconnect, transport fallback and backplane
scale-out for free. All four are things this project either does not want or wants to own.

The disqualifying constraint is the template's build shape. The API is `PublishAot=true`,
`WebApplication.CreateSlimBuilder`, source-generated JSON via `AppJsonContext`, shipping on a
chiseled base image. SignalR's hub invocation is reflective by design — that is what makes
`hub.Clients.All.SendAsync("Move", x, y)` work — and its message envelope carries a target name and
boxed arguments on every call. Both are exactly the overhead being ruled out here: at 20 Hz × N
connections, an envelope that names its method in ASCII on every frame is not a rounding error.

Raw `WebSocket` is in the shared framework, needs no `PackageReference`, and is AOT-clean — verified,
not assumed: `dotnet publish -r linux-x64` emits zero IL trim/AOT warnings.

What we give up, and where it went:

| SignalR feature | Replacement |
| --- | --- |
| Hub method dispatch | A one-byte opcode switch (§2) |
| Automatic reconnect | Client-side, driven by close code (§5) |
| Transport fallback | None. WebSocket or nothing — every target browser has had it for a decade |
| Backplane scale-out | Deliberately absent; see §8 |

## 2. Wire format

Every frame is `WebSocketMessageType.Binary`: a one-byte opcode followed by a fixed, little-endian
layout. No field names, no framing overhead beyond the opcode.

```
WorldSnapshot                                     MoveIntent
┌────────┬──────────┬─────────┬─────────────┐     ┌────────┬────────┬────────┐
│ 0x10   │ tick u32 │ count   │ entries…    │     │ 0x20   │ x f32  │ y f32  │
│ 1 byte │ 4 bytes  │ u16     │ 12 B each   │     │ 1 byte │ 4 B    │ 4 B    │
└────────┴──────────┴─────────┴─────────────┘     └────────┴────────┴────────┘
                                7 + 12N bytes                        9 bytes
   entry: entityId u32 │ x f32 │ y f32
```

Forty slimes is **487 bytes**, against roughly 2 KB for the equivalent JSON. At 20 Hz that is the
difference between 9.5 KB/s and 40 KB/s per connected client, before you multiply by the player
count. Encoding is a handful of `BinaryPrimitives` writes into a span, with no allocation and no
serializer in the path.

JSON deliberately stays on the HTTP side, where payloads are rare and debuggability is worth more
than bytes. The one JSON payload in this slice is the handshake ticket (§3).

### Opcode ranges

| Range | Direction | Purpose |
| --- | --- | --- |
| `0x01`–`0x0F` | both | Session control — hello, re-auth, heartbeat. Rare. |
| `0x10`–`0x1F` | server → client | Authoritative state. The hot path. |
| `0x20`–`0x2F` | client → server | Intent. |

Splitting the ranges costs nothing today and means adding a state message later never has to
negotiate with the control channel for an opcode.

| Opcode | Name | Direction | Size |
| --- | --- | --- | --- |
| `0x01` | ServerHello | S→C | 14 |
| `0x02` | ReAuth | C→S | 1 + ticket |
| `0x03` | ReAuthAck | S→C | 9 |
| `0x04` | Ping | S→C | 9 |
| `0x05` | Pong | C→S | 9 |
| `0x10` | WorldSnapshot | S→C | 7 + 12N |
| `0x20` | MoveIntent | C→S | 9 |

**The layout is a contract with no compiler enforcing it.** `RealtimeProtocol.cs` and
`frontend/src/realtime/protocol.ts` must change together. `RealtimeProtocolTests` pins every field
by byte offset rather than round-tripping through the server's own writer, so a drift on the C#
side fails loudly instead of silently agreeing with itself.

## 3. Authentication

### The problem

The browser `WebSocket` constructor cannot set request headers. There is no `Authorization` header
on an upgrade, and no API to add one. Worse, a rejected upgrade reaches JavaScript as a bare
`error` event — no status, no body — so a 401 here is *invisible* to the client that caused it.

The template also sets a global `RequireAuthenticatedUser` fallback policy, which would reject the
upgrade before any handler ran. `MapRealtimeEndpoint` therefore calls `AllowAnonymous()`, and that
is load-bearing rather than lax: the ticket below *is* the authentication.

### The shape

HTTP keeps sole custody of the JWT. The socket never sees one.

```
  ┌────────┐                                             ┌────────┐
  │ Client │                                             │ Server │
  └───┬────┘                                             └───┬────┘
      │  POST /api/realtime/ticket                           │
      │  Authorization: Bearer <jwt>                         │   ← the only place the JWT appears
      │ ───────────────────────────────────────────────────► │
      │  { ticket, expiresIn: 30, sessionExpiresAt }         │
      │ ◄─────────────────────────────────────────────────── │
      │                                                      │
      │  GET /ws?ticket=…            (Upgrade)               │   ← ticket redeemed, then destroyed
      │ ───────────────────────────────────────────────────► │
      │  0x01 ServerHello  entityId, tickHz, authExpiresAt   │
      │ ◄─────────────────────────────────────────────────── │
      │                                                      │
      │  0x10 WorldSnapshot   × tickHz per second            │
      │ ◄─────────────────────────────────────────────────── │
      │  0x20 MoveIntent      on input                       │
      │ ───────────────────────────────────────────────────► │
```

### Why a ticket and not `?access_token=`

Putting the JWT in the query string is the documented ASP.NET pattern and it works. It also writes
a credential that stays valid for its full lifetime into reverse-proxy access logs, browser
history, and any `Referer` header the page emits. A ticket is 256 random bits that is:

- **single use** — `TryRedeem` removes it whether or not it validates, so a replay fails even
  inside the TTL;
- **30 seconds long** — enough for one round trip from the ticket call to the constructor;
- **never wider than its token** — the ticket carries the JWT's own `exp`, and redemption fails
  once that passes. A socket can never become a way to keep using a session HTTP would refuse.

Cost: one extra HTTP round trip before connecting, once per session.

### Why frames are not signed

An HMAC per frame would defend against an attacker who can inject into an established connection.
But the connection is TLS-terminated point to point, and the server holds the only handle to it —
anyone able to inject already holds the token. The signature would cost bytes and CPU on every
frame at 20 Hz to defend a threat that is not reachable.

**The invariant that actually matters is that no client frame carries an actor id.** A client says
"move in this direction", never "move entity 7". Authority comes from *which socket the bytes
arrived on*, and `RealtimeConnection.EntityId` is stamped at handshake and is not settable from the
wire. There is no frame you can craft that acts on someone else's slime, because the protocol has
no way to express one.

The same principle covers magnitude: `SetIntent` normalises anything longer than unit length, so
the client picks a direction and the server picks the speed. Both are covered by tests.

## 4. Token refresh over a live connection

A session runs for hours; an access token lives 5–60 minutes. Reconnecting on every expiry would
mean a visible hitch several times an hour, so the connection survives instead.

Refresh stays **client-initiated and HTTP-based**, exactly as the OIDC layer already does it. The
socket's only involvement is carrying the resulting ticket:

1. The client watches `sessionExpiresAt` from the hello, and 60 seconds before it lapses calls
   `POST /api/realtime/ticket` again. That call goes through the normal authenticated HTTP path,
   which refreshes the underlying token as a side effect — the realtime client contains no token
   logic at all.
2. It sends the new ticket as `0x02 ReAuth`.
3. The server redeems it, **checks the subject matches the connection's** — a ticket for a
   different account must not be able to inherit a live session — re-stamps the deadline, and
   replies `0x03 ReAuthAck`.
4. If the deadline passes with no re-auth, the send pump closes with `4001 AuthExpired`.

Reserving `0x02`/`0x03` now is the whole point. Retrofitting re-auth onto a deployed protocol is a
breaking change; reserving two opcodes before anything ships is free.

## 5. Close codes

The 4000–4999 range is reserved for applications precisely so a client can tell "try again" from
"stop trying".

| Code | Meaning | Client should |
| --- | --- | --- |
| `4001` | Auth expired | Refresh over HTTP, reconnect |
| `4002` | Protocol error | **Not** reconnect — this is a bug |
| `4003` | Too slow | Reconnect after a backoff |
| `4004` | Heartbeat timeout | Reconnect |
| `4005` | Server full | Reconnect after a backoff |

## 6. Concurrency

Two rules drive the entire server-side structure.

### One send in flight per socket

`WebSocket.SendAsync` permits exactly one concurrent send; a second corrupts the stream. So a
broadcast to N clients must never be N `SendAsync` calls from the tick loop.

Each connection owns a bounded `Channel<ReadOnlyMemory<byte>>` drained by exactly one pump task,
and the pump is the only thing in the process that ever sends on that socket. Broadcast is N
non-blocking enqueues.

```
                        ┌───────────────────────────────────────────┐
  WorldTickService      │  encode ONE snapshot, share by reference   │
  (20 Hz, 1 thread) ────┤                                            │
                        └───────┬──────────────┬──────────────┬──────┘
                                ▼              ▼              ▼
                          [queue cap 16] [queue cap 16] [queue cap 16]   ← DropOldest
                                │              │              │
                             pump task      pump task      pump task     ← sole caller of SendAsync
                                ▼              ▼              ▼
                             socket A       socket B       socket C
```

The queue is bounded with `DropOldest` so a client whose TCP window has closed cannot apply
backpressure to the simulation. Dropping the *oldest* is right because snapshots are absolute, not
incremental — the newest always supersedes what it displaced. Cross 60 cumulative drops and the
connection is closed with `4003` rather than served stale state indefinitely.

*Known limit:* control frames share that queue, so a dropped `ReAuthAck` is possible in principle.
In practice it requires a connection already 800 ms behind, which is one already on its way to a
`4003` close. If high-frequency control traffic is ever added, split this into a priority control
channel plus a capacity-1 state channel and have the pump drain control first.

### One thread mutates the world

`WorldTickService` is the only writer. Everything arriving from a connection's read loop lands in a
concurrent structure and is picked up at the top of the next tick: joins and leaves as a
`ConcurrentQueue`, move intents as a `ConcurrentDictionary` slot per entity.

Intents overwriting each other is the correct lossiness — three intents inside one tick and only
the last was ever going to matter. The result is no locks on the hot path and no way for a slow or
hostile client to stall the simulation.

The snapshot is encoded **once** per tick into a reused scratch buffer, then copied into a
right-sized array shared by every connection by reference. The copy is what makes the sharing safe:
the scratch buffer is overwritten next tick while connections may still be draining the previous
frame. One ~3 KB Gen0 allocation per tick is the price; eliminating it means a ring of buffers with
refcounted release, which is not worth the complexity until a profiler says otherwise.

Teardown is the third place the one-send rule bites: closing while a send is in flight is the same
violation. `RunAsync` waits for **both** loops to finish before the close handshake, so exactly one
place ever touches the socket at the end.

## 7. Heartbeat and idle timeouts

Two separate mechanisms, often confused:

- **`WebSocketOptions.KeepAliveInterval`** (30 s, set in `Program.cs`) is Kestrel's protocol-level
  ping. It keeps intermediaries from treating an idle upgraded connection as dead. Reverse proxies
  commonly kill those around 60 seconds.
- **The application heartbeat** (`0x04`/`0x05`, 15 s) detects a peer that is still *connected* but
  no longer *responding* — a suspended tab, a laptop that slept, a half-open TCP connection. Only
  the application layer can tell the difference. No client frame for 45 s closes with `4004`.

In this slice the server→client direction is never idle anyway, since snapshots flow continuously.
The heartbeat exists for the reverse direction and for dead-peer detection, and it earns its keep
the moment interest management (§9) stops sending to quiet clients.

## 8. Deployment constraints

**The world is in-process singleton state, so `replicaCount` must stay 1.** A second replica would
run a second, divergent world, and the ClusterIP Service would round-robin players between them
with no way to notice. The chart pins this and documents why.

For the same reason the Deployment uses **`strategy: Recreate`**. A rolling update briefly runs two
pods behind one Service — which is the same split, arriving silently during a deploy. Recreate
makes the handover a clean disconnect that clients reconnect through.

Two consequences worth stating plainly:

- Every deploy disconnects every player. Acceptable now; it is what §9's reconnect/resume work
  eventually addresses.
- Scaling out is **not** raising `replicaCount`. It is sharding the world by zone with a routing
  layer that sends a client to the node owning its zone. The ticket store would need to move to
  shared storage at that point (it is in-memory today, which is correct while connections are
  pinned to one process).

No new route is needed: the socket rides the app's existing host, and public exposure is registered
in `Olve.Homelab`'s edge chart, not here. Confirm the ingress does not impose its own idle timeout
below the 30 s keepalive.

## 9. Deliberately not built

Named so the seams exist, not because they are next.

| Not built | Where it plugs in |
| --- | --- |
| **Interest management** — only send what a client can see | `RealtimeHub.Broadcast`. Replace the shared frame with `view.For(connection)`; nothing else changes. This is the first thing that will be needed — the current design sends the whole world to everyone and stops scaling the moment the world exceeds one screen. |
| **Delta compression** — send changes, not full state | The snapshot encoder. Note this trades away the idempotence that makes `DropOldest` safe; deltas need reliable ordering or a periodic keyframe. |
| **Client prediction / interpolation** | Client-side. `tick` is on every snapshot for exactly this. |
| **Lag compensation** | Server-side, needs a tick history buffer. |
| **Reconnect with session resume** | `SlimeWorld.Join` — it currently always spawns fresh. Resume means keying on subject rather than connection. |
| **Multi-node sharding** | §8. Also forces the ticket store to shared storage. |

## 10. Where things live

| Path | |
| --- | --- |
| `Realtime/RealtimeProtocol.cs` | Opcodes, close codes, encode/decode |
| `Realtime/RealtimeTickets.cs` | Ticket issue/redeem, identity from claims |
| `Realtime/RealtimeConnection.cs` | Per-connection state, send pump, receive loop |
| `Realtime/RealtimeHub.cs` | Connection registry, broadcast — the interest-management seam |
| `Realtime/SlimeWorld.cs` | Authoritative state, single-mutator |
| `Realtime/WorldTickService.cs` | The 20 Hz loop |
| `Realtime/RealtimeEndpoints.cs` | DI wiring, ticket endpoint, upgrade |
| `frontend/src/realtime/protocol.ts` | Hand-written mirror of the wire format |
| `frontend/src/realtime/client.ts` | Browser client, incl. the re-auth timer |

### Configuration

All under the `Realtime` section; defaults suit a single node with a few hundred connections.

| Key | Default | |
| --- | --- | --- |
| `TickHz` | 20 | Simulation and broadcast rate |
| `TicketTtlSeconds` | 30 | Handshake ticket lifetime |
| `SendQueueCapacity` | 16 | Outbound frames buffered per connection |
| `MaxDroppedFrames` | 60 | Cumulative drops before a `4003` close |
| `HeartbeatSeconds` | 15 | Server ping interval |
| `ClientTimeoutSeconds` | 45 | Silence before a `4004` close |
| `MaxConnections` | 256 | Hard ceiling; also sizes the snapshot buffer |
| `MaxInboundFrameBytes` | 256 | Larger inbound frames are a protocol error |
| `ArenaHalfSize` | 50 | World half-extent in world units |
| `MoveSpeed` | 6 | World units per second |

### A note on client generation

`api.json` covers `POST /api/realtime/ticket` and nothing else about realtime — OpenAPI has no
vocabulary for an upgraded connection, so `/ws` is marked `ExcludeFromDescription()` rather than
producing a misleading `GET` in the spec and a dead method on every generated client. The
TypeScript client under `frontend/src/realtime/` is hand-written and stays that way.

## 11. Tests

`test/…UnitTests/Realtime/` — wire layout pinned by byte offset; ticket single-use, TTL and
never-outlives-its-token; world speed clamp, arena clamp, and non-finite input rejection.

`test/…IntegrationTests/RealtimeTests.cs` — 14 tests over real sockets against the real container:
upgrade rejected without a ticket and with a forged one, ticket cannot be redeemed twice, hello and
snapshot stream, move intent moving the sender's slime, ping/pong, re-auth extending a live
session, malformed frames closing with `4002`, and two clients seeing each other in one snapshot.
