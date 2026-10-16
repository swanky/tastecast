import { AGE_BUCKETS, type AgeBucket } from '../qloo/types.js';

export interface DemoVector { age: Record<AgeBucket, number>; female: number }

export function toArray(v: DemoVector): number[] {
  return [...AGE_BUCKETS.map((b) => v.age[b]), v.female];
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export function average(vs: DemoVector[]): DemoVector {
  const age = Object.fromEntries(AGE_BUCKETS.map((b) => [b, round(vs.reduce((s, v) => s + v.age[b], 0) / vs.length)])) as Record<AgeBucket, number>;
  return { age, female: round(vs.reduce((s, v) => s + v.female, 0) / vs.length) };
}

export function peakBucket(v: DemoVector): AgeBucket {
  return AGE_BUCKETS.reduce((best, b) => (v.age[b] > v.age[best] ? b : best), AGE_BUCKETS[0]);
}

export function tagOverlap(a: string[], b: string[]): { shared: string[]; score: number } {
  const sb = new Set(b);
  const shared = [...new Set(a)].filter((x) => sb.has(x));
  const denom = Math.min(new Set(a).size, sb.size);
  return { shared, score: denom === 0 ? 0 : shared.length / denom };
}

export function fitScore(rank: number | null, candidates: number): number {
  if (rank === null || candidates < 2) return 0;
  return 1 - (rank - 1) / (candidates - 1);
}

/**
 * Milestone 2: the Qloo taste index carries most of the weight. Taste-tag overlap and the 3-brand fit check
 * stay visible as context with zero weight (overlap is ~0 and the fit set is too small to separate characters).
 */
export const WEIGHTS = { index: 0.6, audience: 0.4, taste: 0, fit: 0 } as const;

export function combine(parts: { index: number; audience: number; taste: number; fit: number }): number {
  return round(WEIGHTS.index * parts.index + WEIGHTS.audience * parts.audience + WEIGHTS.taste * parts.taste + WEIGHTS.fit * parts.fit, 3);
}

export function round(x: number, d = 2): number { const f = 10 ** d; return Math.round(x * f) / f; }
