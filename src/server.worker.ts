import { Hono } from 'hono';
import { createApp } from './app.js';
import { QlooClient } from './qloo/client.js';
import { WorkersKV, type KVNamespaceLike } from './store/workers-kv.js';
import { hashIp, IpDailyLimit, type LimitKind } from './store/ip-limit.js';
import { handleMcp, mcpPreflight } from './mcp.js';
import type { AiLike } from './content/copywriter.js';

/** Cloudflare Workers entry. Static files (public/, including the locally built assets) are served by
 *  the Workers assets binding before this code runs; only /api/* and the /c/:slug page reach the worker.
 *  Data comes from TASTECAST_KV, seeded from ./cache by scripts/seed-kv.mjs, so page loads and the demo
 *  briefs are answered from stored results without new Qloo calls.
 *  Budget guards for live calls (custom briefs from the public), all enforced from KV:
 *    - total cap QLOO_MAX_CALLS (300) across the whole project ledger,
 *    - public sub-cap QLOO_PUBLIC_MAX_CALLS (40) on calls this site makes (ledger tag "public:"),
 *    - per-IP daily allowance: 1 live match and 5 live searches. */
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
        maxCalls: Number(env.QLOO_MAX_CALLS ?? 300),
        tagPrefix: path === '/mcp' ? 'public:mcp:' : 'public:', scopedMaxCalls: Number(env.QLOO_PUBLIC_MAX_CALLS ?? 40),
        scopePrefix: 'public:',
        beforeNetwork: async () => {
          limiter ??= new IpDailyLimit(env.TASTECAST_KV, await ipHash, kind);
          await limiter.consume();
        },
      });
    };
    const qloo = qlooFor(path === '/api/match' ? 'match' : 'resolve');
    const waitUntil = (ctx as { waitUntil?: (p: Promise<unknown>) => void } | undefined)?.waitUntil?.bind(ctx);
    const deps = { qloo, qlooFor, kv, ai: env.AI, defer: waitUntil, flags: { s5Panel: env.S5_PANEL === 'on' } };
    const root = new Hono();
    root.options('/mcp', () => mcpPreflight());
    root.get('/mcp', async (c) => ((c.req.header('accept') ?? '').includes('text/html') ? c.redirect('/#agents', 302) : handleMcp(c.req.raw, deps)));
    root.on(['POST', 'DELETE'], '/mcp', (c) => handleMcp(c.req.raw, deps));
    root.route('/', createApp(deps));
    // "/character" is character.html under the assets default html_handling (auto-trailing-slash).
    root.get('/c/:slug', (c) => env.ASSETS.fetch(new Request(new URL('/character', c.req.url), c.req.raw)));
    root.get('/brief', (c) => env.ASSETS.fetch(new Request(new URL('/brief', c.req.url), c.req.raw)));
    root.all('*', (c) => env.ASSETS.fetch(c.req.raw));
    return root.fetch(req, env, ctx as never);
  },
};
