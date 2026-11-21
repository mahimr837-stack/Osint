import 'dotenv/config';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import {
  buildAnthropicRequest,
  buildOpenAiCompatibleRequest,
  extractAnthropicResponseText,
  extractOpenAiResponseText,
  getProviderMeta,
  LLM_PROVIDERS,
  readApiErrorMessage,
  type LlmProviderId,
} from './src/utils/llmProviders';
import {
  GEOSPY_PREDICT_ENDPOINT,
  parseGeoSpyResponse,
} from './src/utils/geoSpy';
import { checkUsername, OSINT_PLATFORMS } from './src/utils/nativeOsint';
import {
  buildShodanUpstreamUrl,
  normalizeShodanResponse,
} from './src/utils/shodanOsint';
import {
  buildWaybackCdxUrl,
  parseWaybackCdxResponse,
} from './src/utils/archiveOsint';
import {
  buildOpenAiDalleRequest,
  DALLE_MODEL_ID,
  extractOpenAiDalleImageUrl,
  IMAGEN_MODEL_ID,
} from './src/utils/suspectComposite';

interface InlineImageInput {
  mimeType: string;
  data: string;
}

interface ImageGenerateBody {
  provider?: LlmProviderId;
  apiKey?: string;
  prompt?: string;
  images?: InlineImageInput[];
}

interface LlmGenerateBody {
  provider?: LlmProviderId;
  apiKey?: string;
  model?: string;
  promptText?: string;
  images?: InlineImageInput[];
  systemPrompt?: string;
}

interface GeoSpyProxyBody {
  imageBase64?: string;
  mimeType?: string;
  fileName?: string;
}

interface ShodanProxyBody {
  query?: string;
  apiKey?: string;
}

interface ArchiveProxyBody {
  url?: string;
}

const PROVIDER_ENV_KEYS: Record<LlmProviderId, string> = {
  google: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  mistral: 'MISTRAL_API_KEY',
};

const PLACEHOLDER_ENV_VALUES = new Set([
  'MY_GEMINI_API_KEY',
  'YOUR_ACTUAL_KEY_HERE',
  'YOUR_GEMINI_API_KEY_HERE',
]);

function readServerEnvKey(envVarName: string): string {
  const raw = process.env[envVarName];
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || PLACEHOLDER_ENV_VALUES.has(trimmed)) return '';
  return trimmed;
}

function resolveEffectiveApiKey(
  clientApiKey: string | undefined,
  envVarName: string,
): string {
  if (typeof clientApiKey === 'string') {
    const trimmed = clientApiKey.trim();
    if (trimmed && !PLACEHOLDER_ENV_VALUES.has(trimmed)) {
      return trimmed;
    }
  }
  return readServerEnvKey(envVarName);
}

