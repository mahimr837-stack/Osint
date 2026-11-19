import { fileTypeFromBuffer } from 'file-type';

export type ReverseSearchEngine = 'google-lens' | 'yandex' | 'tineye';

export interface ReverseSearchEngineMeta {
  id: ReverseSearchEngine;
  name: string;
  buttonLabel: string;
  homepageUrl: string;
  buildUrlSearch: (publicImageUrl: string) => string;
}

export const REVERSE_SEARCH_ENGINES: readonly ReverseSearchEngineMeta[] = [
  {
    id: 'google-lens',
    name: 'Google Lens',
    buttonLabel: 'Search on Google Lens',
    homepageUrl: 'https://lens.google.com/',
    buildUrlSearch: (publicImageUrl) =>
      `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(publicImageUrl)}`,
  },
  {
    id: 'yandex',
    name: 'Yandex',
    buttonLabel: 'Search on Yandex',
    homepageUrl: 'https://yandex.com/images/',
    buildUrlSearch: (publicImageUrl) =>
      `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(publicImageUrl)}`,
  },
  {
    id: 'tineye',
    name: 'TinEye',
    buttonLabel: 'Search on TinEye',
    homepageUrl: 'https://tineye.com/',
    buildUrlSearch: (publicImageUrl) =>
      `https://tineye.com/search?url=${encodeURIComponent(publicImageUrl)}`,
  },
] as const;

export interface ImageTypeInspection {
  valid: boolean;
  ext: string | null;
  mime: string | null;
}

/**
 * Checks whether a `file-type` detection result corresponds to an image MIME type.
 */
export function isValidImageFileType(
  result: { ext: string; mime: string } | null | undefined,
): boolean {
  return Boolean(result && result.mime.toLowerCase().startsWith('image/'));
}

/**
 * Inspects binary image bytes using `file-type` magic-number detection.
 */
export async function inspectImageBufferWithFileType(
  buffer: ArrayBuffer | Uint8Array,
): Promise<ImageTypeInspection> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const detected = await fileTypeFromBuffer(bytes);
  if (!isValidImageFileType(detected)) {
    return {
      valid: false,
      ext: detected?.ext ?? null,
      mime: detected?.mime ?? null,
    };
  }
  return {
    valid: true,
    ext: detected!.ext,
    mime: detected!.mime,
  };
}

/**
 * Returns true only when `url` is a publicly reachable HTTP(S) image URL that
 * external reverse search engines can fetch directly (rejecting data:, blob:, relative, and localhost URLs).
 */
export function isPublicHttpImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('/')) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '[::1]' ||
      host.endsWith('.local')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export interface ReverseSearchLaunchPlan {
  engine: ReverseSearchEngine;
  engineName: string;
  mode: 'direct-url' | 'clipboard-homepage';
  targetUrl: string;
}

/**
 * Determines whether to pass the image URL directly to the reverse search engine
 * or copy the image to the clipboard and open the engine homepage (when URL upload is blocked).
 */
export function resolveReverseSearchAction(
  engineId: ReverseSearchEngine,
  sourceImageUrl: string,
): ReverseSearchLaunchPlan {
  const engine = REVERSE_SEARCH_ENGINES.find((item) => item.id === engineId);
  if (!engine) {
    throw new Error(`Unsupported reverse search engine: ${engineId}`);
  }

  if (isPublicHttpImageUrl(sourceImageUrl)) {
    return {
      engine: engine.id,
      engineName: engine.name,
      mode: 'direct-url',
      targetUrl: engine.buildUrlSearch(sourceImageUrl.trim()),
    };
  }

  return {
    engine: engine.id,
    engineName: engine.name,
    mode: 'clipboard-homepage',
    targetUrl: engine.homepageUrl,
  };
}
