import { CHARACTERS, DISCLOSURE } from '../domain/characters.js';
import type { MatchCore } from '../agent/match.js';
import { departmentStore, placeTier, shootability } from './places.js';
import { BEATS, CHARACTER_ACTIONS, channelPlan, productKind } from './creative.js';

/**
 * Where a line comes from, and which part of it the source supports:
 *  - qloo: a Qloo API response in this run's evidence (ev id), e.g. a place, an artist or a style tag;
 *  - brief: something the user wrote in the brief (product facts, key message, CTA, channels);
 *  - creative: TasteCast's creative interpretation (story beats, camera, how the product appears);
 *  - rule: a product rule (disclosure, character identity, shot pattern, nothing invented).
 * A line can have several; a Qloo source never vouches for the creative parts of the line.
 */
export type SourceKind = 'qloo' | 'brief' | 'creative' | 'rule';
export interface Source { kind: SourceKind; ev?: string; supports: string }
/** sourceIds: the Qloo evidence ids among the sources (kept for the copy checker, MCP and older clients). */
export interface Line { text: string; sourceIds: string[]; sources?: Source[] }
export interface Beat extends Line { t: string; beat: 'Open' | 'Build' | 'Product' | 'Close'; purpose: string; vo: string; message: string; cta: string }
export interface Shot { n: number; location: string; action: string; product: string; head: string; gaze: string; lens: string; sourceIds: string[]; sources?: Source[] }

export interface PackageStatus {
  /** recommended: the clear-fit leader. preview: a close call nobody has cast yet. chosen: the user picked her on the
   *  result page. requested: asked for on a character page before the run. */
  kind: 'recommended' | 'preview' | 'chosen' | 'requested';
  label: string;
  note: string;
}

export interface EndorsementPackage {
  id: string;
  character: { slug: string; name: string; city: string };
  brand: { name: string; qlooReference: string; product: string; category: string; note: string };
  city: string;
  status: PackageStatus;
  /** The creative inputs as given. toSupply lists what is missing; nothing is filled in for it. */
  inputs: { objective: string; objectiveAssumed: boolean; audience: string; keyMessage: string; facts: string[]; cta: string; example: boolean; toSupply: string[] };
  concept: Line;
  angle: Line[];
  channelNote: Line;
  script30s: Beat[];
  shotList: Shot[];
  soundtrack: Line[];
  pairings: Line[];
  wardrobe: Line[];
  /** Image-generation requirements only (no text in the image). Text goes on in post-production: see overlays. */
  imagePrompt: Line;
  overlays: Line[];
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
  /** Why the template was used: no AI binding (local, tests), the AI call failed, every rewrite was rejected,
   *  or the rewrite is still running after the response (ai-pending; the stored run gets the AI copy). */
  reason?: 'no-ai-binding' | 'ai-failed' | 'all-rejected' | 'ai-pending';
  accepted: string[];
  rejected: { line: string; reason: string }[];
}

/** Bump when package building changes, so stored packages are rebuilt once from their stored match core. */
export const COPY_VERSION = 7;

/** Shot pattern from the character image QA gate (kept in the private photography repo): at most one look to camera, varied head angle and lens. */
const SHOT_PATTERN = [
  { head: 'three-quarter, tilted down', gaze: 'down at her work', lens: '50mm, close medium' },
  { head: 'exact profile', gaze: 'on the task, not the camera', lens: '35mm, full body with the place' },
  { head: 'near-frontal, turned slightly', gaze: 'off-camera at a friend', lens: '50mm, waist up' },
  { head: 'back view, glancing over the shoulder', gaze: 'past the camera', lens: '35mm, full body, candid' },
  { head: 'three-quarter, chin raised', gaze: 'into the distance', lens: '85mm, half body' },
  { head: 'frontal', gaze: 'into the lens (the only shot that does)', lens: '28mm, environmental' },
];

const Q = (ev: string | undefined, supports: string): Source => ({ kind: 'qloo', ev, supports });
const B = (supports: string): Source => ({ kind: 'brief', supports });
const C = (supports: string): Source => ({ kind: 'creative', supports });
const R = (supports: string): Source => ({ kind: 'rule', supports });
function line(text: string, ...sources: Source[]): Line {
  const s = sources.filter((x) => x.kind !== 'qloo' || !!x.ev);
  return { text, sources: s, sourceIds: uniq(s.filter((x) => x.kind === 'qloo').map((x) => x.ev!)) };
}
const quoteList = (xs: string[]) => xs.map((x) => `"${x}"`).join(' · ');

/** placeKinds: Qloo place categories by place name (from the stored character profiles), for match cores stored
 *  before the kinds were kept on the match. Rebuilding a package needs no Qloo call. */
