import { $, esc, api, img, chrome, DISCLOSURE, IDENTITY, demoOnlyNote } from '/common.js';
chrome('/brief');
const srcs = (ids) => (ids || []).filter(Boolean).map((id) => `<a class="src" href="#${esc(id)}" title="Qloo evidence ${esc(id)}">${esc(id)}</a>`).join('');
const KINDS = { qloo: 'Qloo data', brief: 'Brand brief', creative: 'Creative interpretation', rule: 'Product rule' };
const SHORT = { brief: 'Brief', creative: 'Creative', rule: 'Rule' };
/** Source chips for a package line: Qloo evidence ids link to the evidence; the other kinds say what they support. */
const sources = (l) => {
  if (!l.sources) return srcs(l.sourceIds);
  return `<span class="srcs">${l.sources.map((s) => s.kind === 'qloo'
    ? `<a class="src" href="#${esc(s.ev)}" title="${esc(`${KINDS.qloo}: ${s.supports}`)}">${esc(s.ev)}</a>`
    : `<span class="src k-${s.kind}" tabindex="0" title="${esc(`${KINDS[s.kind]}: ${s.supports}`)}" aria-label="${esc(`${KINDS[s.kind]}: ${s.supports}`)}">${SHORT[s.kind]}</span>`).join('')}</span>`;
};
const q = new URLSearchParams(location.search);
let chars = [];
let pending = null;
let requested = null;
/** True when a demo link or demo button pressed Confirm for the visitor; the agent run then says so. */
let autoConfirmed = false;
/** Active-run guard. Every new resolve, match or casting bumps gen and aborts the previous request; late answers
 *  from an older run (match, AI copy refresh, quote, export) are dropped instead of overwriting the page. */
const run = { gen: 0, ctrl: null, matchId: null, match: null };
function newRun() { run.gen++; run.ctrl?.abort(); run.ctrl = new AbortController(); return { gen: run.gen, signal: run.ctrl.signal }; }
const live = (t, id) => t.gen === run.gen && (id === undefined || id === run.matchId);
/** The confirmed Qloo entity for the brief on screen (from a stored run), valid only while the reference brand is unchanged. */
let confirmed = null;
const busy = (btn, on, label) => { if (!btn) return; btn.disabled = on; btn.setAttribute('aria-busy', on ? 'true' : 'false'); if (label) btn.textContent = label; };
const errText = (err) => err.kind === 'timeout' ? `it timed out (${err.message})` : err.kind === 'network' ? 'the network request failed' : err.kind === 'parse' ? err.message : err.message;

const verdictBadge = (v) => !v ? '' : `<em class="badge ${v.level}">${v.level === 'clear' ? `Clear fit · ${esc(v.leader.split(' ')[0])}` : `Close call · ${esc(v.viable.map((n) => n.split(' ')[0]).join(' / '))}`}</em>`;

async function init() {
  const [c, demos] = await Promise.all([api('/api/characters'), api('/api/demos')]);
  chars = c;
  setRequested(chars.find((x) => x.slug === q.get('character')) ?? null);
  $('#demos').innerHTML = demos.map((d, i) => `<button class="demo" data-i="${i}" type="button"><b>${esc(d.label)}</b><span>${esc(d.brief.product)} · reference ${esc(d.brief.referenceQuery)}</span>${verdictBadge(d.verdict)}${d.plain && d.verdict?.level === 'close' ? `<span class="small plain">${esc(d.plain)}</span>` : ''}</button>`).join('')
    + '<p class="small muted" style="margin-top:6px">One click fills the brief and runs it. Demo briefs are served from stored Qloo results.</p>';
  $('#demos').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { fill(demos[Number(b.dataset.i)].brief); $('#brief').requestSubmit(); autoConfirm(); } });
  api('/api/instant').then(renderInstant).catch(() => { $('#instant').closest('aside')?.querySelector('#instant')?.remove(); });
  return demos;
}

const short = (n) => n.split(' ')[0];
const instantBadge = (v) => !v ? '' : v.reason === 'baseline-brand' ? '<em class="badge close">baseline brand</em>'
  : `<em class="badge ${v.level}">${v.level === 'clear' ? `Clear fit · ${esc(short(v.leader))}` : `Close call · ${esc(v.viable.map(short).join(' / '))}`}</em>`;
function renderInstant(list) {
  const ready = list.filter((b) => b.stored);
  if (!ready.length) { $('#instant').remove(); return; }
  $('#instant').innerHTML = ready.map((b) => `<button type="button" class="ib" data-q="${esc(b.query)}" data-cat="${esc(b.category)}"><b>${esc(b.name)}</b>${instantBadge(b.verdict)}</button>`).join('')
    + '<p class="small muted" style="margin-top:6px">Use one of these as your reference brand, leave the campaign city empty, and your own brief runs on stored Qloo results: no wait, no new Qloo calls. Badges show the verdict for a generic brief; a niche tiebreak can change yours only when scores are within 0.03.</p>';
  $('#instant').addEventListener('click', (e) => {
    const b = e.target.closest('button.ib'); if (!b) return;
    const f = $('#brief'); f.elements.referenceQuery.value = b.dataset.q;
    if (!f.elements.category.value) f.elements.category.value = b.dataset.cat;
    (f.elements.brandName.value ? f.elements.product : f.elements.brandName).focus();
  });
}

