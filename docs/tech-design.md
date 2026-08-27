# Technical Design

High-level architecture and the components the system is assembled from. Detail lives elsewhere:

| For | See |
|---|---|
| What the game is meant to be | [docs/game-design-document.md](game-design-document.md) |

---

## 1. Architecture

One ASP.NET Core process, one container, one pod. A single Kestrel listener serves two surfaces:

<img src="assets/architecture.svg" alt="Architecture: browser, two request surfaces, one server process holding durable state" width="100%">

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
| **Messages** | `Messages/` | **Template scaffold, not game state.** Exercises the CRUD/validation/persistence path inherited from `Olve.Template.Api`. |
| **SPA shell** | `frontend/src/` | Vanilla TypeScript, no framework runtime. Vite build, Vitest tests, Biome lint. `api/` is Kiota-generated from `api.json`. |
| **Game client** | `frontend/` (own entry) | Real-time 3D — polygon style with a stylised shader pass. three.js `WebGPURenderer` (`three/webgpu`), shaders in TSL, which compiles to both WGSL and GLSL so the WebGL2 fallback costs nothing to maintain. Built as a separate Vite entry point so the game bundle carries none of the CRUD/admin UI. |
| **Build & versioning** | `tools/version.cs`, `Dockerfile` | Version derived from git; the SPA is built and copied into `wwwroot` at image build time. |
| **Deployment** | `.pipelines/`, `helm/` | GitOps via Olve.Pipelines. ClusterIP-only chart; public routing is registered in Olve.Homelab, not here. |

---

## 3. Cross-cutting constraints

The handful of rules that shape everything else:

- **One game server owns one game world.** A *tile* is one slime's space; a *sector* is an n×n
  block of tiles; a *world* is the set of sectors that forms one board. A world lives entirely in
  one process's memory, so exactly one process may serve it (`replicaCount: 1`, `strategy:
  Recreate`). A second pod would not share the load — it would run a *second, divergent copy*, and
  the Service would send some players to one and some to the other with nothing logged and no error
  raised. Growing past one world means adding game servers, never adding pods to one. The cost of
  the rule is that every deploy disconnects everyone on that world.
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
- **Telemetry is opt-in and never fatal.** Misconfigured or absent observability must not take the
  app down.
- **Durable state is loaded before anything runs and flushed on the way out.** Startup order is
  `StartAsync` (persister loads) → `RunAsyncOnStartup` (seeders, against populated stores) →
  `WaitForShutdownAsync`; on shutdown the persister cancels its debounce timer and writes
  unconditionally, so a clean stop never loses a pending save. Long-running work is a
  `BackgroundService`, not a startup task.
