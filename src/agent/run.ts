import { CHARACTERS } from '../domain/characters.js';
import type { Evidence } from './evidence.js';
import type { MatchCore } from './match.js';
import { packageLines, type EndorsementPackage } from '../content/package.js';
import { audienceInsight } from '../content/creative.js';

export type StepKind = 'plan' | 'tool' | 'human' | 'check' | 'stop';
export interface AgentStep { kind: StepKind; title: string; detail: string; evidenceIds: string[]; calls?: number; cached?: number; status?: 'pass' | 'fail' | 'info' }
export interface AgentRun { steps: AgentStep[]; served: 'live' | 'stored'; qloo: { calls: number; cached: number } }

const nm = (slug: string) => CHARACTERS.find((c) => c.slug === slug)?.name ?? slug;

/** Evidence step names grouped into the tool phases of the loop, in run order. */
const PHASES: { title: string; test: (e: Evidence) => boolean; why: string }[] = [
  { title: 'Read the brand audience', test: (e) => e.step === 'audience', why: 'Qloo age and gender demographics for fans of the confirmed brand.' },
  { title: 'Taste index', test: (e) => e.step === 'taste-index', why: "How strongly the brand's fans like each character's seeds, against the everyday-brand baseline. One query per seed type, all characters in the same query." },
  { title: 'In-city check', test: (e) => e.step.startsWith('in-city@'), why: 'Same question limited to the campaign city. Context, no weight.' },
  { title: 'Context checks', test: (e) => e.step === 'brand-tags' || e.step.startsWith('fit:'), why: 'Brand taste tags and a house-brand fit check with explainability. Shown, no weight.' },
  { title: 'Character profiles', test: (e) => e.step.includes('(precomputed'), why: 'Seed demographics, taste tags and places built once per character. Read from the profile store, not called again.' },
  { title: 'Local package research', test: (e) => e.step.startsWith('local-'), why: "Tags, artists and brands for the chosen character's city and age bucket." },
];

/** Who picked the Qloo entity. The server can prove only that the candidate token came from a stored search for
 *  this query text, so the trace says how the confirmation arrived instead of claiming a person chose it.
 *  person: the Confirm button was clicked in the browser. auto: a demo link (confirm=1) or a one-click demo
 *  pressed it for the visitor. mcp: the calling agent passed a candidate_id. unknown: a stored run opened by id. */
export type Confirmation = 'person' | 'auto' | 'mcp' | 'unknown';

const CONFIRM_STEP: Record<Confirmation, { title: string; kind: StepKind; how: string }> = {
  person: { title: 'Person confirmed the Qloo entity', kind: 'human', how: 'Picked in the browser' },
  auto: { title: 'Qloo entity confirmed automatically (demo link)', kind: 'check', how: 'The demo link pressed Confirm for you and kept the preselected candidate; open the brief without confirm=1 to choose it yourself' },
  mcp: { title: 'Qloo entity confirmed by the calling agent', kind: 'check', how: 'The MCP client passed a candidate_id from resolve_brand; TasteCast checks the token came from that search, not who chose it' },
  unknown: { title: 'Qloo entity confirmed before ranking', kind: 'check', how: 'Stored run' },
};

/**
 * Turns a stored or fresh match into the agent's step list. The step order and the short phase descriptions are
 * fixed text; what each step reports (entity, calls, cache hits, evidence ids, check results, verdict, package)
 * comes from data the run produced.
 */
const pkgIds = (p: EndorsementPackage) => [...new Set(packageLines(p).flatMap((l) => l.sourceIds))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));

