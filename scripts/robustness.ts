// Milestone-3 robustness run. Ranking only (no context or local calls). For each brief: search 1 + demographics 1 + reverse 2–4.
import { capFrom, QlooClient, entitiesOf } from '../src/qloo/client.js';
import { FileKV } from '../src/store/file-kv.js';
import { CORE_TYPES, FULL_TYPES, loadBaseline } from '../src/agent/affinity.js';
import { rankCharacters, type Brief } from '../src/agent/match.js';
import { EvidenceLedger } from '../src/agent/evidence.js';
import { PROFILES_KEY, type CharacterProfile } from '../src/domain/profile.js';

const kv = new FileKV('./cache');
const qloo = new QlooClient({ apiKey: process.env.QLOO_API_KEY, kv, maxCalls: capFrom(process.env.QLOO_MAX_CALLS) });
const profiles = (await kv.get<CharacterProfile[]>(PROFILES_KEY))!;
const baseline = (await loadBaseline(kv))!;
const S = (slug: string) => slug.split('-')[0];
type T = { id: string; cat: string; ref: string; expect: string | null; allowFuzzy?: boolean };
const tests: T[] = [
  { id: 'D1', cat: 'coffee', ref: 'Blue Bottle Coffee', expect: 'itzel' },
  { id: 'D2', cat: 'eyewear', ref: 'Gentle Monster', expect: 'ari' },
  { id: 'D3', cat: 'tableware', ref: 'Le Creuset', expect: 'ingrid' },
  { id: 'S4', cat: 'workwear', ref: 'Carhartt WIP', expect: 'itzel', allowFuzzy: true },
  { id: 'S5', cat: 'outerwear', ref: 'Barbour', expect: 'ingrid' },
  { id: 'S6', cat: 'skincare', ref: 'Innisfree', expect: 'ari' },
  { id: 'R1', cat: 'beauty', ref: 'Glossier', expect: 'ari' },
  { id: 'R2', cat: 'beauty', ref: 'Aesop', expect: 'ingrid' },
  { id: 'R3', cat: 'outdoor', ref: 'The North Face', expect: 'itzel' },
  { id: 'R4', cat: 'outdoor', ref: "Arc'teryx", expect: 'ari' },
  { id: 'R5', cat: 'music/audio', ref: 'Bang & Olufsen', expect: 'ingrid' },
  { id: 'R6', cat: 'music/audio', ref: 'Fender', expect: 'itzel' },
  { id: 'R7', cat: 'fashion', ref: 'Stussy', expect: 'itzel' },
  { id: 'R8', cat: 'fashion', ref: 'Acne Studios', expect: 'ari' },
  { id: 'R9', cat: 'food', ref: 'Tajín', expect: 'itzel' },
  { id: 'R10', cat: 'food', ref: 'Nongshim', expect: 'ari' },
  { id: 'R11', cat: 'food', ref: 'Fortnum & Mason', expect: 'ingrid' },
  { id: 'R12', cat: 'home', ref: 'Muji', expect: 'ari' },
  { id: 'U1', cat: 'coffee', ref: 'Loma Coffee Gear', expect: null },
];
const only = process.argv[2]?.split(',');
const rows: any[] = [];
const norm = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
for (const t of tests.filter((x) => !only || only.includes(x.id))) {
  const row: any = { ...t };
  try {
    const r = await qloo.get('/search', { query: t.ref, types: 'urn:entity:brand', take: '5' }, 'live:resolve');
    const ents = entitiesOf(r.data);
    const exact = ents.find((e) => norm(e.name) === norm(t.ref));
    const e = exact ?? ents[0];
    row.candidates = ents.length;
    if (!e) { row.failure = 'unknown brand (no candidates)'; rows.push(row); console.log(`${t.id} ${t.ref}: NO CANDIDATES`); continue; }
    row.resolved = e.name; row.match = exact ? 'exact' : 'fuzzy';
    if (!exact && !t.allowFuzzy) { row.match = 'none'; row.failure = `no exact name match (Qloo's nearest: ${ents.slice(0, 3).map((x) => x.name).join(', ')})`; rows.push(row); console.log(`${t.id} ${t.ref}: NO EXACT MATCH (${row.failure})`); continue; }
    const brand = { id: e.entity_id, name: e.name };
    const brief: Brief = { brandName: 'Test', referenceQuery: t.ref, category: t.cat, product: t.cat, channels: ['instagram'], durationMonths: 3 };
    for (const [label, types] of [['core', CORE_TYPES], ['full', FULL_TYPES]] as const) {
      const res = await rankCharacters(qloo, profiles, baseline, brief, brand, new EvidenceLedger(), { context: false, indexTypes: types });
      row[label] = {
        winner: S(res.ranking[0].slug), level: res.decision.level, margin: res.decision.margin,
        zLeader: S(res.decision.indexLeaderZ), liftLeader: S(res.decision.indexLeaderLift), tiebreak: res.ranking[0].tiebreak ?? null,
        ranking: res.ranking.map((x) => ({ c: S(x.slug), score: x.score, z: x.parts.indexZ, lift: x.parts.indexLift, aud: x.parts.audience, covered: x.index.covered, total: x.index.total })),
      };
    }
    const f = row.full, c = row.core;
    console.log(`${t.id.padEnd(3)} ${t.cat.padEnd(11)} ${(e.name + (exact ? '' : ' [FUZZY]')).padEnd(26)} exp ${t.expect?.padEnd(6)} | core ${c.winner} ${c.level} ${c.margin} | full ${f.winner} ${f.level} ${f.margin} (z ${f.zLeader}, lift ${f.liftLeader}) | cov ${f.ranking.map((x: any) => `${x.c}${x.covered}/${x.total}`).join(' ')}`);
  } catch (err: any) { row.failure = String(err.message ?? err); console.log(`${t.id} ${t.ref}: ERROR ${row.failure}`); }
  rows.push(row);
}
const prev = (await kv.get<any[]>('robustness:latest')) ?? [];
const merged = [...prev.filter((p) => !rows.some((r) => r.id === p.id)), ...rows];
await kv.set('robustness:latest', merged);
console.log('network calls used total:', await qloo.networkCallsUsed());
