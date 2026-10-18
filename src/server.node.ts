import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApp } from './app.js';
import { capFrom, QlooClient } from './qloo/client.js';
import { FileKV } from './store/file-kv.js';
import { readFileSync } from 'node:fs';
import { handleMcp } from './mcp.js';
import { CHARACTERS } from './domain/characters.js';
import { SECURITY_HEADERS } from './headers.js';

const kv = new FileKV(process.env.TASTECAST_CACHE_DIR ?? './cache');
const qloo = new QlooClient({ apiKey: process.env.QLOO_API_KEY, kv, maxCalls: capFrom(process.env.QLOO_MAX_CALLS) });
const flags = { s5Panel: process.env.S5_PANEL === 'on' };
const root = new Hono();
root.use('*', async (c, next) => { await next(); for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(k, v); });
const notFound = () => new Response(readFileSync('./public/404.html'), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
root.on(['GET', 'POST', 'DELETE'], '/mcp', (c) => handleMcp(c.req.raw, { qloo, kv, flags }));
root.route('/', createApp({ qloo, kv, flags }));
root.get('/brief', serveStatic({ path: './public/brief.html' }));
root.get('/c/:slug', async (c, next) => (CHARACTERS.some((x) => x.slug === c.req.param('slug')) ? next() : notFound()), serveStatic({ path: './public/character.html' }));
root.use('/*', serveStatic({ root: './public' }));
root.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ ok: false, error: 'Not found' }, 404) : notFound()));
const port = Number(process.env.PORT ?? 8787);
// Loopback only by default: /mcp answers any origin (CORS *), so a page open on this machine could otherwise
// spend your own Qloo key's budget from the local network. Set HOST=0.0.0.0 to expose it deliberately.
const hostname = process.env.HOST ?? '127.0.0.1';
serve({ fetch: root.fetch, port, hostname });
console.log(`TasteCast on http://${hostname}:${port} (Qloo key ${qloo.hasKey ? 'set' : 'missing'})`);
