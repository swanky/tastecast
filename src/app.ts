import { Hono } from 'hono';
import { BudgetExceeded, QlooClient, QlooError, type BudgetReason } from './qloo/client.js';
import { DEFAULT_IP_LIMITS } from './store/ip-limit.js';
import type { KV } from './store/kv.js';
import { CHARACTERS, DISCLOSURE, type CharacterDef } from './domain/characters.js';
import { PROFILES_KEY, type CharacterProfile } from './domain/profile.js';
import { loadBaseline } from './agent/affinity.js';
import { CHANNELS, localResearch, normName, OBJECTIVES, resolveBrand, runMatch, type Brief, type Candidate, type Decision, type MatchCore, type RankedCharacter } from './agent/match.js';
import { EvidenceLedger } from './agent/evidence.js';
import { AGE_BUCKETS, type AgeBucket } from './qloo/types.js';
import { audienceInsight } from './content/creative.js';
import { exportCase } from './content/export.js';
import { buildPackage, COPY_VERSION, type EndorsementPackage } from './content/package.js';
import { quote } from './content/license.js';
import { rewriteCopy, type AiLike } from './content/copywriter.js';
import { agentRun, type Confirmation } from './agent/run.js';
import type { LimitKind } from './store/ip-limit.js';
import { canonicalQuery, INSTANT_BRANDS, instantBrand } from './instant-brands.js';

export interface Deps {
  qloo: QlooClient;
  /** Per-kind client on Workers, so live calls count against the right per-IP allowance (match or resolve). */
  qlooFor?: (kind: LimitKind) => QlooClient;
  kv: KV;
  /** Workers AI binding; absent locally and in tests (template copy). */
  ai?: AiLike;
  /** Runs work after the response (Workers ctx.waitUntil). When set, a live match answers with the template copy
   *  and the AI rewrite finishes in the background, so the ranking is not held up by the model. */
  defer?: (p: Promise<unknown>) => void;
  /** Feature flags. s5Panel: show the S5 "LLM only vs Qloo" panel (off until the self-rating exists). */
  flags?: { s5Panel?: boolean };
  /** Per-network daily abuse guard in force (Workers only), reported by /api/health. */
  ipLimits?: { match: number; resolve: number };
}

/** KV value behind the S5 panel (written by the S5 scripts, never by the site). Results stay absent until the user self-rates. */
export const S5_KEY = 's5:panel';
export interface S5Panel {
  model: string; generatedAt: string; method: string;
  briefs: Record<string, { label: string; llmOnly: { character: string; why: string; angle: string; locations: string[]; soundtrack: string[]; styling: string[] } }>;
  results?: { ratedAt: string; summary: string; perBrief: { label: string; preferred: 'qloo' | 'llm-only' | 'tie' }[] };
}
export interface StoredMatch extends MatchCore { id: string; package: EndorsementPackage; createdAt: string; confirmed?: { exact: boolean; duplicates: number } }

/** One plain sentence on why the verdict is what it is, for the home card and the top of the result page. */
export function plainReason(d: Decision, ranking: RankedCharacter[]): string {
  const nm = (s: string) => ranking.find((r) => r.slug === s)?.name ?? s;
  const w = ranking[0].slug;
  if (d.level === 'clear') return `${nm(w)} leads on both taste measures and by a clear margin.`;
  if (d.reason === 'baseline-brand') return 'The reference brand is one of the everyday baseline brands, so its taste index cannot separate the characters.';
  if (d.reason === 'no-data') return 'Qloo returned no taste-index data for one of the top two, so the lead is not reliable.';
  const disagree = d.indexLeaderZ !== d.indexLeaderLift
    ? `The two taste measures disagree: ${nm(d.indexLeaderZ)} has the stronger spread-adjusted index, ${nm(d.indexLeaderLift)} the higher raw lift.` : '';
  if (d.reason === 'lead-below-threshold') return `${nm(w)} leads by only ${d.margin}, under the ${d.threshold} a clear fit needs.${disagree ? ` ${disagree}` : ''}`;
  if (disagree) return disagree;
  return `${nm(w)} leads overall, but the taste index alone picks ${nm(d.indexLeaderZ)}.`;
}
/** Older stored runs say "Qloo decided"; the site now says "Clear fit", which is TasteCast's call on Qloo data. */
const reword = (t: string) => t.replace(/^Qloo decided:/, 'Clear fit:').replace(/"Qloo decided"/g, 'a clear fit');

