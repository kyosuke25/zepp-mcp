/** Textual delta formats independently reimplemented from documented fields:
 * https://github.com/H3llK33p3r/zepp-fit-extractor (ZeppRestClient.kt field comments).
 * No source code copied. Sparse observations: no interpolation or forward fill.
 */
export class DecodeError extends Error {}
export type Observation = { offset_s: number; timestamp: string; [key: string]: number | string | null };
export type DecodedWorkout = ReturnType<typeof decodeWorkout>;
const positionalFields = ['longitude_latitude', 'altitude', 'accuracy', 'pace'] as const;
const timedFields = ['heart_rate', 'gait', 'speed', 'distance', 'power_meter', 'runPosture'] as const;

function cells(value: unknown, field: string): string[] {
  if (value === undefined || value === null || value === '') return [];
  if (typeof value !== 'string') throw new DecodeError(`${field}: expected encoded string`);
  const parts = value.split(';');
  if (parts.at(-1) === '') parts.pop(); // Keep interior missing positions.
  return parts;
}
function numeric(value: string | number, field: string, integer = false): number {
  if (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    throw new DecodeError(`${field}: invalid numeric cell`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || (integer && !Number.isSafeInteger(n))) {
    throw new DecodeError(`${field}: invalid numeric cell`);
  }
  return n;
}
export function decodeWorkout(detail: Record<string, unknown>, startTime?: string | number) {
  const rawStart = startTime ?? detail.trackid;
  if (typeof rawStart !== 'string' && typeof rawStart !== 'number') throw new DecodeError('trackid: missing Unix start time');
  const start = numeric(rawStart, 'trackid', true);
  const streams: Record<string, Observation[]> = {};
  const warnings: string[] = [];
  const sampleAlignment: Record<string, { mode: 'delta_seconds'; input_samples: number;
    time_samples: number; time_offset_s: number; zero_delta_samples: number; gap_delta_samples: number }> = {};
  function row(t: number, values: Record<string, number | string | null> = {}): Observation {
    if (t < 0 || !Number.isSafeInteger(t) || !Number.isFinite(new Date((start + t) * 1000).getTime())) {
      throw new DecodeError('time: timestamp outside supported range');
    }
    return { offset_s: t, timestamp: new Date((start + t) * 1000).toISOString(), ...values };
  }
  let elapsed = 0;
  const times = cells(detail.time, 'time').map(cell => {
    const dt = numeric(cell, 'time', true);
    if (dt < 0) throw new DecodeError('time: negative delta');
    elapsed += dt;
    return elapsed;
  });
  for (const field of positionalFields) {
    const input = cells(detail[field], field);
    if (!input.length) continue;
    if (input.length !== times.length) throw new DecodeError(`${field}: sample count differs from time`);
    let lat = 0, lon = 0;
    streams[field] = [];
    input.forEach((cell, index) => {
      if (cell === '') return;
      let values: Record<string, number | null>;
      if (field === 'longitude_latitude') {
        const pair = cell.split(',');
        if (pair.length !== 2) throw new DecodeError('longitude_latitude: expected two columns');
        // Wire order is LAT,LON, despite the API field name. First pair absolute.
        lat += numeric(pair[0], field, true);
        lon += numeric(pair[1], field, true);
        if (Math.abs(lat) > 90e8 || Math.abs(lon) > 180e8) throw new DecodeError('longitude_latitude: coordinate outside range');
        values = { latitude: lat / 1e8, longitude: lon / 1e8 };
      } else {
        const n = numeric(cell, field);
        const key = { altitude: 'altitude_m', accuracy: 'accuracy_m', pace: 'pace_s_per_m' }[field];
        values = { [key]: field === 'altitude' ? (n === -2000000 ? null : n / 100) : n };
      }
      streams[field].push(row(times[index], values));
    });
  }
  for (const field of timedFields) {
    const input = cells(detail[field], field);
    if (!input.length) continue;
    elapsed = 0;
    const ownClock = field === 'power_meter' || field === 'runPosture';
    if (ownClock) sampleAlignment[field] = { mode: 'delta_seconds', input_samples: input.length,
      time_samples: times.length, time_offset_s: 0, zero_delta_samples: 0, gap_delta_samples: 0 };
    let total = 0;
    streams[field] = input.map(cell => {
      const cols = cell.split(',');
      if (field === 'gait' ? ![3, 4].includes(cols.length) : cols.length !== (field === 'runPosture' ? 4 : 2)) {
        throw new DecodeError(`${field}: unexpected column count`);
      }
      const dt = numeric(ownClock ? cols[0] : cols[0] || '1', field, true);
      if (dt < 0) throw new DecodeError(`${field}: negative time delta`);
      elapsed += dt;
      if (ownClock) {
        if (dt === 0) sampleAlignment[field].zero_delta_samples++;
        if (dt > 1) sampleAlignment[field].gap_delta_samples++;
      }
      let values: Record<string, number | string | null>;
      if (field === 'heart_rate') {
        total += numeric(cols[1], field, true);
        values = { heart_rate_bpm: total };
      } else if (field === 'gait') {
        const steps = numeric(cols[1], field, true);
        total += steps;
        const supplied = cols.length === 4 && cols[3] !== '';
        const cadence = supplied ? numeric(cols[3], field) : dt > 0 ? steps * 60 / dt : null;
        values = { steps: total, step_delta: steps, stride_m: numeric(cols[2], field) / 100,
          cadence_spm: cadence, cadence_source: supplied ? 'gait_frequency' : 'interval_steps' };
      } else if (field === 'power_meter') {
        // Local FIT regression proves column 1 is a seconds delta, not a flag.
        // The first power delta is typically 1; posture typically starts at 0.
        values = { power_w: numeric(cols[1], field), power_time_delta_s: dt };
      } else if (field === 'runPosture') {
        const stance = numeric(cols[1], field, true);
        const oscillation = numeric(cols[2], field, true);
        const ratio = numeric(cols[3], field, true);
        values = { stance_time_ms: stance === 65535 ? null : stance,
          vertical_oscillation_mm: oscillation === 65535 ? null : oscillation,
          vertical_ratio_pct: ratio === 255 ? null : ratio / 10, run_posture_time_delta_s: dt };
      } else if (field === 'distance') {
        total += numeric(cols[1], field);
        values = { distance_m: total };
      } else values = { speed_m_per_s: numeric(cols[1], field) };
      return row(elapsed, values);
    });
  }
  const timeline = new Map<number, Observation>();
  for (const [field, observations] of Object.entries(streams)) {
    const seen = new Set<number>();
    for (const observation of observations) {
      const t = observation.offset_s;
      const warning = `${field}: duplicate timestamps; timeline uses last observation`;
      if (seen.has(t) && !warnings.includes(warning)) warnings.push(warning);
      seen.add(t);
      timeline.set(t, { ...timeline.get(t), ...observation });
    }
  }
  const unsupported = ['cadence', 'stroke_speed', 'air_pressure_altitude', 'correct_altitude'].filter(k => detail[k]);
  if (unsupported.length) warnings.push(`Unsupported streams: ${unsupported.join(', ')}`);
  return { start_time_unix: start, streams, sample_alignment: sampleAlignment,
    sample_counts: Object.fromEntries(Object.entries(streams).map(([k, v]) => [k, v.length])),
    timeline: [...timeline.values()].sort((a, b) => a.offset_s - b.offset_s), warnings };
}
