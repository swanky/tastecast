import { Hono } from 'hono';
import { createApp } from './app.js';
import { capFrom, QlooClient } from './qloo/client.js';
import { WorkersKV, type KVNamespaceLike } from './store/workers-kv.js';
import { DEFAULT_IP_LIMITS, hashIp, IpDailyLimit, type LimitKind } from './store/ip-limit.js';
import { handleMcp, mcpPreflight } from './mcp.js';
import type { AiLike } from './content/copywriter.js';
import { CHARACTERS } from './domain/characters.js';
import { SECURITY_HEADERS } from './headers.js';

/** Cloudflare Workers entry. Static files (public/, including the locally built assets) are served by
 *  the Workers assets binding before this code runs; only /api/* and the /c/:slug page reach the worker.
 *  Data comes from TASTECAST_KV, seeded from ./cache by scripts/seed-kv.mjs, so page loads and the demo
 *  briefs are answered from stored results without new Qloo calls.
 *  Live calls (custom briefs from the public) have no project-side cap. Every network call is still logged in
 *  the KV ledger for reporting. Guards:
 *    - per-network daily abuse guard: 20 live matches and 60 live searches (src/store/ip-limit.ts),
 *    - a Qloo 429 is retried once; a second 429 gets the friendly demo-briefs answer,
 *    - optional caps QLOO_MAX_CALLS / QLOO_PUBLIC_MAX_CALLS (unset or 0 = no cap; not set in wrangler.toml). */
export interface Env {
  QLOO_API_KEY?: string;
  QLOO_MAX_CALLS?: string;
  QLOO_PUBLIC_MAX_CALLS?: string;
  TASTECAST_KV: KVNamespaceLike;
  /** Workers AI, used only for the optional checked copy rewrite. */
  AI?: AiLike;
  /** "on" shows the S5 LLM-only comparison panel. */
  S5_PANEL?: string;
  ASSETS: { fetch(req: Request): Promise<Response> };
}

export default {
  async fetch(req: Request, env: Env, ctx: unknown) {
    const kv = new WorkersKV(env.TASTECAST_KV);
    const path = new URL(req.url).pathname;
    const ipHash = hashIp(req.headers.get('cf-connecting-ip') ?? 'unknown');
    const qlooFor = (kind: LimitKind) => {
      let limiter: IpDailyLimit | undefined;
      return new QlooClient({
        apiKey: env.QLOO_API_KEY, kv, logCacheHits: false,
        maxCalls: capFrom(env.QLOO_MAX_CALLS),
        tagPrefix: path === '/mcp' ? 'public:mcp:' : 'public:', scopedMaxCalls: capFrom(env.QLOO_PUBLIC_MAX_CALLS),
        scopePrefix: 'public:',
        beforeNetwork: async () => {
          limiter ??= new IpDailyLimit(env.TASTECAST_KV, await ipHash, kind);
          await limiter.consume();
        },
      });
    };
    const qloo = qlooFor(path === '/api/match' ? 'match' : 'resolve');
    const waitUntil = (ctx as { waitUntil?: (p: Promise<unknown>) => void } | undefined)?.waitUntil?.bind(ctx);
    const deps = { qloo, qlooFor, ipLimits: DEFAULT_IP_LIMITS, kv, ai: env.AI, defer: waitUntil, flags: { s5Panel: env.S5_PANEL === 'on' } };
    const root = new Hono();
    root.use('*', async (c, next) => {
      await next();
      const res = new Response(c.res.body, c.res);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
      c.res = res;
    });
    /** Branded 404 page (public/404.html, served by the assets binding as /404). */
    const notFound = async (url: string, raw: Request) => {
      const page = await env.ASSETS.fetch(new Request(new URL('/404', url), raw));
      return new Response(page.ok ? page.body : 'Not found', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
    };
    root.options('/mcp', () => mcpPreflight());
    root.get('/mcp', async (c) => ((c.req.header('accept') ?? '').includes('text/html') ? c.redirect('/#agents', 302) : handleMcp(c.req.raw, deps)));
    root.on(['POST', 'DELETE'], '/mcp', (c) => handleMcp(c.req.raw, deps));
    root.route('/', createApp(deps));
    // "/character" is character.html under the assets default html_handling (auto-trailing-slash).
    root.get('/c/:slug', (c) => (CHARACTERS.some((x) => x.slug === c.req.param('slug')) ? env.ASSETS.fetch(new Request(new URL('/character', c.req.url), c.req.raw)) : notFound(c.req.url, c.req.raw)));
    root.get('/brief', (c) => env.ASSETS.fetch(new Request(new URL('/brief', c.req.url), c.req.raw)));
    root.all('*', async (c) => {
      const res = await env.ASSETS.fetch(c.req.raw);
      if (res.status !== 404 || c.req.method !== 'GET' || c.req.path.startsWith('/api/')) return res;
      return notFound(c.req.url, c.req.raw);
    });
    return root.fetch(req, env, ctx as never);
  },
};
