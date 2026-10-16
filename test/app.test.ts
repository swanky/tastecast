import { describe, expect, it } from 'vitest';
import { createApp, validateBrief } from '../src/app.js';
import { QlooClient } from '../src/qloo/client.js';
import { MemoryKV } from '../src/store/kv.js';

describe('app', () => {
  it('health returns 503 without a key and no stack trace', async () => {
    const kv = new MemoryKV();
    const app = createApp({ qloo: new QlooClient({ apiKey: undefined, kv }), kv });
    const r = await app.request('/api/health');
    expect(r.status).toBe(503);
    const body = await r.text();
    expect(body).toContain('QLOO_API_KEY not set');
    expect(body).not.toMatch(/at .*\.ts:\d+/);
  });
  it('match refuses to run before a candidate is confirmed', async () => {
    const kv = new MemoryKV();
    const app = createApp({ qloo: new QlooClient({ apiKey: 'k', kv, fetchImpl: (async () => { throw new Error('no network in tests'); }) as never }), kv });
    const r = await app.request('/api/match', { method: 'POST', body: JSON.stringify({ brief: { brandName: 'X', referenceQuery: 'Y', channels: ['instagram'], durationMonths: 1 }, candidateId: 'nope' }), headers: { 'content-type': 'application/json' } });
    expect(r.status).toBe(409);
  });
  it('validates briefs', () => {
    expect(validateBrief({}).error).toContain('brandName');
    expect(validateBrief({ brandName: 'a', referenceQuery: 'b', channels: ['fax'], durationMonths: 1 }).error).toContain('channels');
    expect(validateBrief({ brandName: 'a', referenceQuery: 'b', channels: ['web'], durationMonths: 2 }).error).toContain('durationMonths');
    expect(validateBrief({ brandName: 'a', referenceQuery: 'b', channels: ['web'], durationMonths: 3 }).brief?.channels).toEqual(['web']);
  });
});
