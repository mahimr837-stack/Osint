import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatGeoSpyLocationLabel,
  GEOSPY_PREDICT_ENDPOINT,
  parseGeoSpyResponse,
} from './geoSpy';

test('targets official GeoSpy predict endpoint', () => {
  assert.equal(GEOSPY_PREDICT_ENDPOINT, 'https://api.geospy.ai/predict');
});

test('parseGeoSpyResponse extracts geo_predictions array coordinates, city, country, and score', () => {
  const parsed = parseGeoSpyResponse({
    geo_predictions: [
      {
        coordinates: [51.9244, 4.4777],
        city: 'Rotterdam',
        country: 'Netherlands',
        score: 0.914,
      },
    ],
  });

  assert.deepEqual(parsed, {
    coordinates: { lat: 51.9244, lng: 4.4777 },
    city: 'Rotterdam',
    country: 'Netherlands',
    confidence: 91,
  });
  assert.equal(formatGeoSpyLocationLabel(parsed!), 'Rotterdam, Netherlands');
});

test('parseGeoSpyResponse handles flat lat/lng and nested location objects', () => {
  const flat = parseGeoSpyResponse({
    lat: 34.0522,
    lng: -118.2437,
    city: 'Los Angeles',
    country: 'United States',
  });
  assert.deepEqual(flat, {
    coordinates: { lat: 34.0522, lng: -118.2437 },
    city: 'Los Angeles',
    country: 'United States',
    confidence: null,
  });

  const nested = parseGeoSpyResponse({
    prediction: {
      latitude: '48.8566',
      longitude: '2.3522',
      location: {
        city: 'Paris',
        country_name: 'France',
      },
      confidence: 88,
    },
  });
  assert.deepEqual(nested, {
    coordinates: { lat: 48.8566, lng: 2.3522 },
    city: 'Paris',
    country: 'France',
    confidence: 88,
  });
});

test('parseGeoSpyResponse rejects missing or out-of-range coordinates and formats partial labels cleanly', () => {
  assert.equal(parseGeoSpyResponse(null), null);
  assert.equal(parseGeoSpyResponse({ city: 'Tokyo' }), null);
  assert.equal(parseGeoSpyResponse({ lat: 120, lng: 15 }), null);

  assert.equal(
    formatGeoSpyLocationLabel({ city: null, country: 'Japan' }),
    'Japan',
  );
  assert.equal(
    formatGeoSpyLocationLabel({ city: null, country: null }),
    'Coordinates Resolved',
  );
});
