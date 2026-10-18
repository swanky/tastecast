import { describe, expect, it } from 'vitest';
import { assertSourced, buildPackage, packageLines } from '../src/content/package.js';
import { quote } from '../src/content/license.js';
import type { MatchCore } from '../src/agent/match.js';

const drift = { statedBucket: '25_to_29' as const, seedPeakBucket: '25_to_29' as const, level: 'none' as const, flagged: false, bucketGap: 0, vector: { age: { '24_and_younger': 0, '25_to_29': 1, '30_to_34': 0, '35_to_44': 0, '45_to_54': 0, '55_and_older': 0 }, female: 0.4 }, message: '' };
const core: MatchCore = {
  brief: { brandName: 'Loma Coffee Gear', referenceQuery: 'Hario', category: 'coffee equipment', product: 'ceramic dripper', channels: ['instagram', 'tiktok'], durationMonths: 3 },
  brand: { id: 'B', name: 'Hario' },
  ranking: [{ slug: 'itzel-robles', name: 'Itzel Robles', city: 'Mexico City', score: 0.8, parts: { index: 0.9, indexZ: 2.4, indexLift: 0.1, audience: 0.9, taste: 0.5, fit: 1, cosine: 0.8 }, index: { z: 2.4, lift: 0.1, seeds: [], covered: 4, total: 4 }, sharedTags: ['Rugged'], fitRank: 1, fitCandidates: 4, topSeed: { name: 'Cuco', score: 0.3 }, drift,
    why: [{ text: 'a', sourceIds: ['ev1'] }, { text: 'b', sourceIds: ['ev2'] }, { text: 'c', sourceIds: ['ev3'] }] }],
  decision: { level: 'clear', margin: 0.2, threshold: 0.08, indexLeaderZ: 'itzel-robles', indexLeaderLift: 'itzel-robles', alternatives: [], tradeoffs: [], text: 'Qloo decided' },
  featured: { slug: 'itzel-robles', requested: false, rank: 1, note: '' },
  local: { city: 'Mexico City', angles: ['Rugged', 'Retro', 'Street', 'Utilitarian', 'Skate', 'Vintage'].map((name) => ({ name, evidenceId: 'ev4' })), artists: [{ name: 'A1', evidenceId: 'ev5' }], brands: [{ name: 'B1', evidenceId: 'ev6' }], places: [{ name: 'P1', area: 'Roma Norte', evidenceId: 'ev7' }] },
  evidence: [], qloo: { calls: 8, cached: 0 },
};

describe('endorsement package', () => {
  it('every line has at least one typed source, and the disclosure opens and closes the script', () => {
    const p = buildPackage('id1', core);
    expect(packageLines(p).every((l) => (l.sources ?? []).length > 0)).toBe(true);
    expect(p.disclosure).toBe('#ad · AI-generated character');
    expect(p.script30s[0].vo).toContain('#ad · AI-generated character');
    expect(p.script30s.at(-1)!.vo).toContain('#ad · AI-generated character');
    expect(p.shotList).toHaveLength(6);
    expect(p.shotList.filter((s) => s.gaze.includes('into the lens'))).toHaveLength(1);
  });
  it('fails when a line has no source', () => {
    const p = buildPackage('id1', core);
    p.soundtrack.push({ text: 'unsourced', sourceIds: [], sources: [] });
    expect(() => assertSourced(p)).toThrow('without a source');
  });
  it('license quote is displayed, never charged, approvals unchecked', () => {
    const p = buildPackage('id1', core);
    const q = quote('id1', core, p);
    expect(q.price_quote.charged).toBe(false);
    expect(q.price_quote.payment_request).toBeNull();
    expect(q.approvals).toEqual({ character_operator: false, brand: false });
    expect(q.price_quote.amount).toBe(400 * 2 * 2.4);
    for (const k of ['usage', 'channels', 'duration', 'price_quote', 'approvals', 'qloo_evidence']) expect(q).toHaveProperty(k);
  });
});

describe('package location filter', () => {
  it('a stored core built before the department-store filter is cleaned when the package is rebuilt', () => {
    const c2 = structuredClone(core) as any;
    c2.local.city = 'Mexico City';
    c2.local.places = [{ name: 'Restaurante Liverpool', area: 'Centro', evidenceId: 'ev9' }, ...c2.local.places];
    const p = buildPackage('id', c2);
    expect(p.shotList.map((s) => s.location).join(' ')).not.toContain('Liverpool');
    expect(p.excludedPlaces.find((x) => x.name === 'Restaurante Liverpool')?.reason).toContain('department store Liverpool');
  });
});
