// Dry run: counts how many Qloo network calls each candidate instant brand would need, from the real
// code path (resolve + rankCharacters with context + local package for every character at her home city).
// Reads ./cache, writes nothing, never calls Qloo (fetch is stubbed and counted).
import { QlooClient } from '../src/qloo/client.js';
import { FileKV } from '../src/store/file-kv.js';
import type { KV } from '../src/store/kv.js';
import { loadBaseline } from '../src/agent/affinity.js';
import { normName, rankCharacters, resolveBrand, type Brief } from '../src/agent/match.js';
import { EvidenceLedger } from '../src/agent/evidence.js';
import { PROFILES_KEY, type CharacterProfile } from '../src/domain/profile.js';
import { CHARACTERS, TAG_TYPES } from '../src/domain/characters.js';
import { cacheKey } from '../src/qloo/client.js';

class Overlay implements KV {
  m = new Map<string, unknown>(); l: string[] = [];
  constructor(private base: FileKV) {}
  async get<T>(k: string) { return (this.m.has(k) ? this.m.get(k) : await this.base.get<T>(k)) as T | undefined; }
  async set<T>(k: string, v: T) { this.m.set(k, v); }
  async append(_k: string, line: string) { this.l.push(line); }
  async lines() { return this.l; }
}
const file = new FileKV('./cache');
const profiles = (await file.get<CharacterProfile[]>(PROFILES_KEY))!;
const baseline = (await loadBaseline(file))!;
const candidates = process.argv.slice(2);
// Local package calls for each character in her home city (shared by every brand whose featured character it is).
for (const p of profiles) {
  const c = CHARACTERS.find((x) => x.slug === p.slug)!; const seedIds = p.seeds.map((s) => s.id).join(',');
  const ps: Record<string, string>[] = [
    { 'filter.type': 'urn:tag', 'signal.interests.entities': seedIds, 'filter.tag.types': TAG_TYPES, 'signal.location.query': c.city, take: '12' },
    { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': seedIds, 'signal.location.query': c.city, 'signal.demographics.age': c.ageBucket, take: '8' },
    { 'filter.type': 'urn:entity:brand', 'signal.interests.entities': seedIds, 'signal.location.query': c.city, 'signal.demographics.age': c.ageBucket, take: '8' },
  ];
  const miss = (await Promise.all(ps.map((x) => file.get('qloo:' + cacheKey('/v2/insights', x))))).filter((x) => !x).length;
  console.log(`local package ${p.slug} @ ${c.city}: ${3 - miss}/3 cached, ${miss} new`);
}
for (const name of candidates) {
  const kv = new Overlay(file); const misses: string[] = [];
  // A search miss is answered with the real entity from a cached take-3 panel search when there is one (baseline brands).
  const t3 = await file.get<{ results: { entity_id: string; name: string }[] }>('qloo:' + cacheKey('/search', { query: name, types: 'urn:entity:brand', take: '3' }));
  const real = t3?.results?.find((e) => normName(e.name) === normName(name));
  const fakeFetch = (async (url: string) => {
    misses.push(String(url).split('?')[0].replace('https://hackathon.api.qloo.com', ''));
    const u = new URL(String(url)); const ft = u.searchParams.get('filter.type');
    const body = u.pathname === '/search' ? { results: [real ? { ...real } : { entity_id: '00000000-0000-0000-0000-00000000dry1', name, popularity: 0.9 }] }
      : ft === 'urn:demographics' ? { results: { demographics: [{ entity_id: 'x', query: { age: { '24_and_younger': 0, '25_to_29': 0, '30_to_34': 0, '35_and_younger': 0, '36_to_55': 0, '55_and_older': 0 }, gender: { female: 0, male: 0 } } }] } }
      : { results: { entities: [], tags: [] } };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const qloo = new QlooClient({ apiKey: 'dry-run-not-a-key', kv, fetchImpl: fakeFetch, maxCalls: 10_000 });
  const r = await resolveBrand(qloo, name);
  const exact = r.candidates.find((c) => normName(c.name) === normName(name));
  const pick = exact ?? r.candidates[0];
  const brief: Brief = { brandName: 'Dry', referenceQuery: name, category: 'x', product: 'x', channels: ['instagram'], durationMonths: 3 };
  await rankCharacters(qloo, profiles, baseline, brief, { id: pick.id, name: pick.name }, new EvidenceLedger(), { context: true });
  const panel = baseline.panel.some((n) => normName(n) === normName(name));
  console.log(`${name.padEnd(20)} new calls ${misses.length} (${misses.join(', ') || 'all cached'})${exact ? '' : ' [no cached exact match]'}${panel ? ' [baseline panel brand]' : ''}`);
}
