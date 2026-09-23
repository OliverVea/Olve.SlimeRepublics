#!/bin/sh
# Build the game server image with Kaniko (tests run inside the build), and stage the deploy
# artifacts — image tar, helm chart, version — into /output for the deploy steps.
# The Kaniko/staging footguns live in olve-lib.sh (shared across all Olve.Pipelines apps).
set -e

# Fetch-to-file, not `. <(...)`: busybox has no process substitution. The kaniko:debug rootfs
# has no /tmp. Swap `main` for a tag/SHA to pin.
mkdir -p /tmp
wget --no-check-certificate -qO /tmp/olve-lib.sh \
  https://raw.githubusercontent.com/OliverVea/Olve.Pipelines/main/.pipelines/scripts/olve-lib.sh
. /tmp/olve-lib.sh

REPO=OliverVea/Olve.SlimeRepublics
BRANCH=main
VERSION=$(olve_version)
CTX=/kaniko/build-context

olve_fetch_repo "$REPO" "$BRANCH" "$CTX"

# Carry the chart and version forward before Kaniko runs (it wipes the context root between
# stages). version.txt marks this step's bundle dir for olve_bundle_input.
olve_stage_artifact "$CTX/helm" /output/helm
echo "$VERSION" > /output/version.txt

# The image name must equal the helm release: olve_helm_deploy sets
# image.repository=docker.io/library/<release>.
olve_kaniko_build "$CTX" "olve-slimerepublics:$VERSION"

echo "Build complete: olve-slimerepublics:$VERSION"
