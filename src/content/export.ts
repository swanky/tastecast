import type { MatchCore } from '../agent/match.js';
import type { EndorsementPackage, Line, Source } from './package.js';
import type { LicenseQuote } from './license.js';

/** Plain-text exports of the current case: what the brief page copies to the clipboard or downloads. */
export interface CaseExport { filename: string; markdown: string; script: string; imagePrompt: string }

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const KIND: Record<Source['kind'], string> = { qloo: 'Qloo data', brief: 'Brand brief', creative: 'Creative interpretation', rule: 'Product rule' };
const srcs = (l: Line) => (l.sources ?? l.sourceIds.map((ev) => ({ kind: 'qloo' as const, ev, supports: '' }))).map((s) => `${KIND[s.kind]}${s.ev ? ` ${s.ev}` : ''}`).join('; ');
const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function scriptText(p: EndorsementPackage): string {
  return [
    `${p.brand.name} × ${p.character.name}: 30-second script (${p.status.label})`,
    ...p.script30s.map((b) => [`[${b.t}] ${b.beat}: ${b.purpose}`, `  Visual/action: ${b.text}`, `  VO/super: ${b.vo}`, `  Product message: ${b.message}`, ...(b.cta ? [`  CTA: ${b.cta}`] : [])].join('\n')),
    `Channels: ${p.channelNote.text}`,
    `Disclosure: ${p.disclosure}`,
  ].join('\n\n');
}

export function imagePromptText(p: EndorsementPackage): string {
  return [`Image generation (no text in the image):\n${p.imagePrompt.text}`, `Post-production overlays:\n${p.overlays.map((o) => `- ${o.text}`).join('\n')}`].join('\n\n');
}

export function exportCase(m: MatchCore & { id: string; package: EndorsementPackage }, q: LicenseQuote): CaseExport {
  const pkg = m.package;
  const b = m.brief; const i = pkg.inputs;
  const verdict = m.decision.level === 'clear' ? 'Clear fit · based on Qloo data' : 'Close call';
  const md: string[] = [
    `# Campaign brief: ${b.brandName} × ${pkg.character.name}`,
    '',
    `Status: **${pkg.status.label}**. ${pkg.status.note}`,
    ...(i.example ? ['', '> The objective, audience, key message, facts and CTA in this demo are synthetic example data, not a real brand\'s claims.'] : []),
    '',
    '## Recommendation',
    `- Verdict: ${verdict} (${m.ranking[0].name} is #1, lead ${m.decision.margin} against a ${m.decision.threshold} threshold).`,
    ...m.ranking.map((r, n) => `- #${n + 1} ${r.name}: fit ${Math.round(r.score * 100)}, taste index ${r.parts.indexZ >= 0 ? '+' : ''}${r.parts.indexZ}σ.`),
    ...(m.decision.tradeoffs.length ? ['', 'Tradeoffs:', ...m.decision.tradeoffs.map((t) => `- ${t.text}`)] : []),
    '',
    '## Brief',
    `- Brand: ${b.brandName} (Qloo reference: ${m.brand.name})`,
    `- Product: ${pkg.brand.product} (${b.category})`,
    `- Channels: ${b.channels.join(', ')}; term ${b.durationMonths} months`,
    `- Objective: ${i.objective}${i.objectiveAssumed ? ' (assumed; not given in the brief)' : ''}`,
    `- Target audience: ${i.audience || (b.audienceAge ? b.audienceAge.replace(/_/g, ' ') : 'to be supplied')}`,
    `- Key message: ${i.keyMessage || 'to be supplied'}`,
    `- Approved facts: ${i.facts.length ? i.facts.join('; ') : 'to be supplied'}`,
    `- CTA: ${i.cta || 'to be supplied'}`,
    ...(i.toSupply.length ? ['', `To be supplied before production: ${i.toSupply.join(', ')}. TasteCast does not invent these.`] : []),
    '',
    '## Why this fit',
    ...pkg.angle.map((l) => `- ${l.text}`),
    '',
    '## Campaign concept',
    pkg.concept.text,
    '',
    '## 30-second script',
    '| Time | Beat | Visual / action | VO / super | Product message | CTA |',
    '|---|---|---|---|---|---|',
    ...pkg.script30s.map((s) => `| ${s.t} | ${s.beat} | ${cell(s.text)} | ${cell(s.vo)} | ${cell(s.message)} | ${cell(s.cta || '–')} |`),
    '',
    `Channels: ${pkg.channelNote.text}`,
    '',
    '## Shot list',
    '| # | Location | Action | Product | Camera |',
    '|---|---|---|---|---|',
    ...pkg.shotList.map((s) => `| ${s.n} | ${cell(s.location)} | ${cell(s.action)} | ${cell(s.product)} | ${cell(`${s.head}; ${s.gaze}; ${s.lens}`)} |`),
    '',
    '## Image prompt',
    `Generation (no text in the image): ${pkg.imagePrompt.text}`,
    '',
    'Post-production overlays:',
    ...pkg.overlays.map((o) => `- ${o.text}`),
    '',
    '## Styling and sound',
    ...pkg.wardrobe.map((l) => `- ${l.text}`),
    ...pkg.pairings.map((l) => `- ${l.text}`),
    `- Soundtrack direction (not cleared music): ${pkg.soundtrack.map((l) => l.text).join(', ') || 'none'}`,
    '',
    '## Licence quote',
    ...q.summary.map((x) => `- ${x}`),
    '',
    '## Sources',
    'Each line in the package lists its sources: Qloo data (an evidence id from this run), the brand brief, creative interpretation, or a product rule.',
    '',
    ...[pkg.concept, ...pkg.script30s, pkg.imagePrompt].map((l) => `- "${l.text.slice(0, 70)}${l.text.length > 70 ? '…' : ''}": ${srcs(l)}`),
    '',
    ...m.evidence.filter((e) => [pkg.concept, ...pkg.angle, ...pkg.script30s, ...pkg.soundtrack, ...pkg.pairings, pkg.imagePrompt, ...pkg.shotList].some((l) => l.sourceIds.includes(e.id)))
      .map((e) => `- ${e.id} · ${e.step}: ${e.results.slice(0, 5).join(', ') || 'no results'}`),
    '',
    `Next step: export for review with the character operator and the brand. Nothing is published, approved or paid by TasteCast. Every use carries "${pkg.disclosure}".`,
    '',
  ];
  return { filename: `tastecast-${slugify(b.brandName)}-${pkg.character.slug}.md`, markdown: md.join('\n'), script: scriptText(pkg), imagePrompt: imagePromptText(pkg) };
}
