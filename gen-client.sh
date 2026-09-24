#!/usr/bin/env bash
# Generates credentials + client configs for the deployed exit node.
#   ./gen-client.sh                 -> generate fresh UUID/path, print worker secrets
#   ./gen-client.sh cloud-exit.you.workers.dev -> also print client link + write sing-box config
set -euo pipefail

ENV_FILE="$(dirname "$0")/.env"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  echo "loaded existing creds from .env"
else
  VPN_UUID="$(uuidgen | tr 'A-Z' 'a-z')"
  VPN_PATH="$(LC_ALL=C head -c 4000 /dev/urandom | LC_ALL=C tr -dc "a-z0-9" | cut -c1-20)"
  cat > "$ENV_FILE" <<EOF
VPN_UUID=$VPN_UUID
VPN_PATH=$VPN_PATH
EOF
  chmod 600 "$ENV_FILE"
  echo "generated new creds -> .env (keep this file private)"
fi

echo
echo "=== Worker secrets (deploy.sh pushes these for you) ==============================="
echo "VPN_UUID = $VPN_UUID"
echo "VPN_PATH = $VPN_PATH"
echo

HOST="${1:-}"
if [ -z "$HOST" ]; then
  echo "Re-run as:  ./gen-client.sh <name>.<subdomain>.workers.dev   to get client configs"
  exit 0
fi
HOST="${HOST#https://}"; HOST="${HOST%/}"

LINK="vless://${VPN_UUID}@${HOST}:443?encryption=none&security=tls&sni=${HOST}&host=${HOST}&type=ws&path=%2F${VPN_PATH}#cloud-exit"

echo "=== Phone / one-tap clients (paste this link) =================="
echo "$LINK"
echo

OUT="$(dirname "$0")/clients/singbox-client.json"
mkdir -p "$(dirname "$OUT")"
cat > "$OUT" <<EOF
{
  "log": { "level": "warn" },
  "dns": {
    "servers": [
      { "type": "https", "tag": "remote", "server": "1.1.1.1", "detour": "proxy" },
      { "type": "local", "tag": "local" }
    ],
    "final": "remote"
  },
  "inbounds": [
    {
      "type": "tun",
      "tag": "tun-in",
      "address": ["172.19.0.1/30"],
      "auto_route": true,
      "strict_route": false,
      "stack": "system"
    }
  ],
  "outbounds": [
    {
      "type": "vless",
      "tag": "proxy",
      "server": "${HOST}",
      "server_port": 443,
      "uuid": "${VPN_UUID}",
      "packet_encoding": "xudp",
      "tls": {
        "enabled": true,
        "server_name": "${HOST}",
        "utls": { "enabled": true, "fingerprint": "chrome" }
      },
      "transport": {
        "type": "ws",
        "path": "/${VPN_PATH}",
        "headers": { "Host": "${HOST}" }
      }
    },
    { "type": "direct", "tag": "direct" }
  ],
  "route": {
    "rules": [
      { "action": "sniff" },
      { "protocol": "dns", "action": "hijack-dns" },
      { "ip_is_private": true, "outbound": "direct" }
    ],
    "final": "proxy",
    "default_domain_resolver": { "server": "local" },
    "auto_detect_interface": true
  }
}
EOF
PROXY="$(dirname "$0")/clients/singbox-proxy.json"
cat > "$PROXY" <<EOF
{
  "log": { "level": "warn" },
  "inbounds": [
    {
      "type": "mixed",
      "tag": "local",
      "listen": "127.0.0.1",
      "listen_port": 1080
    }
  ],
  "outbounds": [
    {
      "type": "vless",
      "tag": "proxy",
      "server": "${HOST}",
      "server_port": 443,
      "uuid": "${VPN_UUID}",
      "packet_encoding": "xudp",
      "tls": {
        "enabled": true,
        "server_name": "${HOST}",
        "utls": { "enabled": true, "fingerprint": "chrome" }
      },
      "transport": {
        "type": "ws",
        "path": "/${VPN_PATH}",
        "headers": { "Host": "${HOST}" }
      }
    }
  ]
}
EOF
echo "=== No-admin proxy config (SOCKS5 + HTTP on 127.0.0.1:1080) ===="
echo "wrote $PROXY"
echo "run it with:  sing-box run -c clients/singbox-proxy.json    (no sudo needed)"
echo

echo "=== macOS / Linux full-tunnel config ==========================="
echo "wrote $OUT"
echo "run it with:  sudo sing-box run -c clients/singbox-client.json"
