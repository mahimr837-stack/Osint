// server.ts
import "dotenv/config";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";

// src/utils/llmProviders.ts
var LLM_PROVIDERS = [
  {
    id: "anthropic",
    name: "Anthropic",
    envVarName: "ANTHROPIC_API_KEY",
    endpointLabel: "/api/llm/generate (api.anthropic.com)",
    endpointUrl: "https://api.anthropic.com/v1/messages",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    defaultModel: "claude-3-5-sonnet-latest",
    models: [
      "claude-3-5-sonnet-latest",
      "claude-3-7-sonnet-latest",
      "claude-3-5-haiku-latest",
      "claude-3-opus-latest"
    ],
    keyPlaceholder: "ANTHROPIC_API_KEY (Server Secret)",
    supportsVision: true,
    description: "Server-proxied Anthropic Messages API with multimodal vision inspection."
  },
  {
    id: "openai",
    name: "OpenAI",
    envVarName: "OPENAI_API_KEY",
    endpointLabel: "/api/llm/generate (api.openai.com)",
    endpointUrl: "https://api.openai.com/v1/chat/completions",
    consoleUrl: "https://platform.openai.com/api-keys",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o4-mini"],
    keyPlaceholder: "OPENAI_API_KEY (Server Secret)",
    supportsVision: true,
    description: "Server-proxied OpenAI Chat Completions API with multimodal image understanding."
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    envVarName: "OPENROUTER_API_KEY",
    endpointLabel: "/api/llm/generate (openrouter.ai)",
    endpointUrl: "https://openrouter.ai/api/v1/chat/completions",
    consoleUrl: "https://openrouter.ai/keys",
    defaultModel: "anthropic/claude-3.5-sonnet",
    models: [
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o",
      "google/gemini-2.5-flash",
      "deepseek/deepseek-chat"
    ],
    keyPlaceholder: "OPENROUTER_API_KEY (Server Secret)",
    supportsVision: true,
    description: "Server-proxied OpenAI-compatible multi-model router supporting Claude, GPT-4o, Gemini, and DeepSeek."
  },
  {
    id: "google",
    name: "Google",
    envVarName: "GEMINI_API_KEY",
    endpointLabel: "/api/llm/generate (Gemini SDK)",
    endpointUrl: "/api/gemini/generate",
    consoleUrl: "https://aistudio.google.com/apikey",
    defaultModel: "gemini-4-hydrogen",
    models: [
      "gemini-4-hydrogen",
      "gemini-4-argon",
      "gemini-3.1-flash-lite",
      "gemini-2.5-flash",
      "gemini-2.5-pro"
    ],
    keyPlaceholder: "GEMINI_API_KEY (Server Secret)",
    supportsVision: true,
    description: "Server-side Google GenAI SDK for multimodal Gemini inspection."
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    envVarName: "DEEPSEEK_API_KEY",
    endpointLabel: "/api/llm/generate (api.deepseek.com)",
    endpointUrl: "https://api.deepseek.com/chat/completions",
    consoleUrl: "https://platform.deepseek.com/api_keys",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    keyPlaceholder: "DEEPSEEK_API_KEY (Server Secret)",
    supportsVision: false,
    description: "Server-proxied DeepSeek reasoning API (processes text prompts, OCR, and EXIF context)."
  },
  {
    id: "mistral",
    name: "Mistral",
    envVarName: "MISTRAL_API_KEY",
    endpointLabel: "/api/llm/generate (api.mistral.ai)",
    endpointUrl: "https://api.mistral.ai/v1/chat/completions",
    consoleUrl: "https://console.mistral.ai/api-keys",
    defaultModel: "pixtral-large-latest",
    models: [
      "pixtral-large-latest",
      "pixtral-12b-2409",
      "mistral-large-latest",
      "mistral-small-latest"
    ],
    keyPlaceholder: "MISTRAL_API_KEY (Server Secret)",
    supportsVision: true,
    description: "Server-proxied Mistral API with Pixtral multimodal vision models."
  }
];
function getProviderMeta(providerId) {
  const found = LLM_PROVIDERS.find((p) => p.id === providerId);
  return found ?? LLM_PROVIDERS[3];
}
function buildOpenAiCompatibleRequest(params) {
  const { provider, apiKey, model, promptText, images, systemPrompt, origin } = params;
  const meta = getProviderMeta(provider);
  const url = meta.endpointUrl;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey.trim()}`
  };
  if (provider === "openrouter") {
    if (origin) {
      headers["HTTP-Referer"] = origin;
    }
    headers["X-Title"] = "Traceboard Image OSINT Canvas";
  }
  let content;
  if (images.length > 0 && meta.supportsVision) {
    content = [
      { type: "text", text: promptText },
      ...images.map((img) => ({
        type: "image_url",
        image_url: {
          url: `data:${img.mimeType};base64,${img.data}`
        }
      }))
    ];
  } else if (images.length > 0 && !meta.supportsVision) {
    content = `${promptText}

