import { CHARACTERS, DISCLOSURE } from '../domain/characters.js';
import type { MatchCore } from '../agent/match.js';

export interface Line { text: string; sourceIds: string[] }
export interface Shot { n: number; location: string; action: string; head: string; gaze: string; lens: string; sourceIds: string[] }

export interface EndorsementPackage {
  id: string;
  character: { slug: string; name: string; city: string };
  brand: { name: string; qlooReference: string; product: string; category: string; note: string };
  city: string;
  angle: Line[];
  script30s: (Line & { t: string })[];
  shotList: Shot[];
  soundtrack: Line[];
  pairings: Line[];
  wardrobe: Line[];
  imagePrompt: Line;
  disclosure: string;
  licenseUrl: string;
  /** Places Qloo returned that the shot list leaves out, with the reason. */
  excludedPlaces: { name: string; reason: string; sourceIds: string[] }[];
  /** How the copy lines were written: deterministic template, or a Workers AI rewrite that passed the checker line by line. */
  copy: CopyReport;
  copyVersion: number;
}

export interface CopyReport {
  mode: 'template' | 'ai';
  model?: string;
  /** Why the template was used: no AI binding (local, tests), the AI call failed, or every rewrite was rejected. */
  reason?: 'no-ai-binding' | 'ai-failed' | 'all-rejected';
  accepted: string[];
  rejected: { line: string; reason: string }[];
}

/** Bump when package building changes, so stored packages are rebuilt once from their stored match core. */
export const COPY_VERSION = 3;

/** QA-gate shot pattern: at most one look to camera, varied head angle and lens (characters/qa/image-qa-gate.md). */
const SHOT_PATTERN = [
  { head: 'three-quarter, tilted down', gaze: 'on the product in her hands', lens: '50mm, close medium' },
  { head: 'exact profile', gaze: 'on the task, not the camera', lens: '35mm, full body with the place' },
  { head: 'near-frontal, turned slightly', gaze: 'off-camera at a friend', lens: '50mm, waist up' },
  { head: 'back view, glancing over the shoulder', gaze: 'past the camera', lens: '35mm, full body, candid' },
  { head: 'three-quarter, chin raised', gaze: 'into the distance', lens: '85mm, half body' },
  { head: 'frontal', gaze: 'into the lens (the only shot that does)', lens: '28mm, environmental' },
];

