import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySharpenToRgbaBuffer,
  computeUpscaleDimensions,
} from './imageEnhance';

test('computes 2x and 4x upscale dimensions and clamps oversized frames cleanly', () => {
  assert.deepEqual(computeUpscaleDimensions(640, 480, 2), {
    width: 1280,
    height: 960,
    appliedScale: 2,
  });

  assert.deepEqual(computeUpscaleDimensions(640, 480, 4), {
    width: 2560,
    height: 1920,
    appliedScale: 4,
  });

  // Oversized 3000x2000 at 4x (would be 12000px) clamps longest edge to 4096px
  const clamped = computeUpscaleDimensions(3000, 2000, 4, 4096);
  assert.equal(clamped.width, 4096);
  assert.equal(clamped.height, 2731);
  assert.equal(clamped.appliedScale, 1.37);
});

test('applies 3x3 sharpening convolution kernel while preserving alpha and clamping [0, 255]', () => {
  // 3x3 RGBA image where center pixel is brighter than uniform neighbors
  const src = new Uint8ClampedArray(3 * 3 * 4);
  for (let i = 0; i < 9; i++) {
    const offset = i * 4;
    const v = i === 4 ? 150 : 100;
    src[offset] = v;
    src[offset + 1] = v;
    src[offset + 2] = v;
    src[offset + 3] = 220;
  }

  const out = applySharpenToRgbaBuffer(src, 3, 3, 0.5);
  // Center pixel: 150 * (1 + 4*0.5) - 4 * 100 * 0.5 = 450 - 200 = 250
  const centerIdx = 4 * 4;
  assert.equal(out[centerIdx], 250);
  assert.equal(out[centerIdx + 1], 250);
  assert.equal(out[centerIdx + 2], 250);
  assert.equal(out[centerIdx + 3], 220);

  // Border pixels remain unchanged
  assert.equal(out[0], 100);
  assert.equal(out[3], 220);
});
