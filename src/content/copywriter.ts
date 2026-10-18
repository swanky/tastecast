import { DISCLOSURE } from '../domain/characters.js';
import type { Evidence } from '../agent/evidence.js';
import type { EndorsementPackage, Line } from './package.js';

/** The subset of the Workers AI binding used here (env.AI.run). */
export interface AiLike { run(model: string, input: Record<string, unknown>): Promise<unknown> }

export const COPY_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Lines the AI may rewrite: the concept line and the visual/action text of the four script beats. Ranking reasons,
 *  supers and VO (quoted from the brief), prices, shot locations and the image prompt stay template-built. */
type Slot = { key: string; get: (p: EndorsementPackage) => Line; set: (p: EndorsementPackage, text: string) => void };
const SLOTS: Slot[] = [
  { key: 'concept', get: (p) => p.concept, set: (p, t) => { p.concept = { ...p.concept, text: t }; } },
  ...[0, 1, 2, 3].map((i) => ({ key: `script.${i}`, get: (p: EndorsementPackage) => p.script30s[i], set: (p: EndorsementPackage, t: string) => { p.script30s[i] = { ...p.script30s[i], text: t }; } })),
];

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’&.-]*/gu;
/** Strips trailing punctuation and a possessive 's, so "Brekkhus's" checks as "Brekkhus". */
const bare = (w: string) => w.replace(/[.'’-]+$/, '').replace(/['’]s$/i, '');
const words = (s: string) => (s.match(WORD) ?? []).map(bare);
const lower = (s: string) => s.toLowerCase();
/** Common words that may open a sentence; any other capitalised opener must already be in the source line. */
const OPENERS = new Set('a an the she her it its this that these those in on at with without by for from into over under through across after before then next now here there as while when where cut open opening close closing end final start lead creative styling keep let show shot frame camera scene finish begin hold pull push move cold warm soft light wide tight slow quick each every both one two all and but so yet or'.split(' '));
/** First-person or testimonial phrasing: the character is not a real user of the product. */
const TESTIMONIAL = /\b(i|i'm|i've|my|me|mine|we|our)\b|\b(love[sd]?|favou?rite|obsessed|swear by|recommend)\b/i;
/** Talent or licensing wording: a Qloo artist or brand is a taste reference, not someone booked, cleared or licensed.
 *  ("with Bratty featured" and "featuring Yerin Baek" got past the name check because the names were in the source line.) */
