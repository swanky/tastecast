// Stores Qloo results for the instant reference brands (src/instant-brands.ts) in ./cache (gitignored), through
// the same service the site uses: resolve, then the full match for a generic brief (its verdict is the badge).
// Budget: QLOO_MAX_CALLS caps the whole ledger, so set it to (current + allowance) for a hard stop.
// Dry run first: npx tsx scripts/instant-cost.ts <names> counts the calls each brand needs from the cache.
import { capFrom, QlooClient } from '../src/qloo/client.js';
import { FileKV } from '../src/store/file-kv.js';
import { createService, instantBrief } from '../src/app.js';
import { INSTANT_BRANDS } from '../src/instant-brands.js';

const kv = new FileKV(process.env.TASTECAST_CACHE_DIR ?? './cache');
const qloo = new QlooClient({ apiKey: process.env.QLOO_API_KEY, kv, maxCalls: capFrom(process.env.QLOO_MAX_CALLS) });
const svc = createService({ qloo, kv });
const before = await qloo.networkCallsUsed();
for (const b of INSTANT_BRANDS) {
  const t = await qloo.networkCallsUsed();
  try {
    const r = await svc.resolve(b.query);
    const cands = (r.body.candidates ?? []) as { id: string; name: string; exact: boolean; preselected: boolean }[];
    const pick = cands.find((c) => c.preselected && c.exact);
    if (!pick) { console.log(`${b.query}: no exact candidate (${cands.map((c) => c.name).join(', ')})`); continue; }
    const m = await svc.match(instantBrief(b.query, b.category), pick.id);
    const x = m.body as any;
    if (m.status !== 200) { console.log(`${b.query}: ${m.status} ${x.error}`); continue; }
    const d = x.decision;
    console.log(`${b.query.padEnd(19)} ${d.level === 'clear' ? 'QLOO DECIDED' : 'CLOSE CALL  '} ${x.ranking[0].name.padEnd(16)} lead ${String(d.margin).padEnd(5)} reason ${d.reason}${d.alternatives.length ? ` viable +${d.alternatives.join('/')}` : ''} | ${x.ranking.map((r: any) => `${r.slug.split('-')[0]} ${Math.round(r.score * 100)} (z ${r.parts.indexZ})`).join(', ')} | lookups ${x.qloo.calls} | new calls ${(await qloo.networkCallsUsed()) - t}`);
  } catch (e: any) { console.log(`${b.query}: STOPPED ${e.message} (new calls ${(await qloo.networkCallsUsed()) - t})`); }
}
console.log(`Qloo network calls this run: ${(await qloo.networkCallsUsed()) - before}; ledger total ${await qloo.networkCallsUsed()}`);
