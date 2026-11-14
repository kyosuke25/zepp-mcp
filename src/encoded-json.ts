/** JSON and Base64 JSON framing only; never infer compressed or binary formats. */
export type JsonEncoding = 'json' | 'base64_json';
export function decodeEmbeddedJson(value: string): { value: unknown; encoding: JsonEncoding } | null {
  const text = value.trim();
  if (/^[\[{]/.test(text)) {
    try { return { value: JSON.parse(text), encoding: 'json' }; } catch { return null; }
  }
  const base64 = text.replace(/[\t\n\r ]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (base64.length < 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
      .decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
    if (!/^\s*[\[{]/.test(decoded)) return null;
    return { value: JSON.parse(decoded), encoding: 'base64_json' };
  } catch { return null; }
}
export function encodeEmbeddedJson(value: unknown, encoding: JsonEncoding): string {
  const json = JSON.stringify(value);
  return encoding === 'json' ? json : btoa(Array.from(new TextEncoder().encode(json), b => String.fromCharCode(b)).join(''));
}
