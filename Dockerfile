# Game server image. Built by .pipelines/scripts/build-server.sh (Kaniko), context = repo root.
#
# Debian trixie: its g++ 14 has std::ranges::to, and the runtime stage must carry a libstdc++
# at least as new as the one we compiled against — trixie-slim does, bookworm/distroless-12
# do not (GLIBCXX_* not found at startup).
FROM debian:trixie AS build

# g++ as well as g++-14: vcpkg builds the dependencies with the default cc/c++, and trixie's
# default is 14. autoconf..m4: libsodium builds with autotools. git: vcpkg resolves the
# baseline from history.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      g++ g++-14 make cmake ninja-build pkg-config git curl ca-certificates zip unzip tar \
      autoconf autoconf-archive automake libtool m4 python3 \
 && rm -rf /var/lib/apt/lists/*

# CMakePresets.json finds vcpkg at $HOME/vcpkg; don't rely on Kaniko's RUN env for HOME.
ENV HOME=/root \
    VCPKG_ROOT=/root/vcpkg \
    VCPKG_DISABLE_METRICS=1 \
    VCPKG_MAX_CONCURRENCY=4

WORKDIR /src

# vcpkg checked out at the manifest's builtin-baseline, so the port versions the image builds
# are the ones vcpkg.json pins — read from the file rather than repeated here.
COPY src/backend/vcpkg.json src/backend/vcpkg.json
RUN baseline=$(grep -o '"builtin-baseline": *"[0-9a-f]*"' src/backend/vcpkg.json | grep -o '[0-9a-f]\{40\}') \
 && git clone --filter=blob:none https://github.com/microsoft/vcpkg.git "$VCPKG_ROOT" \
 && git -C "$VCPKG_ROOT" checkout -q "$baseline" \
 && "$VCPKG_ROOT/bootstrap-vcpkg.sh" -disableMetrics

COPY src/schema src/schema
COPY src/backend src/backend

# One RUN for configure + build + test: Kaniko snapshots every layer, so splitting them would
# snapshot the whole build tree more than once. A failing test fails the image build, which
# fails the pipeline's production group, so nothing deploys.
#
# - x64-linux-release: build the dependencies release-only (the default triplet builds each
#   twice, debug and release).
# - --clean-after-build: drop vcpkg's buildtrees as it goes; they run to gigabytes.
# - Hardening flags are passed here rather than set in CMakeLists.txt, so local debug/ASan
#   builds are untouched. Debian's gcc already defaults to PIE.
RUN cd src/backend \
 && cmake --preset release \
      -DVCPKG_TARGET_TRIPLET=x64-linux-release \
      -DVCPKG_INSTALL_OPTIONS=--clean-after-build \
      "-DCMAKE_CXX_FLAGS=-D_FORTIFY_SOURCE=3 -fstack-protector-strong -fstack-clash-protection -fcf-protection" \
      "-DCMAKE_EXE_LINKER_FLAGS=-Wl,-z,relro,-z,now" \
 && cmake --build build-release --parallel 4 \
 && ctest --test-dir build-release --output-on-failure

FROM debian:trixie-slim

COPY --from=build /src/src/backend/build-release/slime_server /usr/local/bin/slime_server

# Unprivileged, numeric so the pod's runAsNonRoot check can verify it without an /etc/passwd entry.
USER 10001
EXPOSE 9001
ENTRYPOINT ["/usr/local/bin/slime_server"]
