# cloud-exit

A personal exit node on **Cloudflare Workers**. Your traffic leaves from Cloudflare's
network instead of your local network, so network-level blocks don't apply.

Transport is VLESS over WebSocket over TLS — to anything watching, it is an HTTPS
connection to a `workers.dev` site. Free tier, no card, no server to keep alive.

## Setup

```bash
./gen-client.sh                    # generates a UUID + secret path into .env
cd cloudflare && ./deploy.sh       # wrangler login happens here if needed
cd .. && ./gen-client.sh <name>.<subdomain>.workers.dev
```

That last command prints a `vless://` link and writes `clients/singbox-client.json`.

## Connecting

**iPhone / Android** — install a client, paste the `vless://` link:
Streisand or Shadowrocket (iOS), v2rayNG or NekoBox (Android). Toggle on. This is a
real system VPN — all apps go through it.

**macOS** — full tunnel via sing-box:

```bash
brew install sing-box
sudo sing-box run -c clients/singbox-client.json
```

Verify with `curl ifconfig.me` — you should see a Cloudflare IP, not yours.

## What's in here

| path | |
|---|---|
| `cloudflare/src/worker.js` | the worker: VLESS parser, TCP relay, DNS-over-HTTPS for UDP :53 |
| `cloudflare/deploy.sh` | deploys and pushes `UUID` / `WS_PATH` as secrets |
| `gen-client.sh` | generates credentials and client configs |
| `.env` | your credentials — gitignored, keep it private |

Credentials are Worker **secrets**, never committed. Non-WebSocket requests to the
worker get a plain "It works" page; wrong path gets a 404; wrong UUID gets dropped.
All three verified locally against `wrangler dev`.

## Limits worth knowing

- **Free tier**: 100k requests/day (one request = one connection) and 10ms CPU per
  request. Time spent waiting on the network is not CPU, so normal browsing fits fine.
- **UDP is DNS-only.** Everything else is TCP. So: web, APIs, streaming, SSH all work.
  WebRTC and most multiplayer game traffic do not.
- **Sites behind Cloudflare DO fail** — confirmed by testing against the live worker.
  Workers cannot open sockets back into Cloudflare's own network. Verified results:
  YouTube, Instagram, TikTok and Google work; Discord, OpenAI, Medium and example.com
  do not. Roughly a fifth of the web sits behind Cloudflare. Fixing this needs a relay
  host outside Cloudflare — see "Relay" below.
- **`workers.dev` is itself blocked on some restrictive networks**, since it's a
  well-known bypass domain. If that happens, put a custom domain in front of the worker
  (Workers Routes) — costs a domain, nothing else.

## Rotating credentials

```bash
rm .env && ./gen-client.sh && cd cloudflare && ./deploy.sh
```

Old client links stop working immediately.

## Relay (unblocks Cloudflare-fronted sites)

The Worker can't socket into Cloudflare's network, so ChatGPT, OpenAI, Discord and X
fail through it. `relay/` is a small WebSocket→TCP forwarder that lives outside
Cloudflare; the Worker falls back to it only when a direct dial fails, so normal
traffic never touches it.

Verified locally: chatgpt.com returns 301 through the relay while failing through the
Worker directly. Bad tokens are refused.

### Option A — Render free tier (permanent, recommended)

1. Push this repo to GitHub.
2. render.com → **New Web Service** → connect the repo. `render.yaml` sets it up:
   root dir `relay`, free plan, and it generates `RELAY_TOKEN` for you.
3. Copy the generated `RELAY_TOKEN` from the Render dashboard and the service URL.
4. Point the Worker at it:

```bash
cd cloudflare
echo -n "wss://<your-service>.onrender.com/" | npx wrangler@4 secret put RELAY_URL
echo -n "<the RELAY_TOKEN>" | npx wrangler@4 secret put RELAY_TOKEN
```

Free Render services sleep after ~15 min idle and take ~30s to wake, so the first
Cloudflare-hosted site you hit after a quiet spell will be slow. After that it's fine.

### Option B — E2B sandbox (instant, expires)

```bash
export E2B_API_KEY=...
.venv/bin/pip install e2b
.venv/bin/python relay/launch.py --hours 1
```

Boots a sandbox, starts the relay, pushes both secrets automatically. Dies when the
timeout expires and bills sandbox time while up. Good for "I need it right now".

### Turning the relay off

```bash
cd cloudflare && npx wrangler@4 secret delete RELAY_URL && npx wrangler@4 secret delete RELAY_TOKEN
```
