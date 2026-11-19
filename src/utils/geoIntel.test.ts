import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGeoIntelUserPrompt,
  GEOINTEL_CATEGORIES,
  GEOINTEL_SYSTEM_PROMPT,
  parseGeoIntelCluesResponse,
} from './geoIntel';

test('GEOINTEL_SYSTEM_PROMPT matches strict GEOINT analyst specification', () => {
  assert.equal(
    GEOINTEL_SYSTEM_PROMPT,
    'You are a GEOINT analyst. Analyze this image and extract physical geolocation clues. Do not guess the location. Output a JSON array of clues in these categories: [Architecture, Vegetation, Sun/Shadows, License Plates, Signage/Text, Infrastructure]. For each, provide a brief observation.',
  );
  assert.deepEqual(GEOINTEL_CATEGORIES, [
    'Architecture',
    'Vegetation',
    'Sun/Shadows',
    'License Plates',
    'Signage/Text',
    'Infrastructure',
  ]);
});

test('parseGeoIntelCluesResponse parses markdown-fenced JSON arrays into structured clues', () => {
  const raw = [
    '```json',
    JSON.stringify([
      {
        category: 'Architecture',
        observation: 'Steep red-clay tiled gable roofs with narrow timber-framed facades.',
      },
      {
        category: 'Vegetation',
        observation: 'Deciduous plane trees and clipped canal-side hedges.',
      },
      {
        category: 'sun_shadows',
        observation: 'Long shadows angled northeast indicate mid-afternoon northern hemisphere sun.',
      },
      {
        category: 'License Plates',
        observation: 'Yellow rear plate with blue left EU band visible on parked hatchback.',
      },
      {
        category: 'Signage/Text',
        observation: 'Blue street plaque reading "Kade" with sans-serif white lettering.',
      },
      {
        category: 'Infrastructure',
        observation: 'Interlocking brick cycle lane beside cobble curb and steel bollard.',
      },
    ]),
    '```',
  ].join('\n');

  const clues = parseGeoIntelCluesResponse(raw);
  assert.equal(clues.length, 6);
  assert.equal(clues[0].category, 'Architecture');
  assert.equal(clues[2].category, 'Sun/Shadows');
  assert.match(clues[3].observation, /Yellow rear plate/);
});

test('parseGeoIntelCluesResponse handles object maps and nested clues arrays cleanly', () => {
  const objClues = parseGeoIntelCluesResponse(
    JSON.stringify({
      clues: [
        { type: 'Infrastructure', clue: 'Octagonal concrete utility pole with horizontal cross-arm.' },
        { Architecture: 'Corrugated steel warehouse cladding.' },
      ],
    }),
  );

  assert.deepEqual(objClues, [
    {
      category: 'Infrastructure',
      observation: 'Octagonal concrete utility pole with horizontal cross-arm.',
    },
    {
      category: 'Architecture',
      observation: 'Corrugated steel warehouse cladding.',
    },
  ]);

  assert.match(buildGeoIntelUserPrompt('Port Terminal Aerial'), /Port Terminal Aerial/);
});
