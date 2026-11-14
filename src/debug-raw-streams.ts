/** Temporary, authenticated inspection of string-valued stream candidates.
 * No decoding or additional network requests. Never log or persist the result.
 */
const LIMIT = 8000;
const metadata = new Set(['trackid', 'source', 'provider', 'version', 'name', 'nickname', 'display_name']);
const sensitive = /token|password|passwd|secret|authorization|cookie|credential|email|phone|(?:^|_)user_?id$|(?:^|_)third_?id$|(?:^|_)device_?id$/i;
export function debugRawStreams(detail: Record<string, unknown>) {
  const fields = Object.keys(detail).sort().map(key => ({ key,
    type: detail[key] === null ? 'null' : Array.isArray(detail[key]) ? 'array' : typeof detail[key] }));
  const streams: Record<string, { raw_prefix: string; length: number; truncated: boolean }> = {};
  const excluded_fields: { key: string; reason: string }[] = [];
  for (const { key, type } of fields) {
    if (sensitive.test(key)) { excluded_fields.push({ key, reason: 'sensitive_field' }); continue; }
    if (metadata.has(key)) { excluded_fields.push({ key, reason: 'metadata' }); continue; }
    if (type !== 'string') { excluded_fields.push({ key, reason: 'not_string' }); continue; }
    // Count Unicode code points, avoiding a second full-size string array.
    let length = 0, raw_prefix = '';
    for (const character of detail[key] as string) {
      if (length < LIMIT) raw_prefix += character;
      length++;
    }
    Object.defineProperty(streams, key, { value: { raw_prefix, length, truncated: length > LIMIT }, enumerable: true });
  }
  return { prefix_limit: LIMIT, length_unit: 'unicode_code_points', fields,
    stream_keys: Object.keys(streams), streams, excluded_fields };
}
