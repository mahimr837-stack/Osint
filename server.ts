import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response } from 'express';
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
import { runUsernamePivotCheck } from './src/utils/usernamePivot';
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
  prompt?: string;
  images?: InlineImageInput[];
}

interface LlmGenerateBody {
  provider?: LlmProviderId;
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

const PROVIDER_ENV_KEYS: Record<LlmProviderId, string> = {
  google: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  mistral: 'MISTRAL_API_KEY',
};

function readServerEnvKey(envVarName: string): string {
  const raw = process.env[envVarName];
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'MY_GEMINI_API_KEY') return '';
  return trimmed;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = readServerEnvKey('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Please check the Settings > Secrets panel.',
    );
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
      message: `${rawMessage} Configure ${envVarName} in the Settings > Secrets panel.`,
    };
  }

  if (rawMessage.includes('RESOURCE_EXHAUSTED') || rawMessage.includes('429')) {
    return {
      status: 429,
      message: `${rawMessage} Check quota or billing for ${envVarName} in the Settings > Secrets panel.`,
    };
  }

  return {
    status: 500,
    message: rawMessage,
  };
}

async function executeProviderGeneration(params: {
  provider: LlmProviderId;
  model: string;
  promptText: string;
  images: InlineImageInput[];
  systemPrompt?: string;
}): Promise<string> {
  const { provider, model, promptText, images, systemPrompt } = params;
  const meta = getProviderMeta(provider);
  const envVarName = PROVIDER_ENV_KEYS[provider] ?? meta.envVarName;
  const resolvedModel = model.trim() || meta.defaultModel;

  if (provider === 'google') {
    const ai = getGeminiClient();
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

  const serverApiKey = readServerEnvKey(envVarName);
  if (!serverApiKey) {
    throw new Error(
      `${envVarName} is not configured on the server for ${meta.name}.`,
    );
  }

  if (provider === 'anthropic') {
    const spec = buildAnthropicRequest({
      apiKey: serverApiKey,
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
    apiKey: serverApiKey,
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

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '50mb' }));

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
      const ai = getGeminiClient();
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

  // Server-side username pivot proxy route (prevents browser CORS errors on GitHub, Instagram, and Reddit)
  app.post('/api/osint/pivot', async (req: Request, res: Response) => {
    const rawUsername =
      req.body && typeof (req.body as { username?: unknown }).username === 'string'
        ? (req.body as { username: string }).username.trim()
        : '';

    if (!rawUsername) {
      res.status(400).json({ error: 'username is required.' });
      return;
    }

    try {
      const results = await runUsernamePivotCheck(rawUsername);
      res.json({ results });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Server username pivot failed.';
      res.status(500).json({ error: message });
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
      const openAiKey = readServerEnvKey('OPENAI_API_KEY');
      if (!openAiKey) {
        res.status(403).json({
          error:
            'OPENAI_API_KEY is not configured on the server for DALL-E 3 image generation. Configure OPENAI_API_KEY in the Settings > Secrets panel or switch Provider to Google.',
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
        error: `${getProviderMeta(providerId).name} does not expose a native image generation endpoint. Select Google (Imagen 3) or OpenAI (DALL-E 3) in Models.`,
      });
      return;
    }

    // Provider is Google: Call Imagen API (imagen-3.0-generate-001)
    try {
      const ai = getGeminiClient();
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

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

void startServer();
