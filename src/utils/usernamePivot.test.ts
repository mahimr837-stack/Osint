import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPivotUrls,
  evaluatePlatformResponse,
  extractCandidateUsername,
  runUsernamePivotCheck,
  sanitizeUsernameInput,
} from './usernamePivot';

test('sanitizeUsernameInput strips leading @ and trailing punctuation', () => {
  assert.equal(sanitizeUsernameInput('  @octocat, '), 'octocat');
  assert.equal(sanitizeUsernameInput('john_doe.'), 'john_doe');
});

test('extractCandidateUsername parses labeled handles, URLs, @mentions, and plain tokens', () => {
  assert.equal(extractCandidateUsername('octocat'), 'octocat');
  assert.equal(extractCandidateUsername('  @torvalds  '), 'torvalds');
  assert.equal(
    extractCandidateUsername('Subject Username: @jane_osint\nCity: Lyon'),
    'jane_osint',
  );
  assert.equal(
    extractCandidateUsername('Found link https://github.com/gaearon in signage'),
    'gaearon',
  );
  assert.equal(
    extractCandidateUsername('Contact alice@example.com or @alice_sec for tips'),
    'alice_sec',
  );
  assert.equal(extractCandidateUsername('   '), null);
});

test('buildPivotUrls generates exact github, instagram, and reddit URLs', () => {
  assert.deepEqual(buildPivotUrls('@octocat'), {
    github: 'https://github.com/octocat',
    instagram: 'https://instagram.com/octocat',
    reddit: 'https://reddit.com/user/octocat',
  });
});

test('evaluatePlatformResponse distinguishes 200 profiles from 404 and soft-404 pages', () => {
  assert.deepEqual(evaluatePlatformResponse('github', 200, '<html>Octocat</html>'), {
    exists: true,
    detail: 'HTTP 200 · Profile found',
  });
  assert.deepEqual(evaluatePlatformResponse('instagram', 404, ''), {
    exists: false,
    detail: 'HTTP 404 · Not found',
  });
  assert.deepEqual(
    evaluatePlatformResponse(
      'reddit',
      200,
      'Sorry, nobody on Reddit goes by that name.',
    ),
    {
      exists: false,
      detail: 'Profile unavailable / not found',
    },
  );
});

test('runUsernamePivotCheck dispatches parallel fetch checks for GitHub, Instagram, and Reddit', async () => {
  const requestedUrls: string[] = [];

  const mockFetch: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    requestedUrls.push(url);

    if (url === 'https://github.com/ghost_hunter') {
      return new Response('<html>Profile</html>', { status: 200 });
    }
    if (url === 'https://instagram.com/ghost_hunter') {
      return new Response('Not Found', { status: 404 });
    }
    if (url === 'https://reddit.com/user/ghost_hunter') {
      return new Response('<html>u/ghost_hunter</html>', { status: 200 });
    }
    return new Response('Unexpected', { status: 500 });
  };

  const results = await runUsernamePivotCheck('@ghost_hunter', mockFetch);

  assert.deepEqual(requestedUrls, [
    'https://github.com/ghost_hunter',
    'https://instagram.com/ghost_hunter',
    'https://reddit.com/user/ghost_hunter',
  ]);

  assert.equal(results.length, 3);
  assert.deepEqual(
    results.map((r) => ({
      platform: r.platform,
      displayUrl: r.displayUrl,
      exists: r.exists,
    })),
    [
      { platform: 'github', displayUrl: 'github.com/ghost_hunter', exists: true },
      { platform: 'instagram', displayUrl: 'instagram.com/ghost_hunter', exists: false },
      { platform: 'reddit', displayUrl: 'reddit.com/user/ghost_hunter', exists: true },
    ],
  );
});
