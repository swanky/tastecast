import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileKV } from '../src/store/file-kv.js';
import { storageKey } from '../src/store/keys.js';
import { WorkersKV, type KVNamespaceLike } from '../src/store/workers-kv.js';
import { BudgetExceeded, cacheKey, LEDGER_KEY, QlooClient } from '../src/qloo/client.js';
import worker from '../src/server.worker.js';

class FakeNS implements KVNamespaceLike {
  m = new Map<string, string>();
  puts = 0;
  async get(key: string) { const v = this.m.get(key); return v === undefined ? null : JSON.parse(v); }
  async put(key: string, value: string) { this.puts++; this.m.set(key, value); }
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('storageKey', () => {
  it('matches the FileKV ./cache layout, so the cache can be uploaded to KV as-is', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tc-'));
    const fkv = new FileKV(dir);
    const long = 'qloo:' + cacheKey('/v2/insights', { 'filter.type': 'urn:entity:brand', 'signal.interests.entities': 'abc' });
    await fkv.set(long, { a: 1 });
    await fkv.set('profiles:all', [1]);
    const [file] = await readdir(join(dir, 'qloo'));
    expect(await storageKey(long)).toBe('qloo/' + file.replace(/\.json$/, ''));
    expect(await storageKey('profiles:all')).toBe('profiles/all');
    expect(JSON.parse(await readFile(join(dir, 'profiles', 'all.json'), 'utf8'))).toEqual([1]);
  });
});

describe('WorkersKV', () => {
  it('round-trips values and append-only lines', async () => {
    const kv = new WorkersKV(new FakeNS());
    expect(await kv.get('match:x')).toBeUndefined();
    await kv.set('match:x', { id: 'x' });
    expect(await kv.get('match:x')).toEqual({ id: 'x' });
    await kv.append(LEDGER_KEY, 'a'); await kv.append(LEDGER_KEY, 'b');
    expect(await kv.lines(LEDGER_KEY)).toEqual(['a', 'b']);
  });

  it('enforces the call cap from the KV ledger and does not write on cache hits', async () => {
    const ns = new FakeNS();
    const kv = new WorkersKV(ns);
    await ns.put('lines/' + LEDGER_KEY, JSON.stringify(Array(299).fill('{"cached":false}')));
    const fetchImpl = vi.fn(async () => ok({ results: [] }));
    const c = new QlooClient({ apiKey: 'k', kv, maxCalls: 300, fetchImpl: fetchImpl as never, logCacheHits: false });
    await c.get('/search', { query: 'a' }, 't');
    expect(await c.networkCallsUsed()).toBe(300);
    const before = ns.puts;
    expect((await c.get('/search', { query: 'a' }, 't')).cached).toBe(true);
    expect(ns.puts).toBe(before);
    await expect(c.get('/search', { query: 'b' }, 't')).rejects.toBeInstanceOf(BudgetExceeded);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('Workers entry', () => {
  const assets = { fetch: vi.fn(async (r: Request) => new Response('asset ' + new URL(r.url).pathname)) };
  const env = () => ({ TASTECAST_KV: new FakeNS(), ASSETS: assets, QLOO_MAX_CALLS: '300' });

  it('serves /api/characters from KV without a key or any Qloo call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await worker.fetch(new Request('https://t.dev/api/characters'), env(), {});
    expect(res.status).toBe(200);
    const body = await res.json() as { slug: string; disclosure: string }[];
    expect(body.length).toBeGreaterThanOrEqual(3);
    expect(body[0].disclosure).toContain('AI-generated character');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('maps /c/:slug to the character page and passes other paths to assets', async () => {
    expect(await (await worker.fetch(new Request('https://t.dev/c/itzel-robles'), env(), {})).text()).toBe('asset /character');
    expect(await (await worker.fetch(new Request('https://t.dev/styles.css'), env(), {})).text()).toBe('asset /styles.css');
  });

  it('returns 404 JSON for an unknown license id', async () => {
    const res = await worker.fetch(new Request('https://t.dev/api/license/nope'), env(), {});
    expect(res.status).toBe(404);
  });
});
