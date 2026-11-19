import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDorkUserPrompt,
  buildGoogleSearchUrl,
  DORK_SYSTEM_PROMPT,
  DORK_TARGET_OPTIONS,
  parseDorkListResponse,
} from './dorkGenerator';

test('exposes exact target dropdown options and system prompt', () => {
  assert.deepEqual(DORK_TARGET_OPTIONS, [
    'General OSINT',
    'Social Media',
    'Vulnerable Servers',
    'Documents/Leaks',
  ]);
  assert.match(DORK_SYSTEM_PROMPT, /Generate exactly 10 highly advanced Google Dorks/);
  assert.match(DORK_SYSTEM_PROMPT, /site:, inurl:, filetype:, intitle:, intext:/);
});

test('builds dork user prompt combining target type and connected text', () => {
  const prompt = buildDorkUserPrompt('Documents/Leaks', '  alice@acme-corp.io  ');
  assert.equal(
    prompt,
    'Target Type: Documents/Leaks\n\nExtracted Source Text:\nalice@acme-corp.io',
  );
});

test('parses raw or numbered LLM output into up to 10 clean dork strings', () => {
  const raw = [
    '```text',
    '1. \'site:pastebin.com "alice@acme.io"\'',
    '2) filetype:pdf "alice@acme.io"',
    '- inurl:admin "acme.io"',
    'site:github.com "alice@acme.io"',
    'site:linkedin.com/in "Alice Smith"',
    'intext:"alice@acme.io" filetype:xlsx',
    'intitle:"index of" "acme.io"',
    'site:trello.com "acme.io"',
    'filetype:log "acme.io"',
    'site:docs.google.com "alice@acme.io"',
    'site:extra-11th.example "alice@acme.io"',
    '```',
  ].join('\n');

  const parsed = parseDorkListResponse(raw);
  assert.equal(parsed.length, 10);
  assert.equal(parsed[0], 'site:pastebin.com "alice@acme.io"');
  assert.equal(parsed[1], 'filetype:pdf "alice@acme.io"');
  assert.equal(parsed[2], 'inurl:admin "acme.io"');
  assert.equal(parsed[9], 'site:docs.google.com "alice@acme.io"');
});

test('builds properly encoded Google search URL for a dork query', () => {
  assert.equal(
    buildGoogleSearchUrl('site:pastebin.com "alice@acme.io"'),
    'https://www.google.com/search?q=site%3Apastebin.com%20%22alice%40acme.io%22',
  );
});