const TALENT = /\b(featur(?:e|es|ed|ing)|starring|stars|appear(?:s|ed|ing|ance)?|cameo|perform(?:s|ed|ing|ance)?|licen[cs](?:e|es|ed|ing)|sung by|guest|collab(?:oration|orating)?|endors(?:e|es|ed|ing|ement)|sponsor(?:s|ed|ing)?|with a reference to|tracks? by|music by|song by)\b/i;
/** Wording that says the character really uses the product (FTC endorsement guides): she is styled with it, not a user. */
const USE_CLAIM = /\b(daily|every ?day|routine|ritual|habit|go-to|staple|swears?|relies on|can't live without|uses it|her own)\b/i;

/**
 * Checks one rewritten line against the template line it replaces. A line passes only if it adds no claim:
 *  - every capitalised word (a name) already appears in the original line or in the always-allowed names,
 *  - no brand named in the run's evidence appears unless the original line already named it,
 *  - every number already appears in the original line,
 *  - no first-person or testimonial wording, the disclosure survives where it was, and the length is sane,
 *  - the character's first name and every Qloo-sourced name in the line (place, artist) are kept, and the disclosure is not moved into it,
 *  - no talent or licensing wording ("featuring", "starring", "licensed"…) and no claim that she uses the product
 *    ("daily", "routine"…) unless the template line already had it; a soundtrack line keeps "or similar".
 * Evidence ids are not written by the model: the line keeps exactly the ids of the template line it replaces.
 */
export function checkLine(original: string, rewritten: string, allowedNames: string[], evidenceBrands: string[], mustKeep: string[] = []): string | null {
  const t = rewritten.trim();
  if (!t) return 'empty';
  // The line's Qloo chips (a place, an artist) and the character must still be in it, or the sources stop matching the text.
  const fold = (x: string) => x.toLowerCase().normalize('NFC');
  const dropped = mustKeep.find((n) => fold(original).includes(fold(n)) && !fold(t).includes(fold(n)));
  if (dropped) return `drops a sourced name: ${dropped}`;
  if (!original.includes(DISCLOSURE) && t.includes(DISCLOSURE)) return 'adds the disclosure to a visual line (it belongs in the supers)';
  if (t.length > 260) return 'too long';
  if (/\bev\d+\b/i.test(t)) return 'writes evidence ids itself';
  if (original.includes(DISCLOSURE) && !t.includes(DISCLOSURE)) return 'drops the disclosure';
  if (TESTIMONIAL.test(t.replace(DISCLOSURE, ''))) return 'first-person or testimonial wording';
  const talent = t.match(TALENT)?.[0];
  if (talent && !TALENT.test(original)) return `talent or licensing wording: ${talent}`;
  const use = t.match(USE_CLAIM)?.[0];
  if (use && !new RegExp(`\\b${use}\\b`, 'i').test(original)) return `says the character uses the product: ${use}`;
  if (/\bor similar\b/i.test(original) && !/\bor similar\b/i.test(t)) return 'drops "or similar" from the soundtrack direction';
  const origWords = new Set(words(original).map(lower));
  const allowed = new Set([...origWords, ...allowedNames.flatMap(words).map(lower)]);
  const sentenceStart = new Set<number>();
  t.replace(/(^|[.!?:;]\s+|["“(]\s*)([\p{L}])/gu, (m, _a, _b, off: number) => { sentenceStart.add(off + m.length - 1); return m; });
  for (const m of t.matchAll(WORD)) {
    const w = bare(m[0]);
    if (/\d/.test(w) && !origWords.has(lower(w))) return `adds a number not in the source line: ${w}`;
    if (/^\p{Lu}/u.test(w) && !allowed.has(lower(w)) && !(sentenceStart.has(m.index!) && OPENERS.has(lower(w)))) return `adds a name not in the source line: ${w}`;
  }
  for (const b of evidenceBrands) {
    const re = new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(t) && !re.test(original)) return `mentions a brand the source line does not: ${b}`;
  }
  return null;
}

/** Qloo shot locations named in a line ("NOPI by Ottolenghi, Soho"): the place part must survive a rewrite. The
 *  generic fallback ("a London street (style cue: ...)") is not a Qloo place and may be reworded. */
const placesIn = (p: EndorsementPackage, text: string) => (p.shotList ?? []).filter((s) => !/^a .+ street \(style cue/.test(s.location)).map((s) => s.location.split(',')[0].trim()).filter((n) => n.length > 2 && text.includes(n));

function extractJson(out: unknown): Record<string, string> | null {
  const o = out as { response?: unknown } | null;
  const r = o && typeof o === 'object' && 'response' in o ? o.response : out;
  if (r && typeof r === 'object') return r as Record<string, string>;
  if (typeof r !== 'string') return null;
  const m = r.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

/**
 * Optional rewrite of the five copy lines with Workers AI, checked line by line. A rejected line keeps the
 * template text; any failure keeps the whole template. One AI call per package, stored with the match.
 */
export async function rewriteCopy(pkg: EndorsementPackage, evidence: Evidence[], ai: AiLike | undefined, brandNames: string[]): Promise<EndorsementPackage> {
  const out: EndorsementPackage = structuredClone(pkg);
  if (!ai) { out.copy = { mode: 'template', reason: 'no-ai-binding', accepted: [], rejected: [] }; return out; }
  const lines = SLOTS.map((s) => ({ key: s.key, line: s.get(pkg) }));
  const evById = new Map(evidence.map((e) => [e.id, e]));
  const facts = lines.map(({ key, line }) => ({
    key, text: line.text,
    evidence: line.sourceIds.map((id) => { const e = evById.get(id); return e ? `${e.step}: ${e.results.slice(0, 5).join(', ')}` : id; }),
  }));
  const allowedNames = [pkg.character.name, pkg.brand.name, pkg.brand.product, pkg.city, 'Qloo', DISCLOSURE];
  const prompt = [
    'You are a copy editor for a disclosed AI-character ad. Rewrite each line so it reads like a professional creative brief: concrete, warm, one or two sentences.',
    'Hard rules: keep every fact, add none. Do not add any name, brand, place, number or claim that is not in that line. Do not use first person or testimonial wording; the character is fictional and not a real user, so never say she uses the product daily or as a routine. Artists are a soundtrack direction, not booked talent: never write featuring, starring, appears or licensed. Keep the text "' + DISCLOSURE + '" exactly where a line contains it, and do not add it to any other line (it is shown as a separate super). Keep the character\'s first name and every place and artist name the line already has. Do not mention evidence ids.',
    `Character: ${pkg.character.name}. Brand: ${pkg.brand.name}. Product: ${pkg.brand.product}. City: ${pkg.city}.`,
    'Return only JSON mapping each key to its rewritten text.',
    JSON.stringify(facts),
  ].join('\n');
  let res: Record<string, string> | null = null;
  try {
    const raw = await ai.run(COPY_MODEL, {
      messages: [{ role: 'user', content: prompt }], max_tokens: 700, temperature: 0.3,
      response_format: { type: 'json_schema', json_schema: { type: 'object', properties: Object.fromEntries(lines.map((l) => [l.key, { type: 'string' }])), required: lines.map((l) => l.key) } },
    });
    res = extractJson(raw);
  } catch { res = null; }
  if (!res) { out.copy = { mode: 'template', model: COPY_MODEL, reason: 'ai-failed', accepted: [], rejected: [] }; return out; }
  const accepted: string[] = []; const rejected: { line: string; reason: string }[] = [];
  for (const s of SLOTS) {
    const orig = s.get(pkg).text; const cand = typeof res[s.key] === 'string' ? res[s.key] : '';
    const line = s.get(pkg);
    const sourced = line.sourceIds.flatMap((id) => evById.get(id)?.results ?? []);
    const why = checkLine(orig, cand, allowedNames, brandNames, [pkg.character.name.split(' ')[0], ...sourced, ...placesIn(pkg, orig)]);
    if (why) rejected.push({ line: s.key, reason: why }); else { s.set(out, cand.trim()); accepted.push(s.key); }
  }
  out.copy = accepted.length ? { mode: 'ai', model: COPY_MODEL, accepted, rejected } : { mode: 'template', model: COPY_MODEL, reason: 'all-rejected', accepted, rejected };
  return out;
}
