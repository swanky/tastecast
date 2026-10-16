import { describe, expect, it } from 'vitest';
import { average, combine, cosine, fitScore, peakBucket, tagOverlap } from '../src/domain/score.js';
import { driftCheck } from '../src/domain/profile.js';
import { CHARACTERS } from '../src/domain/characters.js';

const v = (a: number[], female: number) => ({ age: { '24_and_younger': a[0], '25_to_29': a[1], '30_to_34': a[2], '35_to_44': a[3], '45_to_54': a[4], '55_and_older': a[5] }, female });

describe('score', () => {
  it('cosine of identical vectors is 1 and of opposite is -1', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
  it('tag overlap divides by the smaller set', () => {
    expect(tagOverlap(['a', 'b', 'c'], ['b', 'c', 'd', 'e'])).toEqual({ shared: ['b', 'c'], score: 2 / 3 });
    expect(tagOverlap([], ['a']).score).toBe(0);
  });
  it('fit score maps rank 1 to 1 and last to 0', () => {
    expect(fitScore(1, 4)).toBe(1);
    expect(fitScore(4, 4)).toBe(0);
    expect(fitScore(null, 4)).toBe(0);
  });
  it('combine uses 0.6 taste index + 0.4 audience; tags and fit are context only', () => {
    expect(combine({ index: 1, audience: 0, taste: 0, fit: 0 })).toBe(0.6);
    expect(combine({ index: 0.5, audience: 0.8, taste: 1, fit: 1 })).toBe(0.62);
  });
  it('drift check flags Ari-like profiles and not matching ones', () => {
    const ari = CHARACTERS.find((c) => c.slug === 'ari-tseng')!;
    const older = average([v([-0.2, 0.1, 0.5, 0.3, 0, -0.5], 0.3), v([0.1, 0.2, 0.4, 0.1, -0.2, -0.6], 0.4)]);
    expect(peakBucket(older)).toBe('30_to_34');
    expect(driftCheck(ari, older).flagged).toBe(true);
    const young = v([0.6, 0.5, 0.2, -0.5, -0.6, -0.7], 0.4);
    expect(driftCheck(ari, young).level).toBe('none');
    const itzel = CHARACTERS.find((c) => c.slug === 'itzel-robles')!;
    const near = v([0.52, 0.44, 0.36, -0.5, -0.42, -0.47], 0.12);
    expect(driftCheck(itzel, near).level).toBe('adjacent');
    expect(driftCheck(itzel, near).flagged).toBe(false);
  });
});

import { applyNicheTiebreak, nicheMatch, type RankedCharacter } from '../src/agent/match.js';
describe('niche tiebreak', () => {
  const r = (slug: string, score: number) => ({ slug, score, why: [{ text: 'x', sourceIds: ['ev1'] }] }) as unknown as RankedCharacter;
  it('matches niches by word stem', () => {
    expect(nicheMatch(CHARACTERS.find((c) => c.slug === 'ari-tseng')!, { category: 'eyewear', product: 'acetate frames' })).toBe('Eyewear');
    expect(nicheMatch(CHARACTERS.find((c) => c.slug === 'itzel-robles')!, { category: 'coffee equipment', product: '' })).toBe('Coffee and homeware');
    expect(nicheMatch(CHARACTERS.find((c) => c.slug === 'ingrid-brekkhus')!, { category: 'tableware', product: 'tea set' })).toBe('Tableware and tea');
  });
  it('swaps only when scores are within 0.03 and only the runner-up matches the niche', () => {
    const close = [r('itzel-robles', 0.508), r('ari-tseng', 0.506)];
    applyNicheTiebreak(close, { category: 'eyewear', product: 'frames' });
    expect(close[0].slug).toBe('ari-tseng');
    expect(close[0].why[0].text).toContain('too close to call');
    const clear = [r('itzel-robles', 0.6), r('ari-tseng', 0.5)];
    applyNicheTiebreak(clear, { category: 'eyewear', product: 'frames' });
    expect(clear[0].slug).toBe('itzel-robles');
  });
});
