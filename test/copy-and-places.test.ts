import { describe, expect, it } from 'vitest';
import { checkLine } from '../src/content/copywriter.js';
import { buildPackage } from '../src/content/package.js';
import { hospitalityReason, placeTier, shootability } from '../src/content/places.js';
import { agentRun } from '../src/agent/run.js';
import type { MatchCore } from '../src/agent/match.js';

const drift = { statedBucket: '25_to_29' as const, seedPeakBucket: '25_to_29' as const, level: 'none' as const, flagged: false, bucketGap: 0, vector: { age: { '24_and_younger': 0, '25_to_29': 1, '30_to_34': 0, '35_to_44': 0, '45_to_54': 0, '55_and_older': 0 }, female: 0.4 }, message: '' };
const rk = (slug: string, name: string, score: number) => ({ slug, name, city: 'Mexico City', score, parts: { index: 0.9, indexZ: 2.4, indexLift: 0.1, audience: 0.9, taste: 0.5, fit: 1, cosine: 0.8 }, index: { z: 2.4, lift: 0.1, seeds: [], covered: 4, total: 4 }, sharedTags: [], fitRank: 1, fitCandidates: 4, topSeed: null, drift,
  why: [{ text: 'a', sourceIds: ['ev1'] }, { text: 'b', sourceIds: ['ev2'] }, { text: 'c', sourceIds: ['ev3'] }] });
const core = (category: string, product: string, places: { name: string; area: string; kinds?: string[] }[]): MatchCore => ({
  brief: { brandName: 'Pica Pica Test Co.', referenceQuery: 'Tajin', category, product, channels: ['instagram'], durationMonths: 3 },
  brand: { id: 'B', name: 'Tajin' },
  ranking: [rk('itzel-robles', 'Itzel Robles', 0.8), rk('ari-tseng', 'Ari Tseng', 0.4)],
  decision: { level: 'clear', margin: 0.4, threshold: 0.08, indexLeaderZ: 'itzel-robles', indexLeaderLift: 'itzel-robles', alternatives: [], tradeoffs: [], text: 'Qloo decided', reason: 'decided' },
  featured: { slug: 'itzel-robles', requested: false, rank: 1, note: '' },
  local: { city: 'Mexico City', angles: ['Rugged', 'Retro', 'Street', 'Utilitarian', 'Skate', 'Vintage'].map((name) => ({ name, evidenceId: 'ev4' })), artists: [{ name: 'Some Artist', evidenceId: 'ev5' }], brands: [{ name: 'B1', evidenceId: 'ev6' }],
    places: places.map((p) => ({ ...p, evidenceId: 'ev7' })) },
  evidence: [], qloo: { calls: 12, cached: 12 },
});

describe('copy checker: talent, licensing and use claims', () => {
  const orig = 'Cut to El Círculo teatral Café, Condesa. Soundtrack direction: Bratty or similar.';
  it('rejects talent or licensing wording even when the artist name is in the source line', () => {
    for (const bad of ['The scene cuts to El Círculo teatral Café, Condesa, with Bratty featured, or similar.', 'Cut to El Círculo teatral Café, Condesa, featuring Bratty or similar.',
      'Cut to El Círculo teatral Café, Condesa, starring Bratty or similar.', 'Bratty or similar performs over the cut to El Círculo teatral Café, Condesa.',
      'Cut to El Círculo teatral Café, Condesa, with licensed music by Bratty or similar.', 'A cameo by Bratty or similar at El Círculo teatral Café, Condesa.']) {
      expect(checkLine(orig, bad, [], []), bad).toMatch(/talent or licensing/);
    }
  });
  it('requires the soundtrack line to stay a direction ("or similar")', () => {
    expect(checkLine(orig, 'Cut to El Círculo teatral Café, Condesa, with Bratty setting the mood.', [], [])).toMatch(/or similar/);
    expect(checkLine(orig, 'Cut to El Círculo teatral Café in Condesa; soundtrack direction: Bratty or similar.', [], [])).toBeNull();
  });
  it('rejects wording that says the character uses the product', () => {
    const o = 'Styled product placement, no hard sell: the toner as a prop in her scene, with no claim that she is a user; styling leans minimal.';
    expect(checkLine(o, 'The toner is part of her daily routine; styling leans minimal.', [], [])).toMatch(/uses the product/);
    expect(checkLine(o, 'Her go-to toner sits in the scene as a prop; styling leans minimal.', [], [])).toMatch(/uses the product/);
    expect(checkLine(o, 'A styled placement, no hard sell: the toner as a prop in her scene, with no claim that she is a user; minimal styling.', [], [])).toBeNull();
  });
});

