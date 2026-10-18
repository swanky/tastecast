import { cpSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createService, DEMO_BRIEFS, plainReason, validateBrief } from '../src/app.js';
import { QlooClient } from '../src/qloo/client.js';
import { FileKV } from '../src/store/file-kv.js';
import { buildPackage, packageLines } from '../src/content/package.js';
import { audienceInsight, productKind } from '../src/content/creative.js';
import { exportCase } from '../src/content/export.js';
import { quote } from '../src/content/license.js';
import { DISCLOSURE } from '../src/domain/characters.js';
import { checkLine } from '../src/content/copywriter.js';
import type { MatchCore } from '../src/agent/match.js';

const drift = (stated: string, peak: string) => ({ statedBucket: stated, seedPeakBucket: peak, level: stated === peak ? 'none' : 'drift', flagged: stated !== peak, bucketGap: 0, vector: { age: {}, female: 0.5 }, message: '' }) as never;
const rk = (slug: string, name: string, score: number, z: number, lift: number) => ({ slug, name, city: 'Mexico City', score, parts: { index: 0.9, indexZ: z, indexLift: lift, audience: 0.9, taste: 0.5, fit: 1, cosine: 0.8 }, index: { z, lift, seeds: [], covered: 4, total: 4 }, sharedTags: [], fitRank: 1, fitCandidates: 3, topSeed: null, drift: drift('25_to_29', '25_to_29'), why: [{ text: 'w', sourceIds: ['ev1'] }] });
const base = (brief: Partial<MatchCore['brief']> = {}, level: 'clear' | 'close' = 'clear'): MatchCore => ({
  brief: { brandName: 'Loma Coffee Gear', referenceQuery: 'Hario', category: 'coffee equipment', product: 'ceramic pour-over dripper', channels: ['instagram', 'tiktok'], durationMonths: 3, ...brief },
  brand: { id: 'B', name: 'Hario' },
  ranking: [rk('itzel-robles', 'Itzel Robles', 0.64, 2, 0.05), rk('ingrid-brekkhus', 'Ingrid Brekkhus', 0.53, 1, 0.08)] as never,
  decision: { level, reason: level === 'clear' ? 'decided' : 'measures-disagree', margin: 0.104, threshold: 0.08, indexLeaderZ: 'itzel-robles', indexLeaderLift: level === 'clear' ? 'itzel-robles' : 'ingrid-brekkhus', alternatives: level === 'clear' ? [] : ['ingrid-brekkhus'], tradeoffs: [], text: '' },
  featured: { slug: 'itzel-robles', requested: false, rank: 1, note: '' },
  local: { city: 'Mexico City', angles: ['Rugged', 'Retro', 'Street', 'Utilitarian'].map((name) => ({ name, evidenceId: 'ev2' })), artists: [{ name: 'A1', evidenceId: 'ev3' }], brands: [{ name: 'B1', evidenceId: 'ev4' }], places: [{ name: 'Café Uno', area: 'Roma', evidenceId: 'ev5', kinds: ['Cafe'] }] },
  evidence: ['ev1', 'ev2', 'ev3', 'ev4', 'ev5'].map((id) => ({ id, step: id === 'ev5' ? 'places (precomputed, itzel-robles)' : 'x', endpoint: '/v2/insights', params: {}, results: [], cached: true })),
  qloo: { calls: 3, cached: 3 },
});