function fill(brief) {
  const f = $('#brief');
  for (const k of ['brandName', 'referenceQuery', 'category', 'product', 'city', 'objective', 'audience', 'audienceAge', 'keyMessage', 'cta']) f.elements[k].value = brief[k] || '';
  f.elements.facts.value = (brief.facts || []).join('\n');
  f.elements.durationMonths.value = String(brief.durationMonths);
  for (const cb of f.querySelectorAll('input[name=channels]')) cb.checked = brief.channels.includes(cb.value);
  $('#example-note').hidden = !brief.example;
  exampleBrief = brief.example ? JSON.stringify(creative(brief)) : null;
  if (brief.character) setRequested(chars.find((c) => c.slug === brief.character) ?? null);
}
/** The demo's example fields are flagged as examples only while they are unchanged. */
let exampleBrief = null;
const creative = (b) => ({ objective: b.objective || '', audience: b.audience || '', audienceAge: b.audienceAge || '', keyMessage: b.keyMessage || '', facts: (b.facts || []).join('\n'), cta: b.cta || '' });

function readBrief() {
  const f = $('#brief'); const v = (k) => f.elements[k].value.trim();
  const b = {
    brandName: v('brandName'), referenceQuery: v('referenceQuery'), category: v('category'), product: v('product'), city: v('city'),
    channels: [...f.querySelectorAll('input[name=channels]:checked')].map((x) => x.value), durationMonths: Number(f.elements.durationMonths.value),
    ...(requested ? { character: requested.slug } : {}),
  };
  for (const k of ['objective', 'audience', 'audienceAge', 'keyMessage', 'cta']) if (v(k)) b[k] = v(k);
  const facts = v('facts').split('\n').map((x) => x.trim()).filter(Boolean);
  if (facts.length) b.facts = facts;
  if (exampleBrief && exampleBrief === JSON.stringify(creative(b))) b.example = true;
  return b;
}

function setRequested(c) {
  requested = c;
  $('#requested').innerHTML = !c ? '' : `<div class="requested">${img(c.images[0].src, c.images[0].alt)}
    <div><div class="eyebrow">Requested character</div><div class="serif" style="font-size:22px">${esc(c.name)}</div>
    <div class="small muted">TasteCast still ranks all three characters, and the package is built for ${esc(c.name.split(' ')[0])}. <a href="/brief">Clear</a></div></div></div>`;
}

/** Shows the confirmed entity of a stored run under the form, with a rerun button that skips the search. */
function showConfirmed() {
  const el = $('#confirmed-note');
  if (!confirmed) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `<p class="note small">Confirmed Qloo entity for <b>${esc(confirmed.ref)}</b>: ${esc(confirmed.name)}. Edit the brief and rerun with this entity, or change the reference brand to search again.</p>
    <p><button class="btn" type="button" id="rerun">Rerun with the confirmed entity</button></p>`;
  $('#rerun').addEventListener('click', () => rerun());
}
$('#brief').elements.referenceQuery.addEventListener('input', (e) => {
  // A different reference brand needs a new search and confirmation; the stored entity no longer applies.
  if (confirmed && e.target.value.trim() !== confirmed.ref) { confirmed = null; showConfirmed(); }
});

const candRow = (c) => `<label class="cand ${c.exact ? 'exact' : ''} ${c.duplicateOf ? 'dup' : ''}"><input type="radio" name="cand" value="${esc(c.id)}" ${c.preselected ? 'checked' : ''}> <b>${esc(c.name)}</b> <span class="muted small">${esc(c.disambiguation)}</span></label>`;

function validate(brief) {
  if (!brief.brandName || !brief.referenceQuery) {
    $('#brief-err').textContent = 'Fill in your brand and a reference brand, or pick one of the demo briefs (one click each).';
    $('#demos').classList.add('pulse'); setTimeout(() => $('#demos').classList.remove('pulse'), 1600); return false;
  }
  if (!brief.channels.length) { $('#brief-err').textContent = 'Pick at least one channel.'; return false; }
  return true;
}

$('#brief').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#brief-err').textContent = '';
  const brief = readBrief();
  if (!validate(brief)) return;
  const t = newRun();
  const btn = $('#find'); busy(btn, true);
  try {
    $('#confirm-sec').hidden = false; $('#confirm').dataset.state = 'loading'; $('#confirm').innerHTML = '<p class="muted" role="status">Searching Qloo…</p>';
    const r = await api('/api/resolve', { query: brief.referenceQuery }, { signal: t.signal, timeout: 20000 });
    if (!live(t)) return;
    pending = brief;
    $('#confirm').dataset.state = 'ready';
    if (!r.candidates.length) { $('#confirm').innerHTML = `<p class="note warn">${esc(r.message)}</p>`; return; }
    const anyExact = r.candidates.some((c) => c.exact);
    const main = anyExact ? r.candidates.filter((c) => c.exact) : r.candidates;
    const others = anyExact ? r.candidates.filter((c) => !c.exact) : [];
    $('#confirm').innerHTML = (r.precomputed ? `<p class="pre-note">Precomputed · ${esc(r.query)} is an instant brand: this search and the ranking come from stored Qloo results.</p>` : '')
      + `<fieldset class="cands"><legend class="sr">Qloo candidates</legend><p class="note ${anyExact ? '' : 'warn'}">${esc(r.message)}</p>` + main.map(candRow).join('')
      + (others.length ? `<details class="others"><summary>Other Qloo names (not exact matches) · ${others.length}</summary>${others.map(candRow).join('')}</details>` : '')
      + `</fieldset><p style="margin-top:20px"><button class="btn arrow" id="go" type="button">Confirm and rank</button></p>`;
    $('#go').addEventListener('click', () => runMatch());
    $('#confirm-sec').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    if (err.kind === 'abort' || !live(t)) return;
    $('#confirm').dataset.state = 'error';
    if (err.demoOnly) { $('#confirm').innerHTML = demoOnlyNote(err); return; }
    $('#confirm').innerHTML = `<p class="err" role="alert">Qloo search failed: ${esc(errText(err))}. Try again, or use a demo brief, which is served from stored results.</p>`;
  } finally { if (live(t)) busy(btn, false); }
});

