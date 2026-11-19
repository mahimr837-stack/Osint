export const GEOINTEL_CATEGORIES = [
  'Architecture',
  'Vegetation',
  'Sun/Shadows',
  'License Plates',
  'Signage/Text',
  'Infrastructure',
] as const;

export type GeoIntelCategory = (typeof GEOINTEL_CATEGORIES)[number];

export const GEOINTEL_SYSTEM_PROMPT =
  'You are a GEOINT analyst. Analyze this image and extract physical geolocation clues. Do not guess the location. Output a JSON array of clues in these categories: [Architecture, Vegetation, Sun/Shadows, License Plates, Signage/Text, Infrastructure]. For each, provide a brief observation.';

export interface GeoIntelClue {
  category: string;
  observation: string;
}

export function buildGeoIntelUserPrompt(imageTitle?: string | null): string {
  const titleHint = imageTitle?.trim()
    ? `Image Title: "${imageTitle.trim()}"`
    : 'Analyze the attached image.';
  return `${titleHint}\nExtract physical geolocation clues across the six categories and return only the JSON array.`;
}

function normalizeCategoryName(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (cleaned.includes('arch') || cleaned.includes('build')) {
    return 'Architecture';
  }
  if (cleaned.includes('veg') || cleaned.includes('flora') || cleaned.includes('tree')) {
    return 'Vegetation';
  }
  if (cleaned.includes('sun') || cleaned.includes('shadow') || cleaned.includes('solar')) {
    return 'Sun/Shadows';
  }
  if (cleaned.includes('plate') || cleaned.includes('vehicle')) {
    return 'License Plates';
  }
  if (cleaned.includes('sign') || cleaned.includes('text') || cleaned.includes('lang')) {
    return 'Signage/Text';
  }
  if (
    cleaned.includes('infra') ||
    cleaned.includes('road') ||
    cleaned.includes('utility') ||
    cleaned.includes('pole')
  ) {
    return 'Infrastructure';
  }
  return raw.trim() || 'Observation';
}

function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function tryParseJsonCandidate(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(text.slice(firstBracket, lastBracket + 1));
      } catch {
        // Ignore slice parse error and try object fallback
      }
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function extractClueFromObject(obj: Record<string, unknown>): GeoIntelClue | null {
  const rawCategory =
    obj.category ?? obj.Category ?? obj.type ?? obj.Type ?? obj.name ?? obj.key;
  const rawObservation =
    obj.observation ??
    obj.Observation ??
    obj.clue ??
    obj.Clue ??
    obj.description ??
    obj.details ??
    obj.detail ??
    obj.value ??
    obj.text ??
    obj.notes;

  if (typeof rawCategory === 'string' && typeof rawObservation === 'string') {
    const obs = rawObservation.trim();
    if (!obs) return null;
    return {
      category: normalizeCategoryName(rawCategory),
      observation: obs,
    };
  }

  // Handle single-key category map objects inside arrays: { "Architecture": "..." }
  const entries = Object.entries(obj).filter(
    ([, val]) => typeof val === 'string' && val.trim().length > 0,
  );
  if (entries.length === 1) {
    const [k, v] = entries[0];
    return {
      category: normalizeCategoryName(k),
      observation: (v as string).trim(),
    };
  }

  return null;
}

/**
 * Parses an LLM GEOINT JSON response (including fenced JSON arrays, wrapped objects,
 * or single-key category maps) into structured bullet items.
 */
export function parseGeoIntelCluesResponse(rawResponse: string): GeoIntelClue[] {
  const cleaned = stripMarkdownFences(rawResponse);
  if (!cleaned) return [];

  const parsed = tryParseJsonCandidate(cleaned);
  const clues: GeoIntelClue[] = [];

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const clue = extractClueFromObject(item as Record<string, unknown>);
        if (clue) clues.push(clue);
      } else if (typeof item === 'string' && item.trim()) {
        clues.push({ category: 'Observation', observation: item.trim() });
      }
    }
  } else if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.clues)) {
      for (const item of record.clues) {
        if (item && typeof item === 'object') {
          const clue = extractClueFromObject(item as Record<string, unknown>);
          if (clue) clues.push(clue);
        }
      }
    } else {
      for (const [key, val] of Object.entries(record)) {
        if (typeof val === 'string' && val.trim()) {
          clues.push({
            category: normalizeCategoryName(key),
            observation: val.trim(),
          });
        }
      }
    }
  }

  if (clues.length > 0) {
    return clues;
  }

  // Defensive fallback if model returned plain bulleted text instead of JSON
  return cleaned
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 1 && colonIdx < 32) {
        const cat = line.slice(0, colonIdx).replace(/\*\*/g, '').trim();
        const obs = line.slice(colonIdx + 1).trim();
        if (obs) {
          return {
            category: normalizeCategoryName(cat),
            observation: obs,
          };
        }
      }
      return {
        category: 'Observation',
        observation: line,
      };
    });
}
