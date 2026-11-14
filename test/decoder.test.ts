import { test } from 'node:test';
import assert from 'node:assert/strict';
import fixture from './fixtures/workout.json';
import { DecodeError, decodeWorkout } from '../src/decoder';

test('known synthetic observations: delta GPS/HR, absolute altitude, gait cadence and independent clocks', () => {
  const result = decodeWorkout(fixture);
  assert.deepEqual(result.sample_counts, { longitude_latitude: 3, altitude: 4, accuracy: 3, pace: 3, heart_rate: 4, gait: 4, speed: 3, distance: 3 });
  assert.deepEqual(result.timeline.map(r => r.offset_s), [0, 2, 3, 5, 10]);
  assert.equal(result.streams.longitude_latitude[2].latitude, 35.0000005);
  assert.equal(result.streams.longitude_latitude[2].longitude, 138.999999);
  assert.equal(result.streams.altitude[0].altitude_m, null);
  assert.equal(result.streams.altitude[1].altitude_m, 123.45);
  assert.deepEqual(result.streams.heart_rate.map(r => [r.offset_s, r.heart_rate_bpm]), [[0, 100], [2, 105], [3, 103], [10, 104]]);
  assert.equal(result.streams.gait[2].steps, 15);
  assert.equal(result.streams.gait[2].cadence_spm, 180);
  assert.equal(result.streams.gait[2].cadence_source, 'interval_steps');
  assert.equal(result.streams.gait[3].cadence_spm, 182);
  assert.equal(result.streams.gait[3].cadence_source, 'gait_frequency');
  assert.equal(result.streams.distance[2].distance_m, 31.4);
  assert.equal(result.timeline[0].timestamp, '2023-11-14T22:13:20.000Z');
  assert.equal(result.timeline[2].latitude, undefined); // no invented GPS/forward fill
});
test('zero time deltas preserve stream observations and report last-wins union', () => {
  const r = decodeWorkout({ trackid: 1700000000, heart_rate: '0,80;0,10;1,-1' });
  assert.equal(r.streams.heart_rate.length, 3);
  assert.equal(r.timeline[0].heart_rate_bpm, 90);
  assert.equal(r.warnings.length, 1);
});
test('missing cadence with zero interval stays null; unavailable altitude is never backfilled', () => {
  const r = decodeWorkout({ trackid: 1700000000, gait: '0,0,80', time: '0;1', altitude: '-2000000;100' });
  assert.equal(r.streams.gait[0].cadence_spm, null);
  assert.equal(r.streams.altitude[0].altitude_m, null);
});
test('malformed streams fail with no raw input; unsupported metrics are explicit', () => {
  for (const detail of [{ time: '0;1', altitude: '123' }, { heart_rate: '0,SECRET' }, { time: '-1' }, { gait: '1,2' }]) {
    assert.throws(() => decodeWorkout({ trackid: 1700000000, ...detail }), DecodeError);
  }
  assert.equal(decodeWorkout({ trackid: 1700000000, cadence: 'opaque' }).warnings.length, 1);
});
