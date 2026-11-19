const DEFAULT_TIMEOUT_MS = 5_000;

const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Platform definitions for native HTTP username OSINT checks.
 * - `notFoundMarkers`: catches HTTP 200 soft-404 responses (Steam, TikTok, Pinterest).
 * - `verifyBody`: optional predicate for SPA / login-walled platforms (Instagram, Reddit, Twitch)
 *   that return HTTP 200 even when a profile does not exist.
 */
export const OSINT_PLATFORMS = [
  {
    id: 'github',
    label: 'GitHub',
    buildUrl: (u) => `https://github.com/${encodeURIComponent(u)}`,
    notFoundMarkers: ['this is not the web page you are looking for'],
  },
  {
    id: 'reddit',
    label: 'Reddit',
    buildUrl: (u) => `https://www.reddit.com/user/${encodeURIComponent(u)}`,
    requestUrl: (u) => `https://www.reddit.com/user/${encodeURIComponent(u)}/`,
    notFoundMarkers: [
      'sorry, nobody on reddit goes by that name',
      'this account has been suspended',
      'page not found',
    ],
    // Require actual profile markup (not a generic 200 WAF/login shell echoing the URL).
    verifyBody: (bodyLower, usernameLower) =>
      bodyLower.includes(`(u/${usernameLower}) - reddit`) ||
      bodyLower.includes(`"subreddit":{"display_name":"u_${usernameLower}"`),
  },
  {
    id: 'instagram',
    label: 'Instagram',
    buildUrl: (u) => `https://www.instagram.com/${encodeURIComponent(u)}/`,
    notFoundMarkers: [
      "sorry, this page isn't available",
      'the link you followed may be broken',
      'page not found',
    ],
    // Logged-out Instagram returns an identical 200 shell without profile og:title metadata.
    verifyBody: (bodyLower, usernameLower) =>
      bodyLower.includes(`(@${usernameLower})`) ||
      bodyLower.includes(`"username":"${usernameLower}"`),
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    buildUrl: (u) => `https://www.tiktok.com/@${encodeURIComponent(u)}`,
    notFoundMarkers: [
      "couldn't find this account",
      'page not available',
      '"statuscode":10202',
      '"statuscode":10221',
    ],
    // Ignore blank 200 JS-challenge pages that lack actual user profile JSON.
    verifyBody: (bodyLower, usernameLower) =>
      bodyLower.includes(`"uniqueid":"${usernameLower}"`),
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    buildUrl: (u) => `https://www.pinterest.com/${encodeURIComponent(u)}/`,
    notFoundMarkers: [
      'user not found',
      "sorry, we couldn't find that page",
      'page not found',
    ],
  },
  {
    id: 'twitch',
    label: 'Twitch',
    buildUrl: (u) => `https://www.twitch.tv/${encodeURIComponent(u)}`,
    notFoundMarkers: [
      'sorry. unless you’ve got a time machine',
      "sorry. unless you've got a time machine",
    ],
    verifyBody: (bodyLower, usernameLower) =>
      bodyLower.includes(`<title>${usernameLower} - twitch</title>`) ||
      bodyLower.includes(`content="${usernameLower} - twitch"`),
  },
  {
    id: 'steam',
    label: 'Steam',
    buildUrl: (u) => `https://steamcommunity.com/id/${encodeURIComponent(u)}`,
    notFoundMarkers: [
      'the specified profile could not be found',
      'steam community :: error',
    ],
  },
];

async function checkSinglePlatform(platform, username, timeoutMs) {
  const profileUrl = platform.buildUrl(username);
  const fetchUrl = platform.requestUrl ? platform.requestUrl(username) : profileUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Use manual redirects so bot/login walls (302 -> /accounts/login) are handled gracefully.
    const res = await fetch(fetchUrl, {
      method: 'GET',
      headers: REQUEST_HEADERS,
      redirect: 'manual',
      signal: controller.signal,
    });

    const status = res.status;

    if (status === 404 || status === 410) {
      return { platform: platform.id, url: profileUrl, exists: false, status, reason: 'not_found' };
    }

    if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
      const location = res.headers.get('location') || '';
      return {
        platform: platform.id,
        url: profileUrl,
        exists: false,
        status,
        reason: `redirect (${location.slice(0, 60) || status})`,
      };
    }

    if (status === 401 || status === 403 || status === 429) {
      return {
        platform: platform.id,
        url: profileUrl,
        exists: false,
        status,
        reason: `blocked_or_rate_limited (${status})`,
      };
    }

    if (status === 200) {
      const bodyLower = (await res.text().catch(() => '')).toLowerCase();

      if (platform.notFoundMarkers?.some((marker) => bodyLower.includes(marker))) {
        return { platform: platform.id, url: profileUrl, exists: false, status, reason: 'soft_404' };
      }

      if (platform.verifyBody && !platform.verifyBody(bodyLower, username.toLowerCase())) {
        return {
          platform: platform.id,
          url: profileUrl,
          exists: false,
          status,
          reason: 'unverified_shell_or_not_found',
        };
      }

      return { platform: platform.id, url: profileUrl, exists: true, status, reason: 'found' };
    }

    return { platform: platform.id, url: profileUrl, exists: false, status, reason: `http_${status}` };
  } catch (err) {
    const isTimeout = err?.name === 'AbortError';
    return {
      platform: platform.id,
      url: profileUrl,
      exists: false,
      status: null,
      reason: isTimeout ? 'timeout' : err?.message || 'network_error',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks username existence across supported platforms in parallel using native fetch.
 * Returns confirmed found profile URLs alongside per-platform diagnostic details.
 */
export async function checkUsername(username, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;

  const settled = await Promise.allSettled(
    OSINT_PLATFORMS.map((platform) =>
      checkSinglePlatform(platform, username, timeoutMs),
    ),
  );

  const checks = settled.map((entry, idx) => {
    if (entry.status === 'fulfilled') return entry.value;
    const platform = OSINT_PLATFORMS[idx];
    return {
      platform: platform.id,
      url: platform.buildUrl(username),
      exists: false,
      status: null,
      reason: entry.reason?.message || 'unexpected_error',
    };
  });

  const found = checks.filter((c) => c.exists).map((c) => c.url);
  return { found, checks };
}
