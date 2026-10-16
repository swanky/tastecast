import { $, esc, api, img, chrome, DISCLOSURE, IDENTITY, demoOnlyNote } from '/common.js';
chrome('/brief');
const srcs = (ids) => (ids || []).filter(Boolean).map((id) => `<a class="src" href="#${esc(id)}" title="Qloo evidence ${esc(id)}">${esc(id)}</a>`).join('');
const q = new URLSearchParams(location.search);
let chars = [];
let pending = null;
let requested = null;

const verdictBadge = (v) => !v ? '' : `<em class="badge ${v.level}">${v.level === 'clear' ? `Qloo decided · ${esc(v.leader.split(' ')[0])}` : `Close call · ${esc(v.viable.map((n) => n.split(' ')[0]).join(' / '))}`}</em>`;

async function init() {
  const [c, demos] = await Promise.all([api('/api/characters'), api('/api/demos')]);
  chars = c;
  requested = chars.find((x) => x.slug === q.get('character')) ?? null;
  if (requested) $('#requested').innerHTML = `<div class="requested">${img(requested.images[0].src, requested.images[0].alt)}
    <div><div class="eyebrow">Requested character</div><div class="serif" style="font-size:22px">${esc(requested.name)}</div>
    <div class="small muted">TasteCast still ranks all three characters, and the package is built for ${esc(requested.name.split(' ')[0])}. <a href="/brief">Clear</a></div></div></div>`;
  $('#demos').innerHTML = demos.map((d, i) => `<button class="demo" data-i="${i}" type="button"><b>${esc(d.label)}</b><span>${esc(d.brief.product)} · reference ${esc(d.brief.referenceQuery)}</span>${verdictBadge(d.verdict)}</button>`).join('')
    + '<p class="small muted" style="margin-top:6px">One click fills the brief and runs it. Demo briefs are served from stored Qloo results.</p>';
  $('#demos').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { fill(demos[Number(b.dataset.i)].brief); $('#brief').requestSubmit(); autoConfirm(); } });
  return demos;
}

function fill(brief) {
  const f = $('#brief');
  for (const k of ['brandName', 'referenceQuery', 'category', 'product', 'city']) f.elements[k].value = brief[k] || '';
  f.elements.durationMonths.value = String(brief.durationMonths);
  for (const cb of f.querySelectorAll('input[name=channels]')) cb.checked = brief.channels.includes(cb.value);
}

function readBrief() {
  const f = $('#brief');
  return {
    brandName: f.elements.brandName.value.trim(), referenceQuery: f.elements.referenceQuery.value.trim(),
    category: f.elements.category.value.trim(), product: f.elements.product.value.trim(), city: f.elements.city.value.trim(),
    channels: [...f.querySelectorAll('input[name=channels]:checked')].map((x) => x.value), durationMonths: Number(f.elements.durationMonths.value),
    ...(requested ? { character: requested.slug } : {}),
  };
}

const candRow = (c) => `<label class="cand ${c.exact ? 'exact' : ''} ${c.duplicateOf ? 'dup' : ''}"><input type="radio" name="cand" value="${esc(c.id)}" ${c.preselected ? 'checked' : ''}> <b>${esc(c.name)}</b> <span class="muted small">${esc(c.disambiguation)}</span></label>`;

