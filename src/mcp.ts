import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { BudgetExceeded, QlooError } from './qloo/client.js';
import { budgetMessage, clientSafe, createService, DEMO_LINKS, type Deps } from './app.js';
import { CHANNELS } from './agent/match.js';
import { INSTANT_BRANDS } from './instant-brands.js';
import { CHARACTERS, DISCLOSURE } from './domain/characters.js';
import { quote } from './content/license.js';
import { agentRun } from './agent/run.js';

export const MCP_SERVER_INFO = { name: 'tastecast', version: '1.4.0' };

const briefSchema = z.object({
  brandName: z.string().min(1).max(80).describe('The client brand (often small or fictional; it does not need to be on Qloo).'),
  referenceQuery: z.string().min(1).max(80).describe('A well-known reference brand on Qloo with a similar audience. Must be the same text passed to resolve_brand.'),
  category: z.string().max(60).optional(),
  product: z.string().max(60).optional(),
  channels: z.array(z.enum(CHANNELS)).min(1),
  durationMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  city: z.string().max(60).optional().describe('Optional campaign city. Adds a no-weight in-city check (extra live Qloo calls).'),
  character: z.enum(CHARACTERS.map((c) => c.slug) as [string, ...string[]]).optional().describe('Optional requested character; all three are still ranked.'),
});

