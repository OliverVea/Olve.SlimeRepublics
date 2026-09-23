# schema

FlatBuffers definitions shared by the C++ server and the TypeScript client.

```bash
./generate.sh
```

regenerates the TypeScript types in `src/frontend/src/generated/`, which are committed so the
client builds without flatc installed. The C++ headers are not generated here: CMake runs the
vcpkg flatc at build time, so they always match the C++ runtime.

## Versions must agree

Three artifacts are pinned to **25.9.23** and have to stay in lockstep:

- `flatc` — see [`tools/install-cpp-deps.sh`](../../tools/install-cpp-deps.sh)
- the C++ headers in `/usr/local/include/flatbuffers` — generated code
  `static_assert`s on the major/minor, so a mismatch is a compile error
- the `flatbuffers` npm package in `src/frontend/package.json` — no such guard
  on this side, so a mismatch is silent

`generate.sh` refuses to run against the wrong `flatc`. Do **not** use Ubuntu's
`flatbuffers-compiler` package; noble ships 2.0.8.

## Notes

- The generated TypeScript is prefixed with `// @ts-nocheck` by `generate.sh`.
  flatc emits unused union helpers and type parameters that trip the project's
  `noUnusedLocals`/`noUnusedParameters`. Exported types still reach callers.
- `src/generated` is excluded from Biome in `src/frontend/biome.json`.