[Attachment note: ${images.length} image frame(s) were wired, but ${meta.name} text models inspect text, OCR, and EXIF metadata context rather than raw pixels.]`;
  } else {
    content = promptText;
  }
  const messages = [];
  if (systemPrompt?.trim()) {
    messages.push({
      role: "system",
      content: systemPrompt.trim()
    });
  }
  messages.push({
    role: "user",
    content
  });
  return {
    url,
    headers,
    body: {
      model: model.trim() || meta.defaultModel,
      messages
    }
  };
}
function buildAnthropicRequest(params) {
  const { apiKey, model, promptText, images, systemPrompt } = params;
  const meta = getProviderMeta("anthropic");
  const content = [
    ...images.map((img) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mimeType,
        data: img.data
      }
    })),
    {
      type: "text",
      text: promptText
    }
  ];
  const body = {
    model: model.trim() || meta.defaultModel,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content
      }
    ]
  };
  if (systemPrompt?.trim()) {
    body.system = systemPrompt.trim();
  }
  return {
    url: meta.endpointUrl,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey.trim(),
      "anthropic-version": "2023-06-01"
    },
    body
  };
}
function extractOpenAiResponseText(payload) {
  if (!payload || typeof payload !== "object") return "";
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0];
  const content = first?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        const textVal = part.text;
        return typeof textVal === "string" ? textVal : "";
      }
      return "";
    }).join("\n").trim();
  }
  return "";
}
function extractAnthropicResponseText(payload) {
  if (!payload || typeof payload !== "object") return "";
  const content = payload.content;
  if (!Array.isArray(content)) return "";
  return content.filter(
    (block) => Boolean(block) && typeof block === "object" && block.type === "text" && typeof block.text === "string"
  ).map((block) => block.text).join("\n").trim();
}
function readApiErrorMessage(payload, fallbackStatus) {
  if (payload && typeof payload === "object") {
    const rec = payload;
    if (typeof rec.error === "string" && rec.error.trim()) return rec.error;
    if (rec.error && typeof rec.error === "object" && typeof rec.error.message === "string" && rec.error.message.trim()) {
      return rec.error.message;
    }
    if (typeof rec.message === "string" && rec.message.trim()) {
      return rec.message;
    }
  }
  return `Provider request failed with HTTP ${fallbackStatus}.`;
}

// src/utils/geoSpy.ts
var GEOSPY_PREDICT_ENDPOINT = "https://api.geospy.ai/predict";
function toValidLatLng(lat, lng) {
  if (typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90 && typeof lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180) {
    return { lat, lng };
  }
  return null;
}
function asNonEmptyString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
function extractCoordinatesFromRecord(record) {
  const directLat = asNumber(record.lat ?? record.latitude);
  const directLng = asNumber(
    record.lng ?? record.lon ?? record.long ?? record.longitude
  );
  const directCoords = toValidLatLng(directLat, directLng);
  if (directCoords) {
    return directCoords;
  }
  const coordsField = record.coordinates ?? record.coords ?? record.point;
  if (Array.isArray(coordsField) && coordsField.length >= 2) {
    const arrLat = asNumber(coordsField[0]);
    const arrLng = asNumber(coordsField[1]);
    const arrCoords = toValidLatLng(arrLat, arrLng);
    if (arrCoords) {
      return arrCoords;
    }
  } else if (coordsField && typeof coordsField === "object") {
    const nested = extractCoordinatesFromRecord(
      coordsField
    );
    if (nested) return nested;
  }
  const locationField = record.location ?? record.geo ?? record.address;
  if (locationField && typeof locationField === "object") {
    const nested = extractCoordinatesFromRecord(
      locationField
    );
    if (nested) return nested;
  }
  return null;
}
function extractPredictionFromRecord(record) {
  const coordinates = extractCoordinatesFromRecord(record);
  if (!coordinates) return null;
  const locationObj = record.location && typeof record.location === "object" ? record.location : null;
  const city = asNonEmptyString(record.city) ?? asNonEmptyString(record.town) ?? asNonEmptyString(record.municipality) ?? (locationObj ? asNonEmptyString(locationObj.city) : null);
  const country = asNonEmptyString(record.country) ?? asNonEmptyString(record.country_name) ?? (locationObj ? asNonEmptyString(locationObj.country) ?? asNonEmptyString(locationObj.country_name) : null);
  const rawConfidence = asNumber(
    record.score ?? record.confidence ?? record.probability
  );
  const confidence = rawConfidence !== null ? rawConfidence <= 1 ? Math.round(rawConfidence * 100) : Math.round(rawConfidence) : null;
  return {
    coordinates,
    city,
    country,
    confidence
  };
}
function parseGeoSpyResponse(payload) {
  if (!payload || typeof payload !== "object") return null;
  const root = payload;
  const arrayKeys = ["geo_predictions", "predictions", "results", "candidates"];
  for (const key of arrayKeys) {
    const list = root[key];
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item && typeof item === "object") {
          const parsed = extractPredictionFromRecord(item);
          if (parsed) return parsed;
        }
      }
    }
  }
  const nestedKeys = ["prediction", "data", "result"];
  for (const key of nestedKeys) {
    const nested = root[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const parsed = extractPredictionFromRecord(nested);
      if (parsed) return parsed;
    }
  }
  return extractPredictionFromRecord(root);
}

// src/utils/nativeOsint.ts
var DEFAULT_TIMEOUT_MS = 5e3;
var REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};
var OSINT_PLATFORMS = [
  {
    id: "github",
    label: "GitHub",
    buildUrl: (u) => `https://github.com/${encodeURIComponent(u)}`,
    notFoundMarkers: ["this is not the web page you are looking for"]
  },
  {
    id: "reddit",
    label: "Reddit",
    buildUrl: (u) => `https://www.reddit.com/user/${encodeURIComponent(u)}`,
    requestUrl: (u) => `https://www.reddit.com/user/${encodeURIComponent(u)}/`,
    notFoundMarkers: [
      "sorry, nobody on reddit goes by that name",
      "this account has been suspended",
      "page not found"
    ],
    // Require actual profile markup (not a generic 200 WAF/login shell echoing the URL).
    verifyBody: (bodyLower, usernameLower) => bodyLower.includes(`(u/${usernameLower}) - reddit`) || bodyLower.includes(`"subreddit":{"display_name":"u_${usernameLower}"`)
  },
  {
    id: "instagram",
    label: "Instagram",
    buildUrl: (u) => `https://www.instagram.com/${encodeURIComponent(u)}/`,
    notFoundMarkers: [
      "sorry, this page isn't available",
      "the link you followed may be broken",
      "page not found"
    ],
    // Logged-out Instagram returns an identical 200 shell without profile og:title metadata.
    verifyBody: (bodyLower, usernameLower) => bodyLower.includes(`(@${usernameLower})`) || bodyLower.includes(`"username":"${usernameLower}"`)
  },
  {
    id: "tiktok",
    label: "TikTok",
    buildUrl: (u) => `https://www.tiktok.com/@${encodeURIComponent(u)}`,
    notFoundMarkers: [
      "couldn't find this account",
      "page not available",
      '"statuscode":10202',
      '"statuscode":10221'
    ],
    // Ignore blank 200 JS-challenge pages that lack actual user profile JSON.
    verifyBody: (bodyLower, usernameLower) => bodyLower.includes(`"uniqueid":"${usernameLower}"`)
  },
  {
    id: "pinterest",
    label: "Pinterest",
    buildUrl: (u) => `https://www.pinterest.com/${encodeURIComponent(u)}/`,
    notFoundMarkers: [
      "user not found",
      "sorry, we couldn't find that page",
      "page not found"
    ]
  },
  {
    id: "twitch",
    label: "Twitch",
    buildUrl: (u) => `https://www.twitch.tv/${encodeURIComponent(u)}`,
    notFoundMarkers: [
      "sorry. unless you\u2019ve got a time machine",
      "sorry. unless you've got a time machine"
    ],
    verifyBody: (bodyLower, usernameLower) => bodyLower.includes(`<title>${usernameLower} - twitch</title>`) || bodyLower.includes(`content="${usernameLower} - twitch"`)
  },
  {
    id: "steam",
    label: "Steam",
    buildUrl: (u) => `https://steamcommunity.com/id/${encodeURIComponent(u)}`,
    notFoundMarkers: [
      "the specified profile could not be found",
      "steam community :: error"
    ]
  }
];
async function checkSinglePlatform(platform, username, timeoutMs) {
  const profileUrl = platform.buildUrl(username);
  const fetchUrl = platform.requestUrl ? platform.requestUrl(username) : profileUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(fetchUrl, {
      method: "GET",
      headers: REQUEST_HEADERS,
      redirect: "manual",
      signal: controller.signal
    });
    const status = res.status;
    if (status === 404 || status === 410) {
      return { platform: platform.id, url: profileUrl, exists: false, status, reason: "not_found" };
    }
    if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
      const location = res.headers.get("location") || "";
      return {
        platform: platform.id,
        url: profileUrl,
        exists: false,
        status,
        reason: `redirect (${location.slice(0, 60) || status})`
      };
    }
    if (status === 401 || status === 403 || status === 429) {
      return {
        platform: platform.id,
        url: profileUrl,
        exists: false,
        status,
        reason: `blocked_or_rate_limited (${status})`
      };
    }
    if (status === 200) {
      const bodyLower = (await res.text().catch(() => "")).toLowerCase();
      if (platform.notFoundMarkers?.some((marker) => bodyLower.includes(marker))) {
        return { platform: platform.id, url: profileUrl, exists: false, status, reason: "soft_404" };
      }
      if (platform.verifyBody && !platform.verifyBody(bodyLower, username.toLowerCase())) {
        return {
          platform: platform.id,
          url: profileUrl,
          exists: false,
          status,
          reason: "unverified_shell_or_not_found"
        };
      }
      return { platform: platform.id, url: profileUrl, exists: true, status, reason: "found" };
    }
    return { platform: platform.id, url: profileUrl, exists: false, status, reason: `http_${status}` };
  } catch (err) {
    const error = err;
    const isTimeout = error?.name === "AbortError";
    return {
      platform: platform.id,
      url: profileUrl,
      exists: false,
      status: null,
      reason: isTimeout ? "timeout" : error?.message || "network_error"
    };
  } finally {
    clearTimeout(timer);
  }
}
async function checkUsername(username, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const settled = await Promise.allSettled(
    OSINT_PLATFORMS.map(
      (platform) => checkSinglePlatform(platform, username, timeoutMs)
    )
  );
  const checks = settled.map((entry, idx) => {
    if (entry.status === "fulfilled") return entry.value;
    const platform = OSINT_PLATFORMS[idx];
    const reason = entry.reason;
    return {
      platform: platform.id,
      url: platform.buildUrl(username),
      exists: false,
      status: null,
      reason: reason?.message || "unexpected_error"
    };
  });
  const found = checks.filter((c) => c.exists).map((c) => c.url);
  return { found, checks };
}

