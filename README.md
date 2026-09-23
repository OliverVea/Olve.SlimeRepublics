# Slime Republics

A multiplayer browser game: three factions of slimes fighting over one persistent world. A player
can be a single slime, a commander of twenty, or the general drawing the front line, and all three
act on the same world state at the same moment. It is an early prototype.

This repo is the game server and a debug client:

- **Server** ([src/backend-cpp](src/backend-cpp)): hand-written C++23. An EnTT simulation on a
  fixed 20 Hz tick, served over WebSockets (uWebSockets) on a single event loop.
- **API contract** ([src/schema](src/schema)): one FlatBuffers schema that generates the message
  types for both the server and the client.
- **Client** ([src/frontend](src/frontend)): TypeScript, no framework. Connects over the WebSocket,
  decodes world state and draws it.

## Quick start

```bash
tools/install-cpp-deps.sh                  # first time on a machine
cd src/backend-cpp && cmake --preset debug && cmake --build build
./build/backend_cpp                        # ws://localhost:9001

cd src/frontend && npm ci && npm run dev   # http://localhost:5173
```

## Documentation

| For | See |
|---|---|
| What the game is meant to be | [docs/game-design-document.md](docs/game-design-document.md) |
| How the system is put together | [docs/tech-design.md](docs/tech-design.md) |
| Building and running the server | [src/backend-cpp/README.md](src/backend-cpp/README.md) |
| The wire format and codegen | [src/schema/README.md](src/schema/README.md) |
| The client | [src/frontend/README.md](src/frontend/README.md) |
