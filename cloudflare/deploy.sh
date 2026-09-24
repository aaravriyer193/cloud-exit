#!/usr/bin/env bash
# Deploys the worker and pushes UUID / WS_PATH as secrets.
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE="../.env"
[ -f "$ENV_FILE" ] || { echo "No ../.env — run ./gen-client.sh first."; exit 1; }
# shellcheck disable=SC1090
. "$ENV_FILE"

WRANGLER="npx --yes wrangler@4"

echo "==> deploying worker"
$WRANGLER deploy

echo "==> setting secrets"
printf '%s' "$VPN_UUID" | $WRANGLER secret put UUID
printf '%s' "$VPN_PATH" | $WRANGLER secret put WS_PATH

echo
echo "Done. Your host is <worker-name>.<your-subdomain>.workers.dev"
echo "Then run:  ../gen-client.sh <that-host>"
