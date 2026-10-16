import { CHARACTERS } from '../domain/characters.js';
import type { Evidence } from './evidence.js';
import type { MatchCore } from './match.js';
import type { EndorsementPackage } from '../content/package.js';

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

/**
 * Turns a stored or fresh match into the agent's step list. Every step is derived from data the run produced
 * (the brief, the confirmed candidate, the evidence ledger, the decision and the package), never from fixed copy.
 */
const pkgIds = (p: EndorsementPackage) => [...new Set([...p.angle, ...p.script30s, ...p.shotList, ...p.soundtrack, p.imagePrompt].flatMap((l) => l.sourceIds))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));

export function agentRun(m: MatchCore, pkg: EndorsementPackage, served: 'live' | 'stored', confirmed: { exact: boolean; duplicates: number }): AgentRun {
  const b = m.brief; const d = m.decision; const w = m.ranking[0];
  const plan = [
    `Resolve "${b.referenceQuery}" on Qloo and wait for a person to confirm the entity`,
    'read the brand audience', 'run the taste index for all three characters',
    ...(b.city ? [`add a no-weight in-city check for ${b.city}`] : []),
    'run context checks', 'self-check the verdict (lead and both index measures)',
    `draft the package for ${b.character ? `${nm(b.character)} (requested)` : 'the leader'}`, 'quote a license and stop for human approval',
  ];
  const steps: AgentStep[] = [
    { kind: 'plan', title: 'Plan', detail: plan.join(' → ') + '.', evidenceIds: [], status: 'info' },
    { kind: 'human', title: 'Human confirmed the Qloo entity', detail: `${m.brand.name}${confirmed.exact ? ', exact name match' : ', not an exact name match (a stand-in the person accepted)'}${confirmed.duplicates > 1 ? `; Qloo lists ${confirmed.duplicates} entries with this name and the person kept the preselected, more popular one` : ''}. No insights call ran before this.`, evidenceIds: [], status: 'pass' },
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
    { kind: 'check', title: 'Lead over the runner-up', detail: `${nm(w.slug)} leads ${m.ranking[1] ? nm(m.ranking[1].slug) : ''} by ${d.margin.toFixed(3)} fit score; "Qloo decided" needs at least ${d.threshold}.`, evidenceIds: [], status: d.margin >= d.threshold ? 'pass' : 'fail' },
    { kind: 'check', title: 'Both taste measures agree', detail: `Spread-adjusted index picks ${nm(zl)}; raw lift picks ${nm(ll)}${zl === ll && zl === w.slug ? ', the same leader' : ''}.`, evidenceIds: w.why[0]?.sourceIds ?? [], status: zl === w.slug && ll === w.slug ? 'pass' : 'fail' },
    { kind: 'check', title: 'Seed coverage', detail: top2.map((r) => `${nm(r.slug)} ${r.index.covered}/${r.index.total} seeds`).join(', ') + '.', evidenceIds: [], status: top2.every((r) => r.index.covered > 0) ? 'pass' : 'fail' },
  ];
  if (d.reason === 'baseline-brand') checks.push({ kind: 'check', title: 'Baseline brand guard', detail: `${m.brand.name} is one of the everyday baseline brands, so its index is near zero by construction.`, evidenceIds: [], status: 'fail' });
  if (w.tiebreak) checks.push({ kind: 'check', title: 'Niche tiebreak (operator data)', detail: `Scores were within 0.03; the operator niche "${w.tiebreak}" broke the tie. Not Qloo data.`, evidenceIds: [], status: 'info' });
  const drift = m.ranking.find((r) => r.slug === pkg.character.slug)?.drift;
  if (drift?.flagged) checks.push({ kind: 'check', title: 'Drift Check', detail: drift.message, evidenceIds: [], status: 'info' });
  steps.push(...checks);
  const verdict = d.level === 'clear' ? `Qloo decided: ${nm(w.slug)}.` : `Close call: ${[w.slug, ...d.alternatives].map(nm).join(' and ')} stay viable; the person chooses on the tradeoffs.`;
  steps.push({ kind: 'check', title: 'Verdict', detail: verdict, evidenceIds: [], status: d.level === 'clear' ? 'pass' : 'info' });
  const c = pkg.copy;
  steps.push({ kind: 'tool', title: `Draft package for ${pkg.character.name}`, detail: `Every line carries its evidence ids.${pkg.excludedPlaces.length ? ` Left out ${pkg.excludedPlaces.length} Qloo place${pkg.excludedPlaces.length > 1 ? 's' : ''} that are shops or other brands.` : ''} Copy: ${c.mode === 'ai' ? `Workers AI rewrite, ${c.accepted.length} line${c.accepted.length === 1 ? '' : 's'} accepted by the checker, ${c.rejected.length} kept as template` : c.reason === 'no-ai-binding' ? 'deterministic template' : c.reason === 'ai-failed' ? 'template (the AI call failed)' : 'template (the checker rejected every AI rewrite)'}.`, evidenceIds: pkgIds(pkg), status: 'info' });
  steps.push({ kind: 'stop', title: 'Stop: waiting for people', detail: `License quote issued with charged:false. Character operator and brand approvals stay unchecked; nothing is published or paid.`, evidenceIds: [], status: 'info' });
  return { steps, served, qloo: m.qloo };
}
