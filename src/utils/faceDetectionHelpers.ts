export const FACE_API_CDN_URLS = [
  'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model',
] as const;

export interface FaceBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

export function formatFaceCountLabel(count: number): string {
  const safeCount = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  return safeCount === 1 ? '1 face detected' : `${safeCount} faces detected`;
}

export function scaleFaceBoundingBox(
  box: FaceBoundingBox,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): FaceBoundingBox {
  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    targetWidth <= 0 ||
    targetHeight <= 0
  ) {
    return { x: 0, y: 0, width: 0, height: 0, score: box.score };
  }
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;
  return {
    x: box.x * scaleX,
    y: box.y * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
    score: box.score,
  };
}

export function normalizeFaceDetections(
  detections: Array<{
    detection?: {
      box: { x: number; y: number; width: number; height: number };
      score?: number;
    };
    box?: { x: number; y: number; width: number; height: number };
    score?: number;
  }>,
): FaceBoundingBox[] {
  return detections
    .map((entry) => {
      const detection = entry.detection ?? entry;
      const box = detection.box;
      if (!box) return null;
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        score: typeof detection.score === 'number' ? detection.score : 1,
      } satisfies FaceBoundingBox;
    })
    .filter((item): item is FaceBoundingBox => item !== null && item.width > 0 && item.height > 0);
}
