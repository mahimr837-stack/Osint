import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clientPointToContainerPoint,
  formatCroppedNodeTitle,
  mapDisplaySelectionToSourceRect,
  normalizeSelectionRect,
} from './imageCrop';

test('clientPointToContainerPoint compensates for React Flow zoom scale', () => {
  // Container is 240x180 in local CSS pixels, rendered at 0.5x zoom (120x90 on screen)
  const mapped = clientPointToContainerPoint(160, 145, {
    left: 100,
    top: 100,
    width: 120,
    height: 90,
    localWidth: 240,
    localHeight: 180,
  });

  assert.deepEqual(mapped, {
    point: { x: 120, y: 90 },
    width: 240,
    height: 180,
  });
});

test('normalizeSelectionRect handles reverse drags and clamps to container bounds', () => {
  const rect = normalizeSelectionRect(
    { x: 180, y: 120 },
    { x: -10, y: 200 },
    240,
    180,
  );
  assert.deepEqual(rect, { x: 0, y: 120, width: 180, height: 60 });
});

test('mapDisplaySelectionToSourceRect accounts for object-cover cropping on wide images', () => {
  // Natural 1600x800 (2:1) displayed inside 240x180 (4:3) with object-cover:
  // scale = max(240/1600, 180/800) = 0.225 -> rendered 360x180, offsetX = -60
  const crop = mapDisplaySelectionToSourceRect({
    selection: { x: 60, y: 45, width: 120, height: 90 },
    containerWidth: 240,
    containerHeight: 180,
    naturalWidth: 1600,
    naturalHeight: 800,
  });

  assert.deepEqual(crop, {
    sx: 533,
    sy: 200,
    sWidth: 534,
    sHeight: 400,
  });
});

test('mapDisplaySelectionToSourceRect rejects tiny or zero-area selections', () => {
  assert.equal(
    mapDisplaySelectionToSourceRect({
      selection: { x: 10, y: 10, width: 1, height: 40 },
      containerWidth: 240,
      containerHeight: 180,
      naturalWidth: 800,
      naturalHeight: 600,
    }),
    null,
  );
});

test('formatCroppedNodeTitle prefixes Cropped: cleanly without duplicating', () => {
  assert.equal(
    formatCroppedNodeTitle('Container ISO Detail'),
    'Cropped: Container ISO Detail',
  );
  assert.equal(
    formatCroppedNodeTitle('Cropped: Port Aerial'),
    'Cropped: Port Aerial',
  );
  assert.equal(formatCroppedNodeTitle('   '), 'Cropped: Untitled Image');
});
