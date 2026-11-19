export type EnhanceScaleFactor = 2 | 4;

export interface UpscaleDimensions {
  width: number;
  height: number;
  appliedScale: number;
}

/**
 * Computes safe target dimensions for 2x or 4x local upscaling while clamping
 * extreme source sizes so browser canvas memory stays bounded.
 */
export function computeUpscaleDimensions(
  sourceWidth: number,
  sourceHeight: number,
  scale: EnhanceScaleFactor,
  maxEdge = 4096,
): UpscaleDimensions {
  const safeW = Math.max(1, Math.round(sourceWidth));
  const safeH = Math.max(1, Math.round(sourceHeight));
  const desiredW = safeW * scale;
  const desiredH = safeH * scale;
  const longest = Math.max(desiredW, desiredH);

  if (longest <= maxEdge) {
    return {
      width: desiredW,
      height: desiredH,
      appliedScale: scale,
    };
  }

  const ratio = maxEdge / longest;
  const clampedW = Math.max(1, Math.round(desiredW * ratio));
  const clampedH = Math.max(1, Math.round(desiredH * ratio));
  const appliedScale = Number((clampedW / safeW).toFixed(2));

  return {
    width: clampedW,
    height: clampedH,
    appliedScale,
  };
}

/**
 * Applies a 3x3 sharpening convolution kernel to an RGBA pixel buffer.
 * Kernel weights:
 *   [  0,       -strength,      0     ]
 *   [ -strength, 1 + 4*strength, -strength ]
 *   [  0,       -strength,      0     ]
 * Preserves edge pixels and alpha values without mutating the source buffer.
 */
export function applySharpenToRgbaBuffer(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  strength = 0.55,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(src.length);
  output.set(src);

  if (width < 3 || height < 3 || strength <= 0) {
    return output;
  }

  const centerWeight = 1 + 4 * strength;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const upIdx = ((y - 1) * width + x) * 4;
      const downIdx = ((y + 1) * width + x) * 4;
      const leftIdx = (y * width + (x - 1)) * 4;
      const rightIdx = (y * width + (x + 1)) * 4;

      for (let c = 0; c < 3; c++) {
        const value =
          src[idx + c] * centerWeight -
          (src[upIdx + c] + src[downIdx + c] + src[leftIdx + c] + src[rightIdx + c]) *
            strength;

        output[idx + c] = value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
      }
      output[idx + 3] = src[idx + 3];
    }
  }

  return output;
}

export interface LocalEnhanceResult {
  enhancedImageUrl: string;
  sourceDimensions: string;
  outputDimensions: string;
  appliedScale: number;
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:') && !src.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load source image into local canvas.'));
    img.src = src;
  });
}

/**
 * Upscales an image by 2x or 4x locally via progressive high-quality HTML5 canvas
 * resampling followed by a 3x3 sharpening convolution pass.
 */
export async function upscaleAndSharpenImage(
  imageUrl: string,
  scale: EnhanceScaleFactor,
): Promise<LocalEnhanceResult> {
  const img = await loadHtmlImage(imageUrl);
  const srcWidth = img.naturalWidth || img.width;
  const srcHeight = img.naturalHeight || img.height;

  if (!srcWidth || !srcHeight) {
    throw new Error('Source image reported zero dimensions.');
  }

  const target = computeUpscaleDimensions(srcWidth, srcHeight, scale);

  // Progressive 2x pass when targeting 4x produces cleaner detail than a single jump
  let workingCanvas = document.createElement('canvas');
  let workingWidth = srcWidth;
  let workingHeight = srcHeight;
  workingCanvas.width = workingWidth;
  workingCanvas.height = workingHeight;

  const initCtx = workingCanvas.getContext('2d');
  if (!initCtx) {
    throw new Error('2D canvas context unavailable in this browser.');
  }
  initCtx.drawImage(img, 0, 0, srcWidth, srcHeight);

  if (scale === 4 && target.width > srcWidth * 2) {
    const midWidth = Math.min(srcWidth * 2, target.width);
    const midHeight = Math.min(srcHeight * 2, target.height);
    const midCanvas = document.createElement('canvas');
    midCanvas.width = midWidth;
    midCanvas.height = midHeight;
    const midCtx = midCanvas.getContext('2d');
    if (midCtx) {
      midCtx.imageSmoothingEnabled = true;
      midCtx.imageSmoothingQuality = 'high';
      midCtx.drawImage(workingCanvas, 0, 0, midWidth, midHeight);
      workingCanvas = midCanvas;
      workingWidth = midWidth;
      workingHeight = midHeight;
    }
  }

  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = target.width;
  finalCanvas.height = target.height;
  const finalCtx = finalCanvas.getContext('2d');
  if (!finalCtx) {
    throw new Error('2D canvas context unavailable for enhancement pass.');
  }

  finalCtx.imageSmoothingEnabled = true;
  finalCtx.imageSmoothingQuality = 'high';
  finalCtx.drawImage(
    workingCanvas,
    0,
    0,
    workingWidth,
    workingHeight,
    0,
    0,
    target.width,
    target.height,
  );

  const imageData = finalCtx.getImageData(0, 0, target.width, target.height);
  const sharpened = applySharpenToRgbaBuffer(
    imageData.data,
    target.width,
    target.height,
    scale === 4 ? 0.65 : 0.5,
  );
  imageData.data.set(sharpened);
  finalCtx.putImageData(imageData, 0, 0);

  return {
    enhancedImageUrl: finalCanvas.toDataURL('image/png'),
    sourceDimensions: `${srcWidth} × ${srcHeight}`,
    outputDimensions: `${target.width} × ${target.height}`,
    appliedScale: target.appliedScale,
  };
}
