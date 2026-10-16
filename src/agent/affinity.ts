import { entitiesOf, type QlooClient } from '../qloo/client.js';
import type { KV } from '../store/kv.js';
import type { CharacterProfile } from '../domain/profile.js';
import { round } from '../domain/score.js';

/**
 * Qloo taste index ("reverse affinity").
 * One query per brief asks Qloo: among fans of the reference brand, how strong is the affinity for each character's seeds?
 * Every character is scored inside the SAME query, so the numbers are directly comparable.
 * Raw affinities are compressed (0.7–0.96) and popular seeds score high for any brand, so each seed is compared
 * with its own baseline: the mean and spread of its affinity among fans of a fixed panel of everyday brands.
 */
export const PANEL_NAMES = ['Starbucks', 'Nike', 'Uniqlo', 'IKEA', 'Patagonia', 'L.L.Bean'] as const;
/** Seed types the index can cover. Milestone 3 measures whether adding TV and film (1 seed each) helps; see FULL_TYPES / CORE_TYPES. */
export const CORE_TYPES = ['urn:entity:artist', 'urn:entity:brand'] as const;
export const FULL_TYPES = ['urn:entity:artist', 'urn:entity:brand', 'urn:entity:tv_show', 'urn:entity:movie'] as const;
export type IndexTypes = readonly string[];
/** Default used by the app since milestone 3: all four seed types (coverage 10/12 → 12/12 seeds on 19 briefs, +2 calls per brief). */
export const INDEX_TYPES: IndexTypes = FULL_TYPES;
export const BASELINE_KEY = 'profiles:baseline';

export interface SeedStat { mean: number; sd: number; n: number }
export interface Baseline { panel: string[]; seeds: Record<string, SeedStat>; builtAt: string }
export interface SeedAffinity { seedId: string; name: string; affinity: number; baseline: number; lift: number; z: number }
export interface TasteIndex { z: number; lift: number; seeds: SeedAffinity[]; covered: number; total: number }

export function indexSeedIds(profiles: CharacterProfile[], type: string): string[] {
  return profiles.flatMap((p) => p.seeds.filter((s) => s.type === type).map((s) => s.id));
}

export function reverseParams(profiles: CharacterProfile[], brandId: string, type: string, city?: string): Record<string, string> {
  const p: Record<string, string> = { 'filter.type': type, 'signal.interests.entities': brandId, 'filter.results.entities': indexSeedIds(profiles, type).join(','), take: '10' };
  if (city) p['signal.location.query'] = city;
  return p;
}

/** 2 Qloo calls (artist seeds, brand seeds). Returns seedId → affinity among the brand's fans (optionally in one city). */
export async function reverseAffinity(qloo: QlooClient, profiles: CharacterProfile[], brandId: string, tag: string, city?: string, types: IndexTypes = INDEX_TYPES) {
  const aff = new Map<string, number>();
  const calls: { params: Record<string, string>; cached: boolean; results: string[] }[] = [];
  for (const type of types) {
    if (!indexSeedIds(profiles, type).length) continue;
    const params = reverseParams(profiles, brandId, type, city);
    const r = await qloo.get('/v2/insights', params, `${tag}:${type.split(':').pop()}`);
    const ents = entitiesOf(r.data);
    for (const e of ents) if (typeof e.query?.affinity === 'number') aff.set(e.entity_id, e.query.affinity);
    calls.push({ params, cached: r.cached, results: ents.map((e) => `${e.name} (${round(e.query?.affinity ?? 0, 3)})`) });
  }
  return { aff, calls };
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

/** Precompute: 6 panel searches + 12 reverse calls on a cold cache. */
export async function buildBaseline(qloo: QlooClient, profiles: CharacterProfile[], types: IndexTypes = FULL_TYPES): Promise<Baseline> {
  const values = new Map<string, number[]>();
  const panel: string[] = [];
  for (const name of PANEL_NAMES) {
    const r = await qloo.get('/search', { query: name, types: 'urn:entity:brand', take: '3' }, 'precompute:panel-search');
    const e = entitiesOf(r.data).find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? entitiesOf(r.data)[0];
    if (!e) throw new Error(`Panel brand not found on Qloo: ${name}`);
    panel.push(e.name);
    const { aff } = await reverseAffinity(qloo, profiles, e.entity_id, `precompute:panel:${name}`, undefined, types);
    for (const [id, v] of aff) values.set(id, [...(values.get(id) ?? []), v]);
  }
  const seeds: Record<string, SeedStat> = {};
  for (const [id, xs] of values) seeds[id] = { mean: round(mean(xs), 4), sd: round(sd(xs), 4), n: xs.length };
  return { panel, seeds, builtAt: new Date().toISOString() };
}

export async function loadBaseline(kv: KV) { return kv.get<Baseline>(BASELINE_KEY); }

/** Minimum spread used for z, so a seed with a near-constant baseline cannot blow up the index. */
export const MIN_SD = 0.02;

export function tasteIndex(p: CharacterProfile, aff: Map<string, number>, base: Baseline, types: IndexTypes = INDEX_TYPES): TasteIndex {
  const covered = p.seeds.filter((s) => types.includes(s.type));
  const seeds: SeedAffinity[] = [];
  for (const s of covered) {
    const a = aff.get(s.id); const b = base.seeds[s.id];
    if (a === undefined || !b) continue;
    const lift = a - b.mean;
    seeds.push({ seedId: s.id, name: s.matchedName, affinity: round(a, 3), baseline: round(b.mean, 3), lift: round(lift, 3), z: round(lift / Math.max(b.sd, MIN_SD), 2) });
  }
  return {
    z: seeds.length ? round(mean(seeds.map((x) => x.z)), 2) : 0,
    lift: seeds.length ? round(mean(seeds.map((x) => x.lift)), 3) : 0,
    seeds, covered: seeds.length, total: p.seeds.length,
  };
}

/** Maps the index (in baseline standard deviations) onto 0..1. ±3σ saturates. */
export function indexScore(z: number): number { return Math.max(0, Math.min(1, 0.5 + z / 6)); }
