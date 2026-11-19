import * as faceapi from '@vladmandic/face-api';
import {
  FACE_API_CDN_URLS,
  normalizeFaceDetections,
  scaleFaceBoundingBox,
  type FaceBoundingBox,
} from './faceDetectionHelpers';

export {
  FACE_API_CDN_URLS,
  formatFaceCountLabel,
  normalizeFaceDetections,
  scaleFaceBoundingBox,
  type FaceBoundingBox,
} from './faceDetectionHelpers';

let cachedModelsPromise: Promise<string> | null = null;
let loadedCdnUrl: string | null = null;

async function ensureTfBackendReady(): Promise<void> {
  const tfAny = faceapi.tf as unknown as {
    ready?: () => Promise<void>;
    getBackend?: () => string;
    setBackend?: (name: string) => Promise<boolean>;
  };

  if (!tfAny) return;

  try {
    if (typeof tfAny.getBackend === 'function' && !tfAny.getBackend()) {
      if (typeof tfAny.setBackend === 'function') {
        try {
          await tfAny.setBackend('webgl');
        } catch {
          await tfAny.setBackend('cpu');
        }
      }
    }
    if (typeof tfAny.ready === 'function') {
      await tfAny.ready();
    }
  } catch {
    if (typeof tfAny.setBackend === 'function') {
      await tfAny.setBackend('cpu');
      if (typeof tfAny.ready === 'function') {
        await tfAny.ready();
      }
    }
  }
}

export async function ensureFaceModelsLoaded(
  onStage?: (stage: string) => void,
): Promise<string> {
  if (
    loadedCdnUrl &&
    faceapi.nets.tinyFaceDetector.isLoaded &&
    faceapi.nets.faceLandmark68Net.isLoaded
  ) {
    return loadedCdnUrl;
  }

  if (cachedModelsPromise) {
    return cachedModelsPromise;
  }

  cachedModelsPromise = (async () => {
    onStage?.('Initializing TensorFlow backend...');
    await ensureTfBackendReady();

    let lastError: unknown = null;
    for (const cdnUrl of FACE_API_CDN_URLS) {
      try {
        onStage?.('Loading TinyFaceDetector & 68-landmark models from CDN...');
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(cdnUrl),
          faceapi.nets.faceLandmark68Net.loadFromUri(cdnUrl),
        ]);
        loadedCdnUrl = cdnUrl;
        return cdnUrl;
      } catch (err) {
        lastError = err;
      }
    }

    cachedModelsPromise = null;
    throw new Error(
      lastError instanceof Error
        ? `Failed to load face-api CDN models: ${lastError.message}`
        : 'Failed to load face-api CDN models.',
    );
  })();

  return cachedModelsPromise;
}

function loadHtmlImage(imageUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!imageUrl.startsWith('data:') && !imageUrl.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error('Failed to decode connected image for face detection.'));
    img.src = imageUrl;
  });
}

export interface FaceDetectionOutput {
  image: HTMLImageElement;
  boxes: FaceBoundingBox[];
  modelSourceUrl: string;
}

export async function detectFacesInImage(
  imageUrl: string,
  onStage?: (stage: string) => void,
): Promise<FaceDetectionOutput> {
  const [modelSourceUrl, image] = await Promise.all([
    ensureFaceModelsLoaded(onStage),
    loadHtmlImage(imageUrl),
  ]);

  onStage?.('Running face & landmark detection...');

  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 416,
    scoreThreshold: 0.45,
  });

  const results = await faceapi.detectAllFaces(image, options).withFaceLandmarks();
  const boxes = normalizeFaceDetections(results);

  return {
    image,
    boxes,
    modelSourceUrl,
  };
}

export function drawFaceDetectionsOnCanvas(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  boxes: FaceBoundingBox[],
): void {
  const sourceWidth = image.naturalWidth || image.width || 1;
  const sourceHeight = image.naturalHeight || image.height || 1;

  // Keep canvas crisp without excessive memory footprint on large images
  const maxDimension = 960;
  const downscale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const targetWidth = Math.max(1, Math.round(sourceWidth * downscale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * downscale));

  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

  if (boxes.length === 0) return;

  const maxRendered = Math.max(targetWidth, targetHeight);
  const lineWidth = Math.max(2, Math.round(maxRendered * 0.005));
  const fontSize = Math.max(12, Math.round(targetWidth * 0.036));
  const padX = Math.max(5, Math.round(fontSize * 0.35));
  const padY = Math.max(3, Math.round(fontSize * 0.2));

  for (let i = 0; i < boxes.length; i += 1) {
    const scaled = scaleFaceBoundingBox(
      boxes[i],
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
    );

    ctx.save();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(scaled.x, scaled.y, scaled.width, scaled.height);

    const label = `#${i + 1} · ${Math.round(scaled.score * 100)}%`;
    ctx.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    const textMetrics = ctx.measureText(label);
    const tagWidth = textMetrics.width + padX * 2;
    const tagHeight = fontSize + padY * 2;
    const tagY = scaled.y >= tagHeight + 2 ? scaled.y - tagHeight : scaled.y;

    ctx.fillStyle = '#ef4444';
    ctx.fillRect(scaled.x, tagY, tagWidth, tagHeight);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    ctx.fillText(label, scaled.x + padX, tagY + padY);
    ctx.restore();
  }
}