async function sha(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

const UUID_RE = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/g;
const UUID_ONLY = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

/** Client responses never carry Qloo entity IDs: fields whose value is an ID are dropped and IDs embedded
 *  in longer strings are masked. Server-side KV keeps the full objects. */
export function clientSafe<T>(v: T): T {
  if (Array.isArray(v)) return v.filter((x) => !(typeof x === 'string' && UUID_ONLY.test(x))).map(clientSafe) as T;
  if (typeof v === 'string') return v.replace(UUID_RE, '[qloo-id]') as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (!(typeof x === 'string' && UUID_ONLY.test(x))) out[k] = clientSafe(x);
    return out as T;
  }
  return v;
}

/** Opaque handle the browser uses to confirm a resolve candidate, instead of the Qloo entity ID. */
const candToken = async (entityId: string) => 'c_' + (await sha('cand:' + entityId));

export { DEMO_BRIEFS } from './demo-briefs.js';
import { DEMO_BRIEFS } from './demo-briefs.js';
export const DEMO_LINKS = DEMO_BRIEFS.map((d, i) => ({ label: d.label, href: `/brief?demo=${i}&confirm=1` }));
const DEMO_HINT = `The ${DEMO_BRIEFS.length} demo briefs (${DEMO_BRIEFS.map((d) => d.label).join(', ')}) still run in full from stored Qloo results.`;
export function budgetMessage(reason: BudgetReason) {
  if (reason === 'ip') return `This network has reached today's abuse guard for live custom briefs (${DEFAULT_IP_LIMITS.match} live matches and ${DEFAULT_IP_LIMITS.resolve} live searches a day). ${DEMO_HINT} Custom briefs open again tomorrow.`;
  if (reason === 'upstream') return `Qloo is rate-limiting live lookups right now. ${DEMO_HINT} Try the custom brief again in a minute.`;
  return `Live Qloo lookups for custom briefs are paused on this demo. ${DEMO_HINT}`;
}

export function validateBrief(b: unknown): { brief?: Brief; error?: string } {
  const x = (b ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof x[k] === 'string' ? (x[k] as string).trim() : '');
  if (!str('brandName')) return { error: 'brandName is required' };
  if (!str('referenceQuery')) return { error: 'referenceQuery (a real reference brand Qloo knows) is required' };
  // Canonical order and no duplicates, so the same brief always hashes to the same stored match.
  const channels = Array.isArray(x.channels) ? CHANNELS.filter((c) => (x.channels as unknown[]).includes(c)) : [];
  if (!channels.length) return { error: `channels must include one of ${CHANNELS.join(', ')}` };
  const durationMonths = Number(x.durationMonths);
  if (![1, 3, 6, 12].includes(durationMonths)) return { error: 'durationMonths must be 1, 3, 6 or 12' };
  const brief: Brief = { brandName: str('brandName').slice(0, 80), referenceQuery: str('referenceQuery').slice(0, 80), category: str('category').slice(0, 60) || 'product', product: str('product').slice(0, 60), channels: channels as Brief['channels'], durationMonths, city: str('city').slice(0, 60) || undefined, character: CHARACTERS.some((ch) => ch.slug === str('character')) ? str('character') : undefined };
  // Optional creative fields: set only when given, so a brief without them hashes to the same stored match as before.
  if ((OBJECTIVES as readonly string[]).includes(str('objective'))) brief.objective = str('objective') as Brief['objective'];
  if (str('audience')) brief.audience = str('audience').slice(0, 160);
  if ((AGE_BUCKETS as readonly string[]).includes(str('audienceAge'))) brief.audienceAge = str('audienceAge') as AgeBucket;
  if (str('keyMessage')) brief.keyMessage = str('keyMessage').slice(0, 160);
  const facts = (Array.isArray(x.facts) ? x.facts : typeof x.facts === 'string' ? (x.facts as string).split('\n') : [])
    .filter((f): f is string => typeof f === 'string').map((f) => f.trim().slice(0, 140)).filter(Boolean).slice(0, 5);
  if (facts.length) brief.facts = facts;
  if (str('cta')) brief.cta = str('cta').slice(0, 80);
  if (x.example === true) brief.example = true;
  return { brief };
}

