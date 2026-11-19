export type PivotPlatformId = 'github' | 'instagram' | 'reddit';
export type PivotSource = 'mock' | 'sherlock' | 'native';

export interface PivotPlatformConfig {
  id: PivotPlatformId;
  label: string;
  buildDisplayUrl: (username: string) => string;
  buildRequestUrl: (username: string) => string;
  buildProfileUrl: (username: string) => string;
}

export interface PivotPlatformResult {
  platform: string;
  label: string;
  displayUrl: string;
  profileUrl: string;
  exists: boolean;
  statusCode: number | null;
  detail: string;
}

export interface BackendPivotResponse {
  username: string;
  source: PivotSource;
  found: string[];
}

export interface BackendPivotResult {
  username: string;
  source: PivotSource;
  results: PivotPlatformResult[];
}

export const PIVOT_PLATFORMS: readonly PivotPlatformConfig[] = [
  {
    id: 'github',
    label: 'GitHub',
    buildDisplayUrl: (username) => `github.com/${username}`,
    buildRequestUrl: (username) =>
      `https://github.com/${encodeURIComponent(username)}`,
    buildProfileUrl: (username) =>
      `https://github.com/${encodeURIComponent(username)}`,
  },
  {
    id: 'instagram',
    label: 'Instagram',
    buildDisplayUrl: (username) => `instagram.com/${username}`,
    buildRequestUrl: (username) =>
      `https://instagram.com/${encodeURIComponent(username)}`,
    buildProfileUrl: (username) =>
      `https://www.instagram.com/${encodeURIComponent(username)}/`,
  },
  {
    id: 'reddit',
    label: 'Reddit',
    buildDisplayUrl: (username) => `reddit.com/user/${username}`,
    buildRequestUrl: (username) =>
      `https://reddit.com/user/${encodeURIComponent(username)}`,
    buildProfileUrl: (username) =>
      `https://www.reddit.com/user/${encodeURIComponent(username)}`,
  },
] as const;

export function buildPivotUrls(
  username: string,
): Record<PivotPlatformId, string> {
  const clean = sanitizeUsernameInput(username);
  return {
    github: `https://github.com/${encodeURIComponent(clean)}`,
    instagram: `https://instagram.com/${encodeURIComponent(clean)}`,
    reddit: `https://reddit.com/user/${encodeURIComponent(clean)}`,
  };
}

/**
 * Normalizes a manual or extracted username token by stripping leading @ and whitespace.
 */
export function sanitizeUsernameInput(raw: string): string {
  return raw
    .trim()
    .replace(/^@+/, '')
    .replace(/[),.;:'"!?]+$/g, '')
    .trim();
}

const VALID_USERNAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,37}[a-zA-Z0-9])?$/;

/**
 * Extracts a likely username handle from OCR or ChatNode text.
 * Supports explicit labels (Username: foo), @handles, social profile URLs, or single tokens.
 */
