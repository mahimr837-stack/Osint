import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import type { VideoExtractedFrame } from '../types/osint';
import {
  clampTimestamp,
  formatVideoTimestamp,
} from './videoFramesHelpers';

export * from './videoFramesHelpers';

const MAX_CAPTURE_DIMENSION = 1280;
const FFMPEG_CORE_BASE_URL =
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;

/**
 * Loads the WebAssembly FFmpeg instance lazily when needed as a fallback
 * for video containers/codecs (such as certain .mov streams) that the browser
 * <video> element cannot natively decode.
 */
export async function getBrowserFfmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }
  if (!ffmpegLoadPromise) {
    ffmpegLoadPromise = (async () => {
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: `${FFMPEG_CORE_BASE_URL}/ffmpeg-core.js`,
        wasmURL: `${FFMPEG_CORE_BASE_URL}/ffmpeg-core.wasm`,
      });
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })().catch((error) => {
      ffmpegLoadPromise = null;
      throw error;
    });
  }
  return ffmpegLoadPromise;
}

/**
 * Transcodes a non-browser-playable video (e.g. ProRes/HEVC .mov) into an MP4
 * Blob URL using @ffmpeg/ffmpeg and @ffmpeg/util so <video> + <canvas> can seek it.
 */
export async function transcodeVideoToPlayableMp4(file: File): Promise<string> {
  const ffmpeg = await getBrowserFfmpeg();
  const inputName = file.name.toLowerCase().endsWith('.mov') ? 'input.mov' : 'input.mp4';
  const outputName = 'playable.mp4';

  await ffmpeg.writeFile(inputName, await fetchFile(file));
  await ffmpeg.exec([
    '-i',
    inputName,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-an',
    outputName,
  ]);
  const outputData = await ffmpeg.readFile(outputName);
  const bytes =
    outputData instanceof Uint8Array
      ? new Uint8Array(outputData)
      : new TextEncoder().encode(String(outputData));
  const blob = new Blob([bytes], { type: 'video/mp4' });
  return URL.createObjectURL(blob);
}

function waitForVideoSeek(
  video: HTMLVideoElement,
  targetTime: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out seeking video to ${targetTime.toFixed(2)}s.`));
    }, 6000);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };

    const onSeeked = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Failed to decode video frame during seek.'));
    };

    if (
      Math.abs(video.currentTime - targetTime) < 0.02 &&
      video.readyState >= 2
    ) {
      cleanup();
      resolve();
      return;
    }

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = targetTime;
  });
}

/**
 * Seeks the browser's <video> element to a specific timestamp and draws the
 * frame onto an HTML <canvas>, returning a base64 JPEG data URL.
 */
export async function captureVideoFrameWithCanvas(
  video: HTMLVideoElement,
  requestedTimestamp: number,
  canvasEl?: HTMLCanvasElement | null,
): Promise<VideoExtractedFrame> {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error('Video dimensions are not available yet.');
  }

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const timestamp = clampTimestamp(requestedTimestamp, duration);
  await waitForVideoSeek(video, timestamp);

  // Allow browser compositor one micro-tick after seeked for decoded frame paint
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

  const srcWidth = video.videoWidth;
  const srcHeight = video.videoHeight;
  const scale = Math.min(
    1,
    MAX_CAPTURE_DIMENSION / Math.max(srcWidth, srcHeight),
  );
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));

  const canvas = canvasEl ?? document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not acquire 2D canvas context to capture video frame.');
  }

  ctx.drawImage(video, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const label = formatVideoTimestamp(timestamp);

  return {
    id: `frame-${Math.round(timestamp * 100)}-${Date.now().toString(36)}`,
    timestamp,
    label,
    dataUrl,
    width,
    height,
  };
}

/**
 * Sequentially seeks the <video> element across a list of timestamps and
 * captures each frame onto the supplied HTML <canvas> as base64 thumbnails.
 */
export async function extractVideoFrameGrid(
  video: HTMLVideoElement,
  timestamps: number[],
  canvasEl?: HTMLCanvasElement | null,
  isCancelled?: () => boolean,
): Promise<VideoExtractedFrame[]> {
  const frames: VideoExtractedFrame[] = [];
  for (const ts of timestamps) {
    if (isCancelled?.()) break;
    const frame = await captureVideoFrameWithCanvas(video, ts, canvasEl);
    frames.push(frame);
  }
  return frames;
}
