import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectImageBufferWithFileType,
  isPublicHttpImageUrl,
  isValidImageFileType,
  resolveReverseSearchAction,
  REVERSE_SEARCH_ENGINES,
} from './reverseSearch';

test('inspectImageBufferWithFileType validates PNG/JPEG magic bytes and rejects non-images', async () => {
  // Minimal PNG header bytes (8-byte PNG signature + IHDR chunk)
  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
  const pngResult = await inspectImageBufferWithFileType(pngBytes);
  assert.deepEqual(pngResult, {
    valid: true,
    ext: 'png',
    mime: 'image/png',
  });

  // Plain ASCII text is not an image
  const textBytes = new TextEncoder().encode('Hello OSINT world');
  const textResult = await inspectImageBufferWithFileType(textBytes);
  assert.equal(textResult.valid, false);
  assert.equal(textResult.mime, null);

  // Non-image binary (PDF header) is rejected
  const pdfBytes = new TextEncoder().encode('%PDF-1.7\n');
  const pdfResult = await inspectImageBufferWithFileType(pdfBytes);
  assert.equal(pdfResult.valid, false);
  assert.equal(pdfResult.mime, 'application/pdf');
});

test('isValidImageFileType accepts image/* MIME types only', () => {
  assert.equal(isValidImageFileType({ ext: 'jpg', mime: 'image/jpeg' }), true);
  assert.equal(isValidImageFileType({ ext: 'webp', mime: 'image/webp' }), true);
  assert.equal(isValidImageFileType({ ext: 'pdf', mime: 'application/pdf' }), false);
  assert.equal(isValidImageFileType(undefined), false);
});

test('isPublicHttpImageUrl distinguishes public URLs from local/blob/data URLs', () => {
  assert.equal(isPublicHttpImageUrl('https://example.com/photo.jpg'), true);
  assert.equal(isPublicHttpImageUrl('http://cdn.site.org/frame.png'), true);
  assert.equal(isPublicHttpImageUrl('data:image/png;base64,iVBORw0='), false);
  assert.equal(isPublicHttpImageUrl('blob:http://localhost:3000/1234-5678'), false);
  assert.equal(isPublicHttpImageUrl('/src/assets/images/sample.jpg'), false);
  assert.equal(isPublicHttpImageUrl('http://localhost:3000/test.jpg'), false);
  assert.equal(isPublicHttpImageUrl('http://127.0.0.1:8080/test.jpg'), false);
});

test('resolveReverseSearchAction builds direct search URLs for public images and clipboard+homepage fallback for local images', () => {
  assert.deepEqual(
    REVERSE_SEARCH_ENGINES.map((e) => e.buttonLabel),
    ['Search on Google Lens', 'Search on Yandex', 'Search on TinEye'],
  );

  const remoteUrl = 'https://images.example.com/port-view.jpg';
  const lensRemote = resolveReverseSearchAction('google-lens', remoteUrl);
  assert.equal(lensRemote.mode, 'direct-url');
  assert.equal(
    lensRemote.targetUrl,
    `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(remoteUrl)}`,
  );

  const yandexRemote = resolveReverseSearchAction('yandex', remoteUrl);
  assert.equal(yandexRemote.mode, 'direct-url');
  assert.equal(
    yandexRemote.targetUrl,
    `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(remoteUrl)}`,
  );

  const tineyeRemote = resolveReverseSearchAction('tineye', remoteUrl);
  assert.equal(tineyeRemote.mode, 'direct-url');
  assert.equal(
    tineyeRemote.targetUrl,
    `https://tineye.com/search?url=${encodeURIComponent(remoteUrl)}`,
  );

  // Local data URL -> clipboard + homepage fallback
  const localDataUrl = 'data:image/png;base64,abc123';
  const lensLocal = resolveReverseSearchAction('google-lens', localDataUrl);
  assert.deepEqual(lensLocal, {
    engine: 'google-lens',
    engineName: 'Google Lens',
    mode: 'clipboard-homepage',
    targetUrl: 'https://lens.google.com/',
  });

  const yandexLocal = resolveReverseSearchAction('yandex', '/src/assets/sample.jpg');
  assert.deepEqual(yandexLocal, {
    engine: 'yandex',
    engineName: 'Yandex',
    mode: 'clipboard-homepage',
    targetUrl: 'https://yandex.com/images/',
  });

  const tineyeLocal = resolveReverseSearchAction('tineye', 'blob:http://localhost:3000/abc');
  assert.deepEqual(tineyeLocal, {
    engine: 'tineye',
    engineName: 'TinEye',
    mode: 'clipboard-homepage',
    targetUrl: 'https://tineye.com/',
  });
});