/** POSTs a match and renders it, guarded against double submits and late answers. */
async function submitMatch(brief, candidateId, confirmation, btn) {
  const t = newRun();
  busy(btn, true); for (const b of document.querySelectorAll('#rerun, #go')) b.disabled = true;
  $('#result-sec').hidden = false; $('#result-sec').dataset.state = 'loading';
  $('#decision').innerHTML = '<p class="muted" role="status">Running the Qloo taste loop…</p>';
  for (const k of ['#ranking', '#choice', '#package', '#export', '#license']) $(k).innerHTML = '';
  try {
    const m = await api('/api/match', { brief, candidateId, confirmation }, { signal: t.signal, timeout: 60000 });
    if (!live(t)) return;
    render(m, t);
    history.replaceState(null, '', `/brief?match=${m.id}`);
    $('#result-sec').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    if (err.kind === 'abort' || !live(t)) return;
    $('#result-sec').dataset.state = 'error';
    if (err.demoOnly) { $('#decision').innerHTML = demoOnlyNote(err); return; }
    $('#decision').innerHTML = `<p class="err" role="alert">Match failed: ${esc(errText(err))}.</p>`;
  } finally { if (live(t)) { busy(btn, false); for (const b of document.querySelectorAll('#rerun, #go')) b.disabled = false; } }
}

function runMatch() {
  const id = document.querySelector('input[name=cand]:checked')?.value;
  const confirmation = autoConfirmed ? 'auto' : 'person'; autoConfirmed = false;
  return submitMatch(pending, id, confirmation, $('#go'));
}

function rerun() {
  $('#brief-err').textContent = '';
  const brief = readBrief();
  if (!validate(brief) || !confirmed || brief.referenceQuery !== confirmed.ref) return;
  pending = brief;
  $('#confirm-sec').hidden = true;
  return submitMatch(brief, confirmed.token, 'person', $('#rerun'));
}

const cap = (s) => String(s ?? '').replace(/^./, (c) => c.toUpperCase());
const CH = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', web: 'Web', ooh: 'Out-of-home' };
const z = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}σ`;
const sgn = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}`;
const meter = (label, value, pct, weight) => `<div class="row"><span>${label} <b>${value}</b></span><span class="muted">${weight}</span></div><div class="bar"><span style="width:${Math.max(0, Math.min(100, pct))}%"></span></div>`;
/** Diverging bar for a cosine in [−1, 1]: the fill grows left or right from the centre line. */
const dmeter = (label, cos, weight) => {
  const w = Math.min(50, Math.abs(cos) * 50);
  return `<div class="row"><span>${label} <b>${sgn(cos)}</b> <span class="muted">cosine, −1 to +1</span></span><span class="muted">${weight}</span></div>
    <div class="dbar"><i></i><span class="${cos < 0 ? 'neg' : ''}" style="${cos < 0 ? `right:50%` : `left:50%`};width:${w}%"></span></div>`;
};

function eyebrow(d) {
  const L = d.margin.toFixed(3), T = d.threshold;
  return {
    decided: `Clear fit · based on Qloo data · lead ${L} ≥ ${T}`,
    'lead-below-threshold': `Close call · lead ${L} is below the ${T} needed`,
    'measures-disagree': `Close call · lead ${L}, but the two taste measures disagree`,
    'index-disagrees': 'Close call · the taste index alone picks another character',
    'no-data': 'Close call · Qloo returned no taste-index data for a top character',
    'baseline-brand': 'Close call · the reference brand is one of the baseline brands',
  }[d.reason] ?? (d.level === 'clear' ? 'Clear fit · based on Qloo data' : 'Close call');
}

const KIND = { plan: 'Plan', tool: 'Tool', human: 'Person', check: 'Check', stop: 'Stop' };
function timeline(run) {
  if (!run) return '';
  const q = run.qloo;
  return `<p class="muted small">Served ${run.served === 'stored' ? 'from the stored run' : 'live'} · Qloo calls in the ranking run: ${q.calls} (${q.cached} answered from cache). The step order is fixed; what each step reports comes from this run's data.</p>
    <ol class="timeline">${run.steps.map((s) => `<li class="t-${s.kind} ${s.status ? `s-${s.status}` : ''}">
      <span class="kind">${KIND[s.kind]}</span>
      <div><b>${esc(s.title)}</b>${s.status === 'pass' ? ' <span class="ok">✓</span>' : s.status === 'fail' ? ' <span class="no">✗</span>' : ''}
        <p>${esc(s.detail)}${s.calls ? ` <span class="muted">${s.calls} call${s.calls > 1 ? 's' : ''}${s.cached ? `, ${s.cached} cached` : ''}</span>` : ''} ${srcs(s.evidenceIds)}</p></div></li>`).join('')}</ol>`;
}