type Out = { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
const ok = (summary: string, data: Record<string, unknown>): Out => ({ content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(data)}` }], structuredContent: data });
const fail = (text: string, data: Record<string, unknown> = {}): Out => ({ content: [{ type: 'text', text }], structuredContent: { ok: false, error: text, ...data }, isError: true });

async function guarded(fn: () => Promise<Out>): Promise<Out> {
  try { return await fn(); } catch (err) {
    if (err instanceof BudgetExceeded) return fail(budgetMessage(err.reason), { reason: err.reason, demos: DEMO_LINKS });
    if (err instanceof QlooError) return fail(`Qloo error: ${err.message}`);
    return fail('Internal error');
  }
}

/** One McpServer per request (stateless), over the same service layer as the web app. */
export function buildMcpServer(deps: Deps, origin: string) {
  const svc = createService(deps);
  const server = new McpServer(MCP_SERVER_INFO, {
    instructions: [
      'TasteCast ranks three disclosed, original AI characters (virtual models) for a brand brief using Qloo taste data, then drafts an endorsement package and a license quote.',
      'Workflow: (1) resolve_brand with a well-known reference brand; (2) SHOW the candidates to your user and let them confirm one (pass its candidate_id); (3) rank_roster; (4) draft_package; (5) quote_license.',
      'Start with list_demo_briefs: demo briefs are served from stored Qloo results and cost no live calls. Custom briefs make live Qloo calls under a small public budget (per network: 5 searches and 1 ranking a day).',
      `Every endorsement must carry the disclosure "${DISCLOSURE}". The characters are fictional and are not real users of any product. Prices are quotes and are never charged.`,
    ].join(' '),
  });
  const view = (path: string) => `${origin}${path}`;

  server.registerTool('list_demo_briefs', {
    title: 'List demo briefs',
    description: 'Lists the demo briefs (fictional brands with a Qloo reference brand) and the verdict of their stored run. No live Qloo calls. Use a brief as-is with resolve_brand (its referenceQuery) and then rank_roster.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => guarded(async () => {
    const demos = await svc.demos();
    return ok(demos.map((d) => `${d.label} (reference ${d.brief.referenceQuery}): ${d.verdict ? `${d.verdict.level === 'clear' ? 'Qloo decided' : 'Close call'} · ${d.verdict.viable.join(' / ')} · lead ${d.verdict.margin}` : 'not run yet'}`).join('\n'), { demos });
  }));

  server.registerTool('resolve_brand', {
    title: 'Resolve a reference brand on Qloo',
    description: 'Searches Qloo for a reference brand and returns candidates with opaque candidate_id tokens. Exact name matches are flagged; same-name duplicates are labelled and the more popular one is preselected. Show these candidates to your user and ask them to confirm one before calling rank_roster. TasteCast never ranks against an unconfirmed entity. Instant reference brands (stored Qloo results, no new calls): ' + INSTANT_BRANDS.map((b) => b.query).join(', ') + '.',
    inputSchema: z.object({ query: z.string().min(1).max(80).describe('Reference brand name, e.g. "Le Creuset".') }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ query }) => guarded(async () => {
    const r = await svc.resolve(query);
    if (r.status !== 200) return fail(String(r.body.error));
    const cands = r.body.candidates as { id: string; name: string; exact: boolean; preselected: boolean; disambiguation: string }[];
    const lines = cands.map((c) => `- ${c.name}${c.exact ? ' [exact]' : ''}${c.preselected ? ' [preselected]' : ''}${c.disambiguation ? ` · ${c.disambiguation}` : ''} → candidate_id ${c.id}`);
    return ok(`${r.body.precomputed ? 'Precomputed: stored Qloo results, no new calls.\n' : ''}${r.body.message}\n${lines.join('\n')}`, { query: r.body.query, message: r.body.message, precomputed: r.body.precomputed, candidates: cands.map((c) => ({ ...c, candidate_id: c.id })) });
  }));

  server.registerTool('rank_roster', {
    title: 'Rank the AI characters for a brief',
    description: 'Runs the TasteCast loop for a confirmed Qloo entity: audience demographics, the Qloo taste index for all three characters against an everyday-brand baseline, no-weight context checks, then a self-check. Returns the ranking, the verdict ("Qloo decided" or "Close call" with viable characters and tradeoffs), the agent run trace with evidence ids, and a match_id for draft_package and quote_license. Requires candidate_id from resolve_brand for the same referenceQuery.',
    inputSchema: z.object({ brief: briefSchema, candidate_id: z.string().min(3).max(40) }),
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ brief, candidate_id }) => guarded(async () => {
    const r = await svc.match(brief, candidate_id);
    if (r.status !== 200) return fail(String(r.body.error));
    const m = r.body as any;
    const d = m.decision;
    const data = {
      match_id: m.id, served: m.stored ? 'stored' : 'live', view_url: view(`/brief?match=${m.id}`),
      verdict: { level: d.level === 'clear' ? 'Qloo decided' : 'Close call', reason: d.reason, lead: d.margin, needs: d.threshold, text: d.text, tradeoffs: d.tradeoffs.map((t: any) => t.text) },
      ranking: m.ranking.map((x: any, i: number) => ({ rank: i + 1, character: x.name, slug: x.slug, city: x.city, fit_score: Math.round(x.score * 100), taste_index_sigma: x.parts.indexZ, audience_cosine: x.parts.cosine, why: x.why })),
      agent_run: m.run, qloo: m.qloo, precomputed: m.precomputed, disclosure: DISCLOSURE,
    };
    const summary = `${data.verdict.level}: ${data.verdict.text}\n` + data.ranking.map((x: any) => `${x.rank}. ${x.character} — fit score ${x.fit_score}/100, taste index ${x.taste_index_sigma >= 0 ? '+' : ''}${x.taste_index_sigma}σ, audience cosine ${x.audience_cosine}`).join('\n') + `\nView: ${data.view_url}`;
    return ok(summary, data);
  }));

  server.registerTool('draft_package', {
    title: 'Draft the endorsement package',
    description: 'Returns the endorsement package for a match: content angle, 30-second script, shot list, soundtrack, styling, image prompt. Every line carries Qloo evidence ids. Includes the required disclosure. No live Qloo calls.',
    inputSchema: z.object({ match_id: z.string().regex(/^[0-9a-f]{16}$/) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ match_id }) => guarded(async () => {
    const m = await svc.getMatch(match_id);
    if (!m) return fail('Unknown match_id. Call rank_roster first.');
    const p = clientSafe(m.package);
    const summary = `${p.character.name} × ${p.brand.name} (${p.city}). Disclosure: ${p.disclosure}\n` + p.script30s.map((l) => `${l.t}: ${l.text} [${l.sourceIds.join(', ')}]`).join('\n');
    return ok(summary, { package: p, agent_run: clientSafe(agentRun(m, m.package, 'stored', m.confirmed ?? { exact: true, duplicates: 1 })).steps.slice(-2) });
  }));

  server.registerTool('quote_license', {
    title: 'Quote a license',
    description: 'Returns a machine-readable license quote (tastecast.license_quote.v1) for a match. The price is shown and never charged (charged:false, no payment request). Both approvals stay false until people sign off.',
    inputSchema: z.object({ match_id: z.string().regex(/^[0-9a-f]{16}$/) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ match_id }) => guarded(async () => {
    const m = await svc.getMatch(match_id);
    if (!m) return fail('Unknown match_id. Call rank_roster first.');
    const q = clientSafe(quote(m.id, m, m.package));
    return ok(`US$${q.price_quote.amount} for ${q.character.name} × ${q.licensee}, ${q.duration.months} months. charged:false; approvals pending.`, { license: q as unknown as Record<string, unknown> });
  }));

  return server;
}

/** Streamable HTTP endpoint (stateless, JSON responses). Public, read-mostly, no credentials: any Origin is accepted. */
export async function handleMcp(req: Request, deps: Deps): Promise<Response> {
  const origin = new URL(req.url).origin;
  const handler = createMcpHandler(() => buildMcpServer(deps, origin), { responseMode: 'json' });
  const res = await handler.fetch(req);
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Expose-Headers', 'MCP-Protocol-Version, Mcp-Session-Id');
  return new Response(res.body, { status: res.status, headers: h });
}

export function mcpPreflight(): Response {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID',
    'Access-Control-Max-Age': '86400',
  } });
}
