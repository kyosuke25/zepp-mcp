import { publicUpstreamData } from './upstream-data';

/** Preserve the complete sanitized response alongside normalized display values.
 * Tests use synthetic records.
 */
export function gearData(payload: Record<string, unknown>): {
  upstream: Record<string, unknown>; items: unknown[] | null;
  gear_by_id: Record<string, Record<string, unknown>[]>; warnings: string[];
} {
  const upstream = publicUpstreamData(payload) as Record<string, unknown>;
  const data = upstream.data;
  const rawItems = data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>).items : undefined;
  if (!Array.isArray(rawItems)) return { upstream, items: null, gear_by_id: {},
    warnings: ['unrecognized gear data.items shape; complete upstream response preserved'] };
  const byId = new Map<string, Record<string, unknown>[]>();
  const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
  for (const item of rawItems) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (!(typeof row.gearId === 'string' && row.gearId.length > 0) &&
      !(typeof row.gearId === 'number' && Number.isSafeInteger(row.gearId))) continue;
    const id = String(row.gearId);
    const nickname = typeof row.nickname === 'string' && row.nickname.trim() ? row.nickname : null;
    const model = typeof row.brandModel === 'string' && row.brandModel.trim() ? row.brandModel : null;
    const entry = { gearId: row.gearId, id: row.id ?? null, name: nickname ?? model,
      name_source: nickname ? 'nickname' : model ? 'brandModel' : null,
      total_distance_m: finite(row.totalDistanceM), initial_distance_m: finite(row.initialDistanceM) };
    const entries = byId.get(id) ?? [];
    entries.push(entry); byId.set(id, entries);
  }
  return { upstream, items: rawItems, gear_by_id: Object.fromEntries(byId), warnings: [] };
}
