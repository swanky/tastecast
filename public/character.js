import { $, esc, api, img, chrome, DISCLOSURE, IDENTITY, AGE_LABEL } from '/common.js';
chrome('');
const slug = location.pathname.split('/').filter(Boolean)[1] || new URLSearchParams(location.search).get('slug');
const NO = { 'itzel-robles': '01', 'ari-tseng': '02', 'ingrid-brekkhus': '03' };

function skew(aud) {
  const rows = Object.entries(aud.age).map(([k, v]) => ({ k: AGE_LABEL[k] ?? k, v })).concat({ k: 'Female', v: aud.female });
  const peak = Math.max(...rows.slice(0, 6).map((r) => r.v));
  return `<div class="skew" role="img" aria-label="Qloo audience affinity by age bracket and gender">${rows.map((r, i) => {
    const w = Math.min(Math.abs(r.v), 1) * 50;
    return `<span class="lab ${i < 6 && r.v === peak ? 'peak' : ''}">${esc(r.k)}</span>
      <span class="track"><span class="bar ${r.v < 0 ? 'neg' : ''}" style="${r.v < 0 ? `right:50%` : `left:50%`};width:${w}%"></span></span>
      <span class="val">${r.v >= 0 ? '+' : '−'}${Math.abs(r.v).toFixed(2)}</span>`;
  }).join('')}</div>`;
}

function driftPanel(c) {
  const d = c.drift;
  if (!d) return '';
  // An audience insight, not a defect: it matters only when a campaign targets an audience her taste skews away from.
  if (d.flagged) return `<div class="drift flag"><div class="eyebrow">Audience insight · taste skews older</div><p>${esc(d.message)}</p>
    <p class="small muted" style="font-family:var(--sans)">The brief page warns only when a campaign's target age is two or more brackets from where her taste seeds peak. TasteCast shows this openly instead of re-tuning her taste to match her age.</p></div>`;
  const msg = d.level === 'adjacent'
    ? `${c.name}'s taste seeds peak one age bracket from her stated one (${AGE_LABEL[d.seedPeakBucket] ?? d.seedPeakBucket} vs ${AGE_LABEL[d.statedBucket] ?? d.statedBucket}). That is within tolerance.`
    : `${c.name}'s taste seeds peak in her stated age bracket (${AGE_LABEL[d.statedBucket] ?? d.statedBucket}).`;
  return `<div class="drift"><div class="eyebrow">Audience insight</div><p>${esc(msg)}</p></div>`;
}

function fitsTable(f) {
  if (!f.briefs) return '<p class="muted small">No test briefs have been run yet.</p>';
  const row = (x) => `<tr><td><span class="serif" style="font-size:18px">${esc(x.brand)}</span><br><span class="muted small">${esc(x.category)} · ranked ${x.rank} of ${x.of}${x.decided ? '' : ' · close call'}</span></td><td>${x.z >= 0 ? '+' : '−'}${Math.abs(x.z).toFixed(2)}σ</td></tr>`;
  return `<table class="fits"><tbody>${f.best.map(row).join('')}</tbody></table>
    <div class="eyebrow" style="margin-top:22px">Weakest fits</div><table class="fits"><tbody>${f.weakest.map(row).join('')}</tbody></table>
    <p class="muted small">Qloo taste index across ${f.briefs} TasteCast test briefs (standard deviations above the everyday-brand baseline).</p>`;
}