describe('brief fields (item 7)', () => {
  it('optional fields are bounded and only set when given, so old briefs keep their match id', () => {
    const old = validateBrief({ brandName: 'A', referenceQuery: 'B', channels: ['web'], durationMonths: 1 }).brief!;
    expect(Object.keys(old)).not.toContain('objective');
    expect(JSON.stringify(old)).not.toMatch(/objective|facts|cta|example/);
    const b = validateBrief({ brandName: 'A', referenceQuery: 'B', channels: ['web'], durationMonths: 1, objective: 'launch', audienceAge: '25_to_29', facts: ['x'.repeat(500), '', 'y'], cta: 'Go', keyMessage: 'Hi', example: true, bogus: 1 }).brief!;
    expect(b.objective).toBe('launch'); expect(b.facts).toEqual(['x'.repeat(140), 'y']); expect(b.example).toBe(true);
    expect(validateBrief({ brandName: 'A', referenceQuery: 'B', channels: ['web'], durationMonths: 1, objective: 'hype', audienceAge: '99' }).brief).not.toHaveProperty('objective');
  });
  it('missing facts, key message and CTA are marked to be supplied, never invented', () => {
    const p = buildPackage('id', base());
    expect(p.inputs.toSupply).toEqual(expect.arrayContaining(['Key message', 'Approved product facts', 'Call to action']));
    expect(p.script30s[2].vo).toContain('[approved product facts to be supplied]');
    expect(p.script30s[3].cta).toBe('[CTA to be supplied]');
  });
  it('given facts and CTA are quoted verbatim with a brief source; the script follows the channel', () => {
    const p = buildPackage('id', base({ objective: 'conversion', facts: ['Fits most mugs'], cta: 'Shop now', keyMessage: 'Better mornings' }));
    expect(p.script30s.map((b) => b.t)).toEqual(['0–3s', '3–12s', '12–22s', '22–30s']);
    expect(p.script30s[2].vo).toContain('"Fits most mugs"');
    expect(p.script30s[3].sources!.some((s) => s.kind === 'brief')).toBe(true);
    expect(p.channelNote.text).toMatch(/9:16/);
    const yt = buildPackage('id', base({ channels: ['youtube', 'web'] }));
    expect(yt.script30s[0].t).toBe('0–5s'); expect(yt.channelNote.text).toMatch(/bumper/);
  });
  it('the image prompt is generation only; text goes in post-production overlays', () => {
    const p = buildPackage('id', base());
    expect(p.imagePrompt.text).toMatch(/No text, no logos/);
    expect(p.imagePrompt.text).not.toContain(DISCLOSURE);
    expect(p.overlays[0].text).toContain(DISCLOSURE);
  });
  it('product kinds: coffee gear is coffee, a tea set is tableware', () => {
    expect(productKind({ category: 'coffee equipment', product: 'ceramic pour-over dripper' }).key).toBe('coffee');
    expect(productKind({ category: 'tableware', product: 'stoneware tea set' }).key).toBe('tableware');
  });
});

describe('evidence semantics (item 4)', () => {
  it('every line has typed sources; Qloo sources point at this run; the end card cites the brief and rules, not a Qloo id', () => {
    const p = buildPackage('id', base({ cta: 'Shop now' }));
    for (const l of packageLines(p)) expect((l.sources ?? []).length).toBeGreaterThan(0);
    const end = p.script30s[3];
    expect(end.sourceIds).toEqual([]);
    expect(end.sources!.map((s) => s.kind).sort()).toEqual(['brief', 'creative', 'rule']);
    const bad = base(); bad.local.artists[0].evidenceId = 'ev99';
    expect(() => buildPackage('id', bad)).toThrow('not in this run');
  });
});

describe('status, verdict wording and audience insight (items 1 and 5)', () => {
  it('a close call is a preview until cast; a cast character is the user\'s choice', () => {
    expect(buildPackage('id', base({}, 'close')).status.kind).toBe('preview');
    const c = base({}, 'close'); c.featured = { slug: 'ingrid-brekkhus', requested: false, chosen: true, rank: 2, note: '' };
    expect(buildPackage('id', c).status).toMatchObject({ kind: 'chosen', label: 'Your choice' });
    expect(buildPackage('id', base()).status.label).toBe('Clear fit · based on Qloo data');
  });
  it('plain reason says the two measures disagree', () => {
    const m = base({}, 'close');
    expect(plainReason(m.decision, m.ranking)).toBe('The two taste measures disagree: Itzel Robles has the stronger spread-adjusted index, Ingrid Brekkhus the higher raw lift.');
  });
  it('audience insight warns only when the target age is two or more brackets from the seed peak', () => {
    const d = drift('24_and_younger', '30_to_34');
    expect(audienceInsight('Ari', 23, d)?.conflict).toBe(false);
    expect(audienceInsight('Ari', 23, d, '25_to_29')?.conflict).toBe(false);
    expect(audienceInsight('Ari', 23, d, '24_and_younger')?.conflict).toBe(true);
  });
  it('the quote says production is not included and how the character was cast', () => {
    const m = base({}, 'close'); const p = buildPackage('id', m);
    const q = quote('id', m, p);
    expect(q.production_included).toBe(false);
    expect(q.casting.status).toBe('preview');
    expect(q.summary.join(' ')).toMatch(/Production .* not included/);
  });
});

describe('copy checker keeps sources honest', () => {
  it('a rewrite may not drop the character or a Qloo-sourced place, or move the disclosure into a visual', () => {
    const o = 'Ingrid Brekkhus studies the glaze on a small pot she made at NOPI by Ottolenghi, Soho.';
    expect(checkLine(o, 'A small handmade pot is displayed at a London location.', ['Ingrid Brekkhus'], [], ['Ingrid Brekkhus', 'NOPI by Ottolenghi'])).toMatch(/drops a sourced name/);
    expect(checkLine(o, 'At NOPI by Ottolenghi in Soho, Ingrid Brekkhus studies the glaze on a small pot she made.', ['Ingrid Brekkhus'], [], ['Ingrid Brekkhus', 'NOPI by Ottolenghi'])).toBeNull();
    expect(checkLine('End card with the logo.', `End card with the logo. ${DISCLOSURE}`, [DISCLOSURE], [])).toMatch(/disclosure/);
  });
});

