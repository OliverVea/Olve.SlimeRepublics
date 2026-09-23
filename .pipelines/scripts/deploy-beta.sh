#!/bin/sh
# Deploy to apps-beta and gate prod: import both images into the homelab k3s containerd,
# helm-upgrade the beta release, wait for both rollouts, then open a WebSocket through the
# beta host. That last check exercises the whole chain — Traefik, nginx, its /ws proxy, the
# NetworkPolicies and the server — so a failure anywhere stops prod from deploying.
set -e

# See build-server.sh for the fetch rationale.
mkdir -p /tmp
wget --no-check-certificate -qO /tmp/olve-lib.sh \
  https://raw.githubusercontent.com/OliverVea/Olve.Pipelines/main/.pipelines/scripts/olve-lib.sh
. /tmp/olve-lib.sh

HOST=oliver@bulwark-m2
RELEASE=olve-slimerepublics
NAMESPACE=apps-beta
BETA_HOST=slimes-beta.ovea.pro

olve_ssh_host bulwark-m2

# The server step's dir holds version.txt, the chart and its image; the web step's holds
# web-version.txt and its image.
INPUT_DIR=$(olve_bundle_input)
VERSION=$(cat "$INPUT_DIR/version.txt")
WEB_DIR=$(dirname "$(ls /input/*/web-version.txt | head -1)")
WEB_VERSION=$(cat "$WEB_DIR/web-version.txt")

echo "Deploying $RELEASE server:$VERSION web:$WEB_VERSION to $NAMESPACE"

olve_image_import "$INPUT_DIR/image.tar" "$HOST"
olve_image_import "$WEB_DIR/image.tar" "$HOST"

olve_helm_deploy "$HOST" "$RELEASE" "$NAMESPACE" "$INPUT_DIR/helm" "$VERSION" \
  --set web.image.tag="$WEB_VERSION"

echo "Waiting for beta rollouts..."
ssh -o StrictHostKeyChecking=no "$HOST" \
  "kubectl -n $NAMESPACE rollout status deploy/$RELEASE-server --timeout=120s \
   && kubectl -n $NAMESPACE rollout status deploy/$RELEASE-web --timeout=120s"

# Run from the node (a tailnet member): the beta host resolves to the Tailscale IP. HTTP/1.1
# because an Upgrade handshake does not exist in HTTP/2. After a 101 curl just holds the socket
# open until --max-time, so it exits non-zero; only the status code matters. The Origin header
# must match the host or nginx refuses the upgrade.
echo "Verifying a WebSocket upgrade through https://$BETA_HOST/ws ..."
for i in 1 2 3 4 5; do
  code=$(ssh -o StrictHostKeyChecking=no "$HOST" \
    "curl -sk --http1.1 --max-time 3 -o /dev/null -w '%{http_code}' \
       -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
       -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
       -H 'Origin: https://$BETA_HOST' \
       https://$BETA_HOST/ws" || true)
  if [ "$code" = "101" ]; then
    echo "Beta WebSocket OK"
    exit 0
  fi
  echo "attempt $i: got HTTP '$code', want 101"
  sleep 5
done
echo "Beta WebSocket check failed" >&2
exit 1
