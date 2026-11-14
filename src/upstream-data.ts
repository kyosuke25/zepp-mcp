/** Preserve upstream data except authentication material. Values also pass through
 * ZeppClient.redact before leaving MCP, removing known credential/token values.
 */
const secretKey = /^(?:access|refresh)$|password|passwd|token|secret|credential|authorization|cookie|^(?:session|session_?id|session_?key)$|(?:access|refresh|api|private)_?key/i;
export function publicUpstreamData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicUpstreamData);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !secretKey.test(key)).map(([key, child]) => [key, publicUpstreamData(child)]));
  return value;
}
