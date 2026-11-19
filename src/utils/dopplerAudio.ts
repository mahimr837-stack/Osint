export const DOPPLER_MAX_FREQUENCY_HZ = 1000;
export const DOPPLER_GUIDANCE_NOTE =
  'Look for a falling S-shaped curve in the 50-600 Hz range. This is a plane passing overhead.';

const ACCEPTED_DOPPLER_EXTENSIONS = ['.mp4', '.wav', '.mp3'];
const ACCEPTED_DOPPLER_MIMES = new Set([
  'video/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mpeg',
  'audio/mp3',
]);

export function isAcceptedDopplerFile(file: {
  name: string;
  type: string;
}): boolean {
  const mime = file.type.trim().toLowerCase();
  if (ACCEPTED_DOPPLER_MIMES.has(mime)) return true;
  if (mime.startsWith('audio/')) return true;
  const lowerName = file.name.trim().toLowerCase();
  return ACCEPTED_DOPPLER_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

/**
 * Normalizes a datetime-local or ISO string to an explicit UTC ISO-8601 timestamp (YYYY-MM-DDTHH:MM:SSZ).
 */
export function normalizeUtcTimestampHeader(rawUtcInput: string): string {
  const trimmed = rawUtcInput.trim();
  if (!trimmed) {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  // Handle datetime-local like "2026-11-16T03:58" or "2026-11-16T03:58:12"
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}Z`;
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  return trimmed;
}

export function defaultUtcInputValue(date = new Date()): string {
  return date.toISOString().slice(0, 19);
}

/**
 * In-place radix-2 Cooley-Tukey FFT returning magnitude spectrum for bins 0..N/2.
 */
export function computeFftMagnitudes(
  samples: Float32Array,
): Float32Array {
  const n = samples.length;
  if (n === 0 || (n & (n - 1)) !== 0) {
    throw new Error('FFT input length must be a non-zero power of 2.');
  }

  const real = new Float32Array(n);
  const imag = new Float32Array(n);

  // Apply Hann window to minimize spectral leakage in low-frequency bands
  for (let i = 0; i < n; i += 1) {
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    real[i] = samples[i] * hann;
  }

  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < n; i += 1) {
    let bit = n >> 1;
    while ((j & bit) !== 0) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;
    }
  }

  // Iterative FFT butterfly stages
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepRe = Math.cos(angle);
    const wStepIm = Math.sin(angle);

    for (let start = 0; start < n; start += len) {
      let wRe = 1;
      let wIm = 0;
      for (let k = 0; k < half; k += 1) {
        const evenIdx = start + k;
        const oddIdx = evenIdx + half;
        const tRe = wRe * real[oddIdx] - wIm * imag[oddIdx];
        const tIm = wRe * imag[oddIdx] + wIm * real[oddIdx];

        real[oddIdx] = real[evenIdx] - tRe;
        imag[oddIdx] = imag[evenIdx] - tIm;
        real[evenIdx] += tRe;
        imag[evenIdx] += tIm;

        const nextWRe = wRe * wStepRe - wIm * wStepIm;
        wIm = wRe * wStepIm + wIm * wStepRe;
        wRe = nextWRe;
      }
    }
  }

  const bins = n >> 1;
  const magnitudes = new Float32Array(bins + 1);
  for (let k = 0; k <= bins; k += 1) {
    magnitudes[k] = Math.hypot(real[k], imag[k]) / n;
  }
  return magnitudes;
}

export interface DopplerSpectrogramColumn {
  timeMs: number;
  bins: number[]; // magnitudes from 0 Hz up to maxFreqHz
}

export interface DopplerSpectrogramData {
  sampleRate: number;
  durationSec: number;
  fftSize: number;
  maxFreqHz: number;
  binStepHz: number;
  freqBinCount: number;
  maxMagnitude: number;
  columns: DopplerSpectrogramColumn[];
}

export interface DopplerPeakPoint {
  timeMs: number;
  frequencyHz: number;
  magnitude: number;
}

/**
 * Computes a time-frequency spectrogram over [0, maxFreqHz] from mono PCM audio samples.
 */
export function computeDopplerSpectrogram(params: {
  samples: Float32Array;
  sampleRate: number;
  maxFreqHz?: number;
  targetColumns?: number;
}): DopplerSpectrogramData {
  const {
    samples,
    sampleRate,
    maxFreqHz = DOPPLER_MAX_FREQUENCY_HZ,
    targetColumns = 140,
  } = params;

  if (samples.length === 0 || sampleRate <= 0) {
    throw new Error('Decoded audio buffer contains no PCM samples.');
  }

  const fftSize = sampleRate >= 22050 ? 4096 : 1024;
  const effectiveMaxHz = Math.min(maxFreqHz, sampleRate / 2);
  const binStepHz = sampleRate / fftSize;
  const freqBinCount = Math.max(2, Math.floor(effectiveMaxHz / binStepHz) + 1);
  const durationSec = samples.length / sampleRate;

  const columnCount = Math.max(
    1,
    Math.min(targetColumns, Math.max(1, Math.floor(samples.length / 256))),
  );
  const hopSamples =
    columnCount > 1
      ? Math.max(1, Math.floor((samples.length - Math.min(samples.length, fftSize)) / (columnCount - 1)))
      : 0;

  const columns: DopplerSpectrogramColumn[] = [];
  let maxMagnitude = 0;

  const windowBuffer = new Float32Array(fftSize);
  for (let c = 0; c < columnCount; c += 1) {
    const startSample =
      columnCount === 1
        ? 0
        : Math.min(c * hopSamples, Math.max(0, samples.length - fftSize));

    windowBuffer.fill(0);
    const copyLen = Math.min(fftSize, samples.length - startSample);
    for (let i = 0; i < copyLen; i += 1) {
      windowBuffer[i] = samples[startSample + i];
    }

    const spectrum = computeFftMagnitudes(windowBuffer);
    const bins: number[] = new Array(freqBinCount);
    for (let b = 0; b < freqBinCount; b += 1) {
      const mag = spectrum[b] ?? 0;
      bins[b] = mag;
      if (mag > maxMagnitude) {
        maxMagnitude = mag;
      }
    }

    const centerSample = startSample + Math.min(copyLen, fftSize) / 2;
    const timeMs = Math.round((centerSample / sampleRate) * 1000);
    columns.push({ timeMs, bins });
  }

  return {
    sampleRate,
    durationSec,
    fftSize,
    maxFreqHz: effectiveMaxHz,
    binStepHz,
    freqBinCount,
    maxMagnitude: maxMagnitude > 0 ? maxMagnitude : 1,
    columns,
  };
}

/**
 * Extracts the highest-amplitude frequency (Hz) at each spectrogram timestamp.
 */
export function extractPeakFrequencySeries(
  spectrogram: DopplerSpectrogramData,
  minHz = 20,
): DopplerPeakPoint[] {
  const minBin = Math.max(
    1,
    Math.ceil(minHz / Math.max(spectrogram.binStepHz, 0.0001)),
  );

  return spectrogram.columns.map((col) => {
    let bestBin = Math.min(minBin, col.bins.length - 1);
    let bestMag = -1;

    for (let b = bestBin; b < col.bins.length; b += 1) {
      const val = col.bins[b] ?? 0;
      if (val > bestMag) {
        bestMag = val;
        bestBin = b;
      }
    }

    return {
      timeMs: col.timeMs,
      frequencyHz: Number((bestBin * spectrogram.binStepHz).toFixed(2)),
      magnitude: Math.max(0, bestMag),
    };
  });
}

/**
 * Formats extracted dominant frequencies and UTC recording timestamp into a CSV string.
 */
export function buildDopplerCsv(params: {
  utcStartTime: string;
  series: DopplerPeakPoint[];
  fileName?: string | null;
}): string {
  const normalizedUtc = normalizeUtcTimestampHeader(params.utcStartTime);
  const lines: string[] = [
    `# recording_start_utc: ${normalizedUtc}`,
  ];
  if (params.fileName) {
    lines.push(`# source_file: ${params.fileName}`);
  }
  lines.push('time_ms,frequency_hz');
  for (const point of params.series) {
    lines.push(`${point.timeMs},${point.frequencyHz}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Mixes an AudioBuffer-like channel collection down to mono Float32Array.
 */
export function mixChannelsToMono(
  channels: readonly Float32Array[],
): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const length = channels[0].length;
  const mono = new Float32Array(length);
  const scale = 1 / channels.length;
  for (let ch = 0; ch < channels.length; ch += 1) {
    const src = channels[ch];
    for (let i = 0; i < length; i += 1) {
      mono[i] += src[i] * scale;
    }
  }
  return mono;
}
