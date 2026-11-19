import type { VideoExtractedFrame } from '../types/osint';

export const VIDEO_INTERVAL_OPTIONS = [1, 2, 5, 10] as const;
export const MAX_AUTO_EXTRACTED_FRAMES = 12;

/**
 * Formats seconds into a clean tabular timestamp string (e.g. 00:05 or 01:12.5).
 */
export function formatVideoTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const roundedTenths = Math.round(seconds * 10) / 10;
  const totalWholeSeconds = Math.floor(roundedTenths);
  const tenths = Math.round((roundedTenths - totalWholeSeconds) * 10);

  const hours = Math.floor(totalWholeSeconds / 3600);
  const mins = Math.floor((totalWholeSeconds % 3600) / 60);
  const secs = totalWholeSeconds % 60;

  const base =
    hours > 0
      ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  return tenths > 0 ? `${base}.${tenths}` : base;
}

/**
 * Clamps a requested timestamp inside [0, duration] rounded to two decimal places.
 */
export function clampTimestamp(timestamp: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
  const safeMax = Math.max(0, duration - 0.01);
  const clamped = Math.min(timestamp, safeMax);
  return Math.round(clamped * 100) / 100;
}

/**
 * Computes evenly spaced timestamps across a video duration for a requested step
 * interval (e.g. every 1s or 5s), capped at maxFrames to keep UI and memory bounded.
 */
export function computeIntervalTimestamps(
  duration: number,
  intervalSeconds: number,
  maxFrames = MAX_AUTO_EXTRACTED_FRAMES,
): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  const step = Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : 1;
  const cap = Math.max(1, Math.floor(maxFrames));

  const rawTimestamps: number[] = [];
  for (let t = 0; t <= duration + 1e-6; t += step) {
    rawTimestamps.push(clampTimestamp(t, duration));
  }

  // Deduplicate clamped timestamps
  const unique: number[] = [];
  for (const t of rawTimestamps) {
    if (unique.length === 0 || Math.abs(t - unique[unique.length - 1]) >= 0.05) {
      unique.push(t);
    }
  }

  if (unique.length <= cap) {
    return unique;
  }

  // Downsample evenly when video duration exceeds maxFrames * intervalSeconds
  const sampled: number[] = [];
  const lastIdx = unique.length - 1;
  for (let i = 0; i < cap; i += 1) {
    const idx = Math.round((i / (cap - 1)) * lastIdx);
    const val = unique[idx];
    if (sampled.length === 0 || Math.abs(val - sampled[sampled.length - 1]) >= 0.05) {
      sampled.push(val);
    }
  }
  return sampled;
}

/**
 * Checks whether a selected File is an accepted MP4/MOV video file.
 */
export function isAcceptedVideoFile(file: {
  name: string;
  type?: string;
}): boolean {
  const mime = (file.type ?? '').toLowerCase();
  if (
    mime === 'video/mp4' ||
    mime === 'video/quicktime' ||
    mime === 'video/x-m4v' ||
    mime.startsWith('video/')
  ) {
    return true;
  }
  const lowerName = file.name.toLowerCase();
  return lowerName.endsWith('.mp4') || lowerName.endsWith('.mov') || lowerName.endsWith('.m4v');
}

/**
 * Generates a concise title for an ImageNode spawned from an extracted video frame.
 */
export function buildVideoFrameTitle(
  fileName: string | null | undefined,
  timestampSeconds: number,
): string {
  const cleanName = fileName?.trim();
  const timeLabel = formatVideoTimestamp(timestampSeconds);
  if (!cleanName) {
    return `Video Frame @ ${timeLabel}`;
  }
  const withoutExt = cleanName.replace(/\.[^.]+$/, '');
  return `${withoutExt} @ ${timeLabel}`;
}

/**
 * Inserts or replaces an extracted frame at a matching timestamp (~50ms tolerance)
 * and keeps all extracted thumbnails ordered chronologically.
 */
export function mergeExtractedFrame(
  existing: VideoExtractedFrame[],
  incoming: VideoExtractedFrame,
): VideoExtractedFrame[] {
  const filtered = existing.filter(
    (frame) => Math.abs(frame.timestamp - incoming.timestamp) >= 0.05,
  );
  return [...filtered, incoming].sort((a, b) => a.timestamp - b.timestamp);
}