describe('package wording', () => {
  const p = buildPackage('id', core('snacks', 'chili-lime fruit cups', [{ name: 'Parque México', area: 'Condesa', kinds: ['Park'] }, { name: 'Café Uno', area: 'Roma', kinds: ['Cafe'] }]));
  const all = [...p.script30s.map((l) => l.text), p.imagePrompt.text].join(' ');
  it('frames the product as styled placement, never as something the character uses daily', () => {
    expect(all).not.toMatch(/\b(daily|routine|real routine|already in use|uses the)\b/i);
    expect(p.script30s[1].text).toMatch(/styled product placement/i);
    expect(p.script30s[1].text).toMatch(/no claim that she is a user/);
  });
  it('the soundtrack line is a direction, not booked or cleared music', () => {
    expect(p.script30s[2].text).toContain('Soundtrack direction: Some Artist or similar.');
    expect(p.script30s[2].text).not.toMatch(/featur|under it/i);
  });
  it('no article before a plural product ("an unbranded chili-lime fruit cups")', () => {
    expect(p.imagePrompt.text).not.toMatch(/\ban unbranded\b/);
    expect(p.imagePrompt.text).toContain("with the brief's product (chili-lime fruit cups) shown unbranded");
  });
});

describe('shoot locations for non-hospitality products', () => {
  const places = [
    { name: 'Papi Fun Bar', area: 'Zona Rosa', kinds: ['Place', 'Bar', 'Restaurant'] },
    { name: 'Hotel Boutique Roma 191', area: 'Roma', kinds: ['Hotel', 'Place'] },
    { name: 'Caviar House Piccadilly', area: 'Westminster', kinds: ['Seafood restaurant', 'Restaurant'] },
    { name: "Mark's Club", area: 'Westminster', kinds: ['Tourist attraction', 'Social club', 'Place'] },
    { name: 'Some Grill', area: 'Centro', kinds: ['Bar grill', 'Restaurant', 'Bar'] },
    { name: 'Neighbourhood Bistro', area: 'Roma', kinds: ['Restaurant', 'Place'] },
    { name: 'Reforma Avenue', area: 'Juárez', kinds: ['Hotel', 'Place'] },
    { name: 'NOPI by Ottolenghi', area: 'Soho', kinds: ['Mediterranean restaurant', 'Bar', 'Restaurant'] },
    { name: 'Corner Coffee', area: 'Roma', kinds: ['Cafe', 'Bar'] },
  ];
  it('leaves out hotels, bars, members\' clubs and caviar dining, keeps cafés, streets and named-cuisine restaurants', () => {
    const ok = places.filter((p) => shootability(p, [], 'Mexico City', 'snacks chili-lime fruit cups').ok).map((p) => p.name);
    expect(ok).toEqual(['Neighbourhood Bistro', 'Reforma Avenue', 'NOPI by Ottolenghi', 'Corner Coffee']);
  });
  it('keeps hotels and bars for a hospitality brief', () => {
    expect(hospitalityReason(places[0], 'spirits mezcal')).toBeNull();
    expect(hospitalityReason(places[1], 'boutique hotels')).toBeNull();
  });
  it('prefers public places and cafés over other venues', () => {
    expect(placeTier({ name: 'Reforma Avenue', area: '', kinds: ['Hotel'] })).toBe(0);
    expect(placeTier({ name: 'Corner Coffee', area: '', kinds: ['Cafe'] })).toBe(0);
    expect(placeTier({ name: 'Neighbourhood Bistro', area: '', kinds: ['Restaurant'] })).toBe(1);
  });
  it('a stored match core is re-filtered when its package is rebuilt, using kinds from the profiles (no Qloo call)', () => {
    const c = core('tableware', 'stoneware tea set', places.map(({ name, area }) => ({ name, area })));
    const kinds = new Map(places.map((p) => [p.name, p.kinds]));
    const p = buildPackage('id', c, { placeKinds: kinds });
    const locs = p.shotList.map((s) => s.location).join(' | ');
    for (const bad of ['Papi Fun Bar', 'Hotel Boutique', 'Caviar House', "Mark's Club", 'Some Grill']) expect(locs).not.toContain(bad);
    expect(p.shotList[0].location).toMatch(/^(Reforma Avenue|Corner Coffee)/);
    expect(p.excludedPlaces.map((x) => x.name)).toContain('Caviar House Piccadilly');
  });
});

describe('agent run wording', () => {
  const m = core('snacks', 'fruit cups', [{ name: 'Café Uno', area: 'Roma', kinds: ['Cafe'] }, { name: 'Bar Uno', area: 'Roma', kinds: ['Bar'] }]);
  const pkg = buildPackage('id', m);
  it('says how the entity was confirmed instead of always claiming a person did', () => {
    const title = (c: Parameters<typeof agentRun>[4]) => agentRun(m, pkg, 'stored', { exact: true, duplicates: 1 }, c).steps[1].title;
    expect(title('auto')).toMatch(/automatically \(demo link\)/);
    expect(title('mcp')).toMatch(/calling agent/);
    expect(title('person')).toBe('Person confirmed the Qloo entity');
    expect(title('unknown')).not.toMatch(/Human|Person/);
    expect(agentRun(m, pkg, 'stored', { exact: true, duplicates: 1 }, 'auto').steps[1].kind).not.toBe('human');
  });
  it('labels the plan as derived from the brief and pluralises the left-out places', () => {
    const run = agentRun(m, pkg, 'stored', { exact: true, duplicates: 1 });
    expect(run.steps[0].title).toBe('Plan (derived from the brief, not generated)');
    expect(run.steps.find((s) => s.title.startsWith('Draft package'))!.detail).toContain('Left out 1 Qloo place that is not a fit');
  });
});