const METHOD = `<div class="method small">
  <p><b>Qloo data.</b> For each of a character's seeds (artists, films, TV shows, brands), Qloo's insights API returns an affinity <i>a</i> among fans of the confirmed brand, and the same affinity among fans of six everyday baseline brands (Starbucks, Nike, Uniqlo, IKEA, Patagonia, L.L.Bean). Qloo also returns the age and gender mix of the brand's fans and of each seed's fans.</p>
  <ol>
    <li>Lift = <i>a</i> − μ, where μ and σ are the mean and spread of that seed's affinity across the baseline brands. z = lift ÷ max(σ, 0.02).</li>
    <li>Taste index = the mean z over the seeds Qloo covered, in σ. Raw lift = the mean lift. Index score = clamp(0.5 + z ÷ 6, 0, 1), so ±3σ fills the scale.</li>
    <li>Audience term = (cosine + 1) ÷ 2, where the cosine compares the brand's fans with the character's seed fans over six age brackets plus the female share.</li>
    <li>Fit score = 0.6 × index score + 0.4 × audience term, on 0–1, shown × 100. Shared taste tags and house-brand fit are shown as context with no weight.</li>
    <li>Clear fit: the leader is ahead by at least 0.08 (8 fit points), both the z-based index and the raw lift pick her, and Qloo covered seeds for both of the top two. Otherwise it is a close call and a person chooses.</li>
  </ol>
  <p><b>TasteCast heuristics, not Qloo data:</b> the baseline panel, the 0.02 spread floor, the ±3σ mapping, the 0.6 / 0.4 weights, the 0.08 threshold, the 0.03 niche tiebreak (operator data), and the age-bracket gap that triggers an audience warning. Scores are relative affinity signals, not purchase probability.</p></div>`;

const statusOf = (m) => m.package.status ?? { kind: 'recommended', label: 'Clear fit · based on Qloo data', note: '' };
const nameOf = (m, slug) => m.ranking.find((r) => r.slug === slug)?.name ?? slug;

function render(m, t) {
  run.matchId = m.id; run.match = m;
  const pic = (slug) => chars.find((c) => c.slug === slug)?.images[0] ?? {};
  const d = m.decision;
  const viable = d.level === 'close' ? [m.ranking[0].slug, ...d.alternatives] : [];
  const st = statusOf(m);
  confirmed = m.confirmedCandidate ? { token: m.confirmedCandidate, ref: m.brief.referenceQuery, name: m.brand.name } : null;
  showConfirmed();
  $('#result-sec').hidden = false; $('#result-sec').dataset.state = 'ready';
  const heading = d.level === 'clear' ? nameOf(m, m.ranking[0].slug) : viable.map((s) => nameOf(m, s)).join(' or ');
  $('#decision').innerHTML = `
    <div class="decision ${d.level}"><div class="eyebrow">${esc(eyebrow(d))}</div>
      <h3 class="serif rec-name">${esc(heading)}</h3>
      <p class="plain">${esc(m.plain ?? d.text)}</p>
      ${d.tradeoffs.length ? `<ul>${d.tradeoffs.slice(0, 3).map((t) => `<li>${esc(t.text)}</li>`).join('')}</ul>` : ''}
      ${m.featured?.requested || m.featured?.chosen ? `<p class="req">${esc(m.featured.note)}</p>` : ''}
      ${m.insight?.conflict ? `<p class="note warn small"><b>Audience insight.</b> ${esc(m.insight.text)}</p>` : ''}
      <p class="rec-actions">${d.level === 'close' ? `<a class="btn" href="#choice-sec">${m.choice ? 'Change the character' : 'Choose a character'}</a>` : ''}<a class="btn ghost" href="#export-sec">Export for review</a></p>
      <p class="fine">Package status: <b>${esc(st.label)}</b>. ${d.level === 'clear' ? 'Clear fit is TasteCast\'s call on Qloo data: ' : ''}lead ${d.margin.toFixed(3)} on the 0–1 fit scale against a ${d.threshold} threshold. <a href="#methods">How the score works</a></p></div>`;
  $('#ranking').innerHTML = m.ranking.map((r, i) => `
    <article class="rank ${i === 0 ? 'first' : ''}">
      <div class="head">${img(pic(r.slug).src, pic(r.slug).alt)}
        <div><div class="eyebrow">No. ${i + 1}${viable.includes(r.slug) ? ' · <span class="viable">viable</span>' : ''}${m.featured?.slug === r.slug ? (m.featured.chosen ? ' · your choice' : m.featured.requested ? ' · requested' : '') : ''}</div><h3><a href="/c/${esc(r.slug)}">${esc(r.name)}</a></h3><div class="muted small">${esc(r.city)}</div></div>
        <div class="score" title="Fit score out of 100">${Math.round(r.score * 100)}<small>fit score<br>/100</small></div></div>
      <div class="meter">
        ${meter('Qloo taste index', z(r.parts.indexZ), r.parts.index * 100, 'weight 0.6')}
        ${dmeter('Audience similarity', r.parts.cosine ?? (r.parts.audience * 2 - 1), 'weight 0.4')}
      </div>
      <ul class="why">${r.why.slice(0, 2).map((w) => `<li>${esc(w.text)} ${srcs(w.sourceIds)}</li>`).join('')}</ul>
      ${r.why.length > 2 ? `<details class="more-why"><summary>${r.why.length - 2} more signal${r.why.length - 2 > 1 ? 's' : ''} and context</summary><ul class="why">${r.why.slice(2).map((w) => `<li>${esc(w.text)} ${srcs(w.sourceIds)}</li>`).join('')}</ul>
        <p class="muted small">Context only, no weight: shared taste tags ${Math.round(r.parts.taste * 100)}% · house-brand fit ${Math.round(r.parts.fit * 100)}%</p></details>` : ''}
    </article>`).join('');
  renderChoice(m, viable);
  $('#agent-run').innerHTML = (m.precomputed && !m.stored ? `<p class="pre-note">Precomputed · ${esc(m.brand.name)} is an instant brand. Your brief ran just now on Qloo results stored ahead of time: ${m.qloo.calls} Qloo lookups, all from storage, 0 new calls.</p>` : '') + timeline(m.run);
  $('#method').innerHTML = METHOD;
  loadS5(m);
  renderPackage(m);
  renderExport(m, t);
  loadQuote(m, t);
  if (m.package.copy?.reason === 'ai-pending') refreshCopy(m.id, t);
  $('#evidence').innerHTML = evidenceHtml(m);
}