try {
  const c = await api(`/api/characters/${encodeURIComponent(slug)}`);
  document.title = `${c.name} · TasteCast`;
  const t = c.taste;
  const first = c.name.split(' ')[0];
  $('#page').innerHTML = `
    <section class="c-hero">
      <div class="frame">${img(c.images[0].src, c.images[0].alt, 'loading="eager"')}</div>
      <div class="text">
        <div class="eyebrow">The roster · No. ${NO[c.slug] ?? ''}</div>
        <h1 class="display">${esc(c.name)}</h1>
        <p class="role">${esc(c.role)}</p>
        <dl class="facts"><div><dt>Home city</dt><dd>${esc(c.city)}</dd></div><div><dt>Age</dt><dd>${c.age}</dd></div><div><dt>Taste skew</dt><dd>${c.drift?.flagged ? `Peaks ${esc(AGE_LABEL[c.drift.seedPeakBucket] ?? '')}` : 'Matches her age'}</dd></div></dl>
        <p class="lede italic">${esc(c.tagline)}</p>
        <div class="disclose" style="margin-top:24px"><span class="chip solid">${esc(IDENTITY)}</span><span class="chip">${esc(DISCLOSURE)} on every endorsement</span></div>
        <div class="cta"><a class="btn arrow" href="/brief?character=${esc(c.slug)}">Brief ${esc(first)}</a><a class="btn ghost" href="#taste">Qloo taste profile</a></div>
      </div>
    </section>

    <div class="section-head"><span class="num">i. Backstory</span><h2>${esc(first)}, in her own world.</h2></div>
    <div class="two">
      <div class="prose"><p>${esc(c.bio)}</p></div>
      <div><div class="eyebrow">Signature, kept in every image</div><ol class="sig">${c.signature.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        <div class="eyebrow" style="margin-top:28px">Works with</div><div class="chips">${c.niches.map((n) => `<span>${esc(n)}</span>`).join('')}</div>
        <p class="muted small" style="margin-top:10px">Niches are set by the operator, not by Qloo.</p></div>
    </div>

    <div class="section-head"><span class="num">ii. Portfolio</span><h2>Approved portfolio, 2026.</h2></div>
    <div class="folio">${[...c.images.slice(1), c.images[0]].map((m) => [m, c.images.indexOf(m)]).map(([m, i]) => `<figure>${img(m.src, m.alt, 'loading="lazy"')}<figcaption><b>${esc(m.title)}</b><span>${String(i + 1).padStart(2, '0')}</span></figcaption></figure>`).join('')}</div>

    <div class="section-head"><span class="num">iii. Identity reference</span><h2>The references every new image is checked against.</h2></div>
    <div class="refs">
      <figure>${img(c.reference.src, c.reference.alt, 'loading="lazy"')}<figcaption><b>Full-length reference</b><span>v3 master</span></figcaption></figure>
      <figure>${img(c.turnaround.src, c.turnaround.alt, 'loading="lazy"')}<figcaption><b>Turnaround sheet</b><span>front, ¾, profile, back and expressions</span></figcaption></figure>
    </div>

    <div class="section-head" id="taste"><span class="num">iv. Taste profile</span><h2>What Qloo sees in ${esc(first)}'s taste.</h2></div>
    ${t ? `<div class="taste">
      <div>
        <div class="panel"><h3>Audience skew</h3><p class="muted small">Qloo age and gender affinity of her taste seeds, averaged. Right of centre means over-indexed.</p>${skew(t.audience)}</div>
        <div class="panel"><h3>Audience insight</h3>${driftPanel(c)}</div>
        <div class="panel"><h3>Strongest fits so far</h3>${fitsTable(c.fits)}</div>
      </div>
      <div>
        <div class="panel"><h3>Taste seeds</h3><p class="muted small">Chosen by the operator. Qloo reads everything else from these.</p><ul class="seeds">${c.seeds.map((s) => `<li><span>${esc(s.kind)}</span>${esc(s.name)}</li>`).join('')}</ul></div>
        <div class="panel"><h3>Taste tags</h3><p class="muted small">Qloo tags most associated with her seeds.</p><div class="chips">${t.tasteTags.map((x) => `<span>${esc(x)}</span>`).join('')}</div></div>
        <div class="panel"><h3>In ${esc(c.city)}</h3><p class="muted small">Tags and places Qloo associates with her taste in her home city.</p><div class="chips">${t.cityTags.map((x) => `<span>${esc(x)}</span>`).join('')}</div>
          <table class="fits" style="margin-top:16px"><tbody>${t.places.map((p) => `<tr><td>${esc(p.name)}</td><td class="muted">${esc(p.area)}</td></tr>`).join('')}</tbody></table></div>
      </div>
    </div>` : '<p class="muted">Taste profile not precomputed. Run npm run precompute.</p>'}

    <div class="adbar" style="margin-top:56px"><span>${esc(IDENTITY)}</span><span>${esc(DISCLOSURE)}</span></div>
    <p style="margin-top:28px"><a class="btn arrow" href="/brief?character=${esc(c.slug)}">Brief ${esc(first)} for your brand</a></p>`;
} catch (e) {
  $('#page').innerHTML = `<p class="err" style="padding:80px 0">${esc(e.message)}. <a href="/">Back to the roster</a></p>`;
}