// src/utils/usernamePivot.ts
var DEFAULT_BACKEND_PIVOT_URL = typeof import.meta !== "undefined" && import.meta.env?.VITE_BACKEND_URL ? `${import.meta.env.VITE_BACKEND_URL.replace(/\/+$/, "")}/api/osint/pivot` : typeof window !== "undefined" ? "/api/osint/pivot" : "http://localhost:3000/api/osint/pivot";

// src/utils/suspectComposite.ts
var IMAGEN_MODEL_ID = "imagen-3.0-generate-001";
var DALLE_MODEL_ID = "dall-e-3";
var OPENAI_IMAGES_ENDPOINT = "https://api.openai.com/v1/images/generations";
function buildOpenAiDalleRequest(params) {
  return {
    url: OPENAI_IMAGES_ENDPOINT,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey.trim()}`
    },
    body: {
      model: DALLE_MODEL_ID,
      prompt: params.prompt.trim(),
      n: 1,
      size: "1024x1024",
      response_format: "b64_json"
    }
  };
}
function extractOpenAiDalleImageUrl(payload) {
  if (!payload || typeof payload !== "object") return null;
  const data = payload.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  if (!first || typeof first !== "object") return null;
  if (typeof first.b64_json === "string" && first.b64_json.trim()) {
    return `data:image/png;base64,${first.b64_json.trim()}`;
  }
  if (typeof first.url === "string" && first.url.trim()) {
    return first.url.trim();
  }
  return null;
}

// server.ts
var PROVIDER_ENV_KEYS = {
  google: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  mistral: "MISTRAL_API_KEY"
};
var PLACEHOLDER_ENV_VALUES = /* @__PURE__ */ new Set([
  "MY_GEMINI_API_KEY",
  "YOUR_ACTUAL_KEY_HERE",
  "YOUR_GEMINI_API_KEY_HERE"
]);
function readServerEnvKey(envVarName) {
  const raw = process.env[envVarName];
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed || PLACEHOLDER_ENV_VALUES.has(trimmed)) return "";
  return trimmed;
}
function resolveEffectiveApiKey(clientApiKey, envVarName) {
  if (typeof clientApiKey === "string") {
    const trimmed = clientApiKey.trim();
    if (trimmed && !PLACEHOLDER_ENV_VALUES.has(trimmed)) {
      return trimmed;
    }
  }
  return readServerEnvKey(envVarName);
}
function getGeminiClient(clientApiKey) {
  const apiKey = resolveEffectiveApiKey(clientApiKey, "GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error("Please set your API key in the Dashboard Settings.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
function sanitizeInlineImages(images) {
  if (!Array.isArray(images)) return [];
  return images.filter(
    (img) => Boolean(img) && typeof img.mimeType === "string" && typeof img.data === "string"
  );
}
function buildGeminiParts(promptText, images) {
  const inlineParts = sanitizeInlineImages(images).map((part) => ({
    inlineData: {
      mimeType: part.mimeType,
      data: part.data
    }
  }));
  return [...inlineParts, { text: promptText }];
}
function formatServerProviderError(providerName, envVarName, error) {
  const rawMessage = error instanceof Error ? error.message : `${providerName} API request failed on the server.`;
  if (rawMessage.includes("Please set your API key in the Dashboard Settings.")) {
    return {
      status: 403,
      message: rawMessage
    };
  }
  if (rawMessage.includes("API_KEY_INVALID") || rawMessage.includes("PERMISSION_DENIED") || rawMessage.includes("is not configured on the server") || rawMessage.includes("401") || rawMessage.includes("invalid x-api-key") || rawMessage.includes("Incorrect API key")) {
    return {
      status: 403,
      message: `${rawMessage} Please check your ${providerName} API key in Dashboard Settings (or ${envVarName} on the server).`
    };
  }
  if (rawMessage.includes("RESOURCE_EXHAUSTED") || rawMessage.includes("429")) {
    return {
      status: 429,
      message: `${rawMessage} Check quota or billing for ${providerName} (${envVarName}).`
    };
  }
  return {
    status: 500,
    message: rawMessage
  };
}
async function executeProviderGeneration(params) {
  const { provider, apiKey, model, promptText, images, systemPrompt } = params;
  const meta = getProviderMeta(provider);
  const envVarName = PROVIDER_ENV_KEYS[provider] ?? meta.envVarName;
  const resolvedModel = model.trim() || meta.defaultModel;
  if (provider === "google") {
    const ai = getGeminiClient(apiKey);
    const parts = buildGeminiParts(promptText, images);
    const response = await ai.models.generateContent({
      model: resolvedModel,
      contents: { parts },
      ...systemPrompt?.trim() ? { config: { systemInstruction: systemPrompt.trim() } } : {}
    });
    return response.text?.trim() || "Gemini returned an empty response for this inspection.";
  }
  const effectiveApiKey = resolveEffectiveApiKey(apiKey, envVarName);
  if (!effectiveApiKey) {
    throw new Error("Please set your API key in the Dashboard Settings.");
  }
  if (provider === "anthropic") {
    const spec2 = buildAnthropicRequest({
      apiKey: effectiveApiKey,
      model: resolvedModel,
      promptText,
      images,
      systemPrompt
    });
    const upstreamRes2 = await fetch(spec2.url, {
      method: "POST",
      headers: spec2.headers,
      body: JSON.stringify(spec2.body)
    });
    const json2 = await upstreamRes2.json().catch(() => null);
    if (!upstreamRes2.ok) {
      throw new Error(readApiErrorMessage(json2, upstreamRes2.status));
    }
    return extractAnthropicResponseText(json2) || "Anthropic returned an empty response for this inspection.";
  }
  const appOrigin = readServerEnvKey("APP_URL") || "http://localhost:3000";
  const spec = buildOpenAiCompatibleRequest({
    provider,
    apiKey: effectiveApiKey,
    model: resolvedModel,
    promptText,
    images,
    systemPrompt,
    origin: appOrigin
  });
  const upstreamRes = await fetch(spec.url, {
    method: "POST",
    headers: spec.headers,
    body: JSON.stringify(spec.body)
  });
  const json = await upstreamRes.json().catch(() => null);
  if (!upstreamRes.ok) {
    throw new Error(readApiErrorMessage(json, upstreamRes.status));
  }
  return extractOpenAiResponseText(json) || `${meta.name} returned an empty response for this inspection.`;
}
var isServerStarted = false;
async function startServer() {
  if (isServerStarted) return;
  isServerStarted = true;
  const app = express();
  const port = Number(process.env.PORT) || 3e3;
  const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000,http://localhost:5173").split(",").map((o) => o.trim()).filter(Boolean);
  const osintTimeoutMs = Number(process.env.OSINT_TIMEOUT_MS) || 5e3;
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(null, false);
      }
    })
  );
  app.use(express.json({ limit: "50mb" }));
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/api/providers/status", (_req, res) => {
    const providers = Object.fromEntries(
      LLM_PROVIDERS.map((p) => [
        p.id,
        Boolean(readServerEnvKey(p.envVarName))
      ])
    );
    res.json({
      providers,
      geospy: Boolean(readServerEnvKey("GEOSPY_API_KEY"))
    });
  });
  app.post("/api/llm/generate", async (req, res) => {
    const body = req.body ?? {};
    const promptText = typeof body.promptText === "string" ? body.promptText.trim() : "";
    if (!promptText) {
      res.status(400).json({ error: "promptText is required." });
      return;
    }
    const providerId = body.provider && LLM_PROVIDERS.some((p) => p.id === body.provider) ? body.provider : "google";
    const meta = getProviderMeta(providerId);
    const resolvedModel = typeof body.model === "string" && body.model.trim() ? body.model.trim() : meta.defaultModel;
    const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";
    const images = sanitizeInlineImages(body.images);
    try {
      const text = await executeProviderGeneration({
        provider: providerId,
        apiKey: typeof body.apiKey === "string" ? body.apiKey : void 0,
        model: resolvedModel,
        promptText,
        images,
        systemPrompt
      });
      res.json({ text });
    } catch (error) {
      const formatted = formatServerProviderError(
        meta.name,
        meta.envVarName,
        error
      );
      res.status(formatted.status).json({ error: formatted.message });
    }
  });
  app.post("/api/gemini/generate", async (req, res) => {
    const body = req.body ?? {};
    const promptText = typeof body.promptText === "string" ? body.promptText.trim() : "";
    if (!promptText) {
      res.status(400).json({ error: "promptText is required." });
      return;
    }
    const resolvedModel = typeof body.model === "string" && body.model.trim() ? body.model.trim() : "gemini-4-hydrogen";
    const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";
    const images = sanitizeInlineImages(body.images);
    try {
      const text = await executeProviderGeneration({
        provider: "google",
        apiKey: typeof body.apiKey === "string" ? body.apiKey : void 0,
        model: resolvedModel,
        promptText,
        images,
        systemPrompt
      });
      res.json({ text });
    } catch (error) {
      const formatted = formatServerProviderError(
        "Google",
        "GEMINI_API_KEY",
        error
      );
      res.status(formatted.status).json({ error: formatted.message });
    }
  });
  app.post("/api/gemini/stream", async (req, res) => {
    const body = req.body ?? {};
    const promptText = typeof body.promptText === "string" ? body.promptText.trim() : "";
    if (!promptText) {
      res.status(400).json({ error: "promptText is required." });
      return;
    }
    const resolvedModel = typeof body.model === "string" && body.model.trim() ? body.model.trim() : "gemini-4-hydrogen";
    const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    try {
      const ai = getGeminiClient(
        typeof body.apiKey === "string" ? body.apiKey : void 0
      );
      const parts = buildGeminiParts(promptText, body.images);
      const streamResponse = await ai.models.generateContentStream({
        model: resolvedModel,
        contents: { parts },
        ...systemPrompt ? { config: { systemInstruction: systemPrompt } } : {}
      });
      for await (const chunk of streamResponse) {
        const c = chunk;
        const chunkText = c.text ?? "";
        if (chunkText) {
          res.write(`data: ${JSON.stringify({ text: chunkText })}

`);
        }
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      const formatted = formatServerProviderError(
        "Google",
        "GEMINI_API_KEY",
        error
      );
      res.write(`data: ${JSON.stringify({ error: formatted.message })}

`);
      res.end();
    }
  });
  app.post("/api/osint/geospy", async (req, res) => {
    const body = req.body ?? {};
    const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";
    const mimeType = typeof body.mimeType === "string" && body.mimeType.trim() ? body.mimeType.trim() : "image/jpeg";
    const fileName = typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim() : "evidence.jpg";
    if (!imageBase64) {
      res.status(400).json({ error: "imageBase64 is required." });
      return;
    }
    const geoSpyKey = readServerEnvKey("GEOSPY_API_KEY");
    if (!geoSpyKey) {
      res.status(403).json({
        error: "GEOSPY_API_KEY is not configured on the server. Add GEOSPY_API_KEY in the Settings > Secrets panel."
      });
      return;
    }
    try {
      const binaryBuffer = Buffer.from(imageBase64, "base64");
      const blob = new Blob([binaryBuffer], { type: mimeType });
      const formData = new FormData();
      formData.append("file", blob, fileName);
      const upstreamRes = await fetch(GEOSPY_PREDICT_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${geoSpyKey}`
        },
        body: formData
      });
      if (!upstreamRes.ok) {
        let errorDetail = `GeoSpy API request failed (${upstreamRes.status}).`;
        try {
          const errorJson = await upstreamRes.json();
          const candidate = errorJson.detail ?? errorJson.message ?? errorJson.error;
          if (typeof candidate === "string" && candidate.trim()) {
            errorDetail = candidate.trim();
          }
        } catch {
        }
        res.status(upstreamRes.status).json({ error: errorDetail });
        return;
      }
      const data = await upstreamRes.json();
      const prediction = parseGeoSpyResponse(data);
      if (!prediction) {
        res.status(502).json({
          error: "GeoSpy response did not include valid lat/lng coordinates."
        });
        return;
      }
      res.json({ prediction });
    } catch (error) {
      const formatted = formatServerProviderError(
        "GeoSpy",
        "GEOSPY_API_KEY",
        error
      );
      res.status(formatted.status).json({ error: formatted.message });
    }
  });
  const PIVOT_USERNAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
  app.post("/api/osint/pivot", async (req, res) => {
    const username = req.body && typeof req.body.username === "string" ? req.body.username.trim() : "";
    if (!PIVOT_USERNAME_RE.test(username)) {
      res.status(400).json({
        error: 'Invalid or missing "username" (allowed: A-Z a-z 0-9 . _ -, max 64).'
      });
      return;
    }
    try {
      const { found, checks } = await checkUsername(username, {
        timeoutMs: osintTimeoutMs
      });
      res.json({ username, source: "native", found, checks });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Server username pivot failed.";
      res.status(500).json({ error: message });
    }
  });
  app.post("/api/image/generate", async (req, res) => {
    const body = req.body ?? {};
    const rawPrompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!rawPrompt) {
      res.status(400).json({ error: "prompt is required." });
      return;
    }
    const providerId = body.provider && LLM_PROVIDERS.some((p) => p.id === body.provider) ? body.provider : "google";
    const inlineImages = sanitizeInlineImages(body.images);
    if (providerId === "openai") {
      const openAiKey = resolveEffectiveApiKey(body.apiKey, "OPENAI_API_KEY");
      if (!openAiKey) {
        res.status(403).json({
          error: "Please set your API key in the Dashboard Settings."
        });
        return;
      }
      try {
        const dalleSpec = buildOpenAiDalleRequest({
          apiKey: openAiKey,
          prompt: rawPrompt
        });
        const upstreamRes = await fetch(dalleSpec.url, {
          method: "POST",
          headers: dalleSpec.headers,
          body: JSON.stringify(dalleSpec.body)
        });
        const json = await upstreamRes.json().catch(() => null);
        if (!upstreamRes.ok) {
          throw new Error(readApiErrorMessage(json, upstreamRes.status));
        }
        const imageUrl = extractOpenAiDalleImageUrl(json);
        if (!imageUrl) {
          throw new Error("DALL-E 3 returned an empty image payload.");
        }
        res.json({
          imageUrl,
          model: DALLE_MODEL_ID,
          provider: "openai"
        });
      } catch (error) {
        const formatted = formatServerProviderError(
          "OpenAI DALL-E 3",
          "OPENAI_API_KEY",
          error
        );
        res.status(formatted.status).json({ error: formatted.message });
      }
      return;
    }
    if (providerId !== "google") {
      res.status(400).json({
        error: `${getProviderMeta(providerId).name} does not expose a native image generation endpoint. Select Google (Imagen 3) or OpenAI (DALL-E 3) in Dashboard Settings.`
      });
      return;
    }
    try {
      const ai = getGeminiClient(
        typeof body.apiKey === "string" ? body.apiKey : void 0
      );
      let finalPrompt = rawPrompt;
      if (inlineImages.length > 0) {
        try {
          const visionParts = buildGeminiParts(
            "Summarize the key physical subject, attire, and facial/structural traits visible in this reference frame in 2 concise sentences for a forensic composite.",
            inlineImages
          );
          const visionSummary = await ai.models.generateContent({
            model: "gemini-4-hydrogen",
            contents: { parts: visionParts }
          });
          const summaryText = visionSummary.text?.trim();
          if (summaryText) {
            finalPrompt = `${rawPrompt} | Visual Traits from Connected ImageNode: ${summaryText}`;
          }
        } catch {
        }
      }
      const imagenResponse = await ai.models.generateImages({
        model: IMAGEN_MODEL_ID,
        prompt: finalPrompt,
        config: {
          numberOfImages: 1,
          outputMimeType: "image/jpeg",
          aspectRatio: "1:1"
        }
      });
      const base64Bytes = imagenResponse.generatedImages?.[0]?.image?.imageBytes;
      if (!base64Bytes) {
        throw new Error(
          "Imagen API (imagen-3.0-generate-001) returned no generated image bytes."
        );
      }
      res.json({
        imageUrl: `data:image/jpeg;base64,${base64Bytes}`,
        model: IMAGEN_MODEL_ID,
        provider: "google"
      });
    } catch (error) {
      const formatted = formatServerProviderError(
        "Google Imagen",
        "GEMINI_API_KEY",
        error
      );
      res.status(formatted.status).json({ error: formatted.message });
    }
  });
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (ws, req) => {
    const peer = req.socket.remoteAddress;
    console.log(`[ws] client connected from ${peer} (total: ${wss.clients.size})`);
    ws.on("message", (data, isBinary) => {
      let relayed = 0;
      for (const client of wss.clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
          relayed++;
        }
      }
      const byteLen = Buffer.isBuffer(data) ? data.length : Array.isArray(data) ? data.reduce((sum, b) => sum + b.length, 0) : data.byteLength;
      console.log(
        `[ws] relayed ${isBinary ? "binary" : "text"} message (${byteLen} bytes) to ${relayed} client(s)`
      );
    });
    ws.on(
      "close",
      () => console.log(`[ws] client disconnected (total: ${wss.clients.size})`)
    );
    ws.on("error", (err) => console.error("[ws] error:", err.message));
  });
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const distPath = path.resolve(__dirname, "dist");
  const mobileDistPath = path.resolve(__dirname, "mobile", "dist");
  app.use("/mobile", express.static(mobileDistPath));
  app.get(["/mobile", "/mobile/*"], (_req, res) => {
    res.sendFile(path.join(mobileDistPath, "index.html"));
  });
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== "true" ? { server: httpServer } : false
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  httpServer.on("upgrade", (req, socket, head) => {
    const protocol = req.headers["sec-websocket-protocol"];
    if (typeof protocol === "string" && protocol.includes("vite-hmr")) {
      return;
    }
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    if (pathname === "/sync") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
      return;
    }
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
  });
  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`Trace | OSINT Canvas listening on http://0.0.0.0:${port}`);
    console.log(`Mobile Companion App available at http://localhost:${port}/mobile`);
    console.log(`WebSocket sync endpoint: ws://localhost:${port}/sync`);
    console.log(`CORS origins: ${allowedOrigins.join(", ")}`);
    console.log(
      `OSINT pivot engine: native fetch (${OSINT_PLATFORMS.length} platforms, ${osintTimeoutMs}ms timeout)`
    );
  });
}
void startServer();
export {
  startServer
};
