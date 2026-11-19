import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getGlobalApiKey,
  GLOBAL_API_KEY_STORAGE_KEY,
  GLOBAL_PROVIDER_STORAGE_KEY,
  GLOBAL_SETTINGS_STORAGE_KEY,
  MISSING_API_KEY_MESSAGE,
  readGlobalSettings,
  saveGlobalSettings,
} from './globalSettings';
import { runMultiProviderAnalysis } from './llmProviders';
import { requestTargetImageGeneration } from './suspectComposite';
import { generateGoogleDorks } from './dorkGenerator';

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

test('persists and reads global provider, API key, and model in localStorage', () => {
  const mockStorage = createMemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });

  // Initially empty key
  assert.equal(getGlobalApiKey(), '');
  assert.equal(readGlobalSettings().provider, 'google');

  // Save OpenAI provider and key
  saveGlobalSettings({
    provider: 'openai',
    apiKey: 'sk-openai-global-123',
    model: 'gpt-4o',
  });

  const saved = readGlobalSettings();
  assert.equal(saved.provider, 'openai');
  assert.equal(saved.apiKey, 'sk-openai-global-123');
  assert.equal(saved.model, 'gpt-4o');
  assert.equal(getGlobalApiKey(), 'sk-openai-global-123');
  assert.equal(getGlobalApiKey('openai'), 'sk-openai-global-123');
  assert.equal(mockStorage.getItem(GLOBAL_PROVIDER_STORAGE_KEY), 'openai');
  assert.equal(
    mockStorage.getItem(GLOBAL_API_KEY_STORAGE_KEY),
    'sk-openai-global-123',
  );
  assert.ok(mockStorage.getItem(GLOBAL_SETTINGS_STORAGE_KEY));

  mockStorage.clear();
});

test('AI utilities throw helpful Dashboard Settings error when no API key is set in localStorage', async () => {
  const mockStorage = createMemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });

  await assert.rejects(
    () =>
      runMultiProviderAnalysis({
        promptText: 'Analyze harbor cranes.',
        images: [],
      }),
    {
      message: MISSING_API_KEY_MESSAGE,
    },
  );

  await assert.rejects(
    () =>
      generateGoogleDorks({
        targetType: 'General OSINT',
        extractedSourceText: 'alice@acme.io',
      }),
    {
      message: MISSING_API_KEY_MESSAGE,
    },
  );

  await assert.rejects(
    () =>
      requestTargetImageGeneration({
        prompt: 'Suspect composite description',
      }),
    {
      message: MISSING_API_KEY_MESSAGE,
    },
  );
});

test('AI utilities pull API key and provider from localStorage globally when configured', async () => {
  const mockStorage = createMemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });

  saveGlobalSettings({
    provider: 'anthropic',
    apiKey: 'sk-ant-dashboard-key',
    model: 'claude-3-5-sonnet-latest',
  });

  let capturedLlmBody: Record<string, unknown> | null = null;
  const mockLlmFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedLlmBody = JSON.parse(String(init?.body ?? '{}')) as Record<
      string,
      unknown
    >;
    return new Response(
      JSON.stringify({
        text: '1. site:pastebin.com "alice@acme.io"\n2. filetype:pdf "alice@acme.io"',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  const dorks = await generateGoogleDorks({
    targetType: 'Documents/Leaks',
    extractedSourceText: 'alice@acme.io',
    fetchImpl: mockLlmFetch,
  });

  assert.equal(dorks.length, 2);
  assert.ok(capturedLlmBody);
  assert.equal(capturedLlmBody?.provider, 'anthropic');
  assert.equal(capturedLlmBody?.apiKey, 'sk-ant-dashboard-key');
  assert.equal(capturedLlmBody?.model, 'claude-3-5-sonnet-latest');

  saveGlobalSettings({
    provider: 'openai',
    apiKey: 'sk-openai-dashboard-key',
    model: 'gpt-4o',
  });

  let capturedImageBody: Record<string, unknown> | null = null;
  const mockImageFetch = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    capturedImageBody = JSON.parse(String(init?.body ?? '{}')) as Record<
      string,
      unknown
    >;
    return new Response(
      JSON.stringify({
        imageUrl: 'data:image/png;base64,COMPOSITE',
        model: 'dall-e-3',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  const imageRes = await requestTargetImageGeneration({
    prompt: 'Forensic composite',
    fetchImpl: mockImageFetch,
  });

  assert.equal(imageRes.imageUrl, 'data:image/png;base64,COMPOSITE');
  assert.equal(imageRes.modelUsed, 'dall-e-3');
  assert.ok(capturedImageBody);
  assert.equal(capturedImageBody?.provider, 'openai');
  assert.equal(capturedImageBody?.apiKey, 'sk-openai-dashboard-key');

  mockStorage.clear();
});
