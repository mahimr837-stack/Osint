export const ELA_JPEG_QUALITY = 0.9;
export const ELA_AMPLIFICATION_FACTOR = 15;

export interface ElaDimensions {
  width: number;
  height: number;
  wasScaled: boolean;
}

/**
 * Computes safe dimensions for pixel-by-pixel Error Level Analysis while
 * preserving exact 1:1 dimensions for standard web and OSINT evidence frames.
 */
export function computeElaDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxEdge = 1600,
): ElaDimensions {
  const safeW = Math.max(1, Math.round(sourceWidth));
  const safeH = Math.max(1, Math.round(sourceHeight));
  const longest = Math.max(safeW, safeH);

  if (longest <= maxEdge) {
    return {
      width: safeW,
      height: safeH,
      wasScaled: false,
    };
  }

  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(safeW * ratio)),
    height: Math.max(1, Math.round(safeH * ratio)),
    wasScaled: true,
  };
}

export interface ElaBufferComparison {
  elaData: Uint8ClampedArray;
  maxChannelDiff: number;
  meanChannelDiff: number;
}

/**
 * Compares original and 90%-JPEG recompressed RGBA pixel buffers, calculates
 * the per-channel absolute difference, and amplifies it by `amplification` (15x).
 * Areas with different compression history surface as bright white/high-value regions.
 */
export function computeElaBuffer(
  originalRgba: Uint8ClampedArray,
  recompressedRgba: Uint8ClampedArray,
  width: number,
  height: number,
  amplification = ELA_AMPLIFICATION_FACTOR,
): ElaBufferComparison {
  const expectedLength = Math.max(0, width) * Math.max(0, height) * 4;
  if (originalRgba.length < expectedLength || recompressedRgba.length < expectedLength) {
    throw new Error('Pixel buffers are smaller than expected image dimensions.');
  }

  const elaData = new Uint8ClampedArray(expectedLength);
  let maxChannelDiff = 0;
  let totalDiff = 0;
  const channelSamples = Math.max(1, width * height * 3);

  for (let idx = 0; idx < expectedLength; idx += 4) {
    for (let c = 0; c < 3; c += 1) {
      const diff = Math.abs(originalRgba[idx + c] - recompressedRgba[idx + c]);
      if (diff > maxChannelDiff) {
        maxChannelDiff = diff;
      }
      totalDiff += diff;
      const amplified = diff * amplification;
      elaData[idx + c] = amplified > 255 ? 255 : Math.round(amplified);
    }
    elaData[idx + 3] = 255;
  }

  return {
    elaData,
    maxChannelDiff,
    meanChannelDiff: Number((totalDiff / channelSamples).toFixed(2)),
  };
}

export interface ElaAnalysisResult {
  elaImageUrl: string;
  dimensions: string;
  maxChannelDiff: number;
  meanChannelDiff: number;
  quality: number;
  amplification: number;
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:') && !src.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error('Failed to load source image into forensics canvas.'));
    img.src = src;
  });
}

/**
 * Performs browser-local Error Level Analysis (ELA):
 * 1. Draws original image to Canvas 1 and reads its RGBA pixel buffer.
 * 2. Exports Canvas 1 as JPEG at 90% quality.
 * 3. Loads the re-compressed JPEG back and draws it onto Canvas 2.
 * 4. Computes |original - recompressed| * 15 per RGB channel into an ELA PNG data URL.
 */
export async function runErrorLevelAnalysis(
  imageUrl: string,
  options?: {
    quality?: number;
    amplification?: number;
  },
): Promise<ElaAnalysisResult> {
  const quality = options?.quality ?? ELA_JPEG_QUALITY;
  const amplification = options?.amplification ?? ELA_AMPLIFICATION_FACTOR;

  const originalImg = await loadHtmlImage(imageUrl);
  const srcWidth = originalImg.naturalWidth || originalImg.width;
  const srcHeight = originalImg.naturalHeight || originalImg.height;

  if (!srcWidth || !srcHeight) {
    throw new Error('Source image reported zero dimensions.');
  }

  const target = computeElaDimensions(srcWidth, srcHeight);

  const originalCanvas = document.createElement('canvas');
  originalCanvas.width = target.width;
  originalCanvas.height = target.height;
  const origCtx = originalCanvas.getContext('2d', { willReadFrequently: true });
  if (!origCtx) {
    throw new Error('2D canvas context unavailable for Error Level Analysis.');
  }

  // Paint opaque white backdrop so transparent PNG regions match JPEG's opaque output
  origCtx.fillStyle = '#ffffff';
  origCtx.fillRect(0, 0, target.width, target.height);
  origCtx.drawImage(originalImg, 0, 0, target.width, target.height);

  const originalPixels = origCtx.getImageData(0, 0, target.width, target.height);

  // Re-compress original canvas as 90% JPEG and reload into a second canvas
  const recompressedJpegUrl = originalCanvas.toDataURL('image/jpeg', quality);
  const recompressedImg = await loadHtmlImage(recompressedJpegUrl);

  const recompressedCanvas = document.createElement('canvas');
  recompressedCanvas.width = target.width;
  recompressedCanvas.height = target.height;
  const recompCtx = recompressedCanvas.getContext('2d', {
    willReadFrequently: true,
  });
  if (!recompCtx) {
    throw new Error('2D canvas context unavailable for JPEG re-compression.');
  }

  recompCtx.drawImage(recompressedImg, 0, 0, target.width, target.height);
  const recompressedPixels = recompCtx.getImageData(
    0,
    0,
    target.width,
    target.height,
  );

  const comparison = computeElaBuffer(
    originalPixels.data,
    recompressedPixels.data,
    target.width,
    target.height,
    amplification,
  );

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = target.width;
  outputCanvas.height = target.height;
  const outputCtx = outputCanvas.getContext('2d');
  if (!outputCtx) {
    throw new Error('2D canvas context unavailable for ELA output rendering.');
  }

  const outputImageData = outputCtx.createImageData(target.width, target.height);
  outputImageData.data.set(comparison.elaData);
  outputCtx.putImageData(outputImageData, 0, 0);

  return {
    elaImageUrl: outputCanvas.toDataURL('image/png'),
    dimensions: `${srcWidth} × ${srcHeight}`,
    maxChannelDiff: comparison.maxChannelDiff,
    meanChannelDiff: comparison.meanChannelDiff,
    quality,
    amplification,
  };
}