function renderChoice(m, viable) {
  const st = statusOf(m);
  const pic = (slug) => chars.find((c) => c.slug === slug)?.images[0] ?? {};
  if (m.decision.level !== 'close') {
    $('#choice').innerHTML = `<p>${esc(m.package.character.name)} is ${m.featured?.requested ? 'the requested character' : 'the clear fit'}, so the campaign below is built for her${m.featured?.requested && m.featured.rank > 1 ? ` (she ranks #${m.featured.rank})` : ''}. <span class="muted small">Status: ${esc(st.label)}.</span></p>`;
    return;
  }
  const current = m.package.character.slug;
  $('#choice').innerHTML = `<p class="choice-status s-${esc(st.kind)}"><b>${esc(st.label)}.</b> ${esc(st.note)}</p>
    <div class="choices">${viable.map((slug) => {
      const r = m.ranking.find((x) => x.slug === slug); const isCast = slug === current && st.kind === 'chosen';
      const tr = m.decision.tradeoffs.find((x) => x.slug === slug);
      return `<div class="choice ${isCast ? 'cast' : ''}">${img(pic(slug).src, pic(slug).alt)}
        <div><b>${esc(r.name)}</b> <span class="muted small">No. ${m.ranking.indexOf(r) + 1} · fit ${Math.round(r.score * 100)}</span>
        ${tr ? `<p class="small">${esc(tr.text.replace(/^[^:]+:\s*/, ''))}</p>` : ''}
        <button class="btn ${isCast ? 'ghost' : ''}" type="button" data-cast="${esc(slug)}" ${isCast ? 'disabled aria-pressed="true"' : 'aria-pressed="false"'}>${isCast ? 'Cast · your choice' : `Use ${esc(r.name.split(' ')[0])}`}</button></div></div>`;
    }).join('')}</div>
    <p class="small muted">Casting keeps the brief, the confirmed Qloo entity, the ranking and the evidence. Only the campaign and the quote are rebuilt for the character you choose. <span id="cast-msg" role="status"></span></p>
    ${m.choice ? `<p class="small"><a href="/brief?match=${esc(m.choice.from)}">Back to the preview for the #1 character</a></p>` : ''}`;
  for (const b of $('#choice').querySelectorAll('button[data-cast]')) b.addEventListener('click', () => castCharacter(m, b.dataset.cast, b));
}

async function castCharacter(m, slug, btn) {
  const t = newRun();
  for (const b of $('#choice').querySelectorAll('button[data-cast]')) b.disabled = true;
  busy(btn, true, 'Casting…');
  $('#cast-msg').textContent = '';
  try {
    const r = await api(`/api/match/${encodeURIComponent(m.id)}/cast`, { character: slug }, { signal: t.signal, timeout: 45000 });
    if (!live(t)) return;
    render(r, t);
    history.replaceState(null, '', `/brief?match=${r.id}`);
    $('#choice-sec').scrollIntoView({ behavior: 'smooth' });
    const cs = $('#choice .choice-status'); if (cs) { cs.setAttribute('tabindex', '-1'); cs.focus({ preventScroll: true }); }
  } catch (err) {
    if (err.kind === 'abort' || !live(t)) return;
    renderChoice(m, m.decision.level === 'close' ? [m.ranking[0].slug, ...m.decision.alternatives] : []);
    $('#cast-msg').innerHTML = `<span class="err">Casting failed: ${esc(errText(err))}. Try again.</span>`;
  }
}

/** The AI rewrite of a fresh run finishes after the response; swap in the stored copy once it is there (same run only). */
async function refreshCopy(id, t) {
  for (const wait of [4000, 4000, 6000]) {
    await new Promise((r) => setTimeout(r, wait));
    if (!live(t, id)) return;
    try {
      const m = await api(`/api/match/${encodeURIComponent(id)}`, null, { signal: t.signal, timeout: 10000 });
      if (!live(t, id)) return;
      if (m.package.copy?.reason !== 'ai-pending') { run.match = m; renderPackage(m); renderExport(m, t); return; }
    } catch { return; }
  }
}

const tbs = '<span class="tbs">To be supplied</span>';
function renderPackage(m) {
  const p = m.package;
  const st = statusOf(m);
  const i = p.inputs ?? { objective: 'awareness', objectiveAssumed: true, audience: '', keyMessage: '', facts: [], cta: '', example: false, toSupply: [] };
  $('#pkg-title').textContent = `Campaign · ${p.character.name} × ${p.brand.name}`;
  const copy = p.copy;
  $('#checker').innerHTML = `<p class="small">${!copy ? '' : copy.mode === 'ai'
    ? `Concept and script visuals rewritten by Workers AI (${esc(copy.model?.split('/').pop())}) and accepted by the checker: ${copy.accepted.length}. Kept as template: ${copy.rejected.length}${copy.rejected.length ? ` (${esc(copy.rejected.map((x) => x.reason).join('; '))})` : ''}.`
    : copy.reason === 'ai-pending' ? 'Copy from the deterministic template for now. The checked Workers AI rewrite is finishing in the background and replaces it here when it is done.'
    : `Copy from the deterministic template${copy.reason === 'ai-failed' ? ' (the AI rewrite failed)' : copy.reason === 'all-rejected' ? ' (the checker rejected every AI rewrite)' : ''}.`}
    The checker rejects any rewritten line that adds a name, brand, number, first-person or testimonial wording, talent or licensing wording, or a claim that the character uses the product. Supers and VO are quoted from the brief and never rewritten.</p>`;
  const script = p.script30s ?? [];
  $('#package').innerHTML = `
    <p class="status-banner s-${esc(st.kind)}"><b>${esc(st.label)}</b> ${esc(st.note)}</p>
    ${i.example ? '<p class="small muted">Example data: the objective, audience, key message, facts and CTA of this demo brief are synthetic, for illustration.</p>' : ''}
    ${p.concept ? `<p class="lede concept">${esc(p.concept.text)} ${sources(p.concept)}</p>` : ''}
    <p class="small muted">${esc(cap(p.brand.product))}, shot in ${esc(p.city)}. ${esc(p.brand.note)}</p>
    <dl class="inputs">
      <div><dt>Objective</dt><dd>${esc(cap(i.objective))}${i.objectiveAssumed ? ' <span class="muted small">(assumed)</span>' : ''}</dd></div>
      <div><dt>Audience</dt><dd>${i.audience ? esc(i.audience) : m.brief.audienceAge ? esc(m.brief.audienceAge.replace(/_/g, ' ')) : tbs}</dd></div>
      <div><dt>Key message</dt><dd>${i.keyMessage ? esc(i.keyMessage) : tbs}</dd></div>
      <div><dt>Approved facts</dt><dd>${i.facts.length ? i.facts.map(esc).join('<br>') : tbs}</dd></div>
      <div><dt>Call to action</dt><dd>${i.cta ? esc(i.cta) : tbs}</dd></div>
    </dl>
    ${i.toSupply.length ? `<p class="small">To be supplied before production: ${esc(i.toSupply.join(', '))}. TasteCast does not invent product claims.</p>` : ''}
    <h3>30-second script</h3>
    <table class="data script stack"><thead><tr><th scope="col">Time</th><th scope="col">Visual / action</th><th scope="col">VO / super</th><th scope="col">Product message</th><th scope="col">CTA</th></tr></thead><tbody>
      ${script.map((l) => `<tr><th scope="row" data-label="Time">${esc(l.t)}<br><span class="muted small">${esc(l.beat ?? '')}</span></th><td data-label="Visual / action">${esc(l.text)} ${sources(l)}</td><td data-label="VO / super">${esc(l.vo ?? '')}</td><td data-label="Product message">${esc(l.message ?? '')}</td><td data-label="CTA">${l.cta ? esc(l.cta) : '<span class="muted">–</span>'}</td></tr>`).join('')}
    </tbody></table>
    ${p.channelNote ? `<p class="small">${esc(p.channelNote.text)} ${sources(p.channelNote)}</p>` : ''}
    <h3>Shot list</h3>
    <table class="data shots stack"><thead><tr><th scope="col">#</th><th scope="col">Location</th><th scope="col">Action</th><th scope="col">Product</th><th scope="col">Camera</th></tr></thead><tbody>
      ${p.shotList.map((s) => `<tr><th scope="row" data-label="Shot">${s.n}</th><td data-label="Location">${esc(s.location)} ${sources(s)}</td><td data-label="Action">${esc(s.action ?? '')}</td><td data-label="Product">${esc(s.product ?? '')}</td><td data-label="Camera">${esc(s.head)}; ${esc(s.gaze)}; ${esc(s.lens)}</td></tr>`).join('')}
    </tbody></table>
    ${p.excludedPlaces?.length ? `<details class="small muted excluded"><summary>${p.excludedPlaces.length} Qloo place${p.excludedPlaces.length > 1 ? 's' : ''} left out as locations</summary><p>${p.excludedPlaces.map((x) => `${esc(x.name)} (${esc(x.reason)})`).join('; ')} ${srcs([...new Set(p.excludedPlaces.flatMap((x) => x.sourceIds))])}</p></details>` : ''}
    <div class="pkg">
      <div><h3>Image generation</h3><p class="small">${esc(p.imagePrompt.text)} ${sources(p.imagePrompt)}</p>
        ${p.overlays ? `<h3>Post-production overlays</h3><ul class="small">${p.overlays.map((o) => `<li>${esc(o.text)} ${sources(o)}</li>`).join('')}</ul>` : ''}</div>
      <div><h3>Soundtrack direction</h3><p class="small muted">Qloo artist affinities for the mood, not cleared or licensed music.</p><p class="small">${p.soundtrack.map((l) => `${esc(l.text)} ${sources(l)}`).join(' · ')}</p>
        <h3>Styling</h3><ul class="small">${[...p.wardrobe, ...p.pairings].map((l) => `<li>${esc(l.text)} ${sources(l)}</li>`).join('')}</ul>
        <p class="small muted">Place, brand and artist names are Qloo-sourced references for mood and location. They are not endorsements by those businesses or people, and not permissions to use them.</p></div>
    </div>
    <p class="small muted">Source tags: an <b>ev</b> number is Qloo data from this run (open it in Technical details); <b>Brief</b> is what the brand wrote; <b>Creative</b> is TasteCast's creative interpretation; <b>Rule</b> is a product rule such as the disclosure.</p>
    <div class="adbar"><span>${esc(p.disclosure)}</span><span>${esc(IDENTITY)}</span></div>`;
}

/** Copy and download for the current case. The text is fetched for this match id and dropped if the run changed. */
function renderExport(m, t) {
  const st = statusOf(m);
  $('#export').dataset.state = 'loading';
  $('#export').innerHTML = `<p>Package status: <b>${esc(st.label)}</b>${st.kind === 'preview' ? ' · choose a character above to cast the case' : ''}.</p>
    <div class="export-actions">
      <button class="btn" type="button" data-copy="markdown" disabled>Copy campaign brief</button>
      <button class="btn" type="button" data-copy="script" disabled>Copy script</button>
      <button class="btn" type="button" data-copy="imagePrompt" disabled>Copy image prompt</button>
      <button class="btn arrow" type="button" data-download disabled>Download campaign brief (.md)</button>
    </div>
    <p class="small" id="export-msg" role="status">Preparing the export…</p>
    <p class="small"><b>Next step: export for review.</b> Share the brief with the character operator and the brand. TasteCast does not publish, approve or charge anything.</p>`;
  const msg = $('#export-msg');
  const load = async () => {
    try {
      const x = await api(`/api/export/${encodeURIComponent(m.id)}`, null, { signal: t.signal, timeout: 10000 });
      if (!live(t, m.id)) return;
      $('#export').dataset.state = 'ready'; msg.textContent = `Ready: ${x.filename}`;
      for (const b of $('#export').querySelectorAll('button')) b.disabled = false;
      for (const b of $('#export').querySelectorAll('button[data-copy]')) b.onclick = () => copyText(x[b.dataset.copy], b.textContent.replace(/^Copy /, ''));
      $('#export').querySelector('button[data-download]').onclick = () => {
        const url = URL.createObjectURL(new Blob([x.markdown], { type: 'text/markdown;charset=utf-8' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: x.filename });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        msg.textContent = `Downloaded ${x.filename}.`;
      };
    } catch (err) {
      if (err.kind === 'abort' || !live(t, m.id)) return;
      $('#export').dataset.state = 'error';
      msg.innerHTML = `<span class="err">Export failed: ${esc(errText(err))}.</span> <button class="btn ghost" type="button" id="export-retry">Retry</button>`;
      $('#export-retry').onclick = () => { msg.textContent = 'Preparing the export…'; load(); };
    }
  };
  load();
}

async function copyText(text, what) {
  const msg = $('#export-msg');
  try { await navigator.clipboard.writeText(text); msg.textContent = `Copied the ${what}.`; }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text }); ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    const ok = document.execCommand?.('copy'); ta.remove();
    msg.textContent = ok ? `Copied the ${what}.` : `Copy is blocked in this browser; use Download instead.`;
  }
}

