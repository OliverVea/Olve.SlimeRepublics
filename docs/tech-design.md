# Technical Design

High-level architecture and the components the system is assembled from. Detail lives elsewhere:

| For | See |
|---|---|
| File layout, endpoints, config keys, CI, client generation | [README.md](../README.md) |
| Realtime wire format, auth handshake, concurrency rules | [docs/REALTIME.md](REALTIME.md) |
| What the game is meant to be | [docs/game-design-document.md](game-design-document.md) |

---

## 1. Architecture

One ASP.NET Core process, one container, one pod. A single Kestrel listener serves three surfaces:

```
                    ┌─────────────────────────────────────────┐
   browser ────────►│  /            SPA (wwwroot)   anonymous │
                    │  /api/*       JSON API        JWT       │
                    │  /ws          binary socket   ticket    │
                    └────────────────┬────────────────────────┘
                                     │
                    ┌────────────────┴────────────────────────┐
                    │  hot state          durable state       │
                    │  SlimeWorld         EntityStore<T>      │
                    │  (in memory,        + persister         │
                    │   never persisted)  (snapshot to disk)  │
                    └─────────────────────────────────────────┘
```

Two ideas carry most of the weight:

**HTTP owns credentials, the socket owns the hot path.** No JWT ever reaches the socket, and no game
frame does auth work. A short-lived single-use ticket is the only bridge between them.

**Hot state and durable state are kept apart.** `SlimeWorld` is in memory, mutated by exactly one
thread, and lost on restart by design. Everything that must survive lives in an `EntityStore<T>`
behind a persister. The tick loop never awaits disk, database, or network.

---

## 2. Components

| Component | Where | What it does |
|---|---|---|
| **Host & configuration** | `Configuration/HostConfiguration.cs` | Clears default sources and rebuilds the chain: appsettings → env → user-secrets → command line. Binds `Host`/`Port`. |
| **Authentication** | `Configuration/AuthenticationConfiguration.cs` | JWT bearer against Authentik. Accepts both the API and the SPA client as valid issuer/audience pairs, so one token shape works for both. App-wide fallback policy is `RequireAuthenticatedUser`. |
| **Auth config endpoint** | `Configuration/FrontendConfigEndpoints.cs` | `GET /api/auth-config` — public OIDC settings served at runtime, not baked into the bundle, because one image deploys to several Authentik environments. |
| **JSON & OpenAPI** | `Configuration/JsonConfiguration.cs`, `AppJsonContext.cs` | Source-generated serialization (AOT-friendly) via a `JsonSerializerContext`. Every DTO must be registered there. `Id<T>` is projected to a string/uuid in the OpenAPI schema. |
| **Logging & telemetry** | `Configuration/TelemetryConfiguration.cs`, `OAuth2TokenProvider.cs` | OpenTelemetry for traces, metrics **and logs**, exported over OTLP. Optional OAuth2 client-credentials auth on the exporter. **Entirely opt-in and never fatal** — no `OpenTelemetry:Endpoint` configured means the whole block is skipped and the app runs on console logging alone. |
| **Health** | `Health/HealthEndpoints.cs` | `GET /health`, anonymous, unconditional 200. Liveness only — deliberately not a readiness or dependency check. |
| **Persistence** | `Stores/` | `EntityStore<T>` plus an optional `EntityStorePersister<T>`: whole-snapshot, debounced, loaded on startup, flushed on shutdown. Pluggable via the two-method `ISnapshotStore`; ephemeral by default, `FileSnapshotStore` when persistent. Cannot overwrite good state with empty. |
| **Realtime** | `Realtime/` | The game transport: ticket issue/redeem, WebSocket upgrade, per-connection send pump, the authoritative world, and the 20 Hz tick loop. See [REALTIME.md](REALTIME.md). |
| **Messages** | `Messages/` | **Template scaffold, not game state.** Exercises the CRUD/validation/persistence path inherited from `Olve.Template.Api`. |
| **Frontend** | `frontend/src/` | Vanilla TypeScript, no framework runtime. Vite build, Vitest tests, Biome lint. `api/` is Kiota-generated from `api.json`; `realtime/` is hand-written. |
| **Build & versioning** | `tools/version.cs`, `Dockerfile` | Version derived from git; the SPA is built and copied into `wwwroot` at image build time. |
| **Deployment** | `.pipelines/`, `helm/` | GitOps via Olve.Pipelines. ClusterIP-only chart; public routing is registered in Olve.Homelab, not here. |

---

## 3. Cross-cutting constraints

The handful of rules that shape everything else:

- **`replicaCount` stays 1, and the Deployment is `strategy: Recreate`.** The world is in-process
  singleton state — two pods behind one Service is two divergent simulations, not scale-out.
  Restarts are visible to players; the world is lost, durable state is not.
- **The tick loop never blocks.** It enqueues to bounded per-connection channels and moves on. One
  slow client falls behind and is eventually disconnected; it cannot stall the simulation.
- **Authority comes from the socket, not the frame.** No inbound frame carries an actor id, so there
  is no such thing as a message that acts on someone else's slime.
- **`RealtimeProtocol.cs` and `frontend/src/realtime/protocol.ts` are one contract with no compiler
  between them.** Change both; tests pin the layout by byte offset.
- **Telemetry is opt-in and never fatal.** Misconfigured or absent observability must not take the
  app down.
- **Startup order matters.** `StartAsync` (persister loads) → `RunAsyncOnStartup` (seeders, against
  populated stores) → `WaitForShutdownAsync`. Long-running work is a `BackgroundService`, not a
  startup task.

---

## 4. Known loose ends

- Seven citations of a `docs/DESIGN.md` that does not exist here — it is `Olve.Template.Api`'s
  design doc, and the references were inherited when this repo was scaffolded from it. They appear
  in `Stores/EntityStorePersister.cs`, `Stores/StorageMode.cs`, `AppJsonContext.cs`,
  `frontend/src/base-element.ts` (×2), `frontend/src/base-element.test.ts` and
  `frontend/src/components/message-list.ts`. Each surrounding comment states its point in full, so
  the citation can be dropped without losing anything.
- The snapshot count field is a `uint16`, so 65535 connections is the hard protocol ceiling
  regardless of `MaxConnections`.
- The `Messages` slice is scaffold and is to be removed once a real game slice has been built the
  same way — it is kept only as the worked example of the CRUD/validation/persistence path.
