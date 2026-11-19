import type { GeoCoordinates } from './mapCoordinates';

export const GEOSPY_PREDICT_ENDPOINT = 'https://api.geospy.ai/predict';
export const GEOSPY_PROXY_ENDPOINT = '/api/osint/geospy';

export interface GeoSpyPrediction {
  coordinates: GeoCoordinates;
  city: string | null;
  country: string | null;
  confidence: number | null;
}

function toValidLatLng(lat: unknown, lng: unknown): GeoCoordinates | null {
  if (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === 'number' &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  ) {
    return { lat, lng };
  }
  return null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function extractCoordinatesFromRecord(
  record: Record<string, unknown>,
): GeoCoordinates | null {
  const directLat = asNumber(record.lat ?? record.latitude);
  const directLng = asNumber(
    record.lng ?? record.lon ?? record.long ?? record.longitude,
  );
  const directCoords = toValidLatLng(directLat, directLng);
  if (directCoords) {
    return directCoords;
  }

  const coordsField = record.coordinates ?? record.coords ?? record.point;
  if (Array.isArray(coordsField) && coordsField.length >= 2) {
    const arrLat = asNumber(coordsField[0]);
    const arrLng = asNumber(coordsField[1]);
    const arrCoords = toValidLatLng(arrLat, arrLng);
    if (arrCoords) {
      return arrCoords;
    }
  } else if (coordsField && typeof coordsField === 'object') {
    const nested = extractCoordinatesFromRecord(
      coordsField as Record<string, unknown>,
    );
    if (nested) return nested;
  }

  const locationField = record.location ?? record.geo ?? record.address;
  if (locationField && typeof locationField === 'object') {
    const nested = extractCoordinatesFromRecord(
      locationField as Record<string, unknown>,
    );
    if (nested) return nested;
  }

  return null;
}

function extractPredictionFromRecord(
  record: Record<string, unknown>,
): GeoSpyPrediction | null {
  const coordinates = extractCoordinatesFromRecord(record);
  if (!coordinates) return null;

  const locationObj =
    record.location && typeof record.location === 'object'
      ? (record.location as Record<string, unknown>)
      : null;

  const city =
    asNonEmptyString(record.city) ??
    asNonEmptyString(record.town) ??
    asNonEmptyString(record.municipality) ??
    (locationObj ? asNonEmptyString(locationObj.city) : null);

  const country =
    asNonEmptyString(record.country) ??
    asNonEmptyString(record.country_name) ??
    (locationObj
      ? asNonEmptyString(locationObj.country) ??
        asNonEmptyString(locationObj.country_name)
      : null);

  const rawConfidence = asNumber(
    record.score ?? record.confidence ?? record.probability,
  );
  const confidence =
    rawConfidence !== null
      ? rawConfidence <= 1
        ? Math.round(rawConfidence * 100)
        : Math.round(rawConfidence)
      : null;

  return {
    coordinates,
    city,
    country,
    confidence,
  };
}

/**
 * Parses common GeoSpy API JSON response shapes for predicted coordinates,
 * city/country labels, and optional confidence score.
 */
export function parseGeoSpyResponse(payload: unknown): GeoSpyPrediction | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;

  const arrayKeys = ['geo_predictions', 'predictions', 'results', 'candidates'] as const;
  for (const key of arrayKeys) {
    const list = root[key];
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item && typeof item === 'object') {
          const parsed = extractPredictionFromRecord(item as Record<string, unknown>);
          if (parsed) return parsed;
        }
      }
    }
  }

  const nestedKeys = ['prediction', 'data', 'result'] as const;
  for (const key of nestedKeys) {
    const nested = root[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const parsed = extractPredictionFromRecord(nested as Record<string, unknown>);
      if (parsed) return parsed;
    }
  }

  return extractPredictionFromRecord(root);
}

/**
 * Formats city and country into a clean single-line location label.
 */
export function formatGeoSpyLocationLabel(
  prediction: Pick<GeoSpyPrediction, 'city' | 'country'>,
): string {
  const parts = [prediction.city, prediction.country].filter(
    (part): part is string => Boolean(part && part.trim().length > 0),
  );
  return parts.length > 0 ? parts.join(', ') : 'Coordinates Resolved';
}

function extensionFromMimeType(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  return 'jpg';
}

async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts an image URL (data URL, blob URL, or local asset URL) into base64
 * and submits a request to the server-side proxy (`/api/osint/geospy`), which
 * forwards the image to https://api.geospy.ai/predict using GEOSPY_API_KEY.
 */
export async function predictGeoSpyLocation(params: {
  imageUrl: string;
  fileName?: string;
  signal?: AbortSignal;
}): Promise<GeoSpyPrediction> {
  const imageResponse = await fetch(params.imageUrl, { signal: params.signal });
  if (!imageResponse.ok) {
    throw new Error('Could not read the connected image for GeoSpy upload.');
  }
  const blob = await imageResponse.blob();
  const mimeType = blob.type || 'image/jpeg';
  const ext = extensionFromMimeType(mimeType);
  const uploadName =
    params.fileName && /\.[a-z0-9]+$/i.test(params.fileName)
      ? params.fileName
      : `evidence.${ext}`;

  const imageBase64 = await blobToBase64(blob);

  const response = await fetch(GEOSPY_PROXY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      imageBase64,
      mimeType,
      fileName: uploadName,
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    let errorDetail = `GeoSpy proxy request failed (${response.status}).`;
    try {
      const errorJson = (await response.json()) as {
        detail?: unknown;
        error?: unknown;
        message?: unknown;
      };
      const candidate =
        errorJson.detail ?? errorJson.message ?? errorJson.error;
      if (typeof candidate === 'string' && candidate.trim()) {
        errorDetail = candidate.trim();
      }
    } catch {
      // Fall back to status message when body is not JSON
    }
    throw new Error(errorDetail);
  }

  const data = (await response.json()) as unknown;
  const parsed = parseGeoSpyResponse(data);
  if (!parsed) {
    throw new Error('GeoSpy response did not include valid lat/lng coordinates.');
  }
  return parsed;
}
