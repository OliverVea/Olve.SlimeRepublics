#!/bin/sh
# Frontend gate: Biome lint/format, the Vitest suite and the typecheck + production build.
# Produces no deploy artifacts; a failure fails the production group, so nothing deploys.
#
# node:24-alpine: busybox wget + tar (for olve_fetch_repo) and npm are built in, and
# package-lock.json carries the musl binaries for Biome and rolldown.
set -e

# See build-server.sh for the fetch rationale.
mkdir -p /tmp
wget --no-check-certificate -qO /tmp/olve-lib.sh \
  https://raw.githubusercontent.com/OliverVea/Olve.Pipelines/main/.pipelines/scripts/olve-lib.sh
. /tmp/olve-lib.sh

REPO=OliverVea/Olve.SlimeRepublics
BRANCH=main

olve_fetch_repo "$REPO" "$BRANCH" /src

cd /src/src/frontend

npm ci
npm run lint
npm test
npm run build

echo "Frontend checks passed"
