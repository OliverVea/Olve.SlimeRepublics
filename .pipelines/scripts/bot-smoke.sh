#!/bin/sh
# Gameplay gate between beta and prod: bots join the freshly deployed beta, hop around for a
# minute, and fail the step if a socket drops, snapshots arrive well under the tick rate, a
# slime does not move, or the bots cannot see each other. See src/frontend/scripts/smoke.ts.
#
# Runs in the runner pod, not over ssh: slimes-beta.ovea.pro resolves to the node's Tailscale
# IP, which svclb forwards to Traefik — a path the runner NetworkPolicy allows.
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

SMOKE_URL=wss://slimes-beta.ovea.pro/ws SMOKE_BOTS=3 SMOKE_SECONDS=60 npm run smoke
