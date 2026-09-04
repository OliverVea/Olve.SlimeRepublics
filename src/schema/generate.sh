#!/usr/bin/env bash
# Regenerates FlatBuffers code from src/schema/*.fbs into both backends.
#
# Requires flatc 25.9.23 — the version must match the C++ headers in
# /usr/local/include/flatbuffers (generated code static_asserts on it) and the
# `flatbuffers` npm package pinned in src/frontend/package.json.
# See src/schema/README.md to install it.
set -euo pipefail

FLATC_VERSION=25.9.23

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
schema_dir="$repo_root/src/schema"
cpp_out="$repo_root/src/backend-cpp/generated"
ts_out="$repo_root/src/frontend/src/generated"

have="$(flatc --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
if [[ "$have" != "$FLATC_VERSION" ]]; then
  echo "flatc $FLATC_VERSION required, found $have — see src/schema/README.md" >&2
  exit 1
fi

rm -rf "$cpp_out" "$ts_out"
mkdir -p "$cpp_out" "$ts_out"

flatc --cpp --scoped-enums -o "$cpp_out" "$schema_dir"/*.fbs
flatc --ts  --gen-all      -o "$ts_out"  "$schema_dir"/*.fbs

# flatc emits unused union helpers and type params, which trip the project's
# noUnusedLocals/noUnusedParameters. Generated code is not ours to fix, so opt
# these files out of checking; their exported types still flow to callers.
while IFS= read -r -d '' f; do
  printf '// @ts-nocheck\n%s' "$(cat "$f")" > "$f"
done < <(find "$ts_out" -name '*.ts' -print0)

echo "generated -> $cpp_out"
echo "generated -> $ts_out"
