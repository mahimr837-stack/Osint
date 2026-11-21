import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShodanUpstreamUrl,
  isIpAddress,
  normalizeShodanResponse,
  runShodanSearch,
} from './shodanOsint';
import {
  buildWaybackCdxUrl,
  extractCandidateArchiveUrl,
  formatWaybackTimestamp,
  parseWaybackCdxResponse,
} from './archiveOsint';
import {
  getGlobalShodanApiKey,
  saveGlobalShodanApiKey,
} from './globalSettings';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

test('Shodan URL builder distinguishes direct IP lookups from general host searches', () => {
  assert.equal(isIpAddress('8.8.8.8'), true);
  assert.equal(isIpAddress('2001:4860:4860::8888'), true);
  assert.equal(isIpAddress('apache port:443'), false);

  const ipReq = buildShodanUpstreamUrl('8.8.8.8', 'test-key');
  assert.equal(ipReq.mode, 'host');
  assert.equal(
    ipReq.url,
    'https://api.shodan.io/shodan/host/8.8.8.8?key=test-key',
  );

  const searchReq = buildShodanUpstreamUrl('nginx country:US', 'test-key');
  assert.equal(searchReq.mode, 'search');
  assert.equal(
    searchReq.url,
    'https://api.shodan.io/shodan/host/search?key=test-key&query=nginx%20country%3AUS',
  );
});

test('Shodan normalizer parses matches, IP data arrays, and base64 screenshot thumbnails', () => {
  const normalizedSearch = normalizeShodanResponse(
    {
      total: 42,
      matches: [
        {
          ip_str: '93.184.216.34',
          port: 443,
          org: 'Edgecast Inc.',
          hostnames: ['example.com'],
          product: 'nginx',
          location: { city: 'Los Angeles', country_name: 'United States' },
          opts: {
            screenshot: {
              mime: 'image/jpeg',
              data: '/9j/4AAQSkZJRg==',
            },
          },
        },
      ],
    },
    'search',
  );

  assert.equal(normalizedSearch.total, 42);
  assert.equal(normalizedSearch.results.length, 1);
  assert.equal(normalizedSearch.results[0]?.ip, '93.184.216.34');
  assert.equal(normalizedSearch.results[0]?.port, 443);
  assert.equal(normalizedSearch.results[0]?.org, 'Edgecast Inc.');
  assert.equal(
    normalizedSearch.results[0]?.screenshotDataUrl,
    'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
  );

  const normalizedHost = normalizeShodanResponse(
    {
      ip_str: '8.8.8.8',
      org: 'Google LLC',
      hostnames: ['dns.google'],
      data: [{ port: 53, product: 'Google Public DNS' }],
    },
    'host',
  );
  assert.equal(normalizedHost.results.length, 1);
  assert.equal(normalizedHost.results[0]?.ip, '8.8.8.8');
  assert.equal(normalizedHost.results[0]?.port, 53);
  assert.equal(normalizedHost.results[0]?.org, 'Google LLC');
});

test('Shodan client pulls global Shodan API key from localStorage', async () => {
  const storage = createMemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });

  saveGlobalShodanApiKey('shodan-global-secret');
  assert.equal(getGlobalShodanApiKey(), 'shodan-global-secret');

  let sentBody: Record<string, unknown> | null = null;
  const mockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        query: '8.8.8.8',
        mode: 'host',
        total: 1,
        results: [
          { ip: '8.8.8.8', port: 53, org: 'Google LLC', hostnames: ['dns.google'] },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  const res = await runShodanSearch({ query: '8.8.8.8', fetchImpl: mockFetch });
  assert.equal(sentBody?.apiKey, 'shodan-global-secret');
  assert.equal(res.results[0]?.org, 'Google LLC');

  storage.clear();
});

test('Wayback Archive helpers parse CDX JSON matrix and extract URLs from text', () => {
  assert.equal(
    buildWaybackCdxUrl('example.com'),
    'https://web.archive.org/cdx/search/cdx?url=example.com&output=json&limit=20',
  );
  assert.equal(
    formatWaybackTimestamp('20240519143022'),
    '2024-05-19 14:30 UTC',
  );
  assert.equal(
    extractCandidateArchiveUrl('See leaked site at https://example.org/docs/report.pdf.'),
    'https://example.org/docs/report.pdf',
  );
  assert.equal(
    extractCandidateArchiveUrl('OCR found domain: sub.target-corp.io in header'),
    'sub.target-corp.io',
  );

  const snapshots = parseWaybackCdxResponse([
    ['urlkey', 'timestamp', 'original', 'mimetype', 'statuscode', 'digest', 'length'],
    ['com,example)/', '20240102030405', 'https://example.com/', 'text/html', '200', 'ABC', '1256'],
    ['com,example)/', '20240615120000', 'https://example.com/', 'text/html', '301', 'DEF', '512'],
  ]);

  assert.equal(snapshots.length, 2);
  assert.equal(
    snapshots[0]?.snapshotUrl,
    'https://web.archive.org/web/20240102030405/https://example.com/',
  );
  assert.equal(snapshots[0]?.formattedDate, '2024-01-02 03:04 UTC');
  assert.equal(snapshots[1]?.statusCode, '301');
});
