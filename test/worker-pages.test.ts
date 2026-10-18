import { describe, expect, it } from 'vitest';
import worker from '../src/server.worker.js';

/** Assets binding stand-in: knows /, /404 and /character; everything else is a 404 with an empty body. */
const ASSETS = { async fetch(req: Request) {
  const p = new URL(req.url).pathname;
  if (p === '/404') return new Response('<h1>There is no page here.</h1>', { status: 200 });
  if (p === '/' || p === '/character') return new Response('<html>page</html>', { status: 200 });
  return new Response(null, { status: 404 });
} };
const env = { TASTECAST_KV: { async get() { return null; }, async put() {} }, ASSETS } as never;
const get = (path: string) => worker.fetch(new Request(`https://tc.test${path}`), env, {});

describe('worker pages', () => {
  it('serves a branded 404 for unknown pages and unknown characters', async () => {
    for (const p of ['/nonexistent-page', '/c/nobody']) {
      const r = await get(p);
      expect(r.status, p).toBe(404);
      expect(await r.text()).toContain('There is no page here.');
    }
    expect((await get('/c/ari-tseng')).status).toBe(200);
  });
  it('sets nosniff and a referrer policy on every response', async () => {
    for (const p of ['/', '/nonexistent-page', '/api/demos']) {
      const r = await get(p);
      expect(r.headers.get('x-content-type-options'), p).toBe('nosniff');
      expect(r.headers.get('referrer-policy'), p).toBe('strict-origin-when-cross-origin');
    }
  });
});
