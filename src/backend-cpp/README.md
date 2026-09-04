# backend-cpp

The game server. One file, no build system.

```bash
g++ -O3 main.cpp -luSockets -lz -luv -o server
./server            # ws://localhost:9001
```

`-luSockets` is uWebSockets' event-loop library; `-lz` is permessage-deflate,
`-luv` the libuv backend it was built against.

`libuSockets.a` is compiled with `WITH_LIBUV=1` (i.e. `-DLIBUS_USE_LIBUV`), but
the compile line above does not define it. That is fine while `main.cpp` only
passes loop pointers around opaquely. Anything that reaches into `uWS::Loop`'s
libuv integration or uses `LocalCluster` must add `-DLIBUS_USE_LIBUV`, or the
struct layouts silently disagree.

## First time on a machine

```bash
../../tools/install-cpp-deps.sh
```

Installs `flatc` to `~/.local/bin` and the flatbuffers, uWebSockets and
uSockets headers plus `libuSockets.a` to `/usr/local`. Versions are pinned in
that script — flatc's must match the C++ headers, because generated code
`static_assert`s on it.

## Generated code

`generated/` is flatc output from [`../schema/`](../schema) and is committed, so
building the server never requires flatc. Regenerate after editing a `.fbs`:

```bash
../schema/generate.sh
```
