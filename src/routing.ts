/** Normalize only routing hints, never copy raw redirect URLs or response maps. */
export const REGIONS = ['global', 'us', 'us2', 'us3', 'de', 'de2', 'cn', 'sg', 'sg2', 'in', 'ru'] as const;
export function normalizeRegion(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim().toLowerCase();
  const aliases: Record<string, string> = { 'us-west-2': 'us2', 'eu-central-1': 'de2', 'cn-north-1': 'cn' };
  return Object.hasOwn(aliases, name) ? aliases[name] : (REGIONS.some(r => r === name) ? name : undefined);
}
export function countryCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value) ? value : undefined;
}
export function apiOrigin(prefix: 'api-mifit' | 'api-user', region: string): string {
  if (!REGIONS.some(r => r === region)) throw new Error('Invalid normalized region');
  return `https://${prefix}${region === 'global' ? '' : `-${region}`}.zepp.com`;
}
export function dataRoute(value: unknown): { origin: string; region: string } | undefined {
  if (typeof value !== 'string') return undefined;
  // Full-string validation; no userinfo, path, query, fragment or alternate port.
  const match = /^(?:https:\/\/)?(api-mifit(?:-([a-z0-9]+))?\.(?:zepp|huami)\.com)\/?$/.exec(value.trim().toLowerCase());
  if (!match) return undefined;
  const region = normalizeRegion(match[2] ?? 'global');
  return region ? { origin: `https://${match[1]}`, region } : undefined;
}
function object(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
function shape(v: unknown): 'missing' | 'null' | 'string' | 'array' | 'object' | 'other' {
  return v === undefined ? 'missing' : v === null ? 'null' : typeof v === 'string' ? 'string'
    : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : 'other';
}
function routeHint(value: unknown) {
  // Only unambiguous one-host wrappers. Multiple hosts must not trigger probing.
  const unwrapped = Array.isArray(value) && value.length === 1 ? value[0] : value;
  return dataRoute(unwrapped) ?? dataRoute(object(unwrapped).host) ?? dataRoute(object(unwrapped).domain);
}
export function loginRouting(result: Record<string, unknown>) {
  const registration = object(result.regist_info);
  const rawRegions = [result.region, registration.region];
  const regionValues = rawRegions.flatMap(v => [v, object(v).region]);
  const region = regionValues.map(normalizeRegion).find(v => v !== undefined);
  const regionRoute = regionValues.map(routeHint).find(v => v !== undefined);
  const map = object(result.r);
  const mapped = [map['api-mifit.zepp.com'], map['api-mifit.huami.com']];
  const mappedRoute = mapped.map(routeHint).find(v => v !== undefined);
  return { route: mappedRoute ?? regionRoute, region,
    routeSource: mappedRoute ? 'login_response.r' : regionRoute ? 'login_response.region_host' : null,
    regionPresent: rawRegions.some(v => v !== undefined), mapPresent: mapped.some(v => v !== undefined),
    regionRecognized: !!(region || regionRoute), mapRecognized: !!mappedRoute,
    regionShape: shape(result.region !== undefined ? result.region : registration.region),
    country: countryCode(result.country_code ?? registration.country_code) };
}
