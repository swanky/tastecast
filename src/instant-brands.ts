import { normName } from './agent/match.js';

/**
 * Reference brands whose Qloo results are stored ahead of time (scripts/precompute-instant.ts), so a judge who
 * types one gets the resolve and the full match from stored results: no new Qloo calls, no per-IP allowance used.
 * `query` is the exact search text whose Qloo response is stored; typed names are matched on normName and aliases.
 * Verdicts shown on the brief page come from the stored run, not from here.
 */
export interface InstantBrand { query: string; category: string; aliases?: string[] }
export const INSTANT_BRANDS: InstantBrand[] = [
  { query: 'Nike', category: 'sportswear' },
  { query: 'Starbucks', category: 'coffee' },
  { query: 'Glossier', category: 'beauty' },
  { query: 'Aesop', category: 'skincare' },
  { query: 'Stussy', category: 'streetwear', aliases: ['Stüssy'] },
  { query: 'Fender', category: 'guitars', aliases: ['Fender guitars'] },
  { query: 'Gentle Monster', category: 'eyewear' },
  { query: 'Tajín', category: 'snacks', aliases: ['Tajin'] },
  { query: 'Innisfree', category: 'skincare' },
  { query: 'Le Creuset', category: 'cookware' },
  { query: 'Blue Bottle Coffee', category: 'coffee', aliases: ['Blue Bottle'] },
];

const byName = new Map<string, InstantBrand>();
for (const b of INSTANT_BRANDS) for (const n of [b.query, ...(b.aliases ?? [])]) byName.set(normName(n), b);

export const instantBrand = (typed: string): InstantBrand | undefined => byName.get(normName(typed));
/** The stored search text for a typed instant brand ("stüssy " → "Stussy"); any other query is returned trimmed. */
export const canonicalQuery = (typed: string) => instantBrand(typed)?.query ?? typed.trim();
