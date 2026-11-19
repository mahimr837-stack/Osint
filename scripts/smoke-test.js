// Smoke test for the consolidated Traceboard server (port 3000).
// Run: NODE_OPTIONS="--dns-result-order=ipv4first" node scripts/smoke-test.js
import WebSocket from 'ws';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

// 1. Frontend SPA + Mobile Companion + Health + Providers Status
const rootRes = await fetch(`${BASE}/`);
const rootHtml = await rootRes.text();
check(
  'GET / (Trace | OSINT Canvas HTML)',
  rootRes.status === 200 && rootHtml.includes('<title>Trace | OSINT Canvas</title>'),
  `HTTP ${rootRes.status}`,
);

const spaRes = await fetch(`${BASE}/dashboard`);
const spaHtml = await spaRes.text();
check(
  'GET /dashboard (SPA fallback)',
  spaRes.status === 200 && spaHtml.includes('<title>Trace | OSINT Canvas</title>'),
  `HTTP ${spaRes.status}`,
);

const mobileRes = await fetch(`${BASE}/mobile`);
const mobileHtml = await mobileRes.text();
check(
  'GET /mobile (Mobile Companion App)',
  mobileRes.status === 200 && mobileHtml.includes('<div id="root"></div>'),
  `HTTP ${mobileRes.status}`,
);

const health = await fetch(`${BASE}/api/health`).then(async (r) => [r.status, await r.json()]);
check('GET /api/health', health[0] === 200 && health[1].status === 'ok', JSON.stringify(health[1]));

const providers = await fetch(`${BASE}/api/providers/status`).then(async (r) => [r.status, await r.json()]);
check('GET /api/providers/status', providers[0] === 200 && typeof providers[1].providers === 'object', `HTTP ${providers[0]}`);

// 2. CORS: allowed vs disallowed origins
for (const [origin, expectAllowed] of [
  ['http://localhost:3000', true],
  ['http://localhost:5173', true],
  ['http://evil.example', false],
]) {
  const r = await fetch(`${BASE}/api/health`, { headers: { Origin: origin } });
  const acao = r.headers.get('access-control-allow-origin');
  check(`CORS ${origin}`, expectAllowed ? acao === origin : acao === null, `ACAO=${acao}`);
}

// 3. Native OSINT Pivot: known username ("octocat") + unsafe username rejection
const pivot = await fetch(`${BASE}/api/osint/pivot`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'octocat' }),
}).then(async (r) => [r.status, await r.json()]);
check(
  'POST /api/osint/pivot (octocat)',
  pivot[0] === 200 &&
    pivot[1].source === 'native' &&
    Array.isArray(pivot[1].found) &&
    pivot[1].found.includes('https://github.com/octocat'),
  `source=${pivot[1].source}, found=${JSON.stringify(pivot[1].found)}`,
);

const bad = await fetch(`${BASE}/api/osint/pivot`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'x; rm -rf /' }),
});
check('POST /api/osint/pivot rejects unsafe username', bad.status === 400, `HTTP ${bad.status}`);

// 4. WebSocket broadcast relay on /sync (sender -> receiver, text + binary, no self-echo)
await new Promise((resolve) => {
  const wsUrl = BASE.replace(/^http/, 'ws') + '/sync';
  const receiver = new WebSocket(wsUrl);
  const sender = new WebSocket(wsUrl);
  const textPayload = JSON.stringify({
    target_id: 'new',
    image_base64: 'data:image/png;base64,iVBORw0KGgo=',
  });
  const binary = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const received = [];
  let senderEchoed = false;
  let openCount = 0;

  const done = () => {
    clearTimeout(timer);
    receiver.close();
    sender.close();
    resolve();
  };

  const timer = setTimeout(() => {
    check('WebSocket /sync relay', false, 'timeout');
    receiver.terminate();
    sender.terminate();
    resolve();
  }, 5000);

  const onOpen = () => {
    openCount++;
    if (openCount === 2) {
      sender.send(textPayload);
      sender.send(binary);
    }
  };

  sender.on('open', onOpen);
  receiver.on('open', onOpen);
  sender.on('message', () => {
    senderEchoed = true;
  });

  receiver.on('message', (data, isBinary) => {
    received.push({ data, isBinary });
    if (received.length === 2) {
      setTimeout(() => {
        check(
          'WebSocket text relay',
          !received[0].isBinary && received[0].data.toString() === textPayload,
        );
        check(
          'WebSocket binary relay',
          received[1].isBinary && Buffer.compare(received[1].data, binary) === 0,
          `${received[1].data.length} bytes`,
        );
        check('WebSocket no self-echo', !senderEchoed);
        done();
      }, 100);
    }
  });

  const onErr = (e) => {
    clearTimeout(timer);
    check('WebSocket /sync connect', false, e.message);
    done();
  };
  sender.on('error', onErr);
  receiver.on('error', onErr);
});

// 5. WebSocket on a wrong path must be rejected
await new Promise((resolve) => {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/nope');
  ws.on('open', () => {
    check('WebSocket wrong path rejected', false);
    ws.close();
    resolve();
  });
  ws.on('error', () => {
    check('WebSocket wrong path rejected', true);
    resolve();
  });
});

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
