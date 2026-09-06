#!/usr/bin/env bash
# Host toolchain + vcpkg bootstrap for src/backend-cpp.
#
# Everything the server actually links comes from src/backend-cpp/vcpkg.json,
# pinned by its builtin-baseline. This script only installs what vcpkg cannot
# provide for itself: the compiler toolchain, CMake/Ninja, and the autotools
# that libsodium's build requires on the host.
#
# g++-14 is explicit: Ubuntu 24.04's default g++-13 ships libstdc++ 13, which
# has no std::ranges::to. CMakePresets.json pins the compiler to match.
set -euo pipefail

VCPKG_DIR="${VCPKG_ROOT:-$HOME/vcpkg}"
FLATC_VERSION=25.9.23   # must match src/frontend/package.json; see src/schema/generate.sh

echo "==> host packages"
sudo apt-get update -qq
sudo apt-get install -y -qq \
  build-essential g++-14 git curl zip unzip tar pkg-config \
  cmake ninja-build \
  autoconf autoconf-archive automake libtool m4   # libsodium builds with autotools

# The C++ FlatBuffers code is generated at build time by vcpkg's flatc. This
# one is for the TypeScript client only: it must match the `flatbuffers` npm
# package, which lags the C++ releases. See src/schema/generate.sh.
echo "==> flatc $FLATC_VERSION (TypeScript codegen only)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
curl -fsSL -o "$work/flatc.zip" \
  "https://github.com/google/flatbuffers/releases/download/v$FLATC_VERSION/Linux.flatc.binary.g%2B%2B-13.zip"
unzip -oq "$work/flatc.zip" -d "$work"
install -d "$HOME/.local/bin"
install -m755 "$work/flatc" "$HOME/.local/bin/flatc"

echo "==> vcpkg -> $VCPKG_DIR"
if [ ! -d "$VCPKG_DIR" ]; then
  git clone --filter=blob:none https://github.com/microsoft/vcpkg.git "$VCPKG_DIR"
fi
"$VCPKG_DIR/bootstrap-vcpkg.sh" -disableMetrics

cat <<MSG

Done. Build with:

    cd src/backend-cpp
    cmake --preset debug     # first run installs the vcpkg dependencies
    cmake --build build

The presets expect vcpkg at \$HOME/vcpkg. If yours lives elsewhere, override
CMAKE_TOOLCHAIN_FILE or move it.
MSG
