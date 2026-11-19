import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLatLngLabel, parseCoordinatesFromText } from './mapCoordinates';

test('parses standard signed decimal GPS coordinate pairs from text', () => {
  assert.deepEqual(
    parseCoordinatesFromText('Target located near 34.0522, -118.2437 in downtown sector.'),
    { lat: 34.0522, lng: -118.2437 },
  );

  assert.deepEqual(
    parseCoordinatesFromText('51.924420, 4.477733'),
    { lat: 51.92442, lng: 4.477733 },
  );
});

test('parses hemisphere-suffixed and explicitly labeled GPS coordinates', () => {
  assert.deepEqual(
    parseCoordinatesFromText('Coordinates: 34.0522° N, 118.2437° W'),
    { lat: 34.0522, lng: -118.2437 },
  );

  assert.deepEqual(
    parseCoordinatesFromText('lat: -33.8688, lng: 151.2093'),
    { lat: -33.8688, lng: 151.2093 },
  );
});

test('rejects out-of-range coordinates and ordinary numbers in prose', () => {
  assert.equal(parseCoordinatesFromText('95.1234, -118.2437'), null);
  assert.equal(parseCoordinatesFromText('34.0522, 195.0000'), null);
  assert.equal(parseCoordinatesFromText('3 sources, 14 frames at 09:14'), null);
  assert.equal(parseCoordinatesFromText('No GPS tags'), null);
});

test('formats lat/lng label with 4 decimal places', () => {
  assert.equal(
    formatLatLngLabel({ lat: 34.0522, lng: -118.2437 }),
    '34.0522, -118.2437',
  );
});
