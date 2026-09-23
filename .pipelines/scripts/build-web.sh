#!/bin/sh
# Build the web image (client + nginx) with Kaniko from src/frontend. Runs in parallel with
# build-server. Writes web-version.txt — never version.txt, which marks the server's bundle
# dir — so the deploy scripts can tell the two apart.
set -e

# See build-server.sh for the fetch rationale.
mkdir -p /tmp
wget --no-check-certificate -qO /tmp/olve-lib.sh \
  https://raw.githubusercontent.com/OliverVea/Olve.Pipelines/main/.pipelines/scripts/olve-lib.sh
. /tmp/olve-lib.sh

REPO=OliverVea/Olve.SlimeRepublics
BRANCH=main
VERSION=$(olve_version)
CTX=/kaniko/build-context

olve_fetch_repo "$REPO" "$BRANCH" "$CTX"

echo "$VERSION" > /output/web-version.txt

# Context is the frontend dir; it holds its own Dockerfile and nginx.conf.
olve_kaniko_build "$CTX/src/frontend" "olve-slimerepublics-web:$VERSION"

echo "Build complete: olve-slimerepublics-web:$VERSION"
