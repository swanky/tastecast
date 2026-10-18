import { describe, expect, it, vi } from 'vitest';
import { BudgetExceeded, capFrom, LEDGER_KEY, QlooClient } from '../src/qloo/client.js';
import { WorkersKV, type KVNamespaceLike } from '../src/store/workers-kv.js';
import { DEFAULT_IP_LIMITS, IpDailyLimit } from '../src/store/ip-limit.js';
import worker from '../src/server.worker.js';

class FakeNS implements KVNamespaceLike {
  m = new Map<string, string>(); puts: { key: string; ttl?: number }[] = [];
  async get(key: string) { const v = this.m.get(key); return v === undefined ? null : JSON.parse(v); }
  async put(key: string, value: string, o?: { expirationTtl?: number }) { this.puts.push({ key, ttl: o?.expirationTtl }); this.m.set(key, value); }
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const seedLedger = (ns: FakeNS, lines: string[]) => ns.m.set('lines/' + LEDGER_KEY, JSON.stringify(lines));

describe('public sub-cap', () => {
  it('counts only "public:" network calls against the sub-cap, and the total cap still applies', async () => {
    const ns = new FakeNS();
    seedLedger(ns, Array(205).fill('{"tag":"live:reverse","cached":false}'));
    const fetchImpl = vi.fn(async () => ok({ results: [] }));
    const c = new QlooClient({ apiKey: 'k', kv: new WorkersKV(ns), fetchImpl: fetchImpl as never, tagPrefix: 'public:', scopedMaxCalls: 2, logCacheHits: false });
    await c.get('/search', { query: 'a' }, 'live:resolve');
    await c.get('/search', { query: 'b' }, 'live:resolve');
    expect(await c.usage()).toEqual({ total: 207, scoped: 2 });
    const err = await c.get('/search', { query: 'c' }, 'live:resolve').catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceeded); expect(err.reason).toBe('public');
    expect((await c.get('/search', { query: 'a' }, 'live:resolve')).cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const tight = new QlooClient({ apiKey: 'k', kv: new WorkersKV(ns), fetchImpl: fetchImpl as never, tagPrefix: 'public:', scopedMaxCalls: 40, maxCalls: 207 });
    expect((await tight.get('/search', { query: 'd' }, 't').catch((e) => e)).reason).toBe('total');
  });
});

describe('IpDailyLimit', () => {
  it('limits per IP per day, charges once per request, and expires', async () => {
    const ns = new FakeNS(); const L = { match: 1, resolve: 5 };
    const now = () => Date.parse('2026-10-16T05:00:00Z');
    const first = new IpDailyLimit(ns, 'ipA', 'match', L, now);
    await first.consume(); await first.consume();
    expect(ns.puts).toHaveLength(1); expect(ns.puts[0].ttl).toBe(172800);
    expect((await new IpDailyLimit(ns, 'ipA', 'match', L, now).consume().catch((e) => e)).reason).toBe('ip');
    await new IpDailyLimit(ns, 'ipB', 'match', L, now).consume();
    await new IpDailyLimit(ns, 'ipA', 'resolve', L, now).consume();
    await new IpDailyLimit(ns, 'ipA', 'match', L, () => now() + 86400000).consume();
  });

  it('defaults to an abuse guard only: 20 live matches and 60 live searches per network a day', async () => {
    expect(DEFAULT_IP_LIMITS).toEqual({ match: 20, resolve: 60 });
    const ns = new FakeNS(); const now = () => Date.parse('2026-10-16T05:00:00Z');
    for (let i = 0; i < 20; i++) await new IpDailyLimit(ns, 'office', 'match', undefined, now).consume();
    expect((await new IpDailyLimit(ns, 'office', 'match', undefined, now).consume().catch((e) => e)).reason).toBe('ip');
  });
});

describe('no project-side cap', () => {
  it('capFrom treats unset, empty, 0 and junk as no cap', () => {
    expect([undefined, '', '0', 'abc', '-3'].map(capFrom)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(capFrom('300')).toBe(300);
  });

  it('keeps calling past 300 when no cap is set, and still logs every call', async () => {
    const ns = new FakeNS();
    seedLedger(ns, Array(300).fill('{"tag":"public:live:resolve","cached":false}'));
    const fetchImpl = vi.fn(async () => ok({ results: [] }));
    const c = new QlooClient({ apiKey: 'k', kv: new WorkersKV(ns), fetchImpl: fetchImpl as never, tagPrefix: 'public:', maxCalls: capFrom(undefined), scopedMaxCalls: capFrom('0'), logCacheHits: false });
    expect(c.caps).toEqual({ total: null, public: null });
    await c.get('/search', { query: 'a' }, 'live:resolve');
    expect(await c.usage()).toEqual({ total: 301, scoped: 301 });
  });

  it('turns a second Qloo 429 into the friendly demo-briefs answer', async () => {
    const ns = new FakeNS();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 429, headers: { 'retry-after': '0' } }));
    const env = { TASTECAST_KV: ns, ASSETS: { fetch: async () => new Response('') }, QLOO_API_KEY: 'k' };
    const r = await worker.fetch(new Request('https://t.dev/api/resolve', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4' }, body: JSON.stringify({ query: 'Brand' }) }), env, {});
    expect(r.status).toBe(429);
    const j = await r.json() as { demoOnly: boolean; reason: string; error: string };
    expect(j.demoOnly).toBe(true); expect(j.reason).toBe('upstream'); expect(j.error).toContain('demo briefs');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
  });
});

describe('Workers budget guard', () => {
  it('answers a 429 that points to the demo briefs when an optional public cap is set and used up', async () => {
    const ns = new FakeNS();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ok({ results: { entities: [] } }));
    const env = { TASTECAST_KV: ns, ASSETS: { fetch: async () => new Response('') }, QLOO_API_KEY: 'k', QLOO_PUBLIC_MAX_CALLS: '1' };
    const post = (q: string) => worker.fetch(new Request('https://t.dev/api/resolve', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4' }, body: JSON.stringify({ query: q }) }), env, {});
    expect((await post('Brand One')).status).toBe(200);
    const r = await post('Brand Two');
    expect(r.status).toBe(429);
    const j = await r.json() as { demoOnly: boolean; reason: string; error: string; demos: { href: string }[] };
    expect(j.demoOnly).toBe(true); expect(j.reason).toBe('public');
    expect(j.error).toContain('demo briefs'); expect(j.demos.map((d) => d.href)).toContain('/brief?demo=2&confirm=1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((await post('Brand One')).status).toBe(200);
    fetchSpy.mockRestore();
  });
});