describe('export (item 9)', () => {
  it('markdown brief, script and image prompt follow the current case', () => {
    const m = { ...base({ cta: 'Shop now' }), id: 'abc' } as never as MatchCore & { id: string; package: ReturnType<typeof buildPackage> };
    m.package = buildPackage('abc', m);
    const x = exportCase(m, quote('abc', m, m.package));
    expect(x.filename).toBe('tastecast-loma-coffee-gear-itzel-robles.md');
    expect(x.markdown).toContain('| Time | Beat | Visual / action | VO / super | Product message | CTA |');
    expect(x.markdown).toContain('Key message: to be supplied');
    expect(x.markdown).toContain(DISCLOSURE);
    expect(x.script).toContain('[0–3s] Open');
    expect(x.imagePrompt).toContain('Post-production overlays');
  });
});

describe('demo briefs read differently', () => {
  it('four objectives, synthetic data flagged, Loma leaves facts to be supplied', () => {
    expect(new Set(DEMO_BRIEFS.map((d) => d.brief.objective)).size).toBe(4);
    expect(DEMO_BRIEFS.every((d) => d.brief.example)).toBe(true);
    expect(DEMO_BRIEFS[3].brief.facts).toBeUndefined();
  });
});

const hasCache = existsSync('cache/match');
describe.skipIf(!hasCache)('casting and rerun on stored data (items 1 and 2)', () => {
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-cast-'));
    cpSync('cache', dir, { recursive: true });
    const kv = new FileKV(dir);
    let net = 0;
    const qloo = new QlooClient({ apiKey: undefined, kv, fetchImpl: (async () => { net++; throw new Error('no network'); }) as never });
    return { svc: createService({ qloo, kv }), net: () => net };
  };
  it('casting keeps brief, entity, ranking and evidence, rebuilds the package for the choice, with 0 network calls', async () => {
    const { svc, net } = setup();
    const demos = await svc.demos();
    const loma = demos[3];
    expect(loma.verdict?.level).toBe('close');
    const root = (await svc.getMatch(loma.verdict!.matchId))!;
    expect(root.package.status.kind).toBe('preview');
    const r = await svc.cast(root.id, 'ingrid-brekkhus');
    expect(r.status).toBe(200);
    const m = r.body as any;
    expect(m.id).not.toBe(root.id);
    expect(m.package.status.kind).toBe('chosen');
    expect(m.choice).toMatchObject({ slug: 'ingrid-brekkhus', by: 'user', from: root.id });
    expect(m.ranking.map((x: any) => x.slug)).toEqual(root.ranking.map((x) => x.slug));
    expect(m.brief).toEqual(root.brief);
    const kept = root.evidence.filter((e) => !e.step.startsWith('local-') && !e.step.startsWith('places (precomputed'));
    expect(m.evidence.slice(0, kept.length).map((e: any) => e.id)).toEqual(kept.map((e) => e.id));
    expect(m.run.steps.some((s: any) => s.title === 'Character chosen by the user')).toBe(true);
    expect(net()).toBe(0);
    const again = await svc.cast(m.id, 'ingrid-brekkhus');
    expect((again.body as any).id).toBe(m.id);
    expect(again.served).toBe('stored');
    expect((await svc.cast(root.id, 'nobody')).status).toBe(400);
  });
  it('a stored run carries its confirmed entity token; a rerun with it is the same run, a new reference brand is refused', async () => {
    const { svc } = setup();
    const d = (await svc.demos())[2];
    const m = (await svc.getMatch(d.verdict!.matchId))!;
    const v = await svc.view(m, true, 'unknown') as any;
    expect(v.confirmedCandidate).toMatch(/^c_[0-9a-f]{16}$/);
    const same = await svc.match(m.brief, v.confirmedCandidate, 'person');
    expect((same.body as any).id).toBe(m.id);
    const edited = await svc.match({ ...m.brief, cta: 'Visit the studio' }, v.confirmedCandidate, 'person');
    expect(edited.status).toBe(200);
    expect((edited.body as any).id).not.toBe(m.id);
    expect((edited.body as any).package.inputs.cta).toBe('Visit the studio');
    const other = await svc.match({ ...m.brief, referenceQuery: 'Tajín' }, v.confirmedCandidate, 'person');
    expect(other.status).toBe(409);
  });
});