export function buildPackage(id: string, m: MatchCore): EndorsementPackage {
  const top = m.ranking.find((r) => r.slug === (m.featured?.slug ?? m.ranking[0].slug)) ?? m.ranking[0];
  const c = CHARACTERS.find((x) => x.slug === top.slug)!;
  const L = m.local;
  const angle = L.angles.slice(0, 3);
  const art = L.artists.slice(0, 3);
  const prod = m.brief.product || m.brief.category;
  const placeOrAngle = (i: number) => L.places[i]
    ? { location: `${L.places[i].name}${L.places[i].area ? `, ${L.places[i].area}` : ''}`, src: L.places[i].evidenceId }
    : { location: `${L.city}, a spot that reads "${L.angles[i % Math.max(L.angles.length, 1)]?.name ?? 'local'}"`, src: L.angles[i % Math.max(L.angles.length, 1)]?.evidenceId ?? '' };
  const mood = (i: number) => L.angles[i % Math.max(L.angles.length, 1)];

  const pkg: EndorsementPackage = {
    id,
    character: { slug: c.slug, name: c.name, city: c.city },
    brand: {
      name: m.brief.brandName, qlooReference: m.brand.name, product: prod, category: m.brief.category,
      note: `${m.brief.brandName} is the brief's brand. Qloo has no data on it, so TasteCast uses ${m.brand.name} as its Qloo reference.`,
    },
    city: L.city,
    angle: [
      { text: `Creative direction: ${listJoin(angle.map((a) => a.name.toLowerCase()))}, the Qloo tags most tied to ${c.name}'s taste in ${L.city}.`, sourceIds: uniq(angle.map((a) => a.evidenceId)) },
      ...top.why.slice(0, 3).map((w) => ({ text: w.text, sourceIds: w.sourceIds })),
    ],
    script30s: [
      { t: '0–5s', text: `Cold open in ${placeOrAngle(0).location}: ${c.name} mid-task, ${prod} already in use.`, sourceIds: [placeOrAngle(0).src] },
      { t: '5–15s', text: `She uses the ${prod} as part of a real routine, no hard sell; styling leans ${mood(0)?.name.toLowerCase() ?? 'everyday'}.`, sourceIds: [mood(0)?.evidenceId ?? ''] },
      { t: '15–25s', text: `Cut to ${placeOrAngle(1).location} with ${art[0]?.name ?? 'a local track'} under it.`, sourceIds: uniq([placeOrAngle(1).src, art[0]?.evidenceId ?? '']) },
      { t: '25–30s', text: `End card: ${m.brief.brandName} with "${DISCLOSURE}" on screen for the full 5 seconds.`, sourceIds: [top.why[0].sourceIds[0]] },
    ],
    shotList: SHOT_PATTERN.map((s, i) => {
      const p = placeOrAngle(i);
      return { n: i + 1, location: p.location, action: `${c.name} with the ${prod}; ${mood(i)?.name.toLowerCase() ?? 'natural'} mood`, ...s, sourceIds: uniq([p.src, mood(i)?.evidenceId ?? '']) };
    }),
    soundtrack: art.map((a) => ({ text: a.name, sourceIds: [a.evidenceId] })),
    pairings: L.brands.slice(0, 3).map((b) => ({ text: `Styling reference: ${b.name}, shown unbranded`, sourceIds: [b.evidenceId] })),
    wardrobe: [
      { text: `Wardrobe and palette notes: ${L.angles.slice(3, 6).map((a) => a.name.toLowerCase()).join(', ') || 'keep to her signature look'}; keep her signature: ${c.signature[0].toLowerCase()}.`, sourceIds: uniq(L.angles.slice(3, 6).map((a) => a.evidenceId).concat(top.why[1].sourceIds)) },
    ],
    imagePrompt: {
      text: `Photoreal editorial photo of ${c.name}, an original fictional AI character (${c.signature.join('; ')}), in ${placeOrAngle(0).location}, using an unbranded ${prod}. Head three-quarter tilted down, eyes on the product, not the camera. ${mood(0)?.name ?? ''} mood, natural light, no text or logos, no real person's likeness. Label: ${DISCLOSURE}.`,
      sourceIds: uniq([placeOrAngle(0).src, mood(0)?.evidenceId ?? '']),
    },
    disclosure: DISCLOSURE,
    licenseUrl: `/api/license/${id}`,
    excludedPlaces: (L.excludedPlaces ?? []).map((x) => ({ name: x.name, reason: x.reason, sourceIds: [x.evidenceId] })),
    copy: { mode: 'template', reason: 'no-ai-binding', accepted: [], rejected: [] },
    copyVersion: COPY_VERSION,
  };
  assertSourced(pkg);
  return pkg;
}

export function packageLines(p: EndorsementPackage): { text: string; sourceIds: string[] }[] {
  return [...p.angle, ...p.script30s, ...p.shotList.map((s) => ({ text: s.location, sourceIds: s.sourceIds })), ...p.soundtrack, ...p.pairings, ...p.wardrobe, p.imagePrompt];
}

export function assertSourced(p: EndorsementPackage) {
  for (const l of packageLines(p)) {
    if (!l.sourceIds.length || l.sourceIds.some((s) => !s)) throw new Error(`Package line without a Qloo source: ${l.text}`);
  }
  if (p.disclosure !== DISCLOSURE) throw new Error('Package is missing the disclosure');
}

const uniq = (a: string[]) => [...new Set(a.filter(Boolean))];
const listJoin = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
