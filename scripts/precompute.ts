import { capFrom, QlooClient } from '../src/qloo/client.js';
import { FileKV } from '../src/store/file-kv.js';
import { buildProfiles, PROFILES_KEY } from '../src/domain/profile.js';
import { buildBaseline, BASELINE_KEY } from '../src/agent/affinity.js';

const kv = new FileKV(process.env.TASTECAST_CACHE_DIR ?? './cache');
const qloo = new QlooClient({ apiKey: process.env.QLOO_API_KEY, kv, maxCalls: capFrom(process.env.QLOO_MAX_CALLS) });
const before = await qloo.networkCallsUsed();
const profiles = await buildProfiles(qloo);
await kv.set(PROFILES_KEY, profiles);
for (const p of profiles) {
  console.log(`${p.slug}: seeds ${p.seeds.map((s) => `${s.name}→${s.matchedName}`).join(' | ')}`);
  console.log(`  drift: ${p.drift.flagged ? 'FLAGGED' : 'none'} (stated ${p.drift.statedBucket}, seeds peak ${p.drift.seedPeakBucket})`);
  console.log(`  tags: ${p.tags.slice(0, 6).map((t) => t.name).join(', ')} | places: ${p.places.length}`);
}
const baseline = await buildBaseline(qloo, profiles);
await kv.set(BASELINE_KEY, baseline);
console.log(`baseline: panel ${baseline.panel.join(', ')}; ${Object.keys(baseline.seeds).length} seeds`);
console.log(`Qloo network calls this run: ${(await qloo.networkCallsUsed()) - before}`);
