import { describe, expect, it } from 'vitest';
import { indexScore, reverseParams, tasteIndex, MIN_SD, type Baseline } from '../src/agent/affinity.js';
import { decide, CLEAR_MARGIN, type RankedCharacter } from '../src/agent/match.js';
import type { CharacterProfile } from '../src/domain/profile.js';

const prof = (slug: string, seeds: [string, string][]) => ({ slug, seeds: seeds.map(([id, type]) => ({ id, type, name: id, matchedName: id })) }) as unknown as CharacterProfile;
const A = prof('itzel-robles', [['a1', 'urn:entity:artist'], ['b1', 'urn:entity:brand']]);
const B = prof('ari-tseng', [['a2', 'urn:entity:artist'], ['t2', 'urn:entity:tv_show']]);
const base: Baseline = { panel: ['P'], builtAt: '', seeds: { a1: { mean: 0.7, sd: 0.05, n: 6 }, b1: { mean: 0.6, sd: 0.001, n: 6 }, a2: { mean: 0.8, sd: 0.04, n: 6 } } };

describe('taste index', () => {
  it('compares each seed with its own everyday-brand baseline, z in baseline sd', () => {
    const t = tasteIndex(A, new Map([['a1', 0.8], ['b1', 0.62]]), base);
    expect(t.seeds.find((s) => s.seedId === 'a1')!.z).toBe(2);
    expect(t.seeds.find((s) => s.seedId === 'b1')!.z).toBe(round(0.02 / MIN_SD)); // floor on sd stops blow-ups
    expect(t.covered).toBe(2);
  });
  it('skips seed types the index does not cover and reports coverage', () => {
    const t = tasteIndex(B, new Map([['a2', 0.76]]), base);
    expect(t.covered).toBe(1); expect(t.total).toBe(2); expect(t.z).toBe(-1);
  });
  it('indexScore maps ±3σ onto 0..1', () => {
    expect(indexScore(0)).toBe(0.5); expect(indexScore(3)).toBe(1); expect(indexScore(-9)).toBe(0);
  });
  it('one query per seed type scores every character together; city is optional', () => {
    const p = reverseParams([A, B], 'BR', 'urn:entity:artist', 'Seoul');
    expect(p['filter.results.entities']).toBe('a1,a2');
    expect(p['signal.location.query']).toBe('Seoul');
    expect(reverseParams([A, B], 'BR', 'urn:entity:brand')['signal.location.query']).toBeUndefined();
  });
});

const r = (slug: string, score: number, indexZ: number, indexLift: number) => ({ slug, score, parts: { indexZ, indexLift } }) as unknown as RankedCharacter;
describe('decision', () => {
  it('is clear only with margin >= threshold and agreement under z and lift', () => {
    expect(decide([r('ari-tseng', 0.85, 3, 0.14), r('itzel-robles', 0.75, 2, 0.04)]).level).toBe('clear');
    expect(decide([r('ari-tseng', 0.80, 3, 0.14), r('itzel-robles', 0.75, 2, 0.04)]).level).toBe('close');
    const d = decide([r('itzel-robles', 0.65, 1.3, 0.01), r('ari-tseng', 0.52, 0, 0), r('ingrid-brekkhus', 0.51, 0.9, 0.025)]);
    expect(d.level).toBe('close'); expect(d.alternatives).toEqual(['ingrid-brekkhus']); expect(d.threshold).toBe(CLEAR_MARGIN);
  });
});
describe('decision with missing data', () => {
  it('is never clear when Qloo returned no index data for one of the top two', () => {
    const a = { ...r('ari-tseng', 0.9, 3, 0.14), index: { covered: 2 } } as unknown as RankedCharacter;
    const b = { ...r('itzel-robles', 0.5, 0, 0), index: { covered: 0 } } as unknown as RankedCharacter;
    const d = decide([a, b]);
    expect(d.level).toBe('close'); expect(d.text).toContain('no taste-index data');
  });
});
function round(x: number) { return Math.round(x * 100) / 100; }