function getGeminiClient(clientApiKey?: string): GoogleGenAI {
  const apiKey = resolveEffectiveApiKey(clientApiKey, 'GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('Please set your API key in the Dashboard Settings.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sanitizeInlineImages(images?: InlineImageInput[]): InlineImageInput[] {
  if (!Array.isArray(images)) return [];
  return images.filter(
    (img): img is InlineImageInput =>
      Boolean(img) &&
      typeof img.mimeType === 'string' &&
      typeof img.data === 'string',
  );
}

function buildGeminiParts(
  promptText: string,
  images?: InlineImageInput[],
): Array<
  | { inlineData: { mimeType: string; data: string } }
  | { text: string }
> {
  const inlineParts = sanitizeInlineImages(images).map((part) => ({
    inlineData: {
      mimeType: part.mimeType,
      data: part.data,
    },
  }));

  return [...inlineParts, { text: promptText }];
}

function formatServerProviderError(
  providerName: string,
  envVarName: string,
  error: unknown,
): {
  status: number;
  message: string;
} {
  const rawMessage =
    error instanceof Error
      ? error.message
      : `${providerName} API request failed on the server.`;

  if (rawMessage.includes('Please set your API key in the Dashboard Settings.')) {
    return {
      status: 403,
      message: rawMessage,
    };
  }

  if (
    rawMessage.includes('API_KEY_INVALID') ||
    rawMessage.includes('PERMISSION_DENIED') ||
    rawMessage.includes('is not configured on the server') ||
    rawMessage.includes('401') ||
    rawMessage.includes('invalid x-api-key') ||
    rawMessage.includes('Incorrect API key')
  ) {
    return {
      status: 403,
      message: `${rawMessage} Please check your ${providerName} API key in Dashboard Settings (or ${envVarName} on the server).`,
    };
  }

  if (rawMessage.includes('RESOURCE_EXHAUSTED') || rawMessage.includes('429')) {
    return {
      status: 429,
      message: `${rawMessage} Check quota or billing for ${providerName} (${envVarName}).`,
    };
  }

  return {
    status: 500,
    message: rawMessage,
  };
}

async function executeProviderGeneration(params: {
  provider: LlmProviderId;
  apiKey?: string;
  model: string;
  promptText: string;
  images: InlineImageInput[];
  systemPrompt?: string;
}): Promise<string> {
  const { provider, apiKey, model, promptText, images, systemPrompt } = params;
  const meta = getProviderMeta(provider);
  const envVarName = PROVIDER_ENV_KEYS[provider] ?? meta.envVarName;
  const resolvedModel = model.trim() || meta.defaultModel;

  if (provider === 'google') {
    const ai = getGeminiClient(apiKey);
    const parts = buildGeminiParts(promptText, images);
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: resolvedModel,
      contents: { parts },
      ...(systemPrompt?.trim()
        ? { config: { systemInstruction: systemPrompt.trim() } }
        : {}),
    });
    return (
      response.text?.trim() ||
      'Gemini returned an empty response for this inspection.'
    );
  }

  const effectiveApiKey = resolveEffectiveApiKey(apiKey, envVarName);
  if (!effectiveApiKey) {
    throw new Error('Please set your API key in the Dashboard Settings.');
  }

  if (provider === 'anthropic') {
    const spec = buildAnthropicRequest({
      apiKey: effectiveApiKey,
      model: resolvedModel,
      promptText,
      images,
      systemPrompt,
    });
    const upstreamRes = await fetch(spec.url, {
      method: 'POST',
      headers: spec.headers,
      body: JSON.stringify(spec.body),
    });
    const json = (await upstreamRes.json().catch(() => null)) as unknown;
    if (!upstreamRes.ok) {
      throw new Error(readApiErrorMessage(json, upstreamRes.status));
    }
    return (
      extractAnthropicResponseText(json) ||
      'Anthropic returned an empty response for this inspection.'
    );
  }

  const appOrigin =
    readServerEnvKey('APP_URL') || 'http://localhost:3000';
  const spec = buildOpenAiCompatibleRequest({
    provider,
    apiKey: effectiveApiKey,
    model: resolvedModel,
    promptText,
    images,
    systemPrompt,
    origin: appOrigin,
  });

  const upstreamRes = await fetch(spec.url, {
    method: 'POST',
    headers: spec.headers,
    body: JSON.stringify(spec.body),
  });
  const json = (await upstreamRes.json().catch(() => null)) as unknown;
  if (!upstreamRes.ok) {
    throw new Error(readApiErrorMessage(json, upstreamRes.status));
  }
  return (
    extractOpenAiResponseText(json) ||
    `${meta.name} returned an empty response for this inspection.`
  );
}

let isServerStarted = false;

const WS_CLOSE_UNAUTHORIZED = 4001;
const WS_AUTH_TIMEOUT_MS = 5_000;

function generateSyncPin(): string {
  return crypto.randomInt(100_000, 1_000_000).toString();
}

function isValidPinMatch(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isLoopbackAddress(address?: string): boolean {
  if (!address) return false;
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  );
}

