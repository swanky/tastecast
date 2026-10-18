// Runs the demo briefs through the same service the site uses and stores the matches in ./cache (gitignored).
// Ranking calls are cached from earlier runs; new demos need context and local-package calls.
// Budget: QLOO_MAX_CALLS caps the whole ledger, so set it to (current + allowance) for a hard stop.
import { capFrom, QlooClient } from '../src/qloo/client.js';
import { FileKV } from '../src/store/file-kv.js';
import { createService, DEMO_BRIEFS } from '../src/app.js';

const kv = new FileKV(process.env.TASTECAST_CACHE_DIR ?? './cache');
const qloo = new QlooClient({ apiKey: process.env.QLOO_API_KEY, kv, maxCalls: capFrom(process.env.QLOO_MAX_CALLS) });
const svc = createService({ qloo, kv });
const before = await qloo.networkCallsUsed();
for (const d of DEMO_BRIEFS) {
  const t = await qloo.networkCallsUsed();
  const r = await svc.resolve(d.brief.referenceQuery);
  const cands = (r.body.candidates ?? []) as { id: string; name: string; exact: boolean; preselected: boolean }[];
  const pick = cands.find((c) => c.preselected);
  if (!pick) { console.log(`${d.label}: no candidate`); continue; }
  const m = await svc.match(d.brief, pick.id);
  const b = m.body as any;
  if (m.status !== 200) { console.log(`${d.label}: ${m.status} ${b.error}`); continue; }
  const dec = b.decision;
  console.log(`${d.label.padEnd(20)} ref ${d.brief.referenceQuery.padEnd(18)} ${dec.level === 'clear' ? 'CLEAR FIT   ' : 'CLOSE CALL  '} ${b.ranking[0].name.padEnd(16)} lead ${dec.margin} (z ${dec.indexLeaderZ}, lift ${dec.indexLeaderLift}) expected ${d.expect} | ranking ${b.ranking.map((x: any) => `${x.slug.split('-')[0]} ${x.score}`).join(', ')} | excluded places ${b.package.excludedPlaces.map((x: any) => x.name).join('; ') || '-'} | new calls ${(await qloo.networkCallsUsed()) - t} | id ${b.id}`);
}
console.log(`Qloo network calls this run: ${(await qloo.networkCallsUsed()) - before}; ledger total ${await qloo.networkCallsUsed()}`);
