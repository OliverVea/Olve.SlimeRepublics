# CLAUDE.md

See [docs/tech-design.md](docs/tech-design.md) for how the system is put together.

## Commands

```bash
# Server (src/backend-cpp)
cmake --preset debug && cmake --build build   # build
ctest --test-dir build                        # tests (Catch2)
./build/backend_cpp                           # run, ws://localhost:9001

# Client (src/frontend)
npm run dev                                   # http://localhost:5173
npm test && npm run lint && npm run build     # tests, Biome, typecheck + bundle

# Contract (src/schema)
./generate.sh                                 # regenerate the TypeScript types after a .fbs change
```

## Conventions

- **Oliver writes the C++ by hand.** Do not write or rewrite server code unless asked; explain,
  review and suggest instead. Build files, scripts and the client are fair game.
- **The schema is the contract.** Every message is defined in `src/schema/*.fbs`. Change the
  schema first, then regenerate; never hand-edit `src/frontend/src/generated/**`.
- **`src/game` must not depend on the network.** The `slime_world` target does not link
  uWebSockets, and CMake enforces it. Keep the simulation testable headless.
- **Socket callbacks never mutate the world.** They enqueue events; the tick applies them.
- C++23 on g++-14 (Ubuntu's g++-13 lacks `std::ranges::to`). Dependencies come from `vcpkg.json`,
  pinned by `builtin-baseline`.
- flatc, the C++ flatbuffers headers and the `flatbuffers` npm package are pinned to the same
  version. See `src/schema/README.md` before bumping any of them.

## Not deployed

There is no deploy pipeline. The earlier .NET server, its Dockerfile, Helm chart and
Olve.Pipelines config were removed on 2026-09-23 when the C++ server replaced it. A deploy for the
C++ server has not been built yet.