export async function startServer() {
  if (isServerStarted) return;
  isServerStarted = true;
  const app = express();
  const host = process.env.HOST?.trim() || '127.0.0.1';
  const port = Number(process.env.PORT) || 3000;
  const wsPin = generateSyncPin();
  const allowedOrigins = (
    process.env.CORS_ORIGINS ||
    'http://127.0.0.1:3000,http://localhost:3000,http://localhost:5173'
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const osintTimeoutMs = Number(process.env.OSINT_TIMEOUT_MS) || 5_000;

  app.use(
    cors({
      origin(origin, callback) {
        // Allow requests with no Origin header (curl, native mobile clients, same-origin).
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(null, false);
      },
    }),
  );
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Loopback-only endpoint so the local desktop canvas can automatically pair with the /sync WebSocket.
  // Remote LAN clients receive 403 and must manually enter the 6-digit PIN printed in the terminal.
  app.get('/api/sync/pin', (req: Request, res: Response) => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      res.status(403).json({
        error: 'WebSocket PIN lookup is restricted to localhost. Enter the PIN from the terminal.',
      });
      return;
    }
    res.json({ pin: wsPin });
  });

  // Returns server-side configuration status for all providers without exposing any secret values
  app.get('/api/providers/status', (_req: Request, res: Response) => {
    const providers = Object.fromEntries(
      LLM_PROVIDERS.map((p) => [
        p.id,
        Boolean(readServerEnvKey(p.envVarName)),
      ]),
    ) as Record<LlmProviderId, boolean>;

    res.json({
      providers,
      geospy: Boolean(readServerEnvKey('GEOSPY_API_KEY')),
    });
  });

  // Unified server-side proxy route for all LLM providers (Gemini, Anthropic, OpenAI, OpenRouter, DeepSeek, Mistral)
  app.post('/api/llm/generate', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as LlmGenerateBody;
    const promptText =
      typeof body.promptText === 'string' ? body.promptText.trim() : '';

    if (!promptText) {
      res.status(400).json({ error: 'promptText is required.' });
      return;
    }

    const providerId: LlmProviderId =
      body.provider &&
      LLM_PROVIDERS.some((p) => p.id === body.provider)
        ? body.provider
        : 'google';
    const meta = getProviderMeta(providerId);
    const resolvedModel =
      typeof body.model === 'string' && body.model.trim()
        ? body.model.trim()
        : meta.defaultModel;
    const systemPrompt =
      typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '';
    const images = sanitizeInlineImages(body.images);

    try {
      const text = await executeProviderGeneration({
        provider: providerId,
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        model: resolvedModel,
        promptText,
        images,
        systemPrompt,
      });
      res.json({ text });
    } catch (error) {
      const formatted = formatServerProviderError(
        meta.name,
        meta.envVarName,
        error,
      );
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Dedicated Gemini generation endpoint
  app.post('/api/gemini/generate', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as LlmGenerateBody;
    const promptText =
      typeof body.promptText === 'string' ? body.promptText.trim() : '';

    if (!promptText) {
      res.status(400).json({ error: 'promptText is required.' });
      return;
    }

    const resolvedModel =
      typeof body.model === 'string' && body.model.trim()
        ? body.model.trim()
        : 'gemini-4-hydrogen';
    const systemPrompt =
      typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '';
    const images = sanitizeInlineImages(body.images);

    try {
      const text = await executeProviderGeneration({
        provider: 'google',
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        model: resolvedModel,
        promptText,
        images,
        systemPrompt,
      });
      res.json({ text });
    } catch (error) {
      const formatted = formatServerProviderError(
        'Google',
        'GEMINI_API_KEY',
        error,
      );
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Dedicated Gemini streaming endpoint
  app.post('/api/gemini/stream', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as LlmGenerateBody;
    const promptText =
      typeof body.promptText === 'string' ? body.promptText.trim() : '';

    if (!promptText) {
      res.status(400).json({ error: 'promptText is required.' });
      return;
    }

    const resolvedModel =
      typeof body.model === 'string' && body.model.trim()
        ? body.model.trim()
        : 'gemini-4-hydrogen';
    const systemPrompt =
      typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const ai = getGeminiClient(
        typeof body.apiKey === 'string' ? body.apiKey : undefined,
      );
      const parts = buildGeminiParts(promptText, body.images);

      const streamResponse = await ai.models.generateContentStream({
        model: resolvedModel,
        contents: { parts },
        ...(systemPrompt
          ? { config: { systemInstruction: systemPrompt } }
          : {}),
      });

      for await (const chunk of streamResponse) {
        const c = chunk as GenerateContentResponse;
        const chunkText = c.text ?? '';
        if (chunkText) {
          res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      const formatted = formatServerProviderError(
        'Google',
        'GEMINI_API_KEY',
        error,
      );
      res.write(`data: ${JSON.stringify({ error: formatted.message })}\n\n`);
      res.end();
    }
  });

  // Server-side GeoSpy geolocation proxy endpoint using GEOSPY_API_KEY
  app.post('/api/osint/geospy', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as GeoSpyProxyBody;
    const imageBase64 =
      typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
    const mimeType =
      typeof body.mimeType === 'string' && body.mimeType.trim()
        ? body.mimeType.trim()
        : 'image/jpeg';
    const fileName =
      typeof body.fileName === 'string' && body.fileName.trim()
        ? body.fileName.trim()
        : 'evidence.jpg';

    if (!imageBase64) {
      res.status(400).json({ error: 'imageBase64 is required.' });
      return;
    }

    const geoSpyKey = readServerEnvKey('GEOSPY_API_KEY');
    if (!geoSpyKey) {
      res.status(403).json({
        error:
          'GEOSPY_API_KEY is not configured on the server. Add GEOSPY_API_KEY in the Settings > Secrets panel.',
      });
      return;
    }

    try {
      const binaryBuffer = Buffer.from(imageBase64, 'base64');
      const blob = new Blob([binaryBuffer], { type: mimeType });
      const formData = new FormData();
      formData.append('file', blob, fileName);

      const upstreamRes = await fetch(GEOSPY_PREDICT_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${geoSpyKey}`,
        },
        body: formData,
      });

      if (!upstreamRes.ok) {
        let errorDetail = `GeoSpy API request failed (${upstreamRes.status}).`;
        try {
          const errorJson = (await upstreamRes.json()) as {
            detail?: unknown;
            error?: unknown;
            message?: unknown;
          };
          const candidate =
            errorJson.detail ?? errorJson.message ?? errorJson.error;
          if (typeof candidate === 'string' && candidate.trim()) {
            errorDetail = candidate.trim();
          }
        } catch {
          // Ignore non-JSON error body
        }
        res.status(upstreamRes.status).json({ error: errorDetail });
        return;
      }

      const data = (await upstreamRes.json()) as unknown;
      const prediction = parseGeoSpyResponse(data);
      if (!prediction) {
        res.status(502).json({
          error: 'GeoSpy response did not include valid lat/lng coordinates.',
        });
        return;
      }
      res.json({ prediction });
    } catch (error) {
      const formatted = formatServerProviderError(
        'GeoSpy',
        'GEOSPY_API_KEY',
        error,
      );
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Native JS username pivot endpoint (7 platforms in parallel with soft-404 & WAF handling)
  const PIVOT_USERNAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
  app.post('/api/osint/pivot', async (req: Request, res: Response) => {
    const username =
      req.body && typeof (req.body as { username?: unknown }).username === 'string'
        ? (req.body as { username: string }).username.trim()
        : '';

    if (!PIVOT_USERNAME_RE.test(username)) {
      res.status(400).json({
        error:
          'Invalid or missing "username" (allowed: A-Z a-z 0-9 . _ -, max 64).',
      });
      return;
    }

    try {
      const { found, checks } = await checkUsername(username, {
        timeoutMs: osintTimeoutMs,
      });
      res.json({ username, source: 'native', found, checks });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Server username pivot failed.';
      res.status(500).json({ error: message });
    }
  });

  // Server-side Shodan Host Search / IP Lookup proxy endpoint (bypasses browser CORS)
  app.post('/api/osint/shodan', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as ShodanProxyBody;
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'query is required.' });
      return;
    }

    const shodanKey = resolveEffectiveApiKey(body.apiKey, 'SHODAN_API_KEY');
    if (!shodanKey) {
      res.status(403).json({
        error:
          'Please set your Shodan API key in the Dashboard Settings (or in the Shodan node).',
      });
      return;
    }

    const { url: upstreamUrl, mode } = buildShodanUpstreamUrl(query, shodanKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    try {
      const upstreamRes = await fetch(upstreamUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Trace-OSINT/1.0',
        },
        signal: controller.signal,
      });

      const payload = (await upstreamRes.json().catch(() => null)) as unknown;
      if (!upstreamRes.ok) {
        const message = readApiErrorMessage(payload, upstreamRes.status);
        res.status(upstreamRes.status).json({ error: message });
        return;
      }

      const normalized = normalizeShodanResponse(payload, mode);
      res.json({
        query,
        mode,
        total: normalized.total,
        results: normalized.results,
      });
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      const message = isAbort
        ? 'Shodan API request timed out after 10 seconds.'
        : error instanceof Error
          ? error.message
          : 'Shodan lookup failed on the server.';
      res.status(isAbort ? 504 : 502).json({ error: message });
    } finally {
      clearTimeout(timer);
    }
  });

  // Server-side Wayback Machine CDX API proxy endpoint (bypasses browser CORS)
  app.post('/api/osint/archive', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as ArchiveProxyBody;
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
    if (!rawUrl || /\s/.test(rawUrl)) {
      res.status(400).json({ error: 'A valid target url is required.' });
      return;
    }

    const cdxUrl = buildWaybackCdxUrl(rawUrl, 20);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);

    try {
      const upstreamRes = await fetch(cdxUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Trace-OSINT/1.0',
        },
        signal: controller.signal,
      });

      if (!upstreamRes.ok) {
        res.status(upstreamRes.status).json({
          error: `Wayback Machine CDX API returned HTTP ${upstreamRes.status}.`,
        });
        return;
      }

      const payload = (await upstreamRes.json().catch(() => null)) as unknown;
      const snapshots = parseWaybackCdxResponse(payload);
      res.json({
        url: rawUrl,
        snapshots,
      });
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      const message = isAbort
        ? 'Wayback Machine CDX lookup timed out after 12 seconds.'
        : error instanceof Error
          ? error.message
          : 'Wayback Machine archive lookup failed.';
      res.status(isAbort ? 504 : 502).json({ error: message });
    } finally {
      clearTimeout(timer);
    }
  });

  // Server-side Target / Suspect Composite Image Generation endpoint (Google Imagen 3 & OpenAI DALL-E 3)
  app.post('/api/image/generate', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as ImageGenerateBody;
    const rawPrompt =
      typeof body.prompt === 'string' ? body.prompt.trim() : '';

    if (!rawPrompt) {
      res.status(400).json({ error: 'prompt is required.' });
      return;
    }

    const providerId: LlmProviderId =
      body.provider && LLM_PROVIDERS.some((p) => p.id === body.provider)
        ? body.provider
        : 'google';
    const inlineImages = sanitizeInlineImages(body.images);

    if (providerId === 'openai') {
      const openAiKey = resolveEffectiveApiKey(body.apiKey, 'OPENAI_API_KEY');
      if (!openAiKey) {
        res.status(403).json({
          error: 'Please set your API key in the Dashboard Settings.',
        });
        return;
      }

      try {
        const dalleSpec = buildOpenAiDalleRequest({
          apiKey: openAiKey,
          prompt: rawPrompt,
        });
        const upstreamRes = await fetch(dalleSpec.url, {
          method: 'POST',
          headers: dalleSpec.headers,
          body: JSON.stringify(dalleSpec.body),
        });
        const json = (await upstreamRes.json().catch(() => null)) as unknown;
        if (!upstreamRes.ok) {
          throw new Error(readApiErrorMessage(json, upstreamRes.status));
        }

        const imageUrl = extractOpenAiDalleImageUrl(json);
        if (!imageUrl) {
          throw new Error('DALL-E 3 returned an empty image payload.');
        }

        res.json({
          imageUrl,
          model: DALLE_MODEL_ID,
          provider: 'openai',
        });
      } catch (error) {
        const formatted = formatServerProviderError(
          'OpenAI DALL-E 3',
          'OPENAI_API_KEY',
          error,
        );
        res.status(formatted.status).json({ error: formatted.message });
      }
      return;
    }

    if (providerId !== 'google') {
      res.status(400).json({
        error: `${getProviderMeta(providerId).name} does not expose a native image generation endpoint. Select Google (Imagen 3) or OpenAI (DALL-E 3) in Dashboard Settings.`,
      });
      return;
    }

    // Provider is Google: Call Imagen API (imagen-3.0-generate-001)
    try {
      const ai = getGeminiClient(
        typeof body.apiKey === 'string' ? body.apiKey : undefined,
      );
      let finalPrompt = rawPrompt;

      // If connected ImageNodes were passed, optionally extract brief visual traits to enrich the Imagen prompt
      if (inlineImages.length > 0) {
        try {
          const visionParts = buildGeminiParts(
            'Summarize the key physical subject, attire, and facial/structural traits visible in this reference frame in 2 concise sentences for a forensic composite.',
            inlineImages,
          );
          const visionSummary = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: { parts: visionParts },
          });
          const summaryText = visionSummary.text?.trim();
          if (summaryText) {
            finalPrompt = `${rawPrompt} | Visual Traits from Connected ImageNode: ${summaryText}`;
          }
        } catch {
          // Proceed with rawPrompt if vision enrichment fails
        }
      }

      const imagenResponse = await ai.models.generateImages({
        model: IMAGEN_MODEL_ID,
        prompt: finalPrompt,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/jpeg',
          aspectRatio: '1:1',
        },
      });

      const base64Bytes =
        imagenResponse.generatedImages?.[0]?.image?.imageBytes;
      if (!base64Bytes) {
        throw new Error(
          'Imagen API (imagen-3.0-generate-001) returned no generated image bytes.',
        );
      }

      res.json({
        imageUrl: `data:image/jpeg;base64,${base64Bytes}`,
        model: IMAGEN_MODEL_ID,
        provider: 'google',
      });
    } catch (error) {
      const formatted = formatServerProviderError(
        'Google Imagen',
        'GEMINI_API_KEY',
        error,
      );
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  const httpServer = http.createServer(app);

  // Mobile companion sync relay on /sync (PIN-authenticated; coexists with Vite HMR via noServer upgrade routing)
  const wss = new WebSocketServer({ noServer: true });
  const authenticatedClients = new Set<WebSocket>();

  wss.on('connection', (ws, req) => {
    const peer = req.socket.remoteAddress;
    console.log(`[ws] pending client connected from ${peer} (awaiting PIN auth)`);

    const authTimer = setTimeout(() => {
      if (!authenticatedClients.has(ws) && ws.readyState === WebSocket.OPEN) {
        console.warn(`[ws] closing unauthenticated client from ${peer} (auth timeout)`);
        ws.close(WS_CLOSE_UNAUTHORIZED, 'Unauthorized: authentication timeout');
      }
    }, WS_AUTH_TIMEOUT_MS);

    ws.on('message', (data, isBinary) => {
      if (!authenticatedClients.has(ws)) {
        clearTimeout(authTimer);
        if (isBinary) {
          console.warn(`[ws] rejected binary pre-auth payload from ${peer}`);
          ws.close(WS_CLOSE_UNAUTHORIZED, 'Unauthorized: PIN authentication required');
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(data.toString('utf8'));
        } catch {
          parsed = null;
        }

        const record =
          parsed && typeof parsed === 'object'
            ? (parsed as Record<string, unknown>)
            : null;
        const candidatePin =
          record && record.type === 'auth' && typeof record.pin === 'string'
            ? record.pin.trim()
            : '';

        if (!candidatePin || !isValidPinMatch(candidatePin, wsPin)) {
          console.warn(`[ws] rejected unauthorized client from ${peer} (invalid or missing PIN)`);
          ws.close(WS_CLOSE_UNAUTHORIZED, 'Unauthorized: invalid or missing PIN');
          return;
        }

        authenticatedClients.add(ws);
        ws.send(JSON.stringify({ type: 'auth_ok' }));
        console.log(
          `[ws] client authenticated from ${peer} (authenticated: ${authenticatedClients.size})`,
        );
        return;
      }

      let relayed = 0;
      for (const client of authenticatedClients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
          relayed++;
        }
      }
      const byteLen = Buffer.isBuffer(data)
        ? data.length
        : Array.isArray(data)
          ? data.reduce((sum, b) => sum + b.length, 0)
          : (data as ArrayBuffer).byteLength;
      console.log(
        `[ws] relayed ${isBinary ? 'binary' : 'text'} message (${byteLen} bytes) to ${relayed} authenticated client(s)`,
      );
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      authenticatedClients.delete(ws);
      console.log(
        `[ws] client disconnected (authenticated: ${authenticatedClients.size})`,
      );
    });
    ws.on('error', (err) => console.error('[ws] error:', err.message));
  });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const distPath = path.resolve(__dirname, 'dist');
  const mobileDistPath = path.resolve(__dirname, 'mobile', 'dist');

  // Serve the built Mobile Companion App at /mobile
  app.use('/mobile', express.static(mobileDistPath));
  app.get(['/mobile', '/mobile/*'], (_req: Request, res: Response) => {
    res.sendFile(path.join(mobileDistPath, 'index.html'));
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true' ? { server: httpServer } : false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.on('upgrade', (req, socket, head) => {
    const protocol = req.headers['sec-websocket-protocol'];
    // Let Vite HMR handle its own WebSocket upgrades without interference.
    if (typeof protocol === 'string' && protocol.includes('vite-hmr')) {
      return;
    }

    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname === '/sync') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
      return;
    }

    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  });

  httpServer.listen(port, host, () => {
    console.log(`Trace | OSINT Canvas listening on http://${host}:${port}`);
    console.log(`Mobile Companion App available at http://${host}:${port}/mobile`);
    console.log(`WebSocket sync endpoint: ws://${host}:${port}/sync`);
    console.log(`🔒 WebSocket PIN: ${wsPin}`);
    console.log(`CORS origins: ${allowedOrigins.join(', ')}`);
    console.log(
      `OSINT pivot engine: native fetch (${OSINT_PLATFORMS.length} platforms, ${osintTimeoutMs}ms timeout)`,
    );
  });
}

void startServer();
