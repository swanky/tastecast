import { demographicsOf, entitiesOf, tagsOf, type QlooClient } from '../qloo/client.js';
import { CHARACTERS, TAG_TYPES, type CharacterDef } from '../domain/characters.js';
import type { CharacterProfile } from '../domain/profile.js';
import { combine, cosine, fitScore, round, tagOverlap, toArray, type DemoVector } from '../domain/score.js';
import { EvidenceLedger, type Evidence } from './evidence.js';
import { shootability } from '../content/places.js';
import { INDEX_TYPES, indexScore, reverseAffinity, tasteIndex, type Baseline, type IndexTypes, type TasteIndex } from './affinity.js';

export const CHANNELS = ['instagram', 'tiktok', 'youtube', 'web', 'ooh'] as const;
export type Channel = (typeof CHANNELS)[number];

export interface Brief {
  brandName: string;
  referenceQuery: string;
  category: string;
  product: string;
  channels: Channel[];
  durationMonths: number;
  city?: string;
  /** Character requested from a character page. All three are still ranked; the package is built for this one. */
  character?: string;
}

export interface Candidate { id: string; name: string; disambiguation: string; popularity: number | null; exact: boolean }

/** Accent-, case- and punctuation-insensitive name comparison ("Stussy" = "Stüssy"). */
export const normName = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export interface RankedCharacter {
  slug: string;
  name: string;
  city: string;
  score: number;
  parts: { index: number; indexZ: number; indexLift: number; audience: number; taste: number; fit: number; cosine: number };
  index: TasteIndex;
  sharedTags: string[];
  fitRank: number | null;
  fitCandidates: number;
  topSeed: { name: string; score: number } | null;
  drift: CharacterProfile['drift'];
  why: { text: string; sourceIds: string[] }[];
  tiebreak?: string;
}

export interface LocalFindings {
  city: string;
  angles: { name: string; evidenceId: string }[];
  artists: { name: string; evidenceId: string }[];
  brands: { name: string; evidenceId: string }[];
  places: { name: string; area: string; evidenceId: string }[];
  /** Places Qloo returned that are not used as shoot locations, with the reason (other brands' stores). */
  excludedPlaces?: { name: string; reason: string; evidenceId: string }[];
}

export interface MatchCore {
  brief: Brief;
  brand: { id: string; name: string };
  ranking: RankedCharacter[];
  decision: Decision;
  featured: { slug: string; requested: boolean; rank: number; note: string };
  local: LocalFindings;
  evidence: Evidence[];
  qloo: { calls: number; cached: number };
}

const char = (slug: string) => CHARACTERS.find((c) => c.slug === slug)!;

export async function resolveBrand(qloo: QlooClient, query: string): Promise<{ candidates: Candidate[]; evidence: Evidence }> {
  const params = { query, types: 'urn:entity:brand', take: '5' };
  const { data, cached } = await qloo.get('/search', params, 'live:resolve');
  const candidates = entitiesOf(data).map((e) => ({ id: e.entity_id, name: e.name, disambiguation: e.disambiguation ?? '', popularity: e.popularity ?? null, exact: normName(e.name) === normName(query) }));
  const ev = new EvidenceLedger();
  ev.add('resolve', '/search', params, candidates.map((c) => c.name), cached);
  return { candidates, evidence: ev.items[0] };
}

export interface Decision {
  level: 'clear' | 'close';
  margin: number;
  threshold: number;
  indexLeaderZ: string;
  indexLeaderLift: string;
  alternatives: string[];
  tradeoffs: { slug: string; text: string }[];
  text: string;
  /** Why the verdict is what it is, for the banner: 'decided', 'lead-below-threshold', 'measures-disagree', 'index-disagrees', 'no-data', 'baseline-brand'. */
  reason?: 'decided' | 'lead-below-threshold' | 'measures-disagree' | 'index-disagrees' | 'no-data' | 'baseline-brand';
}

