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

/** Categories where a hotel, bar or club is the natural setting, so the hospitality filter below is skipped. */
const HOSPITALITY_CATEGORY = /\b(hotels?|hospitality|travel|tourism|pubs?|night ?life|nightclubs?|spirits?|liquor|beer|wine|cocktails?|mezcal|tequila|whisk(?:e)?y|gin|vodka|champagne|restaurants?|dining)\b/i;
export const isHospitalityCategory = (text: string) => HOSPITALITY_CATEGORY.test(text);

/** Place kinds that make a poor everyday backdrop for a non-hospitality product: hotels, bars, members' clubs. */
const NIGHTLIFE = /\b(hotel|motel|hostel|resort|bar|pub|night ?club|social club|members'? club|lounge|casino|cocktail)\b/i;
const CAFE = /\b(cafe|café|coffee|tea ?(?:house|room|shop)|bakery)\b/i;
/** A named cuisine ("Mediterranean restaurant") means the place is a restaurant first, even if Qloo also tags "Bar". */
const CUISINE = /\S+ restaurant\b/i;
/** Luxury dining that reads as a hospitality setting rather than everyday life. */
const LUXE_NAME = /\b(caviar|champagne|oyster)\b/i;
/** Public, everyday places: preferred shoot locations (the allow-list), first by name, then by Qloo kind. */
const PUBLIC_NAME = /\b(park|parque|avenue|avenida|street|calle|plaza|square|market|mercado|garden|gardens|jard[ií]n|museum|museo|gallery|library|biblioteca|bridge|beach|promenade)\b/i;
const PUBLIC_KIND = /\b(park|garden|market|museum|art gallery|gallery|library|plaza|square|tourist attraction|cafe|café|coffee shop|tea house|bakery|book ?store)\b/i;

/** 0 = public everyday place or café (preferred), 1 = other venue (restaurant, no kinds). */
export function placeTier(p: PlaceLike): 0 | 1 {
  if (PUBLIC_NAME.test(p.name) && !/\bhotel\b/i.test(p.name)) return 0;
  return (p.kinds ?? []).some((k) => PUBLIC_KIND.test(k)) ? 0 : 1;
}

/** Hotels, bars, clubs and caviar-type dining are left out of the shoot list unless the brief is a hospitality
 *  product. A public place named as such ("Reforma Avenue") stays even if Qloo also tags it "Hotel". */
export function hospitalityReason(p: PlaceLike, category: string): string | null {
  if (isHospitalityCategory(category)) return null;
  if (PUBLIC_NAME.test(p.name) && !/\b(hotel|bar|club)\b/i.test(p.name)) return null;
  if (LUXE_NAME.test(p.name)) return 'luxury dining, a hospitality setting rather than everyday life for this product';
  const kinds = p.kinds ?? [];
  const nameHit = p.name.match(/\b(hotel|bar|club|lounge)\b/i)?.[0] ?? p.name.match(/(bar|club)$/i)?.[0];
  const cafe = kinds.some((k) => CAFE.test(k)) || CAFE.test(p.name);
  const cuisine = kinds.some((k) => CUISINE.test(k) && !/^(bar|seafood)/i.test(k));
  const kind = kinds.find((k) => NIGHTLIFE.test(k));
  if (kind && /hotel|motel|hostel|resort|club|casino/i.test(kind)) return `Qloo lists it as "${kind}", a hospitality setting rather than everyday life for this product`;
  if (nameHit && !cafe) return `a ${nameHit.toLowerCase()} by name, a hospitality setting rather than everyday life for this product`;
  if (kind && !cafe && !cuisine) return `Qloo lists it as "${kind}", a hospitality setting rather than everyday life for this product`;
  return null;
}

/** A shoot location must not be another brand's retail space: the brief's product would be shown inside a
 *  competitor's store, and the shot would advertise that store. Brands named anywhere in the run's evidence
 *  are also kept out, so a place called "Burberry" is dropped even without category tags. For a non-hospitality
 *  category (pass the brief's category and product), hotels, bars, clubs and caviar-type dining are left out too. */
export function shootability(p: PlaceLike, brandNames: string[], city?: string, category = ''): { ok: true } | { ok: false; reason: string } {
  const retail = (p.kinds ?? []).find((k) => RETAIL.test(k) || (SHOP.test(k) && !VENUE_SHOP.test(k)));
  if (retail) return { ok: false, reason: `Qloo lists it as "${retail}", another brand's retail space` };
  const dept = departmentStore(p.name, city);
  if (dept) return { ok: false, reason: `inside or named after the department store ${dept}, another brand's retail space` };
  const n = normName(p.name);
  const brand = brandNames.find((b) => normName(b).length >= 4 && n.includes(normName(b)));
  if (brand) return { ok: false, reason: `shares a name with the brand ${brand}` };
  const hosp = hospitalityReason(p, category);
  if (hosp) return { ok: false, reason: hosp };
  return { ok: true };
}
