import { describe, expect, it } from 'vitest';
import { createApp, S5_KEY } from '../src/app.js';
import { cacheKey, QlooClient } from '../src/qloo/client.js';
import { MemoryKV } from '../src/store/kv.js';
import { canonicalQuery, instantBrand, INSTANT_BRANDS } from '../src/instant-brands.js';
import { departmentStore, shootability } from '../src/content/places.js';

const noNet = (async () => { throw new Error('no network in tests'); }) as never;
const fakeId = ['AAAAAAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEEEEEEEEEE'].join('-');

describe('instant brands', () => {
  it('maps typed variants to the stored search text', () => {
    expect(canonicalQuery('  glossier ')).toBe('Glossier');
    expect(canonicalQuery('Stüssy')).toBe('Stussy');
    expect(canonicalQuery('tajin')).toBe('Tajín');
    expect(canonicalQuery('blue bottle')).toBe('Blue Bottle Coffee');
    expect(canonicalQuery('Unknown Brand Co')).toBe('Unknown Brand Co');
    expect(instantBrand('nike')?.query).toBe('Nike');
    expect(new Set(INSTANT_BRANDS.map((b) => b.query)).size).toBe(INSTANT_BRANDS.length);
  });
  it('a typed instant brand resolves from the stored search: no network, marked precomputed, no entity id', async () => {
    const kv = new MemoryKV();
    await kv.set('qloo:' + cacheKey('/search', { query: 'Glossier', types: 'urn:entity:brand', take: '5' }), { results: [{ entity_id: fakeId, name: 'Glossier', popularity: 0.9 }] });
    const app = createApp({ qloo: new QlooClient({ apiKey: 'k', kv, fetchImpl: noNet }), kv });
    const r = await app.request('/api/resolve', { method: 'POST', body: JSON.stringify({ query: 'glossier' }), headers: { 'content-type': 'application/json' } });
    expect(r.status).toBe(200);
    const b = await r.json() as any;
    expect(b.precomputed).toBe(true);
    expect(b.query).toBe('Glossier');
    expect(b.candidates[0]).toMatchObject({ name: 'Glossier', exact: true, preselected: true });
    expect(JSON.stringify(b)).not.toContain(fakeId);
    expect((await kv.lines('qloo-ledger.jsonl')).every((l) => l.includes('"cached":true'))).toBe(true);
  });
  it('lists instant brands without Qloo calls', async () => {
    const kv = new MemoryKV();
    const app = createApp({ qloo: new QlooClient({ apiKey: 'k', kv, fetchImpl: noNet }), kv });
    const list = await (await app.request('/api/instant')).json() as any[];
    expect(list.map((x) => x.query)).toEqual(INSTANT_BRANDS.map((b) => b.query));
    expect(list.every((x) => x.stored === false && x.verdict === null)).toBe(true);
  });
});

describe('shoot locations', () => {
  it('drops department stores by name, scoped by city for ambiguous names', () => {
    expect(shootability({ name: 'Restaurante Liverpool', area: 'Centro', kinds: ['Restaurant'] }, [], 'Mexico City').ok).toBe(false);
    expect(shootability({ name: 'Liverpool Street Café', area: 'City', kinds: ['Cafe'] }, [], 'London').ok).toBe(true);
    expect(departmentStore('Selfridges Foodhall', 'London')).toBe('Selfridges');
    expect(departmentStore("Macy’s Herald Square")).toBe("Macy's");
    expect(departmentStore('El Círculo teatral Café', 'Mexico City')).toBeUndefined();
    expect(departmentStore('NOPI by Ottolenghi', 'London')).toBeUndefined();
  });
});

describe('S5 panel flag', () => {
  const seed = async (kv: MemoryKV, results?: unknown) => kv.set(S5_KEY, { model: 'm', generatedAt: 't', method: 'x', briefs: { '0123456789abcdef': { label: 'Demo', llmOnly: { character: 'Ari Tseng', why: 'w', angle: 'a', locations: ['l'], soundtrack: ['s'], styling: ['y'] } } }, ...(results ? { results } : {}) });
  it('is unavailable while the flag is off, even with data stored', async () => {
    const kv = new MemoryKV(); await seed(kv);
    const app = createApp({ qloo: new QlooClient({ apiKey: undefined, kv }), kv });
    const r = await app.request('/api/s5/0123456789abcdef');
    expect(await r.json()).toEqual({ ok: true, available: false });
  });
  it('with the flag on and no rating, returns the LLM-only version and results: null', async () => {
    const kv = new MemoryKV(); await seed(kv);
    const app = createApp({ qloo: new QlooClient({ apiKey: undefined, kv }), kv, flags: { s5Panel: true } });
    const b = await (await app.request('/api/s5/0123456789abcdef')).json() as any;
    expect(b.llmOnly.character).toBe('Ari Tseng');
    expect(b.results).toBeNull();
    expect(b.available).toBe(true);
    expect(await (await app.request('/api/s5/ffffffffffffffff')).json()).toEqual({ ok: true, available: false });
  });
});

describe('deferred AI rewrite', () => {
  it('a live match answers with template copy marked ai-pending, and the deferred rewrite stores the AI copy', async () => {
    const { createService } = await import('../src/app.js');
    const { FileKV } = await import('../src/store/file-kv.js');
    const { existsSync, cpSync, mkdtempSync } = await import('node:fs');
    if (!existsSync('./cache/profiles')) return; // needs the local cache (gitignored); skipped in a fresh clone
    const dir = mkdtempSync('/tmp/tc-test-'); cpSync('./cache', dir, { recursive: true });
    const kv = new FileKV(dir);
    const qloo = new QlooClient({ apiKey: 'offline', kv, fetchImpl: noNet });
    const tasks: Promise<unknown>[] = [];
    const ai = { run: async () => ({ response: '{}' }) };
    const svc = createService({ qloo, kv, ai, defer: (p) => tasks.push(p) });
    const r = await svc.resolve('glossier');
    const cid = (r.body.candidates as any[]).find((c) => c.preselected).id;
    const m = await svc.match({ brandName: 'Deferred Test', referenceQuery: 'glossier', category: 'beauty', product: 'balm', channels: ['instagram'], durationMonths: 1 }, cid);
    const b = m.body as any;
    expect(b.package.copy.reason).toBe('ai-pending');
    expect(b.precomputed).toBe(true);
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks);
    const stored = await svc.getMatch(b.id);
    expect(stored!.package.copy.reason).not.toBe('ai-pending');
  });
});
