#!/bin/sh
# Deploy to prod (apps). Runs only after deploy-beta succeeds: import both images into the
# homelab k3s containerd and helm-upgrade the prod release.
set -e

# See build-server.sh for the fetch rationale.
mkdir -p /tmp
wget --no-check-certificate -qO /tmp/olve-lib.sh \
  https://raw.githubusercontent.com/OliverVea/Olve.Pipelines/main/.pipelines/scripts/olve-lib.sh
. /tmp/olve-lib.sh

HOST=oliver@bulwark-m2
RELEASE=olve-slimerepublics
NAMESPACE=apps

olve_ssh_host bulwark-m2

INPUT_DIR=$(olve_bundle_input)
VERSION=$(cat "$INPUT_DIR/version.txt")
WEB_DIR=$(dirname "$(ls /input/*/web-version.txt | head -1)")
WEB_VERSION=$(cat "$WEB_DIR/web-version.txt")

echo "Deploying $RELEASE server:$VERSION web:$WEB_VERSION to $NAMESPACE"

olve_image_import "$INPUT_DIR/image.tar" "$HOST"
olve_image_import "$WEB_DIR/image.tar" "$HOST"

olve_helm_deploy "$HOST" "$RELEASE" "$NAMESPACE" "$INPUT_DIR/helm" "$VERSION" \
  --set web.image.tag="$WEB_VERSION"

ssh -o StrictHostKeyChecking=no "$HOST" \
  "kubectl -n $NAMESPACE rollout status deploy/$RELEASE-server --timeout=120s \
   && kubectl -n $NAMESPACE rollout status deploy/$RELEASE-web --timeout=120s"

echo "Deploy complete: $RELEASE server:$VERSION web:$WEB_VERSION"