export function agentRun(m: MatchCore, pkg: EndorsementPackage, served: 'live' | 'stored', confirmed: { exact: boolean; duplicates: number }, confirmation: Confirmation = 'unknown'): AgentRun {
  const b = m.brief; const d = m.decision; const w = m.ranking[0];
  const plan = [
    `Resolve "${b.referenceQuery}" on Qloo and wait for the entity to be confirmed`,
    'read the brand audience', 'run the taste index for all three characters',
    ...(b.city ? [`add a no-weight in-city check for ${b.city}`] : []),
    'run context checks', 'self-check the verdict (lead and both index measures)',
    `draft the package for ${b.character ? `${nm(b.character)} (requested)` : 'the leader'}`, 'quote a license and stop for human approval',
  ];
  const cf = CONFIRM_STEP[confirmation];
  const who = confirmation === 'person' ? 'the person' : 'the confirmation';
  const steps: AgentStep[] = [
    { kind: 'plan', title: 'Plan (derived from the brief, not generated)', detail: plan.join(' → ') + '.', evidenceIds: [], status: 'info' },
    { kind: cf.kind, title: cf.title, detail: `${cf.how}: ${m.brand.name}${confirmed.exact ? ', exact name match' : `, not an exact name match (a stand-in ${who} accepted)`}${confirmed.duplicates > 1 ? `; Qloo lists ${confirmed.duplicates} entries with this name and ${who} kept the preselected, more popular one` : ''}. The server refuses to rank without a confirmed candidate, so no insights call ran before this.`, evidenceIds: [], status: 'pass' },
  ];
  for (const ph of PHASES) {
    const ev = m.evidence.filter(ph.test);
    if (!ev.length) continue;
    const pre = ph.title === 'Character profiles';
    steps.push({ kind: 'tool', title: ph.title, detail: ph.why, evidenceIds: ev.map((e) => e.id), calls: pre ? 0 : ev.length, cached: pre ? 0 : ev.filter((e) => e.cached).length, status: 'info' });
  }
  const zl = d.indexLeaderZ, ll = d.indexLeaderLift;
  const top2 = m.ranking.slice(0, 2);
  const checks: AgentStep[] = [
    { kind: 'check', title: 'Lead over the runner-up', detail: `${nm(w.slug)} leads ${m.ranking[1] ? nm(m.ranking[1].slug) : ''} by ${d.margin.toFixed(3)} fit score; a clear fit needs at least ${d.threshold} (a TasteCast threshold).`, evidenceIds: [], status: d.margin >= d.threshold ? 'pass' : 'fail' },
    { kind: 'check', title: 'Both taste measures agree', detail: `Spread-adjusted index picks ${nm(zl)}; raw lift picks ${nm(ll)}${zl === ll && zl === w.slug ? ', the same leader' : ''}.`, evidenceIds: w.why[0]?.sourceIds ?? [], status: zl === w.slug && ll === w.slug ? 'pass' : 'fail' },
    { kind: 'check', title: 'Seed coverage', detail: top2.map((r) => `${nm(r.slug)} ${r.index.covered}/${r.index.total} seeds`).join(', ') + '.', evidenceIds: [], status: top2.every((r) => r.index.covered > 0) ? 'pass' : 'fail' },
  ];
  if (d.reason === 'baseline-brand') checks.push({ kind: 'check', title: 'Baseline brand guard', detail: `${m.brand.name} is one of the everyday baseline brands, so its index is near zero by construction.`, evidenceIds: [], status: 'fail' });
  if (w.tiebreak) checks.push({ kind: 'check', title: 'Niche tiebreak (operator data)', detail: `Scores were within 0.03; the operator niche "${w.tiebreak}" broke the tie. Not Qloo data.`, evidenceIds: [], status: 'info' });
  const fr = m.ranking.find((r) => r.slug === pkg.character.slug);
  const ch = CHARACTERS.find((c) => c.slug === pkg.character.slug);
  const ins = fr?.drift?.flagged || b.audienceAge ? audienceInsight(pkg.character.name, ch?.statedAge ?? 0, fr?.drift, b.audienceAge) : null;
  if (ins) checks.push({ kind: 'check', title: ins.conflict ? 'Audience insight · conflicts with the campaign audience' : 'Audience insight', detail: ins.text, evidenceIds: [], status: ins.conflict ? 'fail' : 'info' });
  steps.push(...checks);
  const verdict = d.level === 'clear' ? `Clear fit, based on Qloo data: ${nm(w.slug)}.` : `Close call: ${[w.slug, ...d.alternatives].map(nm).join(' and ')} stay viable; the person chooses on the tradeoffs.`;
  steps.push({ kind: 'check', title: 'Verdict', detail: verdict, evidenceIds: [], status: d.level === 'clear' ? 'pass' : 'info' });
  if (m.choice) steps.push({ kind: 'human', title: 'Character chosen by the user', detail: `The user chose ${nm(m.choice.slug)} (#${m.ranking.findIndex((r) => r.slug === m.choice!.slug) + 1}) on the result page. The brief, the confirmed entity, the ranking and the evidence above are unchanged; the package and quote are rebuilt for ${nm(m.choice.slug)}.`, evidenceIds: [], status: 'info' });
  else if (d.level === 'close' && !m.featured?.requested) steps.push({ kind: 'stop', title: 'Package is a preview until someone casts', detail: `The package below is drafted for the #1 character, ${nm(w.slug)}, as a preview. Choose a viable character to cast the case.`, evidenceIds: [], status: 'info' });
  const c = pkg.copy;
  steps.push({ kind: 'tool', title: `Draft package for ${pkg.character.name}`, detail: `Every line lists its sources: Qloo evidence ids, the brief, creative interpretation or a product rule.${pkg.excludedPlaces.length ? ` Left out ${pkg.excludedPlaces.length} Qloo place${pkg.excludedPlaces.length === 1 ? ' that is' : 's that are'} not a fit for the shoot (other brands' shops, or hotels and bars for a non-hospitality product).` : ''} Copy: ${c.mode === 'ai' ? `Workers AI rewrite, ${c.accepted.length} line${c.accepted.length === 1 ? '' : 's'} accepted by the checker, ${c.rejected.length} kept as template` : c.reason === 'no-ai-binding' ? 'deterministic template' : c.reason === 'ai-pending' ? 'template for now; the checked Workers AI rewrite is finishing in the background' : c.reason === 'ai-failed' ? 'template (the AI call failed)' : 'template (the checker rejected every AI rewrite)'}.`, evidenceIds: pkgIds(pkg), status: 'info' });
  steps.push({ kind: 'stop', title: 'Stop: waiting for people', detail: `License quote issued with charged:false; production is not included. The character operator and the brand approve outside TasteCast; nothing is published or paid. Next step: export for review.`, evidenceIds: [], status: 'info' });
  return { steps, served, qloo: m.qloo };
}
