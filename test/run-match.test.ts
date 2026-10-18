import { describe, expect, it } from 'vitest';
import { runMatch } from '../src/agent/match.js';
import { agentRun } from '../src/agent/run.js';
import { buildPackage } from '../src/content/package.js';
import { QlooClient } from '../src/qloo/client.js';
import { MemoryKV } from '../src/store/kv.js';
import { CHARACTERS } from '../src/domain/characters.js';
import type { CharacterProfile } from '../src/domain/profile.js';
import type { Baseline } from '../src/agent/affinity.js';

/**
 * The orchestration end to end (rankCharacters → decide → local research → package → agent run) against a fake
 * Qloo that answers with synthetic response shapes. No cache, no key, no network: every id below is made up
 * ("seed:itzel-robles:0"), so the test runs in a clean clone and fails if runMatch is broken.
 */
const BRAND = { id: 'brand:reference', name: 'Reference Brand' };
const HOUSE = (slug: string) => `seed:${slug}:house`;
const age = (peak: number) => Object.fromEntries(['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'].map((k, i) => [k, i === peak ? 0.3 : -0.05]));

function profiles(): CharacterProfile[] {
  return CHARACTERS.map((c, ci) => {
    const seeds = c.seeds.map((s, i) => ({ name: s.name, type: s.type, matchedName: s.name, id: s.name === c.houseBrand ? HOUSE(c.slug) : `seed:${c.slug}:${i}` }));
    const ev = (step: string) => ({ id: 'p', step, endpoint: '/v2/insights', params: {}, results: ['synthetic'], cached: true });
    return {
      slug: c.slug, seeds, houseBrandId: HOUSE(c.slug), demo: { age: age(ci) as never, female: 0.5 },
      drift: { statedBucket: c.ageBucket, seedPeakBucket: c.ageBucket, level: 'none', flagged: false, bucketGap: 0, vector: { age: age(ci) as never, female: 0.5 }, message: '' },
      tags: [{ id: 'tag:a', name: 'Rugged' }], tasteTags: [{ id: 'tag:a', name: 'Rugged' }],
      places: [{ name: 'Parque Uno', area: 'Centro', kinds: ['Park'] }, { name: 'Sky Bar Uno', area: 'Centro', kinds: ['Bar'] }],
      evidence: [ev('profile:demographics'), ev('profile:taste-tags'), ev('profile:places')], builtAt: '2026-10-18T00:00:00Z',
    } as CharacterProfile;
  });
}

/** sd per character's seeds: a tight baseline makes a small lift a large z. */
function baseline(ps: CharacterProfile[], sd: Record<string, number>): Baseline {
  return { panel: ['Everyday A', 'Everyday B'], builtAt: 'x', seeds: Object.fromEntries(ps.flatMap((p) => p.seeds.map((s) => [s.id, { mean: 0.8, sd: sd[p.slug], n: 6 }]))) };
}

/** A fake Qloo: answers by request shape, records every URL. affinity[slug] is the affinity of that character's seeds. */
function fakeQloo(affinity: Record<string, number>, urls: string[]) {
  const slugOf = (id: string) => id.split(':')[1];
  const json = (results: unknown) => new Response(JSON.stringify({ success: true, results }));
  return (async (input: string | URL) => {
    const u = new URL(String(input)); urls.push(u.pathname + u.search);
    const p = Object.fromEntries(u.searchParams);
    if (p['filter.type'] === 'urn:demographics') return json({ demographics: [{ entity_id: BRAND.id, query: { age: age(0), gender: { male: -0.1, female: 0.1 } } }] });
    if (p['filter.type'] === 'urn:tag') return json({ tags: [{ tag_id: 'tag:a', name: 'Rugged' }, { tag_id: 'tag:b', name: 'Retro' }, { tag_id: 'tag:c', name: 'Street' }] });
    if (p['feature.explainability']) return json({ entities: p['filter.results.entities'].split(',').map((id, i) => ({ entity_id: id, name: id === BRAND.id ? BRAND.name : `House ${i}`, query: { affinity: 0.9 - i / 10 } })) });
    if (p['filter.results.entities']) return json({ entities: p['filter.results.entities'].split(',').map((id) => ({ entity_id: id, name: id, query: { affinity: affinity[slugOf(id)] } })) });
    return json({ entities: [{ entity_id: 'local:1', name: 'Local Artist One' }, { entity_id: 'local:2', name: 'Local Brand Two' }] });
  }) as typeof fetch;
}