/** Bumped when the ranking formula changes, so stored matches from an older formula are not reused. */
export const SCORING_VERSION = 4;

/** Row shape written by scripts/robustness.ts (cache only, never committed). */
export interface RobustRow { id: string; ref: string; resolved?: string; cat: string; expect?: string | null; match?: string; full?: { ranking: { c: string; z: number; score: number }[]; winner: string; level: string } }

/** Qloo returns the same tag name under several subtypes ("Rugged" twice); show each name once, sentence-cased. */
const uniqNames = (xs: string[]) => [...new Map(xs.map((x) => [x.toLowerCase(), x.charAt(0).toUpperCase() + x.slice(1)])).values()];
const SEED_LABEL: Record<string, string> = { 'urn:entity:artist': 'Music', 'urn:entity:brand': 'Brand', 'urn:entity:tv_show': 'TV', 'urn:entity:movie': 'Film' };
const asset = (slug: string, file: string) => `/assets/characters/${slug}/${file}`;

/** Client-safe character view: names and derived numbers only, never Qloo entity IDs. */
export function characterView(ch: CharacterDef, prof: CharacterProfile | undefined, rob: RobustRow[]) {
  const short = ch.slug.split('-')[0];
  const fits = rob.filter((r) => r.full && r.expect !== null && r.match !== 'none').map((r) => {
    const rk = r.full!.ranking; const me = rk.find((x) => x.c === short);
    return me ? { brand: r.resolved ?? r.ref, category: r.cat, z: me.z, rank: rk.indexOf(me) + 1, of: rk.length, decided: r.full!.level === 'clear' } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.z - a.z);
  return {
    slug: ch.slug, name: ch.name, city: ch.city, age: ch.statedAge, role: ch.role, tagline: ch.tagline, bio: ch.bio, signature: ch.signature, niches: ch.niches,
    seeds: ch.seeds.map((s) => ({ name: s.name, kind: SEED_LABEL[s.type] ?? 'Other' })),
    images: ch.images.map((i) => ({ src: asset(ch.slug, i.file), alt: i.alt, title: i.title })),
    reference: { src: asset(ch.slug, ch.reference.file), alt: ch.reference.alt },
    turnaround: { src: asset(ch.slug, ch.turnaround.file), alt: ch.turnaround.alt },
    drift: prof?.drift ?? null,
    taste: prof ? {
      audience: { age: prof.demo.age, female: prof.demo.female },
      tasteTags: uniqNames((prof.tasteTags ?? []).map((t) => t.name)).slice(0, 8),
      cityTags: uniqNames(prof.tags.map((t) => t.name)).slice(0, 8),
      places: prof.places.slice(0, 6).map((x) => ({ name: x.name, area: /\d/.test(x.area) ? '' : x.area })),
    } : null,
    fits: { best: fits.slice(0, 3), weakest: fits.slice(-2).reverse(), briefs: fits.length },
    tags: prof?.tags.slice(0, 8).map((t) => t.name) ?? [],
    disclosure: DISCLOSURE, identity: 'Original AI character, not a real person.',
  };
}

export interface ServiceResult { status: 200 | 400 | 404 | 409 | 503; body: Record<string, unknown> }

/** Shared by the HTTP routes and the MCP tools, so both surfaces have the same guards and the same scrub. */
export function createService({ qloo, qlooFor, kv, ai, defer }: Deps) {
  const client = (k: LimitKind) => qlooFor?.(k) ?? qloo;
  const profiles = () => kv.get<CharacterProfile[]>(PROFILES_KEY);
  /** Qloo place kinds by name from the stored profiles, so a rebuilt package can re-run the location filter (0 Qloo calls). */
  const placeKinds = async () => new Map((await profiles() ?? []).flatMap((p) => p.places.map((x) => [x.name, x.kinds ?? []] as [string, string[]])));
  /** Typed instant-brand names map to the stored search text, so "glossier" or "Stüssy" hits the stored Qloo result. */
  const resolveKey = async (q: string) => `resolve:${await sha(canonicalQuery(q).toLowerCase())}`;

  /** Candidates in Qloo's order, with same-name duplicates labelled. The first exact match is the default. */
  async function present(cands: Candidate[]) {
    const counts = new Map<string, number>();
    for (const c of cands) counts.set(normName(c.name), (counts.get(normName(c.name)) ?? 0) + 1);
    const firstExact = cands.findIndex((c) => c.exact);
    const seen = new Set<string>();
    return Promise.all(cands.map(async (c, i) => {
      const key = normName(c.name); const dup = (counts.get(key) ?? 1) > 1; const later = seen.has(key); seen.add(key);
      return {
        id: await candToken(c.id), name: c.name, exact: c.exact, preselected: i === (firstExact >= 0 ? firstExact : 0),
        popularity: c.popularity === null ? null : round2(c.popularity),
        disambiguation: c.disambiguation || (dup ? `${later ? 'Another' : 'Most popular'} Qloo entry named "${c.name}" (popularity ${c.popularity === null ? 'n/a' : round2(c.popularity)})` : ''),
        duplicateOf: later ? cands.find((x) => normName(x.name) === key)!.name : undefined,
      };
    }));
  }

  async function resolve(rawQuery: unknown): Promise<ServiceResult> {
    const typed = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, 80) : '';
    if (!typed) return { status: 400, body: { ok: false, error: 'query is required' } };
    const query = canonicalQuery(typed);
    const rkey = await resolveKey(query);
    const r = await resolveBrand(client('resolve'), query);
    // Skip identical rewrites: on Workers every set is a KV write, and the free plan allows 1,000 a day.
    const prev = await kv.get<Candidate[]>(rkey);
    if (JSON.stringify(prev) !== JSON.stringify(r.candidates)) await kv.set(rkey, r.candidates);
    const candidates = await present(r.candidates);
    const dups = candidates.filter((c) => c.duplicateOf).length;
    const precomputed = !!instantBrand(typed) && r.evidence.cached;
    return { status: 200, body: { ok: true, query, candidates, evidence: clientSafe(r.evidence), precomputed,
      message: !r.candidates.length ? 'Qloo has no brand by that name. Try a well-known reference brand with a similar audience instead; TasteCast will not invent an ID.'
        : r.candidates.some((x) => x.exact) ? `Confirm which entity is the reference brand before any insights call.${dups ? ` Qloo lists ${dups + 1} entries with this exact name; the more popular one is preselected.` : ''}`
        : `No exact match for "${query}" on Qloo. These are Qloo's nearest names, not your brand. Pick one only if it is a fair stand-in, or search for a well-known reference brand.` } };
  }

  async function brandNamesOf(m: MatchCore) {
    const p = (await profiles()) ?? [];
    return [m.brand.name, ...m.local.brands.map((b) => b.name), ...p.flatMap((x) => x.seeds.filter((s) => s.type === 'urn:entity:brand').map((s) => s.matchedName))];
  }

  /** Rebuilds an outdated stored package from its stored match core, and adds the AI rewrite once if a binding exists. */
  async function ensurePackage(m: StoredMatch): Promise<StoredMatch> {
    const old = m.package as Partial<EndorsementPackage>;
    const outdated = (old.copyVersion ?? 0) < COPY_VERSION;
    // A background rewrite gets 60 s to land before a read retries it (it can be lost if the worker is evicted).
    const stalePending = old.copy?.reason === 'ai-pending' && Date.now() - Date.parse(m.createdAt) > 60_000;
    const wantsAi = !!ai && (outdated || (old.copy?.mode === 'template' && (old.copy.reason === 'no-ai-binding' || stalePending)));
    if (!outdated && !wantsAi) return m;
    let pkg = outdated ? buildPackage(m.id, m, { placeKinds: await placeKinds() }) : m.package;
    if (ai) pkg = await rewriteCopy(pkg, m.evidence, ai, await brandNamesOf(m));
    const next = { ...m, package: pkg };
    await kv.set(`match:${m.id}`, next);
    return next;
  }

  /** precomputed: an instant brand whose run used only stored Qloo results (0 new calls).
   *  plain: one sentence on the verdict. insight: the audience insight for the featured character (a warning only when
   *  it conflicts with the brief's target age). confirmedCandidate: the token of the confirmed entity, so the brief page
   *  can rerun this exact brief without searching again (it stays valid only while the reference brand is unchanged). */
  const view = async (m: StoredMatch, stored: boolean, confirmation: Confirmation) => {
    const f = m.ranking.find((r) => r.slug === m.package.character.slug);
    const ch = CHARACTERS.find((c) => c.slug === m.package.character.slug);
    return clientSafe({ ok: true, stored, ...m,
      decision: { ...m.decision, text: reword(m.decision.text) },
      plain: plainReason(m.decision, m.ranking),
      insight: audienceInsight(m.package.character.name, ch?.statedAge ?? 0, f?.drift, m.brief.audienceAge),
      confirmedCandidate: await candToken(m.brand.id),
      precomputed: !!instantBrand(m.brief.referenceQuery) && m.qloo.calls === m.qloo.cached,
      run: agentRun(m, m.package, stored ? 'stored' : 'live', m.confirmed ?? { exact: true, duplicates: 1 }, confirmation) });
  };

  /** Stores a new run with its package. On Workers the AI rewrite finishes after the response (see Deps.defer). */
  async function finish(id: string, core: MatchCore, confirmed: { exact: boolean; duplicates: number } | undefined, confirmation: Confirmation): Promise<ServiceResult & { served: 'live' }> {
    let pkg = buildPackage(id, core);
    const draft: StoredMatch = { ...core, id, package: pkg, createdAt: new Date().toISOString(), confirmed };
    if (ai && defer) {
      const pending: StoredMatch = { ...draft, package: { ...pkg, copy: { ...pkg.copy, reason: 'ai-pending' } } };
      await kv.set(`match:${id}`, pending);
      defer((async () => { const names = await brandNamesOf(draft); await kv.set(`match:${id}`, { ...draft, package: await rewriteCopy(pkg, core.evidence, ai, names) }); })().catch(() => undefined));
      return { status: 200, served: 'live', body: await view(pending, false, confirmation) };
    }
    if (ai) pkg = await rewriteCopy(pkg, core.evidence, ai, await brandNamesOf(draft));
    const stored: StoredMatch = { ...draft, package: pkg };
    await kv.set(`match:${id}`, stored);
    return { status: 200, served: 'live', body: await view(stored, false, confirmation) };
  }

  /** confirmation: how the candidate was picked, reported in the agent run (the server cannot verify a person). */
  async function match(rawBrief: unknown, candidateId: unknown, confirmation: Confirmation = 'unknown'): Promise<ServiceResult & { served?: 'stored' | 'live' }> {
    const { brief, error } = validateBrief(rawBrief);
    if (!brief) return { status: 400, body: { ok: false, error: error! } };
    const cands = await kv.get<Candidate[]>(await resolveKey(brief.referenceQuery));
    const tokens = await Promise.all((cands ?? []).map((x) => candToken(x.id)));
    const idx = tokens.indexOf(String(candidateId ?? ''));
    const picked = cands?.[idx];
    if (!picked) return { status: 409, body: { ok: false, error: 'Confirm a candidate from resolve_brand (/api/resolve) first. TasteCast never ranks against an unconfirmed Qloo entity.' } };
    const p = await profiles();
    const base = await loadBaseline(kv);
    if (!p?.length || !base) return { status: 503, body: { ok: false, error: 'Character profiles are not precomputed. Run npm run precompute.' } };
    const id = await sha(JSON.stringify({ v: SCORING_VERSION, brief, brand: picked.id }));
    const existing = await kv.get<StoredMatch>(`match:${id}`);
    if (existing) return { status: 200, served: 'stored', body: await view(await ensurePackage(existing), true, confirmation) };
    const core = await runMatch(client('match'), p, base, brief, { id: picked.id, name: picked.name });
    const confirmed = { exact: picked.exact, duplicates: cands!.filter((c) => normName(c.name) === normName(picked.name)).length };
    return finish(id, core, confirmed, confirmation);
  }

  /**
   * "Use this character" on the result page. Keeps the root run's brief, confirmed entity, ranking, decision and
   * evidence; adds package research for the chosen character (usually cached: it depends on her seeds and city, not
   * on the brand) and rebuilds the package and quote for her, marked as the user's choice. Stored under its own id.
   */
  async function cast(rawId: unknown, rawSlug: unknown): Promise<ServiceResult & { served?: 'stored' | 'live' }> {
    const first = await getMatch(String(rawId ?? ''));
    if (!first) return { status: 404, body: { ok: false, error: 'Unknown match id' } };
    const rootId = first.choice?.from ?? first.id;
    const root = rootId === first.id ? first : await getMatch(rootId);
    if (!root) return { status: 404, body: { ok: false, error: 'The original run for this match is gone. Run the brief again.' } };
    const slug = String(rawSlug ?? '');
    const rank = root.ranking.findIndex((r) => r.slug === slug) + 1;
    if (!rank) return { status: 400, body: { ok: false, error: 'Choose a character from this ranking.' } };
    const id = await sha(JSON.stringify({ v: SCORING_VERSION, parent: rootId, cast: slug }));
    const existing = await kv.get<StoredMatch>(`match:${id}`);
    if (existing) return { status: 200, served: 'stored', body: await view(await ensurePackage(existing), true, 'unknown') };
    const p = await profiles();
    if (!p?.length) return { status: 503, body: { ok: false, error: 'Character profiles are not precomputed. Run npm run precompute.' } };
    const names = new Map<string, string>([[root.brand.id, root.brand.name]]);
    for (const x of p) for (const sd of x.seeds) names.set(sd.id, sd.matchedName);
    const ev = new EvidenceLedger(names);
    // The root's package research comes last in its evidence; drop it so ids stay contiguous. If an older run has it
    // elsewhere, keep everything (ids never move, the new research is appended).
    const isLocal = (e: { step: string }) => e.step.startsWith('local-') || e.step.startsWith('places (precomputed');
    const kept = root.evidence.filter((e) => !isLocal(e));
    ev.items = (kept.every((e, i) => e.id === `ev${i + 1}`) ? kept : root.evidence).map((e) => ({ ...e }));
    const counter = { calls: 0, cached: 0 };
    const local = await localResearch(client('match'), p, root.brief, root.brand, slug, ev, counter);
    const leader = root.ranking[0];
    const name = root.ranking[rank - 1].name;
    const core: MatchCore = {
      brief: root.brief, brand: root.brand, ranking: root.ranking, decision: root.decision, local, evidence: ev.items, qloo: root.qloo,
      featured: { slug, requested: false, chosen: true, rank, note: rank === 1 ? `You chose ${name}, who is also #1 for this brief.` : `You chose ${name}, #${rank} for this brief (${leader.name} is #1). The ranking and its evidence are unchanged.` },
      choice: { slug, by: 'user', from: rootId, recommended: leader.slug, qloo: counter },
    };
    return finish(id, core, root.confirmed, 'unknown');
  }

  /** Brief, script and image prompt for the current case as text, for copy and download. */
  async function exportOf(id: string) {
    const m = await getMatch(id);
    return m ? exportCase(m, quote(m.id, m, m.package)) : undefined;
  }

  async function getMatch(id: string): Promise<StoredMatch | undefined> {
    if (!/^[0-9a-f]{16}$/.test(id)) return undefined;
    const m = await kv.get<StoredMatch>(`match:${id}`);
    return m ? ensurePackage(m) : undefined;
  }

  /** Demo briefs with the verdict of their stored match. Read-only: no Qloo calls, no writes. */
  async function demos() {
    return Promise.all(DEMO_BRIEFS.map(async (d, i) => {
      const brief = validateBrief(d.brief).brief!;
      const cands = (await kv.get<Candidate[]>(await resolveKey(brief.referenceQuery))) ?? [];
      const pick = cands.find((c) => c.exact);
      const m = pick ? await kv.get<StoredMatch>(`match:${await sha(JSON.stringify({ v: SCORING_VERSION, brief, brand: pick.id }))}`) : undefined;
      return {
        index: i, label: d.label, href: `/brief?demo=${i}&confirm=1`, brief, plain: m ? plainReason(m.decision, m.ranking) : null,
        verdict: m ? { level: m.decision.level, margin: m.decision.margin, leader: m.ranking[0].name, leaderSlug: m.ranking[0].slug, viable: m.decision.level === 'close' ? [m.ranking[0].slug, ...m.decision.alternatives].map((s) => CHARACTERS.find((c) => c.slug === s)?.name ?? s) : [m.ranking[0].name], matchId: m.id } : null,
      };
    }));
  }

  /** Instant brands with the verdict of their stored reference run (canonical brief). Read-only. */
  async function instant() {
    return Promise.all(INSTANT_BRANDS.map(async (b) => {
      const brief = instantBrief(b.query, b.category);
      const cands = (await kv.get<Candidate[]>(await resolveKey(b.query))) ?? [];
      const pick = cands.find((c) => c.exact);
      const m = pick ? await kv.get<StoredMatch>(`match:${await sha(JSON.stringify({ v: SCORING_VERSION, brief, brand: pick.id }))}`) : undefined;
      return { name: pick?.name ?? b.query, query: b.query, category: b.category, stored: !!m,
        verdict: m ? { level: m.decision.level, reason: m.decision.reason, leader: m.ranking[0].name, viable: m.decision.level === 'close' ? [m.ranking[0].slug, ...m.decision.alternatives].map((s) => CHARACTERS.find((c) => c.slug === s)?.name ?? s) : [m.ranking[0].name] } : null };
    }));
  }

  return { resolve, match, cast, getMatch, exportOf, view, demos, profiles, instant };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** The brief used for an instant brand's stored reference run (its verdict on the brief page). */
export const instantBrief = (query: string, category: string): Brief =>
  validateBrief({ brandName: 'Instant brief', referenceQuery: query, category, product: category, channels: ['instagram'], durationMonths: 3 }).brief!;

export function createApp(deps: Deps) {
  const { kv } = deps;
  const svc = createService(deps);
  const app = new Hono();
  const qloo = deps.qloo;

  app.onError((err, c) => {
    if (err instanceof BudgetExceeded) return c.json({ ok: false, error: budgetMessage(err.reason), reason: err.reason, demoOnly: true, demos: DEMO_LINKS }, 429);
    if (err instanceof QlooError) return c.json({ ok: false, error: err.message }, err.status === 503 ? 503 : 502);
    console.error('[error]', err.message);
    return c.json({ ok: false, error: 'Internal error' }, 500);
  });

  app.get('/api/health', async (c) => {
    if (!qloo.hasKey) return c.json({ ok: false, error: 'QLOO_API_KEY not set on the server' }, 503);
    const p = await svc.profiles();
    let reach = 'unknown';
    try { await qloo.get('/search', { query: 'Qloo health check', types: 'urn:entity:brand', take: '1' }, 'health'); reach = 'reachable'; } catch { reach = 'unreachable'; }
    return c.json({ ok: reach === 'reachable', qloo: reach, profiles: p?.length ?? 0, callsUsed: await qloo.networkCallsUsed(),
      limits: { projectCap: qloo.caps.total ?? 'none', publicCap: qloo.caps.public ?? 'none', perNetworkPerDay: deps.ipLimits ? { liveMatches: deps.ipLimits.match, liveSearches: deps.ipLimits.resolve } : 'none' } }, reach === 'reachable' ? 200 : 503);
  });

  app.get('/api/characters', async (c) => {
    const [p, rob] = await Promise.all([svc.profiles(), kv.get<RobustRow[]>('robustness:latest')]);
    return c.json(CHARACTERS.map((ch) => characterView(ch, p?.find((x) => x.slug === ch.slug), rob ?? [])));
  });

  app.get('/api/characters/:slug', async (c) => {
    const ch = CHARACTERS.find((x) => x.slug === c.req.param('slug'));
    if (!ch) return c.json({ ok: false, error: 'Unknown character' }, 404);
    const [p, rob] = await Promise.all([svc.profiles(), kv.get<RobustRow[]>('robustness:latest')]);
    return c.json(characterView(ch, p?.find((x) => x.slug === ch.slug), rob ?? []));
  });

  app.get('/api/demos', async (c) => {
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(await svc.demos());
  });

  app.get('/api/s5/:id', async (c) => {
    // 200 with available:false (not a 404), so pages do not log a console error for every run while the flag is off.
    if (!deps.flags?.s5Panel) return c.json({ ok: true, available: false });
    const panel = await kv.get<S5Panel>(S5_KEY);
    const b = panel?.briefs[c.req.param('id')];
    if (!panel || !b) return c.json({ ok: true, available: false });
    return c.json(clientSafe({ ok: true, available: true, label: b.label, model: panel.model, method: panel.method, generatedAt: panel.generatedAt, llmOnly: b.llmOnly,
      results: panel.results ? { ratedAt: panel.results.ratedAt, summary: panel.results.summary, preferred: panel.results.perBrief.find((x) => x.label === b.label)?.preferred ?? null } : null }));
  });

  app.get('/api/instant', async (c) => {
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(await svc.instant());
  });

  app.post('/api/resolve', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const r = await svc.resolve(body.query);
    return c.json(r.body, r.status);
  });

  app.post('/api/match', async (c) => {
    const t0 = Date.now();
    const body = await c.req.json().catch(() => ({}));
    const confirmation: Confirmation = body.confirmation === 'person' || body.confirmation === 'auto' ? body.confirmation : 'unknown';
    const r = await svc.match(body.brief, body.candidateId, confirmation);
    if (r.served) c.header('Server-Timing', `match;dur=${Date.now() - t0};desc="${r.served}"`);
    return c.json(r.body, r.status);
  });

  app.get('/api/match/:id', async (c) => {
    const m = await svc.getMatch(c.req.param('id'));
    return m ? c.json(await svc.view(m, true, 'unknown')) : c.json({ ok: false, error: 'Unknown match id' }, 404);
  });

  app.post('/api/match/:id/cast', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const r = await svc.cast(c.req.param('id'), body.character);
    return c.json(r.body, r.status);
  });

  app.get('/api/export/:id', async (c) => {
    const x = await svc.exportOf(c.req.param('id'));
    return x ? c.json(clientSafe({ ok: true, ...x })) : c.json({ ok: false, error: 'Unknown match id' }, 404);
  });

  app.get('/api/package/:id', async (c) => {
    const m = await svc.getMatch(c.req.param('id'));
    return m ? c.json(clientSafe(m.package)) : c.json({ ok: false, error: 'Unknown package id' }, 404);
  });

  app.get('/api/license/:id', async (c) => {
    const m = await svc.getMatch(c.req.param('id'));
    return m ? c.json(clientSafe(quote(m.id, m, m.package))) : c.json({ ok: false, error: 'Unknown package id' }, 404);
  });

  return app;
}
