# Olve.SlimeRepublics

A real-time MMO server. Slimes, republics, and a WebSocket carrying authoritative world state to
every connected client.

Scaffolded from [Olve.Template.Api](https://github.com/OliverVea/Olve.Template.Api) (`dotnet new
olve-api`), so it arrives with OIDC auth, OpenTelemetry, a Helm chart, GitOps deployment via
Olve.Pipelines, and C#/TypeScript client generation.

## Quick start

```bash
dotnet run --project src/Olve.SlimeRepublics   # API on http://localhost:5000
cd frontend && npm ci && npm run dev           # SPA on http://localhost:5173, /api proxied
```

## Documentation

| For | See |
|---|---|
| What the game is meant to be | [docs/game-design-document.md](docs/game-design-document.md) |
| How the system is put together | [docs/tech-design.md](docs/tech-design.md) |
| Commands, conventions, deploy gotchas | [CLAUDE.md](CLAUDE.md) |
