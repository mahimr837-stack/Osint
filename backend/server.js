import 'dotenv/config';
import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { checkUsername, OSINT_PLATFORMS } from './osint.js';

const PORT = Number(process.env.PORT) || 3001;
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const OSINT_TIMEOUT_MS = Number(process.env.OSINT_TIMEOUT_MS) || 5_000;

// ---------------------------------------------------------------------------
// Express (REST)
// ---------------------------------------------------------------------------
const app = express();

app.use(
  cors({
    origin(origin, callback) {
      // Requests without an Origin header (curl, native mobile clients) are allowed.
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.json({ name: 'traceboard-backend', endpoints: ['/api/health', '/api/osint/pivot', 'ws:/sync'] });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// --- Native JS Username Pivot -----------------------------------------------

const USERNAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

app.post('/api/osint/pivot', async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Invalid or missing "username" (allowed: A-Z a-z 0-9 . _ -, max 64).' });
  }

  try {
    const { found, checks } = await checkUsername(username, { timeoutMs: OSINT_TIMEOUT_MS });
    return res.json({ username, source: 'native', found, checks });
  } catch (err) {
    console.error('[pivot] native check failed:', err.message);
    return res.status(500).json({ error: 'Username lookup failed' });
  }
});

// ---------------------------------------------------------------------------
// HTTP + WebSocket on the same port
// ---------------------------------------------------------------------------
const server = http.createServer(app);

// Mobile companion app connects here to push images; relay to all other connected clients (e.g. desktop canvas).
const wss = new WebSocketServer({ server, path: '/sync' });

wss.on('connection', (ws, req) => {
  const peer = req.socket.remoteAddress;
  console.log(`[ws] client connected from ${peer} (total: ${wss.clients.size})`);

  ws.on('message', (data, isBinary) => {
    // Relay to every other open client, preserving text vs binary frames.
    let relayed = 0;
    for (const client of wss.clients) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(data, { binary: isBinary });
        relayed++;
      }
    }
    console.log(
      `[ws] relayed ${isBinary ? 'binary' : 'text'} message (${data.length} bytes) to ${relayed} client(s)`,
    );
  });

  ws.on('close', () => console.log(`[ws] client disconnected (total: ${wss.clients.size})`));
  ws.on('error', (err) => console.error('[ws] error:', err.message));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Traceboard backend listening on http://0.0.0.0:${PORT}`);
  console.log(`WebSocket sync endpoint: ws://localhost:${PORT}/sync`);
  console.log(`CORS origins: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`OSINT pivot engine: native fetch (${OSINT_PLATFORMS.length} platforms, ${OSINT_TIMEOUT_MS}ms timeout)`);
});
