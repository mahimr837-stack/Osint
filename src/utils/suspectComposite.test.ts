import test from 'node:test';
import assert from 'node:assert/strict';
import type { Edge } from 'reactflow';
import type { OsintNode } from '../types/osint';
import { HANDLE_IDS } from './osintGraph';
import {
  buildOpenAiDalleRequest,
  buildServerImageGenerationRequest,
  buildSuspectCompositePrompt,
  DALLE_MODEL_ID,
  extractOpenAiDalleImageUrl,
  IMAGEN_MODEL_ID,
  OPENAI_IMAGES_ENDPOINT,
  resolveSuspectContextForNode,
  SERVER_IMAGE_GENERATE_ENDPOINT,
} from './suspectComposite';

test('buildSuspectCompositePrompt formats description and connected context with exact forensic prefix', () => {
  const prompt = buildSuspectCompositePrompt({
    description: 'Male, late 30s, dark utility jacket, scar above left eyebrow',
    contextText:
      'OCR Extracted Text (Badge OCR): PORT AUTH ID 4491 | Analyst Chat Findings (Harbor Inquiry): Subject seen near Berth 4',
  });

  assert.equal(
    prompt,
    'Generate a highly realistic forensic composite image based on this description and context: Target Description: Male, late 30s, dark utility jacket, scar above left eyebrow | Connected Intelligence Context: OCR Extracted Text (Badge OCR): PORT AUTH ID 4491 | Analyst Chat Findings (Harbor Inquiry): Subject seen near Berth 4',
  );
});

test('resolveSuspectContextForNode aggregates connected ImageNode, OcrNode, and ChatNode context', () => {
  const nodes: OsintNode[] = [
    {
      id: 'img-1',
      type: 'imageNode',
      position: { x: 0, y: 0 },
      data: {
        kind: 'image',
        title: 'CCTV Gate Frame',
        imageUrl: 'data:image/png;base64,AAA',
        sourceLabel: 'Cam 04',
      },
    },
    {
      id: 'ocr-1',
      type: 'ocrNode',
      position: { x: 0, y: 100 },
      data: {
        kind: 'ocr',
        title: 'Badge OCR',
        extractedText: 'SECTOR 7 VISITOR',
      },
    },
    {
      id: 'chat-1',
      type: 'chatNode',
      position: { x: 0, y: 200 },
      data: {
        kind: 'chat',
        title: 'Witness Thread',
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            content: 'Subject wears wire-rimmed glasses and a navy cap.',
            timestamp: '10:15',
          },
        ],
      },
    },
    {
      id: 'suspect-1',
      type: 'suspectNode',
      position: { x: 400, y: 100 },
      data: {
        kind: 'suspect',
        title: 'Suspect Composite 1',
        descriptionPrompt: 'Tall individual',
        suspectImageUrl: null,
      },
    },
  ];

  const edges: Edge[] = [
    {
      id: 'e1',
      source: 'img-1',
      target: 'suspect-1',
      sourceHandle: HANDLE_IDS.IMAGE_RIGHT_OUT,
      targetHandle: HANDLE_IDS.SUSPECT_IN,
    },
    {
      id: 'e2',
      source: 'ocr-1',
      target: 'suspect-1',
      sourceHandle: HANDLE_IDS.OCR_OUT,
      targetHandle: HANDLE_IDS.SUSPECT_IN,
    },
    {
      id: 'e3',
      source: 'chat-1',
      target: 'suspect-1',
      sourceHandle: HANDLE_IDS.CHAT_RESULT_OUT,
      targetHandle: HANDLE_IDS.SUSPECT_IN,
    },
  ];

  const resolved = resolveSuspectContextForNode('suspect-1', nodes, edges);
  assert.equal(resolved.items.length, 3);
  assert.equal(resolved.imageUrls.length, 1);
  assert.equal(resolved.imageUrls[0]?.title, 'CCTV Gate Frame');
  assert.match(resolved.combinedContextText, /CCTV Gate Frame/);
  assert.match(resolved.combinedContextText, /SECTOR 7 VISITOR/);
  assert.match(
    resolved.combinedContextText,
    /Subject wears wire-rimmed glasses and a navy cap/,
  );
});

test('builds OpenAI DALL-E 3 request and server proxy payload for Google Imagen 3 and OpenAI', () => {
  assert.equal(IMAGEN_MODEL_ID, 'imagen-3.0-generate-001');
  assert.equal(DALLE_MODEL_ID, 'dall-e-3');

  const dalleSpec = buildOpenAiDalleRequest({
    apiKey: 'sk-openai-secret',
    prompt: 'Generate a highly realistic forensic composite image...',
  });
  assert.equal(dalleSpec.url, OPENAI_IMAGES_ENDPOINT);
  assert.equal(dalleSpec.headers.Authorization, 'Bearer sk-openai-secret');
  assert.equal(dalleSpec.body.model, 'dall-e-3');
  assert.equal(dalleSpec.body.response_format, 'b64_json');

  assert.equal(
    extractOpenAiDalleImageUrl({ data: [{ b64_json: 'BASE64PNG' }] }),
    'data:image/png;base64,BASE64PNG',
  );
  assert.equal(
    extractOpenAiDalleImageUrl({ data: [{ url: 'https://example.com/img.png' }] }),
    'https://example.com/img.png',
  );

  const serverSpec = buildServerImageGenerationRequest({
    provider: 'google',
    prompt: 'Generate a highly realistic forensic composite image...',
    images: [{ mimeType: 'image/png', data: 'AAA' }],
  });
  assert.equal(serverSpec.url, SERVER_IMAGE_GENERATE_ENDPOINT);
  assert.equal(serverSpec.body.provider, 'google');
  assert.equal(serverSpec.body.images.length, 1);
});
