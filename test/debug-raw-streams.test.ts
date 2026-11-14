import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debugRawStreams } from '../src/debug-raw-streams';
test('inventory covers every field, not just known metrics, including empty strings', () => {
  const result = debugRawStreams({ trackid: 1700000000, source: 'watch', power_meter: '0,250;1,260',
    future_dynamics: 'opaque', empty: '', version: 1, nested: {}, list: [], absent: null });
  assert.equal(result.fields.length, 9);
  assert.deepEqual(result.stream_keys, ['empty', 'future_dynamics', 'power_meter']);
  assert.deepEqual(result.streams.empty, { raw_prefix: '', length: 0, truncated: false });
  assert.equal(result.streams.power_meter.raw_prefix, '0,250;1,260');
});
test('per-field limit is exactly 8000 Unicode characters and full lengths remain available', () => {
  const result = debugRawStreams({ a: 'a'.repeat(8000), b: '🙂'.repeat(8001), c: 'x'.repeat(16000) });
  assert.equal(result.streams.a.truncated, false);
  assert.equal(Array.from(result.streams.b.raw_prefix).length, 8000);
  assert.equal(result.streams.b.length, 8001);
  assert.equal(result.streams.b.truncated, true);
  assert.equal(result.streams.c.length, 16000);
});
test('credential and identifying metadata fields never return raw values', () => {
  const result = debugRawStreams({ login_token: 'fixture-secret', password: 'fixture-secret',
    user_id: '42', device_id: 'fixture-secret', display_name: 'Fixture Runner', safe_stream: '1,2' });
  assert.deepEqual(result.stream_keys, ['safe_stream']);
  assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
});
