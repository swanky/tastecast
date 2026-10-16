import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApp } from './app.js';
import { QlooClient } from './qloo/client.js';
import { FileKV } from './store/file-kv.js';
import { handleMcp } from './mcp.js';

const kv = new FileKV(process.env.TASTECAST_CACHE_DIR ?? './cache');
const qloo = new QlooClient({ apiKey: process.env.QLOO_API_KEY, kv, maxCalls: Number(process.env.QLOO_MAX_CALLS ?? 300) });
const root = new Hono();
root.on(['GET', 'POST', 'DELETE'], '/mcp', (c) => handleMcp(c.req.raw, { qloo, kv }));
root.route('/', createApp({ qloo, kv }));
root.get('/brief', serveStatic({ path: './public/brief.html' }));
root.get('/c/:slug', serveStatic({ path: './public/character.html' }));
root.use('/*', serveStatic({ root: './public' }));
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: root.fetch, port });
console.log(`TasteCast on http://localhost:${port} (Qloo key ${qloo.hasKey ? 'set' : 'missing'})`);
