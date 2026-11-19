import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVideoFrameTitle,
  clampTimestamp,
  computeIntervalTimestamps,
  formatVideoTimestamp,
  isAcceptedVideoFile,
  mergeExtractedFrame,
} from './videoFramesHelpers';

test('formats seconds into clean tabular video timestamps', () => {
  assert.equal(formatVideoTimestamp(0), '00:00');
  assert.equal(formatVideoTimestamp(5), '00:05');
  assert.equal(formatVideoTimestamp(5.5), '00:05.5');
  assert.equal(formatVideoTimestamp(75), '01:15');
  assert.equal(formatVideoTimestamp(3661), '1:01:01');
  assert.equal(formatVideoTimestamp(-3), '00:00');
});

test('clamps requested timestamps safely within video duration', () => {
  assert.equal(clampTimestamp(-2, 10), 0);
  assert.equal(clampTimestamp(4.25, 10), 4.25);
  assert.equal(clampTimestamp(12, 10), 9.99);
  assert.equal(clampTimestamp(2, 0), 0);
});

test('computes interval timestamps for 1s and 5s steps with frame cap', () => {
  assert.deepEqual(computeIntervalTimestamps(4, 1), [0, 1, 2, 3, 3.99]);
  assert.deepEqual(computeIntervalTimestamps(15, 5), [0, 5, 10, 14.99]);

  const capped = computeIntervalTimestamps(120, 1, 12);
  assert.equal(capped.length, 12);
  assert.equal(capped[0], 0);
  assert.ok(capped[capped.length - 1] > 110);
});

test('accepts mp4 and mov video files by MIME type or extension', () => {
  assert.equal(isAcceptedVideoFile({ name: 'dashcam.mp4', type: 'video/mp4' }), true);
  assert.equal(isAcceptedVideoFile({ name: 'street.mov', type: 'video/quicktime' }), true);
  assert.equal(isAcceptedVideoFile({ name: 'drone.MOV', type: '' }), true);
  assert.equal(isAcceptedVideoFile({ name: 'document.pdf', type: 'application/pdf' }), false);
  assert.equal(isAcceptedVideoFile({ name: 'photo.jpg', type: 'image/jpeg' }), false);
});

test('builds descriptive ImageNode titles and merges frames chronologically without near-duplicates', () => {
  assert.equal(buildVideoFrameTitle('harbor_cctv.mp4', 5), 'harbor_cctv @ 00:05');
  assert.equal(buildVideoFrameTitle(null, 12.5), 'Video Frame @ 00:12.5');

  const merged = mergeExtractedFrame(
    [
      { id: 'f1', timestamp: 0, label: '00:00', dataUrl: 'data:image/jpeg;base64,a', width: 640, height: 360 },
      { id: 'f2', timestamp: 5, label: '00:05', dataUrl: 'data:image/jpeg;base64,b', width: 640, height: 360 },
    ],
    { id: 'f3', timestamp: 2, label: '00:02', dataUrl: 'data:image/jpeg;base64,c', width: 640, height: 360 },
  );
  assert.deepEqual(merged.map((f) => f.timestamp), [0, 2, 5]);

  const replaced = mergeExtractedFrame(merged, {
    id: 'f2-new',
    timestamp: 5.01,
    label: '00:05',
    dataUrl: 'data:image/jpeg;base64,updated',
    width: 640,
    height: 360,
  });
  assert.equal(replaced.length, 3);
  assert.equal(replaced[2].id, 'f2-new');
});