/** Licence quote: loading, ready, or an error with a retry. Dropped if the user moved on to another run. */
async function loadQuote(m, t) {
  const el = $('#license');
  el.dataset.state = 'loading';
  el.innerHTML = '<p class="muted small" role="status">Loading the licence quote…</p>';
  $('#license-json').innerHTML = '';
  try {
    const ql = await api(m.package.licenseUrl, null, { signal: t.signal, timeout: 10000 });
    if (!live(t, m.id)) return;
    if (typeof ql?.price_quote?.amount !== 'number') throw Object.assign(new Error('the quote was incomplete'), { kind: 'parse' });
    el.dataset.state = 'ready';
    el.innerHTML = `<div class="quote"><div><div class="eyebrow">Licence quote · shown, never charged</div><div class="price">US$${ql.price_quote.amount.toLocaleString('en-US')}</div>
      <p class="small"><b>Production included: ${ql.production_included ? 'yes' : 'no'}.</b> The fee covers the character licence only; shoot, image generation and edit are separate.</p></div>
      <ul class="small">${(ql.summary ?? [`${ql.character.name} for ${ql.licensee}: ${ql.channels.map((c) => CH[c] ?? c).join(', ')}, ${ql.duration.months} months.`]).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <p class="small">Approvals: <b>pending</b>. The character operator and the brand approve outside TasteCast; this demo records neither.</p></div>`;
    $('#license-json').innerHTML = `<p class="small"><a href="${esc(m.package.licenseUrl)}" target="_blank" rel="noopener">GET ${esc(m.package.licenseUrl)}</a> · <a href="/api/package/${esc(m.id)}" target="_blank" rel="noopener">Package JSON</a></p><pre>${esc(JSON.stringify(ql, null, 2))}</pre>`;
  } catch (err) {
    if (err.kind === 'abort' || !live(t, m.id)) return;
    el.dataset.state = 'error';
    el.innerHTML = `<p class="err small" role="alert">The licence quote did not load: ${esc(errText(err))}.</p><p><button class="btn ghost" type="button" id="quote-retry">Retry the quote</button></p>`;
    $('#quote-retry').addEventListener('click', () => loadQuote(m, t));
  }
}

