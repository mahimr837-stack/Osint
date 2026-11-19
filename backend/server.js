import 'dotenv/config';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import cors from 'cors';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT) || 3001;
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const SHERLOCK_BIN = process.env.SHERLOCK_BIN || 'sherlock';
const SHERLOCK_TIMEOUT_MS = Number(process.env.SHERLOCK_TIMEOUT_MS) || 180_000;

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

// --- Sherlock username pivot ------------------------------------------------

let sherlockAvailable; // cached result of the availability probe

async function isSherlockAvailable() {
  if (sherlockAvailable !== undefined) return sherlockAvailable;
  try {
    await execFileAsync(SHERLOCK_BIN, ['--version'], { timeout: 15_000 });
    sherlockAvailable = true;
  } catch {
    sherlockAvailable = false;
  }
  return sherlockAvailable;
}

// Usernames are passed as a process argument, so restrict them to a safe charset.
const USERNAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

async function runSherlock(username) {
  const dir = await mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'sherlock-'));
  const outFile = path.join(dir, `${username}.txt`);
  try {
    // execFile (no shell) avoids command injection via the username.
    // Note: Sherlock's --json flag loads a *site data* file; results are written with --output.
    await execFileAsync(
      SHERLOCK_BIN,
      [username, '--print-found', '--no-color', '--output', outFile],
      { timeout: SHERLOCK_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
    );
    const text = await readFile(outFile, 'utf8');
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\//i.test(l));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

app.post('/api/osint/pivot', async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Invalid or missing "username" (allowed: A-Z a-z 0-9 . _ -, max 64).' });
  }

  if (!(await isSherlockAvailable())) {
    // Mock mode: Sherlock is not installed in this environment.
    return res.json({
      username,
      source: 'mock',
      found: [`github.com/${username}`, `reddit.com/user/${username}`],
    });
  }

  try {
    const found = await runSherlock(username);
    return res.json({ username, source: 'sherlock', found });
  } catch (err) {
    console.error('[pivot] sherlock failed:', err.message);
    const timedOut = err.killed || err.signal === 'SIGTERM';
    return res.status(timedOut ? 504 : 500).json({ error: timedOut ? 'Sherlock timed out' : 'Sherlock failed' });
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

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`Traceboard backend listening on http://0.0.0.0:${PORT}`);
  console.log(`WebSocket sync endpoint: ws://localhost:${PORT}/sync`);
  console.log(`CORS origins: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`Sherlock: ${(await isSherlockAvailable()) ? 'available' : 'not installed (pivot endpoint in mock mode)'}`);
});
