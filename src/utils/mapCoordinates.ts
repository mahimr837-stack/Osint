export interface GeoCoordinates {
  lat: number;
  lng: number;
}

/**
 * Extracts valid latitude/longitude decimal coordinates from arbitrary text
 * (e.g. "34.0522, -118.2437", "lat: 51.9244, lon: 4.4777", or "34.0522° N, 118.2437° W").
 */
export function parseCoordinatesFromText(text: string): GeoCoordinates | null {
  if (!text || typeof text !== 'string') return null;

  // Pattern 1: Explicit hemisphere suffixes like "34.0522° N, 118.2437° W"
  const hemisphereRegex =
    /(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([NS])\s*[,;\s/]+\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])\b/gi;
  for (const match of text.matchAll(hemisphereRegex)) {
    const rawLat = Number.parseFloat(match[1]);
    const ns = match[2].toUpperCase();
    const rawLng = Number.parseFloat(match[3]);
    const ew = match[4].toUpperCase();

    const lat = ns === 'S' ? -Math.abs(rawLat) : Math.abs(rawLat);
    const lng = ew === 'W' ? -Math.abs(rawLng) : Math.abs(rawLng);
    if (isValidLatLng(lat, lng)) {
      return { lat, lng };
    }
  }

  // Pattern 2: Signed decimal pair with optional lat/lng labels, e.g. "34.0522, -118.2437"
  const decimalPairRegex =
    /(?:lat(?:itude)?\s*[:=]\s*)?(-?\d{1,3}\.\d+)\s*°?\s*[,;]\s*(?:lon(?:gitude)?|lng\s*)?(?:[:=]\s*)?(-?\d{1,3}\.\d+)\s*°?/gi;
  for (const match of text.matchAll(decimalPairRegex)) {
    const lat = Number.parseFloat(match[1]);
    const lng = Number.parseFloat(match[2]);
    if (isValidLatLng(lat, lng)) {
      return { lat, lng };
    }
  }

  // Pattern 3: Integer or decimal pair explicitly labeled lat/lng/lon
  const labeledRegex =
    /lat(?:itude)?\s*[:=]\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]+\s*(?:lon(?:gitude)?|lng)\s*[:=]\s*(-?\d{1,3}(?:\.\d+)?)/gi;
  for (const match of text.matchAll(labeledRegex)) {
    const lat = Number.parseFloat(match[1]);
    const lng = Number.parseFloat(match[2]);
    if (isValidLatLng(lat, lng)) {
      return { lat, lng };
    }
  }

  return null;
}

export function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function formatLatLngLabel(coords: GeoCoordinates): string {
  return `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
}
