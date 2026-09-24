# Connecting a machine

Your node: `cloud-exit.aaravriyer.workers.dev`
Your link and configs come from `./gen-client.sh cloud-exit.aaravriyer.workers.dev`.

There are two ways to connect, and the right one depends on whether you control the machine.

| | what it does | needs admin |
|---|---|---|
| **Full tunnel** | every app on the device goes through the node | yes |
| **Proxy mode** | only apps you point at `127.0.0.1:1080` | **no** |

Proxy mode is the one that works on locked-down and managed machines.

---

## iPhone / iPad

1. App Store → **Streisand** (free). Shadowrocket also works but costs money.
2. Copy the `vless://` link, open Streisand → **+** → *Import from clipboard*.
3. Toggle on. Approve the VPN profile prompt.

## Android

1. Play Store or GitHub → **v2rayNG** or **NekoBox**.
2. **+** → *Import config from clipboard*, paste the `vless://` link.
3. Tap connect, approve the VPN prompt.

## Windows

1. Download **Hiddify** or **NekoRay**.
2. Paste the `vless://` link (Hiddify: *Add from clipboard*).
3. For full tunnel pick "Tun mode"; otherwise it runs as a local proxy.

## macOS — full tunnel

```bash
brew install sing-box
sudo sing-box run -c clients/singbox-client.json
```

## macOS / Linux — proxy mode, no admin

```bash
sing-box run -c clients/singbox-proxy.json
```

Then point things at it:

```bash
curl --socks5-hostname 127.0.0.1:1080 https://checkip.amazonaws.com
```

Browser-wide, without touching system settings — launch Chrome through it:

```bash
open -na "Google Chrome" --args --proxy-server="socks5://127.0.0.1:1080"
```

On Linux, or to set it for one shell only:

```bash
export ALL_PROXY=socks5h://127.0.0.1:1080
```

## Chromebook / managed device

Install the **Android** client (v2rayNG) if the Play Store is allowed — it uses
Android's VPN API and needs no admin rights on ChromeOS itself.

---

## Checking it worked

```bash
curl --socks5-hostname 127.0.0.1:1080 https://checkip.amazonaws.com
```

A different IP than `curl https://checkip.amazonaws.com` means you're through.
Don't use ipify or ifconfig.me to test — they're Cloudflare-hosted and will hang.

## When something won't load

Cloudflare-fronted sites (Discord, OpenAI, Medium) fail by design — see README.
Everything else should work. If a site hangs, check whether it's on Cloudflare
before assuming the node is broken:

```bash
dig +short <the-site> | head -1
```

An IP starting `104.` or `172.6x.` is usually Cloudflare.
