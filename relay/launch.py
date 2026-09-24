#!/usr/bin/env python3
"""
Boots a relay in an E2B sandbox and points the Worker at it.

    export E2B_API_KEY=...
    python3 relay/launch.py [--hours 1]

The sandbox dies when the timeout expires; rerun this to get a new one.
"""
import argparse, os, secrets, subprocess, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PORT = 8000


def wrangler_secret(name: str, value: str) -> None:
    subprocess.run(
        ["npx", "--yes", "wrangler@4", "secret", "put", name],
        cwd=ROOT / "cloudflare", input=value, text=True, check=True,
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=float, default=1.0)
    args = ap.parse_args()

    if not os.getenv("E2B_API_KEY"):
        print("E2B_API_KEY is not set. export it first.", file=sys.stderr)
        return 1

    try:
        from e2b import Sandbox
    except ImportError:
        print("pip install e2b", file=sys.stderr)
        return 1

    timeout = int(args.hours * 3600)
    token = secrets.token_urlsafe(24)

    print(f"==> starting sandbox (timeout {args.hours}h)")
    sbx = Sandbox.create(timeout=timeout, allow_internet_access=True)

    print("==> installing relay")
    sbx.files.write("/home/user/server.js", (HERE / "server.js").read_text())
    sbx.commands.run("cd /home/user && npm init -y >/dev/null 2>&1 && npm install ws --silent")

    sbx.commands.run(
        "cd /home/user && node server.js > relay.log 2>&1",
        background=True,
        envs={"RELAY_TOKEN": token, "PORT": str(PORT)},
    )
    time.sleep(3)

    host = sbx.get_host(PORT)
    url = f"wss://{host}/"
    print(f"==> relay up at {url}")

    print("==> pointing the worker at it")
    wrangler_secret("RELAY_URL", url)
    wrangler_secret("RELAY_TOKEN", token)

    deadline = time.time() + timeout
    print()
    print("Relay is live. Cloudflare-fronted sites should now work through the VPN.")
    print(f"It expires at {time.strftime('%H:%M', time.localtime(deadline))}.")
    print("Leave this running; Ctrl-C kills the sandbox.")
    try:
        while time.time() < deadline:
            time.sleep(30)
    except KeyboardInterrupt:
        pass
    finally:
        sbx.kill()
        print("sandbox stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
