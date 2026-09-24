import { connect } from 'cloudflare:sockets';

const WS_OPEN = 1;
const DOH = 'https://1.1.1.1/dns-query';

export default {
  async fetch(request, env) {
    const userID = String(env.UUID || '').toLowerCase();
    const wsPath = '/' + String(env.WS_PATH || '').replace(/^\/+/, '');

    if (!userID || !env.WS_PATH) {
      return new Response('Not configured: set UUID and WS_PATH.', { status: 500 });
    }

    // Anything that is not a websocket upgrade just sees a boring page.
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response(LANDING, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    if (new URL(request.url).pathname !== wsPath) {
      return new Response('Not found', { status: 404 });
    }

    return handleTunnel(request, userID, env);
  },
};

function handleTunnel(request, userID, env) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();

  const state = { writer: null, udpWrite: null };
  const early = request.headers.get('sec-websocket-protocol') || '';

  wsReadable(server, early)
    .pipeTo(
      new WritableStream({
        async write(chunk) {
          if (state.udpWrite) return state.udpWrite(chunk);
          if (state.writer) return state.writer.write(chunk);

          const head = parseHeader(chunk, userID);
          if (head.error) throw new Error(head.message);

          const ack = new Uint8Array([head.version, 0]);
          const payload = chunk.slice(head.offset);

          if (head.isUDP) {
            if (head.port !== 53) throw new Error('UDP is only supported for DNS');
            state.udpWrite = makeDnsRelay(server, ack);
            return state.udpWrite(payload);
          }

          const conn = await dial(head, env);
          if (conn.kind === 'tcp') {
            state.writer = conn.socket.writable.getWriter();
            await state.writer.write(payload);
            remoteToWs(conn.socket, server, ack);
          } else {
            const relay = conn.ws;
            state.writer = {
              write: (c) => relay.send(c),
              close: () => relay.close(),
              abort: () => relay.close(),
            };
            relay.send(payload);
            relayToWs(relay, server, ack);
          }
        },
        close() {
          state.writer?.close().catch(() => {});
        },
        abort() {
          state.writer?.abort().catch(() => {});
        },
      })
    )
    .catch(() => safeClose(server));

  return new Response(null, { status: 101, webSocket: client });
}

/** Direct TCP, falling back to the relay when Cloudflare refuses the socket. */
async function dial(head, env) {
  try {
    const socket = connect({ hostname: head.address, port: head.port });
    await socket.opened;
    return { kind: 'tcp', socket };
  } catch (err) {
    if (!env.RELAY_URL || !env.RELAY_TOKEN) throw err;
    const u = new URL(env.RELAY_URL);
    u.searchParams.set('host', head.address);
    u.searchParams.set('port', String(head.port));
    u.searchParams.set('token', env.RELAY_TOKEN);
    const res = await fetch(u.toString(), { headers: { Upgrade: 'websocket' } });
    if (!res.webSocket) throw new Error('relay refused: ' + res.status);
    res.webSocket.accept();
    return { kind: 'relay', ws: res.webSocket };
  }
}

function relayToWs(relay, ws, ack) {
  let first = true;
  relay.addEventListener('message', (e) => {
    if (ws.readyState !== WS_OPEN) return;
    if (first) {
      const data = e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : new Uint8Array(e.data);
      ws.send(concat(ack, data));
      first = false;
    } else {
      ws.send(e.data);
    }
  });
  relay.addEventListener('close', () => safeClose(ws));
  relay.addEventListener('error', () => safeClose(ws));
}

async function remoteToWs(socket, ws, ack) {
  let first = true;
  await socket.readable
    .pipeTo(
      new WritableStream({
        write(chunk) {
          if (ws.readyState !== WS_OPEN) throw new Error('socket closed');
          if (first) {
            ws.send(concat(ack, new Uint8Array(chunk)));
            first = false;
          } else {
            ws.send(chunk);
          }
        },
        close: () => safeClose(ws),
        abort: () => safeClose(ws),
      })
    )
    .catch(() => safeClose(ws));
}