function evidenceHtml(m) {
  return `<p class="muted small">Qloo calls for the ranking run: ${m.qloo.calls} (${m.qloo.cached} from cache)${m.choice ? `; casting ${esc(nameOf(m, m.choice.slug))}: ${m.choice.qloo.calls} (${m.choice.qloo.cached} from cache)` : ''}. Entity IDs are shown as names.</p>` + m.evidence.map((e) => `
    <details id="${esc(e.id)}"><summary>${esc(e.id)} · ${esc(e.step)} <span class="muted">${esc(e.endpoint)}${e.cached ? ' · cached' : ''}</span></summary>
      <table class="data">${Object.entries(e.params).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
      <p class="small"><strong>Top results:</strong> ${e.results.map(esc).join(' · ')}</p>${e.note ? `<p class="small muted">${esc(e.note)}</p>` : ''}</details>`).join('');
}

/** S5 panel: shown only when the server flag is on and an LLM-only version exists for this run. */
async function loadS5(m) {
  $('#s5-sec').hidden = true;
  let r; try { r = await api(`/api/s5/${encodeURIComponent(m.id)}`); } catch { return; }
  if (!r.available) return;
  const L = r.llmOnly;
  $('#s5').innerHTML = `<p class="muted small">The same brief and the same character cards given to ${esc(r.model)} with no Qloo data. ${esc(r.method)}</p>
    <div class="pkg"><div><h3>Character picked</h3><p>${esc(L.character)}</p><p class="small">${esc(L.why)}</p><h3>Content angle</h3><p class="small">${esc(L.angle)}</p></div>
      <div><h3>Locations</h3><ul class="small">${L.locations.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><h3>Soundtrack direction</h3><p class="small muted">Qloo artist affinities for the mood, not cleared or licensed music.</p><p class="small">${L.soundtrack.map(esc).join(' · ')}</p>
      <h3>Styling</h3><ul class="small">${L.styling.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>
    <p class="small ${r.results ? '' : 'muted'}" style="margin-top:12px">${r.results ? `Blind self-rating (${esc(r.results.ratedAt)}): ${esc(r.results.summary)}${r.results.preferred ? ` For this brief: ${r.results.preferred === 'qloo' ? 'the Qloo version was preferred' : r.results.preferred === 'tie' ? 'no preference' : 'the LLM-only version was preferred'}.` : ''}` : 'No rating yet: the blind self-rating has not been done, so no result is shown.'}</p>`;
  $('#s5-sec').hidden = false;
}

