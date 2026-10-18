export const $ = (s, el = document) => el.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** JSON request with a timeout and an optional abort signal. Errors carry kind: 'abort' (a newer run replaced this
 *  one), 'timeout', 'network', 'http' (non-2xx or ok:false; status set) or 'parse' (the body was not JSON). */
export const api = async (path, body, { signal, timeout = 30000 } = {}) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeout);
  const onAbort = () => ctrl.abort(new DOMException('aborted', 'AbortError'));
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  const fail = (kind, message, extra = {}) => Object.assign(new Error(message), { kind, ...extra });
  let r;
  try {
    r = await fetch(path, { ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: ctrl.signal });
  } catch (e) {
    const reason = ctrl.signal.reason;
    if (reason?.name === 'TimeoutError') throw fail('timeout', `the request took longer than ${Math.round(timeout / 1000)} s`);
    if (reason?.name === 'AbortError') throw fail('abort', 'replaced by a newer request');
    throw fail('network', 'network error');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
  let j;
  try { j = await r.json(); } catch { throw fail(r.ok ? 'parse' : 'http', r.ok ? 'the server sent a response that could not be read' : `HTTP ${r.status}`, { status: r.status }); }
  if (!r.ok || j.ok === false) throw fail('http', j.error || `HTTP ${r.status}`, { status: r.status, demoOnly: Boolean(j.demoOnly), demos: j.demos || [] });
  return j;
};
export const DISCLOSURE = '#ad · AI-generated character';
export const IDENTITY = 'Original AI character, not a real person';
export const AGE_LABEL = { '24_and_younger': '24 and under', '25_to_29': '25–29', '30_to_34': '30–34', '35_to_44': '35–44', '45_to_54': '45–54', '55_and_older': '55 and over' };
export const img = (src, alt, extra = '') => `<img src="${esc(src)}" alt="${esc(alt)}" ${extra} onerror="this.outerHTML='<div class=&quot;img-missing&quot;>Image not built locally. Run scripts/build-assets.py</div>'">`;

export function chrome(active) {
  const nav = [['/', 'Roster'], ['/brief', 'Brief a character'], ['/#how', 'How it works'], ['/#agents', 'MCP']];
  document.body.insertAdjacentHTML('afterbegin', `
    <header class="mast"><div class="wrap">
      <a class="logo" href="/">Taste<em>Cast</em></a>
      <nav class="nav" aria-label="Main">${nav.map(([h, t]) => `<a href="${h}" ${active === h ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
    </div></header>
    <div class="strap"><div class="wrap eyebrow"><span>Disclosed AI characters, cast with Qloo taste data</span><span>Original AI characters, not real people · ${esc(DISCLOSURE)}</span></div></div>`);
  document.body.insertAdjacentHTML('beforeend', `
    <footer class="foot"><div class="wrap">
      <div><a class="logo" href="/">Taste<em>Cast</em></a>
        <p>Every character on TasteCast is an original AI character, not a real person, and not a real user of any product. Every endorsement is labelled <strong>${esc(DISCLOSURE)}</strong>.</p></div>
      <div><p>Taste data: Qloo Insights API. Scores are relative affinity signals, not purchase probability. Prices are shown for the demo and never charged.</p>
        <p class="small">Place, brand and artist names in packages are Qloo-sourced references for mood and location, not endorsements by them or permissions to use them.</p>
        <p class="muted small">Copy rewrite: Built with Llama (Llama 3.3 70B on Cloudflare Workers AI), checked line by line. A SWANKY MODELS demo for the Qloo hackathon.</p></div>
    </div></footer>`);
}

/** Friendly panel when a live call is refused (per-network guard or a Qloo 429): points to the stored demo briefs. */
export const demoOnlyNote = (err) => `<div class="note warn"><p>${esc(err.message)}</p>
  <p style="margin-top:12px">${(err.demos || []).map((d) => `<a class="btn arrow" style="margin:4px 8px 4px 0" href="${esc(d.href)}">${esc(d.label)}</a>`).join('')}</p></div>`;
