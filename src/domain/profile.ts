import { demographicsOf, entitiesOf, tagsOf, type QlooClient } from '../qloo/client.js';
import { AGE_BUCKETS, type AgeBucket } from '../qloo/types.js';
import { EvidenceLedger, type Evidence } from '../agent/evidence.js';
import { CHARACTERS, TAG_TYPES, type CharacterDef } from './characters.js';
import { average, peakBucket, type DemoVector } from './score.js';

export interface ResolvedSeed { name: string; type: string; id: string; matchedName: string }
export interface DriftCheck { statedBucket: AgeBucket; seedPeakBucket: AgeBucket; level: 'none' | 'adjacent' | 'drift'; flagged: boolean; bucketGap: number; vector: DemoVector; message: string }
export interface CharacterProfile {
  slug: string;
  seeds: ResolvedSeed[];
  houseBrandId: string;
  demo: DemoVector;
  drift: DriftCheck;
  tags: { id: string; name: string }[];
  tasteTags: { id: string; name: string }[];
  places: { name: string; area: string; kinds?: string[] }[];
  evidence: Evidence[];
  builtAt: string;
}

export const PROFILES_KEY = 'profiles:all';

const BUCKET_LABEL: Record<AgeBucket, string> = {
  '24_and_younger': '24 and younger', '25_to_29': '25–29', '30_to_34': '30–34', '35_to_44': '35–44', '45_to_54': '45–54', '55_and_older': '55 and older',
};
export const bucketLabel = (b: AgeBucket) => BUCKET_LABEL[b];

/** Drift rule: flag when the seeds peak two or more Qloo age buckets away from the stated bucket, or when the
 *  stated bucket's affinity is not positive. One bucket apart with a positive stated affinity is reported as
 *  'adjacent' (Qloo buckets are coarse; neighbouring peaks are within noise). */
export function driftCheck(c: CharacterDef, v: DemoVector): DriftCheck {
  const peak = peakBucket(v);
  const gap = Math.abs(AGE_BUCKETS.indexOf(peak) - AGE_BUCKETS.indexOf(c.ageBucket));
  const level: DriftCheck['level'] = gap >= 2 || v.age[c.ageBucket] <= 0 ? 'drift' : gap === 1 ? 'adjacent' : 'none';
  const message = level === 'drift'
    ? `${c.name} is ${c.statedAge} (Qloo bucket ${bucketLabel(c.ageBucket)}), but her taste seeds peak at ${bucketLabel(peak)}, ${gap} buckets older. Briefs aimed at ${bucketLabel(c.ageBucket)} audiences should weigh this gap.`
    : level === 'adjacent'
      ? `${c.name}'s seeds peak one bucket away (${bucketLabel(peak)}) and stay strong in her stated bucket (${bucketLabel(c.ageBucket)}, ${v.age[c.ageBucket]}). Within tolerance.`
      : `${c.name}'s taste seeds peak in her stated bucket (${bucketLabel(c.ageBucket)}). No drift.`;
  return { statedBucket: c.ageBucket, seedPeakBucket: peak, level, flagged: level === 'drift', bucketGap: gap, vector: v, message };
}

/** P1–P4 from the spike's recommended usage. About 19 Qloo calls for 3 characters on a cold cache. */
export async function buildProfiles(qloo: QlooClient, chars: CharacterDef[] = CHARACTERS): Promise<CharacterProfile[]> {
  const resolved = new Map<string, ResolvedSeed[]>();
  for (const c of chars) {
    const seeds: ResolvedSeed[] = [];
    for (const s of c.seeds) {
      const { data } = await qloo.get('/search', { query: s.name, types: s.type, take: '3' }, `precompute:search:${c.slug}`);
      const list = entitiesOf(data);
      const exact = list.find((e) => e.name.toLowerCase() === s.name.toLowerCase()) ?? list[0];
      if (!exact) throw new Error(`Seed not found on Qloo: ${s.name}`);
      seeds.push({ name: s.name, type: s.type, id: exact.entity_id, matchedName: exact.name });
    }
    resolved.set(c.slug, seeds);
  }
  const allIds = [...resolved.values()].flat().map((s) => s.id);
  const demoParams = { 'filter.type': 'urn:demographics', 'signal.interests.entities': allIds.join(',') };
  const demoRes = await qloo.get('/v2/insights', demoParams, 'precompute:demographics');
  const rows = new Map(demographicsOf(demoRes.data).map((r) => [r.entity_id, r.query]));

  const out: CharacterProfile[] = [];
  for (const c of chars) {
    const seeds = resolved.get(c.slug)!;
    const ev = new EvidenceLedger(new Map(seeds.map((s) => [s.id, s.matchedName])));
    const ids = seeds.map((s) => s.id);
    const vectors: DemoVector[] = ids.filter((i) => rows.has(i)).map((i) => ({ age: rows.get(i)!.age, female: rows.get(i)!.gender.female }));
    if (vectors.length === 0) throw new Error(`No demographics for ${c.slug}`);
    const demo = average(vectors);
    const sub = { ...demoParams, 'signal.interests.entities': ids.join(',') };
    ev.add('profile:demographics', '/v2/insights', sub, seeds.map((s) => s.matchedName), demoRes.cached, 'Seed age and gender affinities, averaged');

    const tagParams = { 'filter.type': 'urn:tag', 'signal.interests.entities': ids.join(','), 'filter.tag.types': TAG_TYPES, 'signal.location.query': c.city, take: '20' };
    const t = await qloo.get('/v2/insights', tagParams, `precompute:tags:${c.slug}`);
    const tags = tagsOf(t.data).map((x) => ({ id: x.tag_id, name: x.name }));
    ev.add('profile:tags', '/v2/insights', tagParams, tags.map((x) => x.name), t.cached);

    // Like-for-like with the live brand-tag call (no location), so the taste overlap compares the same kind of list.
    const tasteParams = { 'filter.type': 'urn:tag', 'signal.interests.entities': ids.join(','), 'filter.tag.types': TAG_TYPES, take: '20' };
    const tt = await qloo.get('/v2/insights', tasteParams, `precompute:taste-tags:${c.slug}`);
    const tasteTags = tagsOf(tt.data).map((x) => ({ id: x.tag_id, name: x.name }));
    ev.add('profile:taste-tags', '/v2/insights', tasteParams, tasteTags.map((x) => x.name), tt.cached);

    const placeParams = { 'filter.type': 'urn:entity:place', 'signal.interests.entities': ids.join(','), 'filter.location.query': c.city, take: '12' };
    const p = await qloo.get('/v2/insights', placeParams, `precompute:places:${c.slug}`);
    const places = entitiesOf(p.data).map((e) => ({
      name: e.name,
      area: String((e.properties as Record<string, unknown> | undefined)?.neighborhood ?? e.disambiguation ?? ''),
      // Qloo category tags ("Clothing store", "Hotel", ...): used to keep other brands' shops out of shot lists.
      kinds: [...new Set((e.tags ?? []).filter((t) => /^urn:tag:(category|genre):place/.test(t.type ?? '')).map((t) => t.name))],
    }));
    ev.add('profile:places', '/v2/insights', placeParams, places.map((x) => x.name), p.cached);

    const house = seeds.find((s) => s.name === c.houseBrand);
    if (!house) throw new Error(`House brand missing for ${c.slug}`);
    out.push({ slug: c.slug, seeds, houseBrandId: house.id, demo, drift: driftCheck(c, demo), tags, tasteTags, places, evidence: ev.items, builtAt: new Date().toISOString() });
  }
  return out;
}
