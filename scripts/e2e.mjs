// End-to-end check against a running server: resolve -> confirm first candidate -> match -> package -> license.
const base = process.env.BASE ?? 'http://localhost:8787';
const briefs = JSON.parse(await (await fetch(base + '/api/demos')).text());
const which = process.argv.slice(2).map(Number);
const post = async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, timing: r.headers.get('server-timing'), body: await r.json() }; };
for (const i of which.length ? which : briefs.map((_, k) => k)) {
  const { brief, label } = briefs[i];
  const t0 = Date.now();
  const res = await post('/api/resolve', { query: brief.referenceQuery });
  const cands = res.body.candidates ?? [];
  console.log(`\n[${label}] resolve "${brief.referenceQuery}" -> ${cands.map((c) => c.name).join(' | ') || 'none'}`);
  const pick = cands.find((c) => c.preselected) ?? cands[0];
  if (!pick) { console.log('  no candidate, stop'); continue; }
  const m = await post('/api/match', { brief, candidateId: pick.id });
  if (m.status !== 200) { console.log('  match failed', m.status, m.body); continue; }
  const b = m.body;
  console.log(`  confirmed: ${pick.name} | ${Date.now() - t0} ms | ${m.timing} | stored=${b.stored}`);
  for (const r of b.ranking) console.log(`  ${r.name.padEnd(16)} score ${r.score}  index ${r.parts.indexZ}σ (lift ${r.parts.indexLift}, ${r.index.covered}/${r.index.total} seeds)  audience ${r.parts.audience}  [context: tags ${r.parts.taste}, fit ${r.fitRank}/${r.fitCandidates}]  drift ${r.drift.level}${r.tiebreak ? `  NICHE ${r.tiebreak}` : ''}`);
  console.log(`  DECISION ${b.decision.level} margin ${b.decision.margin}: ${b.decision.text}`);
  console.log(`  city ${b.local.city}: angles ${b.local.angles.slice(0, 5).map((a) => a.name).join(', ')}`);
  console.log(`  artists ${b.local.artists.slice(0, 4).map((a) => a.name).join(', ')} | brands ${b.local.brands.slice(0, 4).map((a) => a.name).join(', ')} | places ${b.local.places.slice(0, 3).map((a) => a.name).join(', ')}`);
  const pkg = await (await fetch(`${base}/api/package/${b.id}`)).json();
  const lic = await fetch(`${base}/api/license/${b.id}`);
  const q = await lic.json();
  console.log(`  package ${b.id}: disclosure "${pkg.disclosure}", ${pkg.shotList.length} shots | license ${lic.status} US$${q.price_quote.amount} charged=${q.price_quote.charged} approvals=${JSON.stringify(q.approvals)} evidence=${q.qloo_evidence.join(',')}`);
}
