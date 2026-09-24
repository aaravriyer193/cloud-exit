// WebSocket -> raw TCP relay. Runs inside the E2B sandbox.
// The Worker calls: wss://<host>/?host=<dest>&port=<n>&token=<secret>
const http = require('http');
const net = require('net');
const { WebSocketServer } = require('ws');

const TOKEN = process.env.RELAY_TOKEN || '';
const PORT = Number(process.env.PORT || 8000);

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('ok');
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  let u;
  try {
    u = new URL(req.url, 'http://localhost');
  } catch {
    return socket.destroy();
  }

  if (!TOKEN || u.searchParams.get('token') !== TOKEN) return socket.destroy();

  const host = u.searchParams.get('host');
  const port = Number(u.searchParams.get('port'));
  if (!host || !port) return socket.destroy();

  wss.handleUpgrade(req, socket, head, (ws) => {
    const tcp = net.connect(port, host);
    tcp.on('data', (d) => ws.readyState === 1 && ws.send(d));
    tcp.on('close', () => ws.close());
    tcp.on('error', () => ws.close());
    ws.on('message', (d) => tcp.write(d));
    ws.on('close', () => tcp.destroy());
    ws.on('error', () => tcp.destroy());
  });
});

server.listen(PORT, () => console.log('relay listening on ' + PORT));
