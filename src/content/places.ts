import { normName } from '../agent/match.js';

/** Qloo place categories that mean "someone else's shop". "Coffee shop" and "tea shop" are venues, not retail. */
const RETAIL = /\b(store|shopping|boutique|mall|outlet|department)\b/i;
const SHOP = /\bshop\b/i;
const VENUE_SHOP = /\b(coffee|tea|barber|bake|wine|juice)\s*shop\b/i;

/** Department-store and mall chains. Qloo often tags their in-store restaurants and cafés only as "Restaurant"
 *  ("Restaurante Liverpool" is inside a Liverpool department store), so the name is checked as well as the kinds. */
export const DEPARTMENT_STORES = [
  'El Palacio de Hierro', 'Palacio de Hierro', 'Sanborns', 'Sears', 'Suburbia', 'Coppel', 'Saks Fifth Avenue',
  "Macy's", 'Nordstrom', "Bloomingdale's", 'Neiman Marcus', 'Barneys', 'Harrods', 'Selfridges', 'Liberty London', 'John Lewis',
  'Harvey Nichols', 'Fortnum & Mason', 'Galeries Lafayette', 'Printemps', 'Le Bon Marché', 'KaDeWe', 'El Corte Inglés', 'Rinascente',
  'Isetan', 'Mitsukoshi', 'Takashimaya', 'Daimaru', 'Hankyu', 'Seibu', 'Sogo', 'Lotte Department Store', 'Lotte World Mall',
  'Shinsegae', 'Hyundai Department Store', 'Galleria Department Store', 'The Hyundai', 'Starfield',
];
/** Chains whose name is also a common place name: only checked in these cities ("Liverpool Street" in London is fine). */
export const CITY_SCOPED_STORES: Record<string, string[]> = { Liverpool: ['Mexico City', 'Guadalajara', 'Monterrey', 'Puebla'] };
const DEPT = [...DEPARTMENT_STORES, ...Object.keys(CITY_SCOPED_STORES)].map((d) => ({ d, re: new RegExp(`(^|[^\\p{L}\\p{N}])${d.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}($|[^\\p{L}\\p{N}])`, 'iu') }));
const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’]/g, "'");
/** The department-store chain a place name contains as whole words, if any. */
export const departmentStore = (name: string, city?: string) =>
  DEPT.find((x) => x.re.test(fold(name)) && (!CITY_SCOPED_STORES[x.d] || (!!city && CITY_SCOPED_STORES[x.d].includes(city))))?.d;

export interface PlaceLike { name: string; area: string; kinds?: string[] }

/** A shoot location must not be another brand's retail space: the brief's product would be shown inside a
 *  competitor's store, and the shot would advertise that store. Brands named anywhere in the run's evidence
 *  are also kept out, so a place called "Burberry" is dropped even without category tags. */
export function shootability(p: PlaceLike, brandNames: string[], city?: string): { ok: true } | { ok: false; reason: string } {
  const retail = (p.kinds ?? []).find((k) => RETAIL.test(k) || (SHOP.test(k) && !VENUE_SHOP.test(k)));
  if (retail) return { ok: false, reason: `Qloo lists it as "${retail}", another brand's retail space` };
  const dept = departmentStore(p.name, city);
  if (dept) return { ok: false, reason: `inside or named after the department store ${dept}, another brand's retail space` };
  const n = normName(p.name);
  const brand = brandNames.find((b) => normName(b).length >= 4 && n.includes(normName(b)));
  if (brand) return { ok: false, reason: `shares a name with the brand ${brand}` };
  return { ok: true };
}
