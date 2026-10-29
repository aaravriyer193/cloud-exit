#!/usr/bin/env bash
# Creates the relay service on Render and wires the Worker to it.
#
#   render login          # once, opens a browser
#   ./relay/deploy-render.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NAME="cloud-exit-relay"
REPO="https://github.com/aaravriyer193/cloud-exit"

command -v render >/dev/null || { echo "render CLI missing: brew install render"; exit 1; }
WS_OUT="$(render workspace current 2>&1 || true)"
if printf '%s' "$WS_OUT" | grep -qi "error"; then
  if printf '%s' "$WS_OUT" | grep -q "no workspace set"; then
    echo "No Render workspace selected. Pick one (interactive, one time):"
    echo
    echo "    render workspace set"
    echo
    echo "...then rerun this script."
  else
    echo "Not logged in. Run: render login"
  fi
  exit 1
fi

[ -f .env ] || { echo "no .env - run ./gen-client.sh first"; exit 1; }
# shellcheck disable=SC1090
. ./.env
[ -n "${RELAY_TOKEN:-}" ] || { echo "RELAY_TOKEN missing from .env"; exit 1; }

echo "==> creating $NAME on Render (free plan)"
render services create \
  --name "$NAME" \
  --type web_service \
  --repo "$REPO" \
  --branch main \
  --runtime node \
  --root-directory relay \
  --build-command "npm install" \
  --start-command "node server.js" \
  --health-check-path "/" \
  --plan free \
  --env-var "RELAY_TOKEN=$RELAY_TOKEN" \
  --confirm \
  --output json > /tmp/render-create.json || {
    echo "create failed. If it says the repo is not accessible, connect GitHub to"
    echo "Render once at https://dashboard.render.com/settings#github then rerun."
    exit 1
  }

URL="$(python3 -c '
import json,sys
d=json.load(open("/tmp/render-create.json"))
def find(o):
    if isinstance(o,dict):
        for k,v in o.items():
            if k=="url" and isinstance(v,str) and v.startswith("http"): return v
            r=find(v)
            if r: return r
    if isinstance(o,list):
        for v in o:
            r=find(v)
            if r: return r
d=find(d) or ""
print(d)
')"

if [ -z "$URL" ]; then
  echo "service created but no URL yet; check: render services"
  exit 1
fi

HOST="${URL#https://}"; HOST="${HOST#http://}"; HOST="${HOST%/}"
echo "==> service at https://$HOST"

echo "==> waiting for first deploy (free tier builds are slow)"
for i in $(seq 1 60); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$HOST/" || true)"
  [ "$CODE" = "200" ] && { echo "==> relay is live"; break; }
  printf '.'
  sleep 15
done
echo

echo "==> pointing the Worker at the relay"
cd cloudflare
printf '%s' "wss://$HOST/" | npx --yes wrangler@4 secret put RELAY_URL
printf '%s' "$RELAY_TOKEN" | npx --yes wrangler@4 secret put RELAY_TOKEN
cd ..

echo
echo "Done. Cloudflare-fronted sites should now work through the VPN."
echo "Verify:  curl --socks5-hostname 127.0.0.1:1080 -o /dev/null -w '%{http_code}\\n' https://chatgpt.com/"
