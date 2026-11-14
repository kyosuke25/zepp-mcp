import { decodeEmbeddedJson } from './encoded-json';
import { publicUpstreamData } from './upstream-data';

/** Independently implemented from published wire-format facts. Keep raw payloads
 * alongside decoded values; do not infer sleep dates, timezones, or unknown units.
 */
export function parseEmbeddedJson(value: string): { value: unknown; encoding: 'json' | 'base64_json' } | null {
  const parsed = decodeEmbeddedJson(value);
  return parsed ? { ...parsed, value: publicUpstreamData(parsed.value) } : null;
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
  const warnings: string[] = [];
  const records: { path: string; value: unknown }[] = [];
  function collect(value: unknown, path: string): void {
    if (Array.isArray(value)) {
      value.forEach((child, index) => {
        if (child && typeof child === 'object') collect(child, `${path}[${index}]`);
        else warnings.push(`day ${index}: unexpected shape; complete response preserved`);
      });
    } else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (Object.hasOwn(record, 'summary') || Object.hasOwn(record, 'data_hr') || Object.hasOwn(record, 'date_time')) records.push({ path, value });
      else for (const [key, child] of Object.entries(record)) collect(child, `${path}.${key}`);
    }
  }
  collect(payload.data ?? payload.items ?? payload, '$');
  if (!records.length && !(Array.isArray(payload.data) && payload.data.length === 0)) {
    warnings.push('no band day records recognized; complete response preserved');
  }
  const days = records.map(({ path, value }, index) => {
    const record = value as Record<string, unknown>;
    const decoded = decodedJsonFields(record) as Record<string, unknown>;
    const summary = decoded.summary && typeof decoded.summary === 'object' ? decoded.summary : null;
    const summaryEncoding = typeof record.summary === 'string' ? parseEmbeddedJson(record.summary)?.encoding
      : summary ? 'structured_json' : undefined;

    let hr: { minute_of_day: number; heart_rate_bpm: number | null }[] | null = null;
    if (typeof record.data_hr === 'string') {
      try {
        const bytes = Uint8Array.from(atob(record.data_hr), c => c.charCodeAt(0));
        hr = [...bytes].map((bpm, minute) => ({ minute_of_day: minute, heart_rate_bpm: bpm === 0 || bpm >= 254 ? null : bpm }));
      } catch { warnings.push(`day ${index}: invalid heart-rate base64; raw field preserved`); }
    }
    if (record.summary !== undefined && summary === null) warnings.push(`day ${index}: summary not decoded; raw field preserved`);
    return { index, path, summary, summary_decode: summaryEncoding ?? (record.summary === undefined ? 'not_present' : 'unrecognized'),
      decoded, heart_rate_minutes: hr,
      activity_binary_status: record.data ? 'raw_preserved_format_unverified' : 'not_present' };
  });
  return { days, warnings };
}
