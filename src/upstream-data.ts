import { decodeEmbeddedJson, encodeEmbeddedJson } from './encoded-json';
/** Preserve upstream data except authentication material. Values also pass through
 * ZeppClient.redact before leaving MCP, removing known credential/token values.
 */
const secretKey = /^(?:access|refresh)$|password|passwd|token|secret|credential|authorization|cookie|^(?:session|session_?id|session_?key)$|(?:access|refresh|api|private)_?key/i;
export function publicUpstreamData(value: unknown): unknown {
  // Some endpoints embed JSON inside strings or base64; strip secret keys there
  // too, preserving the original encoding (and exact string if nothing changed).
  if (typeof value === 'string') {
    const parsed = decodeEmbeddedJson(value);
    if (parsed) {
      const clean = publicUpstreamData(parsed.value);
      if (JSON.stringify(parsed.value) !== JSON.stringify(clean)) return encodeEmbeddedJson(clean, parsed.encoding);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(publicUpstreamData);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !secretKey.test(key)).map(([key, child]) => [key, publicUpstreamData(child)]));
  return value;
}