export function extractCandidateUsername(rawText: string): string | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  // 1. Explicit label match: e.g. "Username: @octocat" or "Handle: john_doe"
  const labeledMatch =
    /(?:username|user\s*name|handle|alias|account)\s*[:=-]\s*@?([a-zA-Z0-9._-]{2,39})/i.exec(
      trimmed,
    );
  if (labeledMatch?.[1]) {
    const candidate = sanitizeUsernameInput(labeledMatch[1]);
    if (VALID_USERNAME_RE.test(candidate)) return candidate;
  }

  // 2. Social profile URL match: github.com/foo, instagram.com/foo, reddit.com/user/foo
  const urlMatch =
    /(?:github\.com|instagram\.com|reddit\.com\/(?:user|u)|twitter\.com|x\.com)\/([a-zA-Z0-9._-]{2,39})/i.exec(
      trimmed,
    );
  if (urlMatch?.[1]) {
    const candidate = sanitizeUsernameInput(urlMatch[1]);
    if (
      VALID_USERNAME_RE.test(candidate) &&
      !['user', 'users', 'explore', 'login', 'about'].includes(
        candidate.toLowerCase(),
      )
    ) {
      return candidate;
    }
  }

  // 3. Standalone @handle (exclude email addresses like alice@example.com)
  const atMatches = trimmed.matchAll(/(?:^|[\s([{"'])@([a-zA-Z0-9._-]{2,39})\b/g);
  for (const match of atMatches) {
    const candidate = sanitizeUsernameInput(match[1] ?? '');
    if (VALID_USERNAME_RE.test(candidate)) {
      return candidate;
    }
  }

  // 4. If the input is a single short token or short first token, treat it as the username
  const tokens = trimmed
    .split(/\s+/)
    .map((token) => sanitizeUsernameInput(token))
    .filter(Boolean);

  for (const token of tokens) {
    if (token.includes('@') || token.includes('/')) continue;
    if (VALID_USERNAME_RE.test(token)) {
      return token;
    }
  }

  return null;
}

const SOFT_404_MARKERS: Record<PivotPlatformId, readonly string[]> = {
  github: ['not found', 'this is not the web page you are looking for'],
  instagram: [
    "sorry, this page isn't available",
    'the link you followed may be broken',
    'page not found',
  ],
  reddit: [
    'sorry, nobody on reddit goes by that name',
    'page not found',
    'this account has been suspended',
  ],
};

/**
 * Classifies an HTTP status and optional response body text into existence state.
 */
export function evaluatePlatformResponse(
  platform: PivotPlatformId,
  status: number,
  bodyText = '',
): { exists: boolean; detail: string } {
  if (status === 404 || status === 410) {
    return { exists: false, detail: `HTTP ${status} · Not found` };
  }

  if (status >= 200 && status < 300) {
    const lower = bodyText.toLowerCase();
    const soft404 = SOFT_404_MARKERS[platform].some((marker) =>
      lower.includes(marker),
    );
    if (soft404) {
      return { exists: false, detail: 'Profile unavailable / not found' };
    }
    return { exists: true, detail: `HTTP ${status} · Profile found` };
  }

  if (status === 301 || status === 302) {
    return { exists: true, detail: `HTTP ${status} · Profile redirect` };
  }

  return { exists: false, detail: `HTTP ${status} · Unavailable` };
}

async function safeReadBodyText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

async function checkSinglePlatform(
  config: PivotPlatformConfig,
  username: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<PivotPlatformResult> {
  const displayUrl = config.buildDisplayUrl(username);
  const profileUrl = config.buildProfileUrl(username);
  const requestUrl = config.buildRequestUrl(username);

  try {
    const response = await fetchImpl(requestUrl, {
      method: 'GET',
      signal,
    });
    const bodyText = await safeReadBodyText(response);
    const evaluated = evaluatePlatformResponse(
      config.id,
      response.status,
      bodyText,
    );
    return {
      platform: config.id,
      label: config.label,
      displayUrl,
      profileUrl,
      exists: evaluated.exists,
      statusCode: response.status,
      detail: evaluated.detail,
    };
  } catch (primaryError) {
    // Graceful CORS fallback for live browser checks on GitHub & Reddit JSON/API endpoints
    if (config.id === 'github') {
      try {
        const fallback = await fetchImpl(
          `https://api.github.com/users/${encodeURIComponent(username)}`,
          { method: 'GET', signal },
        );
        const evaluated = evaluatePlatformResponse('github', fallback.status);
        return {
          platform: config.id,
          label: config.label,
          displayUrl,
          profileUrl,
          exists: evaluated.exists,
          statusCode: fallback.status,
          detail: evaluated.detail,
        };
      } catch {
        // Fall through to structured unreachable result
      }
    }

    if (config.id === 'reddit') {
      try {
        const fallback = await fetchImpl(
          `https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`,
          { method: 'GET', signal },
        );
        const bodyText = await safeReadBodyText(fallback);
        const evaluated = evaluatePlatformResponse(
          'reddit',
          fallback.status,
          bodyText,
        );
        return {
          platform: config.id,
          label: config.label,
          displayUrl,
          profileUrl,
          exists: evaluated.exists,
          statusCode: fallback.status,
          detail: evaluated.detail,
        };
      } catch {
        // Fall through to structured unreachable result
      }
    }

    const message =
      primaryError instanceof Error ? primaryError.message : 'Request failed';
    return {
      platform: config.id,
      label: config.label,
      displayUrl,
      profileUrl,
      exists: false,
      statusCode: null,
      detail: `Blocked or unreachable (${message})`,
    };
  }
}

/**
 * Runs parallel fetch requests for GitHub, Instagram, and Reddit to verify
 * whether the given username exists on each platform.
 * When invoked in the browser with default fetch, routes via the backend `/api/osint/pivot` proxy to avoid CORS blocks.
 */
export async function runUsernamePivotCheck(
  rawUsername: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<PivotPlatformResult[]> {
  const username = sanitizeUsernameInput(rawUsername);
  if (!username) {
    throw new Error('Enter or extract a valid username before pivoting.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (typeof window !== 'undefined' && fetchImpl === fetch) {
      const proxyRes = await fetch('/api/osint/pivot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
        signal: controller.signal,
      });
      if (proxyRes.ok) {
        const payload = (await proxyRes.json()) as {
          results?: PivotPlatformResult[];
        };
        if (Array.isArray(payload.results)) {
          return payload.results;
        }
      }
    }

    return await Promise.all(
      PIVOT_PLATFORMS.map((config) =>
        checkSinglePlatform(config, username, fetchImpl, controller.signal),
      ),
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

const BACKEND_USERNAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

const KNOWN_HOST_LABELS: Record<string, string> = {
  'github.com': 'GitHub',
  'reddit.com': 'Reddit',
  'instagram.com': 'Instagram',
  'x.com': 'X',
  'twitter.com': 'Twitter',
  'gitlab.com': 'GitLab',
  'youtube.com': 'YouTube',
  'tiktok.com': 'TikTok',
  'linkedin.com': 'LinkedIn',
  'pinterest.com': 'Pinterest',
  'twitch.tv': 'Twitch',
  'medium.com': 'Medium',
  'keybase.io': 'Keybase',
  't.me': 'Telegram',
};

export const DEFAULT_BACKEND_PIVOT_URL =
  (typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_BACKEND_URL
    ? `${(import.meta as unknown as { env: Record<string, string> }).env.VITE_BACKEND_URL.replace(/\/+$/, '')}/api/osint/pivot`
    : typeof window !== 'undefined'
      ? '/api/osint/pivot'
      : 'http://localhost:3000/api/osint/pivot');

/**
 * Converts a URL string returned by the backend (either bare "github.com/foo" or full "https://...")
 * into a structured PivotPlatformResult suitable for rendering clickable links.
 */
export function normalizeFoundUrlToPivotResult(
  rawUrl: string,
  index: number,
  source: PivotSource = 'sherlock',
): PivotPlatformResult {
  const trimmed = rawUrl.trim();
  const profileUrl = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let hostname = '';
  let displayUrl = profileUrl.replace(/^https?:\/\/(?:www\.)?/i, '').replace(/\/+$/, '');
  try {
    const parsed = new URL(profileUrl);
    hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const pathPart = `${parsed.pathname}${parsed.search}`.replace(/\/+$/, '');
    displayUrl = `${hostname}${pathPart}`;
  } catch {
    hostname = displayUrl.split('/')[0]?.toLowerCase() || `result-${index}`;
  }

  const knownLabel =
    hostname === 'steamcommunity.com' ? 'Steam' : KNOWN_HOST_LABELS[hostname];
  const fallbackBase = hostname.split('.')[0] || 'Profile';
  const label =
    knownLabel ??
    fallbackBase.charAt(0).toUpperCase() + fallbackBase.slice(1);

  return {
    platform: `${hostname}-${index}`,
    label,
    displayUrl,
    profileUrl,
    exists: true,
    statusCode: 200,
    detail:
      source === 'mock'
        ? 'Mock backend response'
        : source === 'native'
          ? 'Verified via native OSINT check'
          : 'Found by Sherlock',
  };
}

export interface BackendPivotOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Calls the consolidated Traceboard Express server (`POST /api/osint/pivot` on port 3000)
 * to run a native JS (or Sherlock / mock fallback) username pivot lookup.
 */
export async function runBackendPivotCheck(
  rawUsername: string,
  options: BackendPivotOptions = {},
): Promise<BackendPivotResult> {
  const username = sanitizeUsernameInput(rawUsername);
  if (!username) {
    throw new Error('Enter or extract a valid username before pivoting.');
  }
  if (!BACKEND_USERNAME_RE.test(username)) {
    throw new Error(
      'Username may only contain letters, digits, ".", "_", and "-" (max 64 chars).',
    );
  }

  const endpoint = options.endpoint ?? DEFAULT_BACKEND_PIVOT_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 185_000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => null)) as
      | (Partial<BackendPivotResponse> & { error?: string })
      | null;

    if (!response.ok) {
      throw new Error(
        data?.error || `Backend pivot failed with HTTP ${response.status}.`,
      );
    }

    const source: PivotSource =
      data?.source === 'native' || data?.source === 'sherlock'
        ? data.source
        : 'mock';
    const foundList = Array.isArray(data?.found)
      ? data.found.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [];

    return {
      username: typeof data?.username === 'string' && data.username ? data.username : username,
      source,
      results: foundList.map((url, idx) =>
        normalizeFoundUrlToPivotResult(url, idx, source),
      ),
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Pivot request timed out waiting for the local backend.');
    }
    if (err instanceof TypeError) {
      throw new Error(
        `Could not reach local backend (${endpoint}). Ensure the server is running on port 3000.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
