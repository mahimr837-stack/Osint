import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FACE_API_CDN_URLS,
  formatFaceCountLabel,
  normalizeFaceDetections,
  scaleFaceBoundingBox,
} from './faceDetectionHelpers';

test('configures primary GitHub weights CDN and fallback CDN', () => {
  assert.equal(
    FACE_API_CDN_URLS[0],
    'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights',
  );
  assert.ok(FACE_API_CDN_URLS.length >= 2);
});

test('formats singular and plural face count labels accurately', () => {
  assert.equal(formatFaceCountLabel(0), '0 faces detected');
  assert.equal(formatFaceCountLabel(1), '1 face detected');
  assert.equal(formatFaceCountLabel(4), '4 faces detected');
  assert.equal(formatFaceCountLabel(-2), '0 faces detected');
});

test('scales bounding boxes cleanly from natural image dimensions to canvas dimensions', () => {
  const scaled = scaleFaceBoundingBox(
    { x: 100, y: 200, width: 300, height: 400, score: 0.92 },
    1000,
    800,
    500,
    400,
  );
  assert.deepEqual(scaled, {
    x: 50,
    y: 100,
    width: 150,
    height: 200,
    score: 0.92,
  });
});

test('normalizes face-api WithFaceLandmarks detection structures cleanly', () => {
  const boxes = normalizeFaceDetections([
    {
      detection: {
        box: { x: 12, y: 24, width: 90, height: 110 },
        score: 0.87,
      },
    },
    {
      box: { x: 0, y: 0, width: 0, height: 10 },
      score: 0.5,
    },
  ]);

  assert.deepEqual(boxes, [
    { x: 12, y: 24, width: 90, height: 110, score: 0.87 },
  ]);
});
