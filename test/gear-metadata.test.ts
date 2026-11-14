import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gearMetadata } from '../src/gear-metadata';
import { decodeWorkout } from '../src/decoder';

test('gear/shoe metadata preserves original keys and supported scalar/nested attributes', () => {
  const metadata = { gearId: 'fixture-gear-a', shoe_id: 7, gearName: 'Fixture shoe', shoeDistance: 123.4,
    gear: { id: 'fixture-gear-b', name: 'Fixture shoe B', totalDistance: 456, retired: false }, shoe: null };
  assert.deepEqual(gearMetadata(metadata), metadata);
  const decoded = decodeWorkout({ trackid: 1700000000, ...metadata, heart_rate: '0,80;' });
  assert.deepEqual(decoded.metadata, { trackid: 1700000000, ...metadata });
  assert.deepEqual(Object.keys(decoded.streams), ['heart_rate']);
  assert.deepEqual(decoded.timeline[0].heart_rate_bpm, 80);
  assert.equal(decoded.timeline[0].gearId, undefined);
});

test('missing gear metadata remains empty without inventing names or an association', () => {
  assert.deepEqual(decodeWorkout({ trackid: 1700000000 }).metadata, { trackid: 1700000000 });
  assert.deepEqual(gearMetadata({ gearId: null }), { gearId: null });
});

test('gear metadata preserves compound values while excluding credentials and unrelated data', () => {
  assert.deepEqual(gearMetadata({ gearToken: 'fixture-private', shoe_password: 'fixture-private',
    gear: { id: 7, name: 'Fixture shoe', token: 'fixture-private', email: 'fixture@example.invalid', raw: { access: 'fixture-private' } },
    shoe: ['fixture-shoe'], gearDistance: 123, app_token: 'fixture-private', heart_rate: '0,80;' }),
    { gear: { id: 7, name: 'Fixture shoe', email: 'fixture@example.invalid', raw: {} }, shoe: ['fixture-shoe'], gearDistance: 123 });
});