/** Success threshold for "Qloo decided": winner leads by at least this much on the combined score. Stated before the milestone-2 run. */
export const CLEAR_MARGIN = 0.08;

export interface RankResult { ranking: RankedCharacter[]; decision: Decision; calls: number; cached: number }

/**
 * L2–L4. Must only run after the user confirmed the brand. Cold cache: demographics 1 + reverse affinity 2,
 * plus brand tags 1 + fit 3 when context is on (context lines are shown but carry no weight).
 */
export async function rankCharacters(qloo: QlooClient, profiles: CharacterProfile[], baseline: Baseline, brief: Brief, brand: { id: string; name: string }, ev: EvidenceLedger, opts: { context: boolean; indexTypes?: IndexTypes } = { context: true }): Promise<RankResult> {
  let calls = 0, cachedCalls = 0;
  const q = async (params: Record<string, string>, tag: string) => {
    const r = await qloo.get('/v2/insights', params, tag);
    calls++; if (r.cached) cachedCalls++;
    return r;
  };
  const names = new Map<string, string>();
  for (const p of profiles) for (const s of p.seeds) names.set(s.id, s.matchedName);
  const importEv = (p: CharacterProfile, step: string, label: string): string[] => {
    const src = p.evidence.find((e) => e.step === step);
    if (!src) return [];
    const id = `ev${ev.items.length + 1}`;
    ev.items.push({ ...src, id, step: `${label} (precomputed, ${p.slug})` });
    return [id];
  };

  const demoParams = { 'filter.type': 'urn:demographics', 'signal.interests.entities': brand.id };
  const d = await q(demoParams, 'live:demographics');
  const row = demographicsOf(d.data)[0];
  if (!row) throw new Error('Qloo returned no demographics for this brand');
  const brandDemo: DemoVector = { age: row.query.age, female: row.query.gender.female };
  const demoEv = ev.add('audience', '/v2/insights', demoParams, Object.entries(brandDemo.age).map(([k, v]) => `${k}: ${v}`).concat(`female: ${brandDemo.female}`), d.cached);

  // The index is always global: the baseline is global, and city-conditioned affinities sit on a different scale
  // (milestone 2: every seed jumped 2–5σ in Mexico City). A campaign city adds a same-query, no-weight context line instead.
  const city = brief.city?.trim() || undefined;
  const types = opts.indexTypes ?? INDEX_TYPES;
  const rev = await reverseAffinity(qloo, profiles, brand.id, 'live:reverse', undefined, types);
  calls += rev.calls.length; cachedCalls += rev.calls.filter((c) => c.cached).length;
  const revEv = rev.calls.map((c) => ev.add('taste-index', '/v2/insights', c.params, c.results, c.cached,
    `Affinity for each character's seeds among ${brand.name} fans. Baseline: the same seeds among fans of ${baseline.panel.join(', ')}.`));
  let cityAff: Map<string, number> | null = null; let cityEv: string[] = [];
  if (city) {
    const rc = await reverseAffinity(qloo, profiles, brand.id, 'live:reverse-city', city, types);
    calls += rc.calls.length; cachedCalls += rc.calls.filter((c) => c.cached).length;
    cityAff = rc.aff;
    cityEv = rc.calls.map((c) => ev.add(`in-city@${city}`, '/v2/insights', c.params, c.results, c.cached, `Same question, limited to ${brand.name} fans in ${city}. Shown as context, no weight.`));
  }
  const cityMeans = cityAff ? profiles.map((p) => {
    const xs = p.seeds.map((s) => cityAff!.get(s.id)).filter((x): x is number => x !== undefined);
    return { slug: p.slug, mean: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, n: xs.length };
  }).sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1)) : [];

  let brandTags: { id: string; name: string }[] = []; let tagEv = '';
  if (opts.context) {
    const tagParams = { 'filter.type': 'urn:tag', 'signal.interests.entities': brand.id, 'filter.tag.types': TAG_TYPES, take: '20' };
    const t = await q(tagParams, 'live:brand-tags');
    brandTags = tagsOf(t.data).map((x) => ({ id: x.tag_id, name: x.name }));
    tagEv = ev.add('brand-tags', '/v2/insights', tagParams, brandTags.map((x) => x.name), t.cached);
  }

  const houseIds = [...new Set(profiles.map((p) => p.houseBrandId))].filter((i) => i !== brand.id);
  const ranking: RankedCharacter[] = [];
  for (const p of profiles) {
    const c = char(p.slug);
    const idx = tasteIndex(p, rev.aff, baseline, types);
    const cos = cosine(toArray(brandDemo), toArray(p.demo));
    const pDemo = importEv(p, 'profile:demographics', 'character audience');
    const parts: RankedCharacter['parts'] = { index: round(indexScore(idx.z), 3), indexZ: idx.z, indexLift: idx.lift, audience: round((cos + 1) / 2, 3), taste: 0, fit: 0, cosine: round(cos, 3) };
    const best = [...idx.seeds].sort((a, b) => b.z - a.z)[0];
    const why: RankedCharacter['why'] = [
      { text: `Qloo taste index ${sign(idx.z)}σ: among ${brand.name} fans${city ? ` in ${city}` : ''}, ${c.name}'s seeds score ${sign(idx.lift, 3)} affinity above their everyday-brand baseline${best ? `; strongest: ${best.name} (${sign(best.z)}σ)` : ''}. ${idx.covered} of ${idx.total} seeds covered.`, sourceIds: revEv },
      { text: `Audience similarity ${sign(parts.cosine)} (cosine, −1 to +1): ${brand.name}'s Qloo age and gender profile against ${c.name}'s seed profile. ${parts.cosine >= 0.3 ? 'Similar audiences' : parts.cosine > -0.3 ? 'Weakly related audiences' : 'Opposite audiences'}; the score uses (cosine + 1) / 2 = ${parts.audience.toFixed(2)}.`, sourceIds: [demoEv, ...pDemo] },
    ];
    let sharedNames: string[] = []; let fitRank: number | null = null; let fitN = 0; let topSeed: RankedCharacter['topSeed'] = null;
    if (opts.context) {
      const cands = [brand.id, ...houseIds];
      const fitParams = {
        'filter.type': 'urn:entity:brand', 'signal.interests.entities': p.seeds.map((s) => s.id).join(','),
        'filter.results.entities': cands.join(','), 'feature.explainability': 'true', take: String(cands.length),
      };
      const f = await q(fitParams, `live:fit:${p.slug}`);
      const ents = entitiesOf(f.data);
      const i = ents.findIndex((e) => e.entity_id === brand.id);
      fitRank = i >= 0 ? i + 1 : null; fitN = ents.length;
      const expl = i >= 0 ? ents[i].query?.explainability?.['signal.interests.entities'] ?? [] : [];
      const top = [...expl].sort((a, b) => b.score - a.score)[0];
      topSeed = top ? { name: names.get(top.entity_id) ?? top.entity_id, score: round(top.score, 3) } : null;
      const fitEv = ev.add(`fit:${p.slug}`, '/v2/insights', fitParams, ents.map((e) => `${e.name} (${round(e.query?.affinity ?? 0, 3)})`), f.cached,
        topSeed ? `Top contributing seed: ${topSeed.name}` : undefined);
      const overlap = tagOverlap(brandTags.map((x) => x.id), (p.tasteTags ?? p.tags).map((x) => x.id));
      sharedNames = [...new Set(brandTags.filter((x) => overlap.shared.includes(x.id)).map((x) => x.name))];
      parts.taste = round(overlap.score, 3); parts.fit = round(fitScore(fitRank, ents.length), 3);
      const pTags = importEv(p, 'profile:taste-tags', 'character taste tags');
      why.push({ text: `Context (no weight): ${sharedNames.length ? `shared taste tags ${sharedNames.slice(0, 4).join(', ')}` : `no shared taste tags in the top ${brandTags.length}`}; ${fitRank ? `${brand.name} ranks ${fitRank} of ${ents.length} against the house brands${topSeed ? `, strongest seed ${topSeed.name}` : ''}` : 'not returned in the house-brand check'}.`, sourceIds: [tagEv, ...pTags, fitEv] });
    }
    if (city) {
      const cm = cityMeans.find((x) => x.slug === p.slug)!;
      why.push({ text: cm.mean === null
        ? `In ${city} (context, no weight): Qloo returned no affinity for ${c.name}'s seeds among ${brand.name} fans there.`
        : `In ${city} (context, no weight): mean affinity of ${c.name}'s seeds among ${brand.name} fans there is ${round(cm.mean, 3)}, ${ordinal(cityMeans.indexOf(cm) + 1)} of ${cityMeans.length}.`, sourceIds: cityEv });
    }
    if (idx.covered === 0) why.unshift({ text: `Qloo returned no affinity for ${c.name}'s seeds among ${brand.name} fans, so her taste index is neutral (0σ), not evidence of fit.`, sourceIds: revEv });
    if (p.drift.flagged) why.push({ text: `Drift Check: ${p.drift.message}`, sourceIds: pDemo });
    ranking.push({ slug: p.slug, name: c.name, city: c.city, score: combine(parts), parts, index: idx, sharedTags: sharedNames, fitRank, fitCandidates: fitN, topSeed, drift: p.drift, why });
  }
  ranking.sort((a, b) => b.score - a.score);
  const decision = decide(ranking);
  if (baseline.panel.some((n) => normName(n) === normName(brand.name))) {
    decision.level = 'close'; decision.reason = 'baseline-brand';
    decision.text += ` ${brand.name} is one of the everyday brands TasteCast uses as its baseline, so its taste index is close to zero by construction. Pick another reference brand.`;
  }
  const before = ranking[0].slug;
  applyNicheTiebreak(ranking, brief);
  if (ranking[0].slug !== before) decision.text += ` Operator niche "${ranking[0].tiebreak}" put ${ranking[0].name} first. That is TasteCast operator data, not Qloo data.`;
  return { ranking, decision, calls, cached: cachedCalls };
}

