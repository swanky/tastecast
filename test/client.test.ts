import { describe, expect, it, vi } from 'vitest';
import { BudgetExceeded, cacheKey, QlooClient, QlooError } from '../src/qloo/client.js';
import { MemoryKV } from '../src/store/kv.js';

const ok = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

describe('cacheKey', () => {
  it('sorts params so order does not matter', () => {
    expect(cacheKey('/search', { b: '2', a: '1' })).toBe(cacheKey('/search', { a: '1', b: '2' }));
    expect(cacheKey('/search', { query: 'a b', types: 'urn:entity:brand' })).toBe('/search?query=a%20b&types=urn%3Aentity%3Abrand');
  });
});

describe('QlooClient', () => {
  it('sends the key only in X-Api-Key, blocks redirects, and caches', async () => {
    const fetchImpl = vi.fn(async () => ok({ success: true, results: [] }));
    const c = new QlooClient({ apiKey: 'k-123', kv: new MemoryKV(), fetchImpl: fetchImpl as never });
    await c.get('/search', { query: 'x' }, 't');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://hackathon.api.qloo.com/search?query=x');
    expect(url).not.toContain('k-123');
    expect((init.headers as Record<string, string>)['X-Api-Key']).toBe('k-123');
    expect(init.redirect).toBe('manual');
    const again = await c.get('/search', { query: 'x' }, 't');
    expect(again.cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 once after Retry-After', async () => {
    const responses = [ok({}, 429, { 'retry-after': '2' }), ok({ results: [] })];
    const sleep = vi.fn(async () => {});
    const c = new QlooClient({ apiKey: 'k', kv: new MemoryKV(), fetchImpl: (async () => responses.shift()!) as never, sleep });
    await c.get('/search', { query: 'y' }, 't');
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(await c.networkCallsUsed()).toBe(2);
  });

  it('does not retry 401 and redacts nothing into errors', async () => {
    const fetchImpl = vi.fn(async () => ok({ error: 'bad key k' }, 401));
    const c = new QlooClient({ apiKey: 'k', kv: new MemoryKV(), fetchImpl: fetchImpl as never });
    await expect(c.get('/search', { query: 'z' }, 't')).rejects.toBeInstanceOf(QlooError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects redirects', async () => {
    const c = new QlooClient({ apiKey: 'k', kv: new MemoryKV(), fetchImpl: (async () => new Response('', { status: 302, headers: { location: 'https://evil.example' } })) as never });
    await expect(c.get('/search', { query: 'r' }, 't')).rejects.toThrow('redirect blocked');
  });

  it('enforces the call budget from the ledger', async () => {
    const c = new QlooClient({ apiKey: 'k', kv: new MemoryKV(), maxCalls: 1, fetchImpl: (async () => ok({ results: [] })) as never });
    await c.get('/search', { query: '1' }, 't');
    await expect(c.get('/search', { query: '2' }, 't')).rejects.toBeInstanceOf(BudgetExceeded);
  });

  it('fails clearly without a key', async () => {
    const c = new QlooClient({ apiKey: undefined, kv: new MemoryKV() });
    await expect(c.get('/search', { query: 'n' }, 't')).rejects.toThrow('QLOO_API_KEY not set');
  });
});
