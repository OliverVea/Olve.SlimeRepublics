#!/usr/bin/env bash
# Installs everything `g++ -O3 main.cpp -luSockets -lz -luv -o server` needs.
#
#   flatc                -> ~/.local/bin              (schema compiler)
#   flatbuffers/*.h      -> /usr/local/include        (header-only runtime)
#   uWebSockets/*.h      -> /usr/local/include
#   libusockets.h        -> /usr/local/include
#   libuSockets.a        -> /usr/local/lib
#   libuv, zlib          -> apt
#
# Versions are pinned. flatc must match the C++ headers (generated code
# static_asserts on it) and the `flatbuffers` npm package in src/frontend.
set -euo pipefail

FLATBUFFERS_VERSION=25.9.23
UWEBSOCKETS_VERSION=20.80.0

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "==> apt packages"
sudo apt-get update -qq
sudo apt-get install -y -qq build-essential git unzip curl libuv1-dev zlib1g-dev

echo "==> flatc $FLATBUFFERS_VERSION"
curl -fsSL -o "$work/flatc.zip" \
  "https://github.com/google/flatbuffers/releases/download/v$FLATBUFFERS_VERSION/Linux.flatc.binary.g%2B%2B-13.zip"
unzip -oq "$work/flatc.zip" -d "$work"
install -d "$HOME/.local/bin"
install -m755 "$work/flatc" "$HOME/.local/bin/flatc"

echo "==> flatbuffers headers $FLATBUFFERS_VERSION"
curl -fsSL -o "$work/fb.tar.gz" \
  "https://github.com/google/flatbuffers/archive/refs/tags/v$FLATBUFFERS_VERSION.tar.gz"
tar xzf "$work/fb.tar.gz" -C "$work"
sudo rm -rf /usr/local/include/flatbuffers
sudo cp -r "$work/flatbuffers-$FLATBUFFERS_VERSION/include/flatbuffers" /usr/local/include/flatbuffers

echo "==> uWebSockets $UWEBSOCKETS_VERSION"
git clone -q --branch "v$UWEBSOCKETS_VERSION" --depth 1 --recurse-submodules \
  https://github.com/uNetworking/uWebSockets.git "$work/uws"
# libuv event loop, no SSL — TLS is terminated at the ingress, not here.
make -C "$work/uws/uSockets" WITH_LIBUV=1 >/dev/null
sudo install -m644 "$work/uws/uSockets/uSockets.a" /usr/local/lib/libuSockets.a
sudo install -m644 "$work/uws/uSockets/src/libusockets.h" /usr/local/include/libusockets.h
sudo rm -rf /usr/local/include/uWebSockets
sudo install -d /usr/local/include/uWebSockets
sudo cp "$work/uws"/src/*.h /usr/local/include/uWebSockets/
sudo ldconfig

echo
echo "done. flatc: $("$HOME/.local/bin/flatc" --version)"
echo "build the server with:"
echo "  cd src/backend-cpp && g++ -O3 main.cpp -luSockets -lz -luv -o server"