export function buildPackage(id: string, m: MatchCore, opts: { placeKinds?: Map<string, string[]> } = {}): EndorsementPackage {
  const top = m.ranking.find((r) => r.slug === (m.featured?.slug ?? m.ranking[0].slug)) ?? m.ranking[0];
  const c = CHARACTERS.find((x) => x.slug === top.slug)!;
  const b = m.brief;
  // Re-checked here so stored match cores built before a filter change are cleaned when the package is rebuilt:
  // department stores by name, and hotels, bars and clubs for a non-hospitality product by Qloo kind.
  const cat = `${b.category} ${b.product}`;
  const kind = productKind(b);
  const judged = m.local.places.map((x) => {
    const kinds = x.kinds ?? opts.placeKinds?.get(x.name);
    const dept = departmentStore(x.name, m.local.city);
    const v = dept ? { ok: false as const, reason: `inside or named after the department store ${dept}, another brand's retail space` } : shootability({ name: x.name, area: x.area, kinds }, [], m.local.city, cat);
    return { x: { ...x, kinds }, v };
  });
  // Places that suit the product come first (a café for coffee gear, a market for snacks), then public places, then the rest.
  const fits = (x: { name: string; kinds?: string[] }) => (kind.places.test(x.name) || (x.kinds ?? []).some((k) => kind.places.test(k)) ? 0 : 1);
  const places = judged.filter((j) => j.v.ok).map((j) => j.x).sort((a, b2) => fits(a) - fits(b2) || placeTier(a) - placeTier(b2));
  const excluded = [...(m.local.excludedPlaces ?? []), ...judged.flatMap(({ x, v }) => (v.ok ? [] : [{ name: x.name, reason: v.reason, evidenceId: x.evidenceId }]))];
  const L = m.local;
  const tags = L.angles.map((a) => a.name.toLowerCase());
  const tagEv = L.angles[0]?.evidenceId;
  const art = L.artists.slice(0, 3);
  const prod = b.product || b.category;
  const loc = (i: number) => places[i]
    ? { name: `${places[i].name}${places[i].area ? `, ${places[i].area}` : ''}`, src: Q(places[i].evidenceId, `${places[i].name} is a place Qloo associates with ${c.name}'s taste in ${L.city}`) }
    : { name: `a ${L.city} street (style cue: "${L.angles[i % Math.max(L.angles.length, 1)]?.name ?? 'local'}")`, src: Q(tagEv, `the "${L.angles[i % Math.max(L.angles.length, 1)]?.name ?? ''}" style tag for her taste in ${L.city}`) };
  const actions = CHARACTER_ACTIONS[c.slug] ?? ['works on her own project', 'walks through the neighbourhood', 'pauses with a friend', 'looks out over the city'];
  const actionSrc = C(`what ${c.name.split(' ')[0]} does comes from her operator-written bio; she is never shown using the product`);

  const objective = b.objective ?? 'awareness';
  const plan = BEATS[objective];
  const ch = channelPlan(b.channels);
  const facts = (b.facts ?? []).filter(Boolean);
  const toSupply = [
    !b.objective ? 'Campaign objective (the script assumes awareness)' : '',
    !b.audience && !b.audienceAge ? 'Target audience' : '',
    !b.keyMessage ? 'Key message' : '',
    !facts.length ? 'Approved product facts' : '',
    !b.cta ? 'Call to action' : '',
  ].filter(Boolean);
  const missing = (what: string) => R(`${what} not given in the brief, so it is marked to be supplied instead of invented`);
  const keyMsg = b.keyMessage ? `"${b.keyMessage}"` : '[key message to be supplied]';
  const factsTxt = facts.length ? quoteList(facts.slice(0, 2)) : '[approved product facts to be supplied]';
  const ctaTxt = b.cta ? b.cta : '[CTA to be supplied]';
  const msgSrc = b.keyMessage ? B('the key message, quoted as written') : missing('The key message');
  const factSrc = facts.length ? B('the approved product facts, quoted as written') : missing('Approved product facts');
  const ctaSrc = b.cta ? B('the call to action, quoted as written') : missing('The call to action');
  const mood = tags.slice(0, 2);
  const openMsg: Record<typeof objective, string> = {
    awareness: 'Product not shown yet: the hook is her world.',
    consideration: `On-screen question that the key message answers (${keyMsg}).`,
    launch: `The ${prod} at the edge of frame, not yet revealed.`,
    conversion: `Super: ${ctaTxt}.`,
  };

  const script30s: Beat[] = [
    { t: ch.times[0], beat: 'Open', purpose: plan.open, ...line(`${c.name} ${actions[0]} at ${loc(0).name}.`, loc(0).src, actionSrc),
      vo: `Super from the first frame: "${DISCLOSURE}".`, message: openMsg[objective], cta: objective === 'conversion' ? ctaTxt : '' },
    { t: ch.times[1], beat: 'Build', purpose: plan.build, ...line(`${c.name} ${actions[1]}; the styling leans ${mood.join(' and ') || 'everyday'}, at ${loc(1).name}.`, Q(tagEv, `the style words ${mood.map((x) => `"${x}"`).join(' and ')} are Qloo tags for her taste in ${L.city}`), loc(1).src, actionSrc),
      vo: `VO or super: ${keyMsg}.`, message: plan.build + '.', cta: '' },
    { t: ch.times[2], beat: 'Product', purpose: plan.product, ...line(`Product insert: the ${prod} on ${kind.set}, ${kind.hero}, as styled product placement (no claim that she is a user); ${c.name} ${actions[2]} in the background. Soundtrack direction: ${art[0] ? `${art[0].name} or similar` : 'a local track'}.`,
      C(`how the ${prod} appears is TasteCast's convention for this kind of product`), Q(art[0]?.evidenceId, `${art[0]?.name ?? 'the artist'} is a Qloo artist affinity for her taste, a mood direction and not cleared music`), actionSrc),
      vo: `Supers: ${factsTxt}.`, message: facts.length ? `Approved facts on screen: ${factsTxt}.` : `Key message on screen: ${keyMsg}.`, cta: objective === 'conversion' ? ctaTxt : '' },
    { t: ch.times[3], beat: 'Close', purpose: plan.close, ...line(`End card: the ${b.brandName} logo with the ${prod} on ${kind.set}; ${c.name} ${actions[3]}.`, C('end-card layout'), actionSrc),
      vo: `Super: "${ctaTxt}" and "${DISCLOSURE}" for the whole end card.`, message: `${b.brandName}: ${ctaTxt}.`, cta: ctaTxt },
  ];
  // Sources for the spoken and on-screen text of each beat (not rewritten by the AI).
  script30s[0].sources!.push(R('the disclosure is on screen from the first frame'));
  script30s[1].sources!.push(msgSrc);
  script30s[2].sources!.push(factSrc);
  script30s[3].sources!.push(ctaSrc, R('the disclosure stays on the end card'));

  const productInShot = [
    objective === 'launch' ? `At the edge of frame, not yet revealed` : 'Not in frame (the hook is her world)',
    `On ${kind.set} beside her, soft focus`,
    `Hero insert on ${kind.set}, ${kind.hero}`,
    'Not in frame',
    `Second angle of the insert: a close detail of the ${prod}`,
    `On ${kind.set} beside her; the end-card plate`,
  ];
  const shotList: Shot[] = SHOT_PATTERN.map((s, i) => {
    const p = loc(i);
    const l = line('', p.src, R('head angle, gaze and lens follow the character shot pattern'), C('character action and product placement'));
    return { n: i + 1, location: p.name, action: `${c.name} ${actions[i % actions.length]}`, product: productInShot[i], ...s, sourceIds: l.sourceIds, sources: l.sources };
  });

  const featured = m.featured ?? { slug: top.slug, requested: false, rank: 1, note: '' };
  const leader = m.ranking[0];
  const status: PackageStatus = featured.chosen
    ? { kind: 'chosen', label: 'Your choice', note: `You chose ${c.name} for this case. The ranking is unchanged: ${leader.slug === c.slug ? `${c.name} is also #1` : `${leader.name} is #1 and ${c.name} is #${featured.rank}`}.` }
    : featured.requested
      ? { kind: 'requested', label: 'Requested character', note: featured.note }
      : m.decision.level === 'close'
        ? { kind: 'preview', label: 'Preview · pending casting', note: `This is a close call. The package below is a preview for the #1 character, ${c.name}; choose a character above to cast the case.` }
        : { kind: 'recommended', label: 'Clear fit · based on Qloo data', note: `${c.name} is the clear fit for this brief on TasteCast's score from Qloo data.` };

  const pkg: EndorsementPackage = {
    id,
    character: { slug: c.slug, name: c.name, city: c.city },
    brand: {
      name: b.brandName, qlooReference: m.brand.name, product: prod, category: b.category,
      note: `${b.brandName} is the brief's brand. Qloo has no data on it, so TasteCast uses ${m.brand.name} as its Qloo reference.`,
    },
    city: L.city,
    status,
    inputs: { objective, objectiveAssumed: !b.objective, audience: b.audience ?? '', keyMessage: b.keyMessage ?? '', facts, cta: b.cta ?? '', example: !!b.example, toSupply },
    concept: line(`${c.name}'s ${L.city}, ${tags.slice(0, 3).join(', ') || 'her everyday world'}: the ${prod} placed in her world as a styled prop, never as something she uses, built for ${objective}.`,
      Q(tagEv, `${tags.slice(0, 3).map((x) => `"${x}"`).join(', ')} are Qloo style tags for her taste in ${L.city}`), C('turning those tags into a campaign idea'), b.objective ? B('the campaign objective') : missing('The campaign objective')),
    angle: top.why.slice(0, 3).map((w) => line(w.text, ...w.sourceIds.map((ev) => Q(ev, 'the score or comparison stated in this line'))) as Line),
    channelNote: line(ch.note || 'Single master for the channels in the brief.', B(`the channels in the brief: ${b.channels.join(', ')}`), C('delivery conventions for those channels')),
    script30s,
    shotList,
    soundtrack: art.map((a) => line(a.name, Q(a.evidenceId, `${a.name} is a Qloo artist affinity for her taste in ${L.city}; a direction, not cleared music`))),
    pairings: L.brands.slice(0, 3).map((x) => line(`Styling reference: ${x.name}, shown unbranded`, Q(x.evidenceId, `${x.name} is a brand Qloo associates with her taste in ${L.city}`))),
    wardrobe: [
      line(`Wardrobe: ${kind.wardrobe}; palette notes ${tags.slice(3, 6).join(', ') || 'from her signature look'}; keep her signature: ${c.signature[0].toLowerCase()}.`,
        C(`what suits the ${prod}`), Q(L.angles[3]?.evidenceId, 'the palette words are Qloo style tags'), R('the signature detail is part of her fixed identity')),
    ],
    imagePrompt: line(`Photoreal editorial photo of ${c.name}, an original fictional AI character (${c.signature.join('; ')}), who ${actions[0]} at ${loc(0).name}, with the brief's product (${prod}) shown unbranded on ${kind.set} beside her, as a styled prop. Head three-quarter, eyes on her work, not the camera. ${cap(mood[0] ?? 'natural')} mood, natural light. No text, no logos and no real person's likeness in the image.`,
      loc(0).src, Q(tagEv, 'the mood word is a Qloo style tag'), R('identity details from her reference sheet'), C('pose and product placement')),
    overlays: [
      line(`Disclosure super "${DISCLOSURE}", added in post-production and on screen from the first frame.`, R('disclosure on every endorsement')),
      line(`End card: ${b.brandName} logo with "${ctaTxt}".`, ctaSrc),
      ...(b.keyMessage ? [line(`Key message super: ${keyMsg}.`, msgSrc)] : []),
    ],
    disclosure: DISCLOSURE,
    licenseUrl: `/api/license/${id}`,
    excludedPlaces: excluded.map((x) => ({ name: x.name, reason: x.reason, sourceIds: [x.evidenceId] })),
    copy: { mode: 'template', reason: 'no-ai-binding', accepted: [], rejected: [] },
    copyVersion: COPY_VERSION,
  };
  for (const l of [...packageLines(pkg).filter((x) => !('location' in x)), ...pkg.shotList]) if (l.sources) l.sources = mergeSources(l.sources);
  for (const s of pkg.shotList) s.sourceIds = uniq(s.sourceIds);
  assertSourced(pkg, m.evidence.map((e) => e.id));
  return pkg;
}

export function packageLines(p: EndorsementPackage): Line[] {
  return [p.concept, ...p.angle, p.channelNote, ...p.script30s, ...p.shotList.map((s) => ({ text: s.location, sourceIds: s.sourceIds, sources: s.sources })), ...p.soundtrack, ...p.pairings, ...p.wardrobe, p.imagePrompt, ...p.overlays];
}

/** Every line needs at least one source, every Qloo source must point at evidence from this run, and the disclosure must be there. */
export function assertSourced(p: EndorsementPackage, evidenceIds?: string[]) {
  const known = evidenceIds?.length ? new Set(evidenceIds) : null;
  for (const l of packageLines(p)) {
    const srcs = l.sources ?? l.sourceIds.map((ev) => ({ kind: 'qloo' as const, ev, supports: '' }));
    if (!srcs.length) throw new Error(`Package line without a source: ${l.text}`);
    for (const s of srcs) if (s.kind === 'qloo' && (!s.ev || (known && !known.has(s.ev)))) throw new Error(`Package line cites Qloo evidence that is not in this run: ${l.text}`);
  }
  if (p.disclosure !== DISCLOSURE) throw new Error('Package is missing the disclosure');
}

/** One source per kind and evidence id; what each supports is joined, so a line shows each chip once. */
function mergeSources(xs: Source[]): Source[] {
  const out: Source[] = [];
  for (const x of xs) {
    const same = out.find((o) => o.kind === x.kind && o.ev === x.ev);
    if (!same) out.push({ ...x });
    else if (!same.supports.includes(x.supports)) same.supports = `${same.supports}; ${x.supports}`;
  }
  return out;
}
const uniq = (a: string[]) => [...new Set(a.filter(Boolean))];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
