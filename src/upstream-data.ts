/** Preserve upstream data except authentication material. Values also pass through
 * ZeppClient.redact before leaving MCP, removing known credential/token values.
 */
const secretKey = /^(?:access|refresh)$|password|passwd|token|secret|credential|authorization|cookie|^(?:session|session_?id|session_?key)$|(?:access|refresh|api|private)_?key/i;
export function publicUpstreamData(value: unknown): unknown {
  // Some endpoints embed JSON inside strings or base64; strip secret keys there
  // too, preserving the original encoding (and exact string if nothing changed).
  if (typeof value === 'string') {
    const isJson = /^\s*[\[{]/.test(value);
    const isBase64 = value.length >= 8 && /^[A-Za-z0-9+/\r\n]+={0,2}$/.test(value);
    if (isJson || isBase64) {
      try {
        const text = isJson ? value : new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
          .decode(Uint8Array.from(atob(value), c => c.charCodeAt(0)));
        if (/^\s*[\[{]/.test(text)) {
          const parsed = JSON.parse(text), clean = publicUpstreamData(parsed);
          if (JSON.stringify(parsed) !== JSON.stringify(clean)) {
            const json = JSON.stringify(clean);
            return isJson ? json : btoa(Array.from(new TextEncoder().encode(json), b => String.fromCharCode(b)).join(''));
          }
        }
      } catch { /* Opaque/binary data is retained, never logged. */ }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(publicUpstreamData);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !secretKey.test(key)).map(([key, child]) => [key, publicUpstreamData(child)]));
  return value;
}
