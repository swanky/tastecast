import { normName } from '../agent/match.js';

/** Qloo place categories that mean "someone else's shop". "Coffee shop" and "tea shop" are venues, not retail. */
const RETAIL = /\b(store|shopping|boutique|mall|outlet|department)\b/i;
const SHOP = /\bshop\b/i;
const VENUE_SHOP = /\b(coffee|tea|barber|bake|wine|juice)\s*shop\b/i;

export interface PlaceLike { name: string; area: string; kinds?: string[] }

/** A shoot location must not be another brand's retail space: the brief's product would be shown inside a
 *  competitor's store, and the shot would advertise that store. Brands named anywhere in the run's evidence
 *  are also kept out, so a place called "Burberry" is dropped even without category tags. */
export function shootability(p: PlaceLike, brandNames: string[]): { ok: true } | { ok: false; reason: string } {
  const retail = (p.kinds ?? []).find((k) => RETAIL.test(k) || (SHOP.test(k) && !VENUE_SHOP.test(k)));
  if (retail) return { ok: false, reason: `Qloo lists it as "${retail}", another brand's retail space` };
  const n = normName(p.name);
  const brand = brandNames.find((b) => normName(b).length >= 4 && n.includes(normName(b)));
  if (brand) return { ok: false, reason: `shares a name with the brand ${brand}` };
  return { ok: true };
}