$('#brief').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#brief-err').textContent = '';
  const brief = readBrief();
  if (!brief.brandName || !brief.referenceQuery) {
    $('#brief-err').textContent = 'Fill in your brand and a reference brand, or pick one of the demo briefs (one click each).';
    $('#demos').classList.add('pulse'); setTimeout(() => $('#demos').classList.remove('pulse'), 1600); return;
  }
  if (!brief.channels.length) { $('#brief-err').textContent = 'Pick at least one channel.'; return; }
  try {
    $('#confirm-sec').hidden = false; $('#confirm').innerHTML = '<p class="muted">Searching Qloo…</p>';
    const r = await api('/api/resolve', { query: brief.referenceQuery });
    pending = brief;
    if (!r.candidates.length) { $('#confirm').innerHTML = `<p class="note warn">${esc(r.message)}</p>`; return; }
    const anyExact = r.candidates.some((c) => c.exact);
    const main = anyExact ? r.candidates.filter((c) => c.exact) : r.candidates;
    const others = anyExact ? r.candidates.filter((c) => !c.exact) : [];
    $('#confirm').innerHTML = `<p class="note ${anyExact ? '' : 'warn'}">${esc(r.message)}</p>` + main.map(candRow).join('')
      + (others.length ? `<details class="others"><summary>Other Qloo names (not exact matches) · ${others.length}</summary>${others.map(candRow).join('')}</details>` : '')
      + `<p style="margin-top:20px"><button class="btn arrow" id="go" type="button">Confirm and rank</button></p>`;
    $('#go').addEventListener('click', runMatch);
    $('#confirm-sec').scrollIntoView({ behavior: 'smooth' });
  } catch (err) { if (err.demoOnly) { $('#confirm').innerHTML = demoOnlyNote(err); return; } $('#confirm').innerHTML = `<p class="err">Qloo is unavailable right now (${esc(err.message)}). Try a demo brief, which is served from cache.</p>`; }
});

