import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { decodeWorkout } from '../src/decoder';

// Private data stays in the ignored directory. This test contains no real samples.
const fixturePath = new URL('./fixtures/local/fukuoka-2026-fixture.json', import.meta.url);
const present = existsSync(fixturePath);
type Metric = 'power_w' | 'stance_time_ms' | 'vertical_oscillation_mm' | 'vertical_ratio_pct';
interface Fixture {
  power_meter_raw_prefix: string;
  runPosture_raw_prefix: string;
  expected_first_1336: Record<Metric, (number | null)[]>;
}
// A prefix without a final semicolon may end midway through a numeric value,
// even if its column count looks complete. Drop that final element entirely.
function completePrefix(raw: string): string {
  return raw.slice(0, raw.lastIndexOf(';') + 1);
}
for (const metric of ['power_w', 'stance_time_ms', 'vertical_oscillation_mm', 'vertical_ratio_pct'] as const) {
  test(`local FIT regression: ${metric}`, { skip: !present }, () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;
    const field = metric === 'power_w' ? 'power_meter' : 'runPosture';
    const raw = completePrefix(field === 'power_meter' ? fixture.power_meter_raw_prefix : fixture.runPosture_raw_prefix);
    const inputCount = raw.split(';').length - 1;
    assert.ok(inputCount > 0, 'No complete input samples');
    // No original Zepp time column was supplied. FIT index defines seconds here.
    // Supply a regular clock long enough for the legacy positional implementation.
    const timeCount = inputCount + (field === 'power_meter' ? 1 : 0);
    const result = decodeWorkout({ trackid: 1700000000, time: ['0', ...Array(timeCount - 1).fill('1')].join(';'), [field]: raw });
    const actual = new Map(result.streams[field].map(r => [r.offset_s, r[metric]]));
    const expected = fixture.expected_first_1336[metric];
    const end = Math.min(expected.length - 1, Math.max(...actual.keys()));
    let pairs = 0, matches = 0, expectedAvailable = 0;
    const tolerance = metric === 'vertical_ratio_pct' ? 0.05 : 0;
    for (let offset = 0; offset <= end; offset++) {
      const reference = expected[offset], value = actual.get(offset);
      if (reference === null) continue;
      expectedAvailable++;
      if (typeof value !== 'number') continue;
      pairs++;
      if (Math.abs(value - reference) <= tolerance + 1e-9) matches++;
    }
    // Prevent accidental empty/short output from making a high match rate vacuous.
    assert.equal(pairs, expectedAvailable, 'Missing decoded observations in the covered non-null FIT window');
    assert.ok(pairs > 100, 'Insufficient comparison pairs');
    const required = metric === 'power_w' ? 0.93 : metric === 'vertical_ratio_pct' ? 0.95 : 1;
    const summary = { metric, input_samples: inputCount, compared_pairs: pairs, matches,
      match_rate: matches / pairs, required, tolerance };
    console.log(JSON.stringify(summary)); // Aggregate statistics only, never raw samples.
    assert.ok(matches / pairs >= required, `FIT regression threshold not met: ${JSON.stringify(summary)}`);
  });
}