const brief = { brandName: 'Test Snacks Co.', referenceQuery: BRAND.name, category: 'snacks', product: 'fruit cups', channels: ['instagram' as const], durationMonths: 3 };
const client = (fetchImpl: typeof fetch) => new QlooClient({ apiKey: 'test-key-not-real', kv: new MemoryKV(), fetchImpl, sleep: async () => {} });

describe('runMatch end to end with a fake Qloo', () => {
  it('a clear lead: 12 calls, 19 evidence entries, 13 agent steps, "Qloo decided"', async () => {
    const ps = profiles(); const urls: string[] = [];
    const aff = { 'itzel-robles': 0.95, 'ari-tseng': 0.8, 'ingrid-brekkhus': 0.78 };
    const m = await runMatch(client(fakeQloo(aff, urls)), ps, baseline(ps, { 'itzel-robles': 0.05, 'ari-tseng': 0.05, 'ingrid-brekkhus': 0.05 }), brief, BRAND);
    expect(urls).toHaveLength(12);
    expect(m.qloo).toEqual({ calls: 12, cached: 0 });
    expect(m.evidence).toHaveLength(19);
    expect(m.ranking.map((r) => r.slug)).toEqual(['itzel-robles', 'ari-tseng', 'ingrid-brekkhus']);
    expect(m.decision).toMatchObject({ level: 'clear', reason: 'decided', indexLeaderZ: 'itzel-robles', indexLeaderLift: 'itzel-robles' });
    expect(m.local.places.map((p) => p.name)).toEqual(['Parque Uno']);
    expect(m.local.excludedPlaces?.[0].name).toBe('Sky Bar Uno');
    const pkg = buildPackage('id', m);
    const run = agentRun(m, pkg, 'live', { exact: true, duplicates: 1 }, 'person');
    expect(run.steps).toHaveLength(13);
    expect(run.steps.map((s) => s.kind)).toEqual(['plan', 'human', 'tool', 'tool', 'tool', 'tool', 'tool', 'check', 'check', 'check', 'check', 'tool', 'stop']);
    expect(run.steps.find((s) => s.title === 'Verdict')!.detail).toBe('Qloo decided: Itzel Robles.');
    expect(run.steps.filter((s) => s.kind === 'tool').every((s) => s.evidenceIds.length > 0)).toBe(true);
  });

  it('refuses to decide when the two taste measures disagree (close call)', async () => {
    const ps = profiles(); const urls: string[] = [];
    // Ari: small lift on a tight baseline (high z). Itzel: larger raw lift on a wide baseline (low z).
    const aff = { 'itzel-robles': 0.9, 'ari-tseng': 0.85, 'ingrid-brekkhus': 0.7 };
    const m = await runMatch(client(fakeQloo(aff, urls)), ps, baseline(ps, { 'itzel-robles': 0.2, 'ari-tseng': 0.02, 'ingrid-brekkhus': 0.05 }), brief, BRAND);
    expect(m.decision.indexLeaderZ).toBe('ari-tseng');
    expect(m.decision.indexLeaderLift).toBe('itzel-robles');
    expect(m.decision.level).toBe('close');
    expect(m.decision.alternatives).toContain('itzel-robles');
    const run = agentRun(m, buildPackage('id', m), 'live', { exact: true, duplicates: 1 }, 'mcp');
    expect(run.steps.find((s) => s.title === 'Both taste measures agree')!.status).toBe('fail');
    expect(run.steps.find((s) => s.title === 'Verdict')!.detail).toMatch(/^Close call: Ari Tseng and Itzel Robles stay viable/);
  });

  it('never ranks without demographics: a Qloo answer with no rows stops the run', async () => {
    const ps = profiles();
    const empty = (async () => new Response(JSON.stringify({ success: true, results: { demographics: [] } }))) as typeof fetch;
    await expect(runMatch(client(empty), ps, baseline(ps, { 'itzel-robles': 0.05, 'ari-tseng': 0.05, 'ingrid-brekkhus': 0.05 }), brief, BRAND)).rejects.toThrow('no demographics');
  });
});