async function runMatch() {
  const id = document.querySelector('input[name=cand]:checked')?.value;
  $('#result-sec').hidden = false; $('#ranking').innerHTML = '<p class="muted">Running the Qloo taste loop…</p>'; $('#decision').innerHTML = '';
  try {
    const m = await api('/api/match', { brief: pending, candidateId: id });
    render(m);
    history.replaceState(null, '', `/brief?match=${m.id}`);
    $('#result-sec').scrollIntoView({ behavior: 'smooth' });
  } catch (err) { if (err.demoOnly) { $('#ranking').innerHTML = demoOnlyNote(err); return; } $('#ranking').innerHTML = `<p class="err">Match failed: ${esc(err.message)}</p>`; }
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

function eyebrow(d, m) {
  const zl = d.indexLeaderZ, ll = d.indexLeaderLift, w = m.ranking[0].slug;
  const reason = d.reason ?? (d.level === 'clear' ? 'decided' : d.margin < d.threshold ? 'lead-below-threshold' : zl !== ll ? 'measures-disagree' : 'index-disagrees');
  const L = d.margin.toFixed(3), T = d.threshold;
  return {
    decided: `Qloo decided · lead ${L} ≥ ${T} · both taste measures agree`,
    'lead-below-threshold': `Close call · lead ${L} is below the ${T} needed`,
    'measures-disagree': `Close call · lead ${L} clears ${T}, but the two taste measures pick different leaders`,
    'index-disagrees': `Close call · the taste index alone picks another character`,
    'no-data': 'Close call · Qloo returned no taste-index data for a top character',
    'baseline-brand': 'Close call · the reference brand is one of the baseline brands',
  }[reason] ?? (d.level === 'clear' ? 'Qloo decided' : 'Close call');
}

const KIND = { plan: 'Plan', tool: 'Tool', human: 'Human', check: 'Check', stop: 'Stop' };
function timeline(run) {
  if (!run) return '';
  const q = run.qloo;
  return `<p class="muted small">Served ${run.served === 'stored' ? 'from the stored run' : 'live'} · Qloo calls in this run: ${q.calls} (${q.cached} answered from cache). Each step below is built from this run's data.</p>
    <ol class="timeline">${run.steps.map((s) => `<li class="t-${s.kind} ${s.status ? `s-${s.status}` : ''}">
      <span class="kind">${KIND[s.kind]}</span>
      <div><b>${esc(s.title)}</b>${s.status === 'pass' ? ' <span class="ok">✓</span>' : s.status === 'fail' ? ' <span class="no">✗</span>' : ''}
        <p>${esc(s.detail)}${s.calls ? ` <span class="muted">${s.calls} call${s.calls > 1 ? 's' : ''}${s.cached ? `, ${s.cached} cached` : ''}</span>` : ''} ${srcs(s.evidenceIds)}</p></div></li>`).join('')}</ol>`;
}

function render(m) {
  const pic = (slug) => chars.find((c) => c.slug === slug)?.images[0] ?? {};
  const d = m.decision;
  const viable = new Set(d.level === 'close' ? [m.ranking[0].slug, ...d.alternatives] : []);
  $('#result-sec').hidden = false;
  $('#decision').innerHTML = `
    <div class="decision ${d.level}"><div class="eyebrow">${esc(eyebrow(d, m))}</div>
      <p>${esc(d.text.replace(/^(Close call\. |Qloo decided: )/, ''))}</p>
      ${d.tradeoffs.length ? `<ul>${d.tradeoffs.map((t) => `<li>${esc(t.text)}</li>`).join('')}</ul>` : ''}
      ${m.featured?.requested ? `<p class="req">${esc(m.featured.note)}</p>` : ''}
      <p class="fine">Fit score (0–100) = 0.6 × Qloo taste index + 0.4 × audience term, where the audience term is (cosine + 1) / 2. "Qloo decided" needs a lead of at least ${d.threshold} and the taste index has to pick the same leader both ways it is measured. Leads are on the 0–1 scale, so 0.08 is 8 fit-score points. <a href="#agent-run">See the agent run ↓</a></p></div>`;
  $('#ranking').innerHTML = m.ranking.map((r, i) => `
    <article class="rank ${i === 0 ? 'first' : ''}">
      <div class="head">${img(pic(r.slug).src, pic(r.slug).alt)}
        <div><div class="eyebrow">No. ${i + 1}${viable.has(r.slug) ? ' · <span class="viable">viable</span>' : ''}${m.featured?.requested && m.featured.slug === r.slug ? ' · requested' : ''}</div><h3><a href="/c/${esc(r.slug)}">${esc(r.name)}</a></h3><div class="muted small">${esc(r.city)}</div></div>
        <div class="score" title="Fit score out of 100">${Math.round(r.score * 100)}<small>fit score<br>/100</small></div></div>
      <div class="meter">
        ${meter('Qloo taste index', z(r.parts.indexZ), r.parts.index * 100, 'weight 0.6')}
        ${dmeter('Audience similarity', r.parts.cosine ?? (r.parts.audience * 2 - 1), 'weight 0.4')}
        <div class="muted">Context only, no weight: shared taste tags ${Math.round(r.parts.taste * 100)}% · house-brand fit ${Math.round(r.parts.fit * 100)}%</div>
      </div>
      <ul class="why">${r.why.map((w) => `<li>${esc(w.text)} ${srcs(w.sourceIds)}</li>`).join('')}</ul>
    </article>`).join('');
  $('#agent-run').innerHTML = timeline(m.run);
  const p = m.package;
  $('#pkg-title').textContent = `${p.character.name} × ${p.brand.name}`;
  const copy = p.copy;
  const copyNote = !copy ? '' : copy.mode === 'ai'
    ? `Copy lines rewritten by Workers AI (${esc(copy.model?.split('/').pop())}) and accepted by the checker: ${copy.accepted.length}. Kept as template: ${copy.rejected.length}${copy.rejected.length ? ` (${esc(copy.rejected.map((x) => x.reason).join('; '))})` : ''}. The checker rejects any line that adds a name, brand, number or first-person claim.`
    : `Copy from the deterministic template${copy.reason === 'ai-failed' ? ' (the AI rewrite failed)' : copy.reason === 'all-rejected' ? ' (the checker rejected every AI rewrite)' : ''}.`;
  $('#package').innerHTML = `
    <p class="lede">${esc(cap(p.brand.product))}, shot in ${esc(p.city)}.<span class="pkg-note">${esc(p.brand.note)}</span></p>
    <div class="pkg">
      <div><h3>Content angle</h3><ul>${p.angle.map((l) => `<li>${esc(l.text)} ${srcs(l.sourceIds)}</li>`).join('')}</ul>
        <h3>30-second script</h3><table class="data">${p.script30s.map((l) => `<tr><th>${esc(l.t)}</th><td>${esc(l.text)} ${srcs(l.sourceIds)}</td></tr>`).join('')}</table>
        <h3>Image prompt</h3><p class="small">${esc(p.imagePrompt.text)} ${srcs(p.imagePrompt.sourceIds)}</p></div>
      <div><h3>Shot list</h3><table class="data"><tr><th>#</th><th>Location</th><th>Head · gaze · lens</th></tr>${p.shotList.map((s) => `<tr><td>${s.n}</td><td>${esc(s.location)} ${srcs(s.sourceIds)}</td><td>${esc(s.head)}; ${esc(s.gaze)}; ${esc(s.lens)}</td></tr>`).join('')}</table>
        ${p.excludedPlaces?.length ? `<p class="small muted">Left out as locations: ${p.excludedPlaces.map((x) => `${esc(x.name)} (${esc(x.reason)})`).join('; ')} ${srcs([...new Set(p.excludedPlaces.flatMap((x) => x.sourceIds))])}</p>` : ''}
        <h3>Soundtrack</h3><p class="small">${p.soundtrack.map((l) => `${esc(l.text)} ${srcs(l.sourceIds)}`).join(' · ')}</p>
        <h3>Styling</h3><ul class="small">${[...p.pairings, ...p.wardrobe].map((l) => `<li>${esc(l.text)} ${srcs(l.sourceIds)}</li>`).join('')}</ul></div>
    </div>
    <p class="small muted" style="margin-top:14px">${copyNote}</p>
    <div class="adbar"><span>${esc(p.disclosure)}</span><span>${esc(IDENTITY)}</span></div>
    <p class="small" style="margin-top:12px"><a href="/api/package/${esc(m.id)}" target="_blank" rel="noopener">Package JSON</a></p>`;
  fetch(p.licenseUrl).then((r) => r.json()).then((ql) => {
    $('#license').innerHTML = `<div class="pkg"><div><div class="price">US$${ql.price_quote.amount.toLocaleString('en-US')}</div>
      <p>${esc(ql.character.name)} for ${esc(ql.licensee)}: ${esc(ql.channels.map((c) => CH[c] ?? c).join(', '))}, ${ql.duration.months} months.</p>
      <p class="muted small">${esc(ql.price_quote.basis)}. Not charged; no payment request is issued.</p>
      <p><label class="small"><input type="checkbox" disabled> Character operator approves</label><br><label class="small"><input type="checkbox" disabled> Brand approves</label></p>
      <p class="small"><a href="${esc(p.licenseUrl)}" target="_blank" rel="noopener">GET ${esc(p.licenseUrl)}</a></p></div>
      <pre>${esc(JSON.stringify(ql, null, 2))}</pre></div>`;
  });
  $('#evidence').innerHTML = `<p class="muted small">Qloo calls for this match: ${m.qloo.calls} (${m.qloo.cached} from cache). Entity IDs are shown as names.</p>` + m.evidence.map((e) => `
    <details id="${esc(e.id)}"><summary>${esc(e.id)} · ${esc(e.step)} <span class="muted">${esc(e.endpoint)}${e.cached ? ' · cached' : ''}</span></summary>
      <table class="data">${Object.entries(e.params).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
      <p class="small"><strong>Top results:</strong> ${e.results.map(esc).join(' · ')}</p>${e.note ? `<p class="small muted">${esc(e.note)}</p>` : ''}</details>`).join('');
}

addEventListener('hashchange', () => { const el = document.getElementById(location.hash.slice(1)); if (el?.tagName === 'DETAILS') el.open = true; });

async function autoConfirm() {
  for (let i = 0; i < 80 && !document.querySelector('#go'); i++) await new Promise((r) => setTimeout(r, 100));
  document.querySelector('#go')?.click();
}

async function deepLink(demos) {
  // Judge paths: /brief?demo=N&confirm=1 fills, resolves and confirms the preselected exact candidate; /brief?match=<id> shows a stored run.
  if (q.has('match')) {
    try { const m = await api(`/api/match/${encodeURIComponent(q.get('match'))}`); render(m); $('#result-sec').scrollIntoView(); }
    catch (err) { $('#brief-err').textContent = `Could not load that run: ${err.message}`; }
    return;
  }
  if (!q.has('demo')) return;
  const d = demos[Number(q.get('demo'))]; if (!d) return;
  fill(d.brief);
  $('#brief').requestSubmit();
  if (q.get('confirm') === '1') await autoConfirm();
}
init().then(deepLink).catch((e) => { $('#demos').innerHTML = `<p class="err">${esc(e.message)}</p>`; });
