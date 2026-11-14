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

test('power starts at its first seconds delta, posture starts at zero, independently of the time column', () => {
  const r = decodeWorkout({ trackid: 1700000000, time: '5;7',
    power_meter: '1,210;1,230;2,0;', runPosture: '0,245,72,68;1,250,75,71;3,260,80,73;' });
  assert.deepEqual(r.sample_counts, { power_meter: 3, runPosture: 3 });
  assert.deepEqual(r.streams.power_meter.map(v => [v.offset_s, v.power_w]), [[1, 210], [2, 230], [4, 0]]);
  assert.deepEqual(r.streams.runPosture.map(v => [v.offset_s, v.stance_time_ms, v.vertical_oscillation_mm, v.vertical_ratio_pct]),
    [[0, 245, 72, 6.8], [1, 250, 75, 7.1], [4, 260, 80, 7.3]]);
  assert.equal(r.timeline[0].power_w, undefined);
  assert.equal(r.timeline[1].power_w, 210);
  assert.equal(r.timeline[1].stance_time_ms, 250);
  assert.equal(r.timeline[1].timestamp, '2023-11-14T22:13:21.000Z');
  assert.equal(r.sample_alignment.power_meter.mode, 'delta_seconds');
  assert.equal(r.sample_alignment.runPosture.time_offset_s, 0);
  assert.deepEqual(r.warnings, []);
});
test('posture 65535/255 sentinels are independent nulls and ratio values are divided by ten', () => {
  const r = decodeWorkout({ trackid: 1700000000,
    runPosture: '0,65535,60,55;1,240,65535,255;1,65535,65535,255;' });
  assert.deepEqual(r.streams.runPosture.map(v => [v.stance_time_ms, v.vertical_oscillation_mm, v.vertical_ratio_pct]),
    [[null, 60, 5.5], [240, null, null], [null, null, null]]);
  assert.equal(r.timeline[2].offset_s, 2);
  assert.equal(r.timeline[2].stance_time_ms, null);
});
test('delta 2 leaves a gap and delta 0 preserves duplicate observations with last-wins timeline', () => {
  const r = decodeWorkout({ trackid: 1700000000,
    power_meter: '1,200;2,220;0,230', runPosture: '0,240,60,65;2,250,70,75;0,260,80,85' });
  assert.deepEqual(r.streams.power_meter.map(v => v.offset_s), [1, 3, 3]);
  assert.deepEqual(r.streams.runPosture.map(v => v.offset_s), [0, 2, 2]);
  assert.equal(r.timeline.find(v => v.offset_s === 3)?.power_w, 230);
  assert.equal(r.timeline.find(v => v.offset_s === 2)?.stance_time_ms, 260);
  assert.equal(r.timeline.find(v => v.offset_s === 2)?.power_w, undefined);
  assert.equal(r.timeline.find(v => v.offset_s === 1)?.stance_time_ms, undefined);
  assert.equal(r.sample_alignment.power_meter.zero_delta_samples, 1);
  assert.equal(r.sample_alignment.power_meter.gap_delta_samples, 1);
  assert.equal(r.warnings.length, 2);
});
test('bad power/posture columns and deltas fail explicitly without raw input', () => {
  for (const detail of [{ power_meter: '1,2,3' }, { power_meter: '1,fixture-private-value' },
    { power_meter: '-1,200' }, { power_meter: ',200' }, { runPosture: '1,240,60' },
    { runPosture: '1,240,fixture-private-value,65' }, { runPosture: '-1,240,60,65' }]) {
    assert.throws(() => decodeWorkout({ trackid: 1700000000, ...detail }), error => {
      assert.ok(error instanceof DecodeError);
      assert.ok(!error.message.includes('fixture-private-value'));
      return true;
    });
  }
});
test('power and posture require no GPS/time clock and differing sample counts are normal', () => {
  const r = decodeWorkout({ trackid: 1700000000, power_meter: '1,200;2,210', runPosture: '0,240,60,65' });
  assert.deepEqual(r.sample_counts, { power_meter: 2, runPosture: 1 });
  assert.deepEqual(r.streams.power_meter.map(v => v.offset_s), [1, 3]);
  assert.equal(r.sample_alignment.power_meter.time_samples, 0);
  assert.deepEqual(r.warnings, []);
});
test('new clocks do not shift or change existing altitude and heart-rate observations', () => {
  const r = decodeWorkout({ trackid: 1700000000, time: '3;2;2', altitude: '100;200;300', heart_rate: '3,100;2,5;2,5',
    power_meter: '1,210;2,220', runPosture: '0,240,60,65;2,250,70,75' });
  assert.deepEqual(r.streams.altitude.map(v => v.offset_s), [3, 5, 7]);
  assert.deepEqual(r.streams.heart_rate.map(v => v.offset_s), [3, 5, 7]);
  assert.deepEqual(r.streams.power_meter.map(v => v.offset_s), [1, 3]);
  assert.deepEqual(r.streams.runPosture.map(v => v.offset_s), [0, 2]);
});
test('zero measurements and ratio 254 remain valid rather than missing', () => {
  const r = decodeWorkout({ trackid: 1700000000, power_meter: '1,0', runPosture: '0,0,0,0;1,240,60,254' });
  assert.equal(r.streams.power_meter[0].power_w, 0);
  assert.equal(r.streams.runPosture[0].stance_time_ms, 0);
  assert.equal(r.streams.runPosture[0].vertical_oscillation_mm, 0);
  assert.equal(r.streams.runPosture[0].vertical_ratio_pct, 0);
  assert.equal(r.streams.runPosture[1].vertical_ratio_pct, 25.4);
});
test('full streams accept a complete last element without a trailing delimiter', () => {
  const r = decodeWorkout({ trackid: 1700000000, power_meter: '1,200;1,210', runPosture: '0,240,60,65;1,250,70,75' });
  assert.equal(r.streams.power_meter.length, 2);
  assert.equal(r.streams.runPosture.length, 2);
  assert.equal(r.timeline[2].power_w, 210);
});
