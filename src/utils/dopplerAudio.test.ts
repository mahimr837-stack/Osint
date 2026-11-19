import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDopplerCsv,
  computeDopplerSpectrogram,
  DOPPLER_GUIDANCE_NOTE,
  extractPeakFrequencySeries,
  isAcceptedDopplerFile,
  normalizeUtcTimestampHeader,
} from './dopplerAudio';

test('isAcceptedDopplerFile accepts mp4, wav, and mp3 files and rejects images/text', () => {
  assert.equal(isAcceptedDopplerFile({ name: 'overflight.wav', type: 'audio/wav' }), true);
  assert.equal(isAcceptedDopplerFile({ name: 'flyover.mp3', type: 'audio/mpeg' }), true);
  assert.equal(isAcceptedDopplerFile({ name: 'plane.MP4', type: 'video/mp4' }), true);
  assert.equal(isAcceptedDopplerFile({ name: 'photo.jpg', type: 'image/jpeg' }), false);
});

test('computeDopplerSpectrogram and extractPeakFrequencySeries detect synthetic Doppler shift curve', () => {
  const sampleRate = 8000;
  const durationSec = 2;
  const totalSamples = sampleRate * durationSec;
  const samples = new Float32Array(totalSamples);

  // First half: ~440 Hz; second half: ~220 Hz (simulating falling Doppler shift)
  let phase = 0;
  for (let i = 0; i < totalSamples; i += 1) {
    const freq = i < totalSamples / 2 ? 440 : 220;
    phase += (2 * Math.PI * freq) / sampleRate;
    samples[i] = Math.sin(phase);
  }

  const spectrogram = computeDopplerSpectrogram({
    samples,
    sampleRate,
    maxFreqHz: 1000,
    targetColumns: 20,
  });

  assert.equal(spectrogram.maxFreqHz, 1000);
  assert.ok(spectrogram.columns.length >= 10);

  const peaks = extractPeakFrequencySeries(spectrogram);
  assert.equal(peaks.length, spectrogram.columns.length);

  const firstPeak = peaks[1];
  const lastPeak = peaks[peaks.length - 2];
  assert.ok(
    Math.abs(firstPeak.frequencyHz - 440) <= 25,
    `Expected early peak near 440 Hz, got ${firstPeak.frequencyHz}`,
  );
  assert.ok(
    Math.abs(lastPeak.frequencyHz - 220) <= 25,
    `Expected late peak near 220 Hz, got ${lastPeak.frequencyHz}`,
  );
});

test('normalizeUtcTimestampHeader and buildDopplerCsv format UTC header and time_ms,frequency_hz rows', () => {
  assert.equal(
    normalizeUtcTimestampHeader('2026-11-16T03:58'),
    '2026-11-16T03:58:00Z',
  );
  assert.equal(
    normalizeUtcTimestampHeader('2026-11-16T03:58:42'),
    '2026-11-16T03:58:42Z',
  );

  const csv = buildDopplerCsv({
    utcStartTime: '2026-11-16T03:58:42',
    fileName: 'flyover.wav',
    series: [
      { timeMs: 120, frequencyHz: 438.28, magnitude: 0.42 },
      { timeMs: 360, frequencyHz: 218.75, magnitude: 0.39 },
    ],
  });

  assert.match(csv, /^# recording_start_utc: 2026-11-16T03:58:42Z/m);
  assert.match(csv, /^# source_file: flyover\.wav/m);
  assert.match(csv, /^time_ms,frequency_hz$/m);
  assert.match(csv, /^120,438\.28$/m);
  assert.match(csv, /^360,218\.75$/m);
  assert.equal(
    DOPPLER_GUIDANCE_NOTE,
    'Look for a falling S-shaped curve in the 50-600 Hz range. This is a plane passing overhead.',
  );
});