/** Evidence links and the method link point inside the collapsed Technical details: open it (and the evidence item) first. */
function reveal(hash) {
  const el = hash && document.getElementById(hash.slice(1));
  if (!el) return;
  const tech = $('#tech');
  if (tech.contains(el)) tech.open = true;
  if (el.tagName === 'DETAILS') el.open = true;
  el.scrollIntoView({ block: 'start' });
  if (el.tagName === 'DETAILS') el.querySelector('summary')?.focus(); else { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
}
addEventListener('hashchange', () => reveal(location.hash));
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const h = a.getAttribute('href');
  if (h === location.hash) { e.preventDefault(); reveal(h); }
});

async function autoConfirm() {
  for (let i = 0; i < 80 && !document.querySelector('#go'); i++) await new Promise((r) => setTimeout(r, 100));
  const go = document.querySelector('#go');
  if (go) { autoConfirmed = true; go.click(); }
}

async function deepLink(demos) {
  // Judge paths: /brief?demo=N&confirm=1 fills, resolves and confirms the preselected exact candidate; /brief?match=<id> shows a stored run.
  // A stored run also refills the whole brief, so it can be edited and rerun with the confirmed entity.
  if (q.has('match')) {
    const t = newRun();
    try {
      const m = await api(`/api/match/${encodeURIComponent(q.get('match'))}`, null, { signal: t.signal });
      if (!live(t)) return;
      fill(m.brief); render(m, t);
      if (location.hash) reveal(location.hash); else $('#result-sec').scrollIntoView();
    } catch (err) { if (err.kind !== 'abort') $('#brief-err').textContent = `Could not load that run: ${errText(err)}`; }
    return;
  }
  if (!q.has('demo')) return;
  const d = demos[Number(q.get('demo'))]; if (!d) return;
  fill(d.brief);
  $('#brief').requestSubmit();
  if (q.get('confirm') === '1') await autoConfirm();
}
init().then(deepLink).catch((e) => { $('#demos').innerHTML = `<p class="err">${esc(e.message)}</p>`; });