/** Clear only if the margin clears CLEAR_MARGIN and the taste index picks the same leader under z and under raw lift. */
export function decide(ranking: RankedCharacter[]): Decision {
  const margin = round(ranking[0].score - (ranking[1]?.score ?? 0), 3);
  const by = (k: 'indexZ' | 'indexLift') => [...ranking].sort((a, b) => b.parts[k] - a.parts[k])[0].slug;
  const zl = by('indexZ'), ll = by('indexLift'), w = ranking[0].slug;
  const noData = ranking.slice(0, 2).some((r) => r.index && r.index.covered === 0);
  const clear = margin >= CLEAR_MARGIN && zl === w && ll === w && !noData;
  const alternatives = [...new Set([
    ...ranking.slice(1).filter((r) => w && ranking[0].score - r.score < CLEAR_MARGIN).map((r) => r.slug),
    ...[zl, ll].filter((s) => s !== w),
  ])];
  const nm = (s: string) => char(s).name;
  const tradeoffs = clear ? [] : [w, ...alternatives].map((slug) => {
    const r = ranking.find((x) => x.slug === slug)!;
    const pros = [
      slug === zl ? 'highest spread-adjusted taste index' : '',
      slug === ll ? 'highest raw lift among the brand\'s fans' : '',
      ranking.every((x) => x.parts.audience <= r.parts.audience) ? 'closest age and gender match' : '',
    ].filter(Boolean);
    return { slug, text: `${nm(slug)}: taste index ${r.parts.indexZ >= 0 ? '+' : ''}${r.parts.indexZ}σ, raw lift ${r.parts.indexLift >= 0 ? '+' : ''}${r.parts.indexLift}, audience similarity ${sign(r.parts.cosine)}${pros.length ? ` (${pros.join('; ')})` : ''}.` };
  });
  const text = clear
    ? `Qloo decided: ${nm(w)} leads by ${margin} (threshold ${CLEAR_MARGIN}) and the taste index agrees under both measures.`
    : `Close call. ${nm(w)} leads by ${margin}${margin < CLEAR_MARGIN ? `, below the ${CLEAR_MARGIN} needed` : `, which clears ${CLEAR_MARGIN}, but that is not enough on its own`}${zl !== ll ? `: the taste index picks ${nm(zl)} by spread-adjusted score and ${nm(ll)} by raw lift` : zl !== w ? `: the taste index alone picks ${nm(zl)}` : ''}. Treat ${[w, ...alternatives].map(nm).join(' and ')} as viable and choose on the tradeoffs below.`;
  const reason: Decision['reason'] = clear ? 'decided' : noData ? 'no-data' : margin < CLEAR_MARGIN ? 'lead-below-threshold' : zl !== ll ? 'measures-disagree' : 'index-disagrees';
  return { reason, level: clear ? 'clear' : 'close', margin, threshold: CLEAR_MARGIN, indexLeaderZ: zl, indexLeaderLift: ll, alternatives, tradeoffs, text: noData ? text + ' Qloo returned no taste-index data for one of the top two.' : text };
}

