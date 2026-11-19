import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeElaBuffer,
  computeElaDimensions,
  ELA_AMPLIFICATION_FACTOR,
  ELA_JPEG_QUALITY,
} from './forensicsEla';

test('uses expected default ELA parameters (90% JPEG quality, 15x amplification)', () => {
  assert.equal(ELA_JPEG_QUALITY, 0.9);
  assert.equal(ELA_AMPLIFICATION_FACTOR, 15);
});

test('computeElaDimensions preserves standard image dimensions and clamps oversized frames', () => {
  assert.deepEqual(computeElaDimensions(800, 600), {
    width: 800,
    height: 600,
    wasScaled: false,
  });

  assert.deepEqual(computeElaDimensions(3200, 1600, 1600), {
    width: 1600,
    height: 800,
    wasScaled: true,
  });
});

test('computeElaBuffer calculates absolute difference amplified by 15x and surfaces tampering spots', () => {
  // 2x1 image (2 pixels, RGBA)
  // Pixel 0: identical between original and recompressed -> [0, 0, 0, 255]
  // Pixel 1: differs by [10, 20, 5] -> amplified 15x => [150, 255 (clamped from 300), 75, 255]
  const original = new Uint8ClampedArray([
    100, 120, 140, 255,
    200, 180, 90, 255,
  ]);
  const recompressed = new Uint8ClampedArray([
    100, 120, 140, 255,
    190, 200, 85, 255,
  ]);

  const result = computeElaBuffer(original, recompressed, 2, 1, 15);

  assert.deepEqual(Array.from(result.elaData), [
    0, 0, 0, 255,
    150, 255, 75, 255,
  ]);
  assert.equal(result.maxChannelDiff, 20);
  // Sum of diffs = 0+0+0 + 10+20+5 = 35 across 6 RGB samples => 5.83
  assert.equal(result.meanChannelDiff, 5.83);
});

test('computeElaBuffer highlights high-error tampered pixel as bright white and validates buffer size', () => {
  const original = new Uint8ClampedArray([255, 255, 255, 128]);
  const recompressed = new Uint8ClampedArray([230, 230, 230, 255]);

  const result = computeElaBuffer(original, recompressed, 1, 1);
  // |255 - 230| * 15 = 375 -> clamped to 255 white with opaque alpha
  assert.deepEqual(Array.from(result.elaData), [255, 255, 255, 255]);

  assert.throws(
    () => computeElaBuffer(new Uint8ClampedArray(4), new Uint8ClampedArray(4), 2, 2),
    /smaller than expected/,
  );
});
