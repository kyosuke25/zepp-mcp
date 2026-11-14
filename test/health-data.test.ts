import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBandDays, decodedJsonFields } from '../src/health-data';
import { publicUpstreamData } from '../src/upstream-data';

const base64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');
test('daily data decodes complete summary JSON and minute HR without inventing dates or binary activity units', () => {
  const payload = { data: [{ date_time: '2026-01-01', summary: base64({ slp: { ss: 80, future: 7 }, stp: { ttl: 900 }, extra: null }),
    data_hr: Buffer.from([0, 60, 253, 254, 255]).toString('base64'), data: 'AQID', newMetric: 17 }] };
  const result = decodeBandDays(payload);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual((result.days[0].decoded as any).summary, { slp: { ss: 80, future: 7 }, stp: { ttl: 900 }, extra: null });
  assert.equal((result.days[0].decoded as any).newMetric, 17);
  assert.deepEqual(result.days[0].heart_rate_minutes?.map(v => v.heart_rate_bpm), [null, 60, 253, null, null]);
  assert.equal(result.days[0].heart_rate_minutes?.[1].minute_of_day, 1);
  assert.equal(result.days[0].activity_binary_status, 'raw_preserved_format_unverified');
  assert.equal(payload.data[0].data, 'AQID');
});
test('invalid or unusual health data remains visible with explicit decoding warnings', () => {
  const r = decodeBandDays({ data: [{ summary: 'opaque', data_hr: 'not base64!' }, null] });
  assert.equal(r.warnings.length, 3);
  assert.equal((r.days[0].decoded as any).summary, 'opaque');
  assert.equal(r.days[0].heart_rate_minutes, null);
  assert.equal(decodeBandDays({ code: 1 }).warnings.length, 1);
});
test('JSON-in-JSON and base64 JSON exclude nested credentials while retaining unknown metrics', () => {
  const raw = { items: [{ extra: JSON.stringify({ spo2: 98, app_token: 'fixture-private' }),
    summary: base64({ future: 7, token: 'fixture-private' }), training_sessions: 3, session_id: 'fixture-private' }] };
  const upstream = publicUpstreamData(raw) as any;
  assert.deepEqual(JSON.parse(upstream.items[0].extra), { spo2: 98 });
  assert.deepEqual(JSON.parse(Buffer.from(upstream.items[0].summary, 'base64').toString()), { future: 7 });
  const decoded = decodedJsonFields(upstream) as any;
  assert.deepEqual(decoded.items[0], { extra: { spo2: 98 }, summary: { future: 7 }, training_sessions: 3 });
  assert.equal(JSON.stringify(decoded).includes('fixture-private'), false);
});
