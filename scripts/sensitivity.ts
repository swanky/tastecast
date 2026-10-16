// Milestone-2 sensitivity check. Ranking only (no context or local calls): reverse affinity 2 calls (+1 search, +1 demographics for a new brand).
import { QlooClient, entitiesOf } from '../src/qloo/client.js';
import { FileKV } from '../src/store/file-kv.js';
import { loadBaseline } from '../src/agent/affinity.js';
import { rankCharacters, type Brief } from '../src/agent/match.js';
import { EvidenceLedger } from '../src/agent/evidence.js';
import { PROFILES_KEY, type CharacterProfile } from '../src/domain/profile.js';

const kv = new FileKV('./cache');
const qloo = new QlooClient({ apiKey: process.env.QLOO_API_KEY, kv, maxCalls: Number(process.env.QLOO_MAX_CALLS ?? 300) });
const profiles = (await kv.get<CharacterProfile[]>(PROFILES_KEY))!;
const baseline = (await loadBaseline(kv))!;
const tests: { id: string; ref: string; city?: string; category: string }[] = [
  { id: 'base', ref: 'Blue Bottle Coffee', category: 'coffee equipment' },
  { id: 'base', ref: 'Gentle Monster', category: 'eyewear' },
  { id: 'base', ref: 'Le Creuset', category: 'tableware' },
  { id: 'S1', ref: 'Gentle Monster', city: 'Mexico City', category: 'eyewear' },
  { id: 'S2', ref: 'Le Creuset', city: 'Seoul', category: 'tableware' },
  { id: 'S3', ref: 'Blue Bottle Coffee', city: 'Seoul', category: 'coffee equipment' },
  { id: 'S4', ref: 'Carhartt WIP', category: 'workwear' },
  { id: 'S5', ref: 'Barbour', category: 'outerwear' },
  { id: 'S6', ref: 'Innisfree', category: 'skincare' },
];
const only = process.argv[2]?.split(',');
const out: unknown[] = [];
for (const t of tests.filter((x) => !only || only.includes(x.id))) {
  {
    const r = await qloo.get('/search', { query: t.ref, types: 'urn:entity:brand', take: '5' }, 'live:resolve');
    const e = entitiesOf(r.data).find((x) => x.name.toLowerCase() === t.ref.toLowerCase()) ?? entitiesOf(r.data)[0];
    if (!e) { console.log(`${t.id} ${t.ref}: not on Qloo`); continue; }
    var brand = { id: e.entity_id, name: e.name };
  }
  const brief: Brief = { brandName: 'Test', referenceQuery: t.ref, category: t.category, product: t.category, channels: ['instagram'], durationMonths: 3, city: t.city };
  const res = await rankCharacters(qloo, profiles, baseline, brief, brand, new EvidenceLedger(), { context: false });
  const row = res.ranking.map((r) => `${r.name.split(' ')[0]} ${r.score.toFixed(3)} (z ${r.parts.indexZ}, lift ${r.parts.indexLift}, aud ${r.parts.audience})`).join(' > ');
  console.log(`${t.id.padEnd(4)} ${brand.name}${t.city ? ' @' + t.city : ''}: ${row}\n     ${res.decision.level.toUpperCase()} margin ${res.decision.margin}; z-leader ${res.decision.indexLeaderZ}, lift-leader ${res.decision.indexLeaderLift}${res.ranking[0].tiebreak ? `; niche tiebreak "${res.ranking[0].tiebreak}"` : ''}`);
  if (t.city) for (const r of res.ranking) { const w = r.why.find((x) => x.text.startsWith(`In ${t.city}`)); if (w) console.log('     ' + w.text); }
  out.push({ test: t.id, brand: brand.name, city: t.city ?? null, ranking: res.ranking.map((r) => ({ name: r.name, score: r.score, z: r.parts.indexZ, lift: r.parts.indexLift, audience: r.parts.audience })), decision: res.decision });
}
await kv.set('sensitivity:latest', out);
console.log('network calls used total:', await qloo.networkCallsUsed());
