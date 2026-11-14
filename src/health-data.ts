import { publicUpstreamData } from './upstream-data';

/** Independently implemented from published wire-format facts. Keep raw payloads
 * alongside decoded values; do not infer sleep dates, timezones, or unknown units.
 */
export function parseEmbeddedJson(value: string): { value: unknown; encoding: 'json' | 'base64_json' } | null {
  for (const encoding of ['json', 'base64_json'] as const) {
    if (encoding === 'json' && !/^\s*[\[{]/.test(value)) continue;
    if (encoding === 'base64_json' && (value.length < 8 || !/^[A-Za-z0-9+/\r\n]+={0,2}$/.test(value))) continue;
    try {
      const text = encoding === 'json' ? value : new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
        .decode(Uint8Array.from(atob(value), c => c.charCodeAt(0)));
      if (!/^[\s]*[\[{]/.test(text)) continue;
      return { value: publicUpstreamData(JSON.parse(text)), encoding };
    } catch { /* A non-JSON or binary value remains raw. */ }
  }
  return null;
}
export function decodedJsonFields(value: unknown): unknown {
  if (typeof value === 'string') {
    const parsed = parseEmbeddedJson(value);
    return parsed ? decodedJsonFields(parsed.value) : value;
  }
  if (Array.isArray(value)) return value.map(decodedJsonFields);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, child]) => [key, decodedJsonFields(child)]));
  return value;
}
export function decodeBandDays(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.data)) return { days: [], warnings: ['band data is not an array; upstream response preserved'] };
  const warnings: string[] = [];
  const days = payload.data.map((day, index) => {
    if (!day || typeof day !== 'object' || Array.isArray(day)) {
      warnings.push(`day ${index}: unexpected shape; upstream value preserved`);
      return { index, decoded: day };
    }
    const record = day as Record<string, unknown>;
    const decoded = decodedJsonFields(record);
    let hr: { minute_of_day: number; heart_rate_bpm: number | null }[] | null = null;
    if (typeof record.data_hr === 'string') {
      try {
        const bytes = Uint8Array.from(atob(record.data_hr), c => c.charCodeAt(0));
        hr = [...bytes].map((bpm, minute) => ({ minute_of_day: minute, heart_rate_bpm: bpm === 0 || bpm >= 254 ? null : bpm }));
      } catch { warnings.push(`day ${index}: invalid heart-rate base64; raw field preserved`); }
    }
    if (typeof record.summary === 'string' && !parseEmbeddedJson(record.summary)) warnings.push(`day ${index}: summary not decoded; raw field preserved`);
    return { index, decoded, heart_rate_minutes: hr,
      activity_binary_status: record.data ? 'raw_preserved_format_unverified' : 'not_present' };
  });
  return { days, warnings };
}