/** DNS-over-UDP inside VLESS -> DNS-over-HTTPS out. */
function makeDnsRelay(ws, ack) {
  let first = true;
  return async (chunk) => {
    const buf = new Uint8Array(chunk);
    let i = 0;
    while (i + 2 <= buf.byteLength) {
      const len = (buf[i] << 8) | buf[i + 1];
      i += 2;
      const query = buf.slice(i, i + len);
      i += len;
      if (query.byteLength !== len) break;

      const res = await fetch(DOH, {
        method: 'POST',
        headers: { 'content-type': 'application/dns-message' },
        body: query,
      });
      const answer = new Uint8Array(await res.arrayBuffer());
      const size = new Uint8Array([answer.byteLength >> 8, answer.byteLength & 0xff]);
      if (ws.readyState !== WS_OPEN) return;
      ws.send(first ? concat(ack, size, answer) : concat(size, answer));
      first = false;
    }
  };
}

function parseHeader(chunk, userID) {
  const buf = chunk instanceof ArrayBuffer ? chunk : chunk.buffer;
  if (buf.byteLength < 24) return { error: true, message: 'header too short' };
  const b = new Uint8Array(buf);

  if (uuidString(b.subarray(1, 17)) !== userID) {
    return { error: true, message: 'invalid user' };
  }

  const optLen = b[17];
  const cmd = b[18 + optLen];
  if (cmd !== 1 && cmd !== 2) return { error: true, message: `unsupported command ${cmd}` };

  let i = 19 + optLen;
  const port = (b[i] << 8) | b[i + 1];
  i += 2;

  const type = b[i++];
  let address = '';
  if (type === 1) {
    address = b.subarray(i, i + 4).join('.');
    i += 4;
  } else if (type === 2) {
    const len = b[i++];
    address = new TextDecoder().decode(b.subarray(i, i + len));
    i += len;
  } else if (type === 3) {
    const parts = [];
    const view = new DataView(buf, i, 16);
    for (let j = 0; j < 8; j++) parts.push(view.getUint16(j * 2).toString(16));
    address = parts.join(':');
    i += 16;
  } else {
    return { error: true, message: `bad address type ${type}` };
  }

  return { error: false, version: b[0], isUDP: cmd === 2, address, port, offset: i };
}

function wsReadable(ws, earlyDataHeader) {
  let done = false;
  return new ReadableStream({
    start(controller) {
      ws.addEventListener('message', (e) => !done && controller.enqueue(e.data));
      ws.addEventListener('close', () => {
        if (!done) {
          done = true;
          controller.close();
        }
      });
      ws.addEventListener('error', (e) => controller.error(e));

      // 0-RTT payload smuggled through the subprotocol header
      const early = base64UrlToBytes(earlyDataHeader);
      if (early) controller.enqueue(early.buffer);
    },
    cancel() {
      done = true;
      safeClose(ws);
    },
  });
}

const HEX = Array.from({ length: 256 }, (_, i) => (i + 256).toString(16).slice(1));
function uuidString(bytes) {
  const h = (a, b) => {
    let s = '';
    for (let i = a; i < b; i++) s += HEX[bytes[i]];
    return s;
  };
  return `${h(0, 4)}-${h(4, 6)}-${h(6, 8)}-${h(8, 10)}-${h(10, 16)}`;
}

function base64UrlToBytes(s) {
  if (!s) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out.buffer;
}

function safeClose(ws) {
  try {
    if (ws.readyState === WS_OPEN) ws.close(1000);
  } catch {}
}

const LANDING = `<!doctype html><meta charset=utf-8><title>It works</title>
<style>body{font:16px/1.6 system-ui;margin:12vh auto;max-width:34rem;padding:0 1rem;color:#333}</style>
<h1>It works</h1><p>This server is running.</p>`;