/** L2–L6. Must only run after the user confirmed brandId from resolveBrand. */
export async function runMatch(qloo: QlooClient, profiles: CharacterProfile[], baseline: Baseline, brief: Brief, brand: { id: string; name: string }): Promise<MatchCore> {
  const names = new Map<string, string>([[brand.id, brand.name]]);
  for (const p of profiles) for (const s of p.seeds) names.set(s.id, s.matchedName);
  const ev = new EvidenceLedger(names);
  const ranked = await rankCharacters(qloo, profiles, baseline, brief, brand, ev);
  const ranking = ranked.ranking;
  let calls = ranked.calls, cachedCalls = ranked.cached;
  const q = async (params: Record<string, string>, tag: string) => {
    const r = await qloo.get('/v2/insights', params, tag);
    calls++; if (r.cached) cachedCalls++;
    return r;
  };
  const importEv = (p: CharacterProfile, step: string, label: string): string[] => {
    const src = p.evidence.find((e) => e.step === step);
    if (!src) return [];
    const id = `ev${ev.items.length + 1}`;
    ev.items.push({ ...src, id, step: `${label} (precomputed, ${p.slug})` });
    return [id];
  };

  const wanted = brief.character && profiles.some((p) => p.slug === brief.character) ? brief.character : null;
  const featuredSlug = wanted ?? ranking[0].slug;
  const rank = ranking.findIndex((r) => r.slug === featuredSlug) + 1;
  const featured = {
    slug: featuredSlug, requested: !!wanted, rank,
    note: !wanted ? '' : rank === 1
      ? `You requested ${char(featuredSlug).name}, and Qloo ranks her first for this brief.`
      : `You requested ${char(featuredSlug).name}. Qloo ranks her #${rank} for this brief (${ranking[0].name} is #1); the package below is built for ${char(featuredSlug).name} as requested.`,
  };
  const winner = profiles.find((p) => p.slug === featuredSlug)!;
  const wc: CharacterDef = char(winner.slug);
  const city = brief.city?.trim() || wc.city;
  const seedIds = winner.seeds.map((s) => s.id).join(',');
  const angleParams = { 'filter.type': 'urn:tag', 'signal.interests.entities': seedIds, 'filter.tag.types': TAG_TYPES, 'signal.location.query': city, take: '12' };
  const a = await q(angleParams, 'live:local-tags');
  const angleNames = tagsOf(a.data).map((x) => x.name);
  const angleEv = ev.add('local-angle', '/v2/insights', angleParams, angleNames, a.cached);

  const artistParams = { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': seedIds, 'signal.location.query': city, 'signal.demographics.age': wc.ageBucket, take: '8' };
  const ar = await q(artistParams, 'live:local-artists');
  const artistNames = entitiesOf(ar.data).map((e) => e.name);
  const artistEv = ev.add('local-artists', '/v2/insights', artistParams, artistNames, ar.cached);

  const brandParams = { 'filter.type': 'urn:entity:brand', 'signal.interests.entities': seedIds, 'signal.location.query': city, 'signal.demographics.age': wc.ageBucket, take: '8' };
  const br = await q(brandParams, 'live:local-brands');
  const brandNames = entitiesOf(br.data).map((e) => e.name).filter((n) => n !== brand.name);
  const brandEv = ev.add('local-brands', '/v2/insights', brandParams, brandNames, br.cached);

  const placeEv = importEv(winner, 'profile:places', 'places')[0] ?? '';
  const knownBrands = [brand.name, ...brandNames, ...profiles.flatMap((p) => p.seeds.filter((s) => s.type === 'urn:entity:brand').map((s) => s.matchedName))];
  const judged = city === wc.city ? winner.places.map((x) => ({ x, v: shootability(x, knownBrands) })) : [];

  return {
    brief, brand, ranking, decision: ranked.decision, featured,
    local: {
      city,
      angles: angleNames.map((name) => ({ name, evidenceId: angleEv })),
      artists: artistNames.map((name) => ({ name, evidenceId: artistEv })),
      brands: brandNames.map((name) => ({ name, evidenceId: brandEv })),
      places: judged.filter((j) => j.v.ok).map(({ x }) => ({ name: x.name, area: x.area, evidenceId: placeEv })),
      excludedPlaces: judged.flatMap(({ x, v }) => (v.ok ? [] : [{ name: x.name, reason: v.reason, evidenceId: placeEv }])),
    },
    evidence: ev.items,
    qloo: { calls, cached: cachedCalls },
  };
}

const ordinal = (n: number) => ['first', 'second', 'third'][n - 1] ?? `#${n}`;
const sign = (x: number, d = 2) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(d)}`;

export const CLOSE_CALL = 0.03;

export function nicheMatch(c: CharacterDef, brief: Pick<Brief, 'category' | 'product'>): string | null {
  const words = `${brief.category} ${brief.product}`.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const stem = (w: string) => w.replace(/(ware|wear|s)$/, '');
  return c.niches.find((n) => (n.toLowerCase().match(/[a-z]{4,}/g) ?? []).some((nw) => words.some((w) => stem(w) === stem(nw)))) ?? null;
}

/** Qloo scores within CLOSE_CALL are too close to call. The operator-declared niche (not Qloo data) breaks the tie, and the UI says so. */
export function applyNicheTiebreak(ranking: RankedCharacter[], brief: Pick<Brief, 'category' | 'product'>) {
  if (ranking.length < 2 || ranking[0].score - ranking[1].score >= CLOSE_CALL) return;
  const n0 = nicheMatch(char(ranking[0].slug), brief);
  const n1 = nicheMatch(char(ranking[1].slug), brief);
  const note = (r: RankedCharacter, n: string | null, won: boolean) => r.why.unshift({
    text: `Qloo scores are within ${CLOSE_CALL} (too close to call). ${won ? `Tie broken by the operator-declared niche "${n}"` : 'This character did not win the niche tiebreak'}. Niches are TasteCast operator data, not Qloo data.`,
    sourceIds: [...r.why[0].sourceIds],
  });
  if (!n0 && n1) {
    [ranking[0], ranking[1]] = [ranking[1], ranking[0]];
    note(ranking[0], n1, true); note(ranking[1], null, false);
    ranking[0].tiebreak = n1;
  } else if (n0) { note(ranking[0], n0, true); ranking[0].tiebreak = n0; }
}
