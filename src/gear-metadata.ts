import { publicUpstreamData } from './upstream-data';
/** Gear is workout metadata, never a sampled stream. Preserve upstream keys and
 * values, including compound attributes, excluding authentication material.
 */
export function gearMetadata(detail: Record<string, unknown>): Record<string, unknown> {
  return publicUpstreamData(Object.fromEntries(Object.entries(detail)
    .filter(([key]) => /^(?:gear|shoe)/i.test(key)))) as Record<string, unknown>;
}
