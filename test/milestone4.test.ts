import { cpSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createApp } from '../src/app.js';
import { handleMcp } from '../src/mcp.js';
import { QlooClient } from '../src/qloo/client.js';
import { MemoryKV } from '../src/store/kv.js';
import { FileKV } from '../src/store/file-kv.js';
import { shootability } from '../src/content/places.js';
import { checkLine, rewriteCopy } from '../src/content/copywriter.js';
import { DISCLOSURE } from '../src/domain/characters.js';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// Fake ids built at runtime so the source never holds a UUID-shaped string (scan-public).
const fakeId = (c: string) => [8, 4, 4, 4, 12].map((n) => c.repeat(n)).join('-');
const U1 = fakeId('1');
const U2 = fakeId('a');
const fakeSearch = (async () => new Response(JSON.stringify({ success: true, results: [
  { entity_id: U1, name: 'Le Creuset', popularity: 0.93, types: ['urn:entity:brand'] },
  { entity_id: U2, name: 'Le Creuset', popularity: 0.62, types: ['urn:entity:brand'] },
] }))) as never;

/** An MCP SDK client whose transport calls the handler in-process. */
async function mcpClient(deps: Parameters<typeof handleMcp>[1]) {
  const client = new Client({ name: 'tastecast-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), { fetch: (async (u: string | URL | Request, init?: RequestInit) => handleMcp(new Request(u, init), deps)) as typeof fetch });
  await client.connect(transport);
  return client;
}

describe('MCP endpoint', () => {
  it('initializes, lists the five tools, and resolves with labelled duplicates and no UUIDs', async () => {
    const kv = new MemoryKV();
    const client = await mcpClient({ qloo: new QlooClient({ apiKey: 'k', kv, fetchImpl: fakeSearch }), kv });
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(['draft_package', 'list_demo_briefs', 'quote_license', 'rank_roster', 'resolve_brand']);
    const r: any = await client.callTool({ name: 'resolve_brand', arguments: { query: 'Le Creuset' } });
    expect(r.isError).toBeFalsy();
    const cands = r.structuredContent.candidates;
    expect(cands.filter((c: any) => c.preselected)).toHaveLength(1);
    expect(cands[0].preselected).toBe(true);
    expect(cands[1].duplicateOf).toBeTruthy();
    expect(JSON.stringify(r)).not.toMatch(UUID);
    await client.close();
  });
  it('refuses rank_roster for an unconfirmed candidate and maps errors to tool errors', async () => {
    const kv = new MemoryKV();
    const client = await mcpClient({ qloo: new QlooClient({ apiKey: 'k', kv, fetchImpl: fakeSearch }), kv });
    const r: any = await client.callTool({ name: 'rank_roster', arguments: { brief: { brandName: 'X', referenceQuery: 'Le Creuset', channels: ['web'], durationMonths: 1 }, candidate_id: 'nope' } });
    expect(r.isError).toBe(true);
    const q: any = await client.callTool({ name: 'quote_license', arguments: { match_id: '0123456789abcdef' } });
    expect(q.isError).toBe(true);
    await client.close();
  });

  const hasCache = existsSync('cache');
  it.skipIf(!hasCache)('runs a stored demo end to end with no network calls and client-safe output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-'));
    cpSync('cache', dir, { recursive: true });
    const kv = new FileKV(dir);
    let net = 0;
    const qloo = new QlooClient({ apiKey: undefined, kv, fetchImpl: (async () => { net++; throw new Error('no network'); }) as never });
    const client = await mcpClient({ qloo, kv });
    const demos: any = await client.callTool({ name: 'list_demo_briefs', arguments: {} });
    const d = demos.structuredContent.demos[2];
    expect(d.verdict.level).toBe('clear');
    const res: any = await client.callTool({ name: 'resolve_brand', arguments: { query: d.brief.referenceQuery } });
    const pick = res.structuredContent.candidates.find((c: any) => c.preselected);
    const rank: any = await client.callTool({ name: 'rank_roster', arguments: { brief: d.brief, candidate_id: pick.candidate_id } });
    expect(rank.isError).toBeFalsy();
    const s = rank.structuredContent;
    expect(s.served).toBe('stored');
    expect(s.agent_run.steps[0].kind).toBe('plan');
    expect(s.agent_run.steps.at(-1).kind).toBe('stop');
    expect(s.agent_run.steps[1].title).toBe('Qloo entity confirmed by the calling agent');
    expect(s.agent_run.steps.filter((x: any) => x.kind === 'tool').every((x: any) => x.evidenceIds.length > 0)).toBe(true);
    const pkg: any = await client.callTool({ name: 'draft_package', arguments: { match_id: s.match_id } });
    expect(pkg.structuredContent.package.disclosure).toBe(DISCLOSURE);
    const lic: any = await client.callTool({ name: 'quote_license', arguments: { match_id: s.match_id } });
    expect(lic.structuredContent.license.price_quote.charged).toBe(false);
    for (const x of [demos, res, rank, pkg, lic]) expect(JSON.stringify(x)).not.toMatch(UUID);
    expect(net).toBe(0);
    await client.close();
  });
});

describe('/api/demos', () => {
  it('lists the four demo briefs without Qloo calls', async () => {
    const kv = new MemoryKV();
    const app = createApp({ qloo: new QlooClient({ apiKey: undefined, kv }), kv });
    const r = await app.request('/api/demos');
    const body: any = await r.json();
    expect(body).toHaveLength(4);
    expect(body[0].href).toBe('/brief?demo=0&confirm=1');
  });
});

describe('shootability', () => {
  it('drops stores and other brands, keeps cafés and parks', () => {
    expect(shootability({ name: 'Liberty London', area: '', kinds: ['department store'] }, []).ok).toBe(false);
    expect(shootability({ name: 'Burberry', area: '', kinds: [] }, ['Burberry']).ok).toBe(false);
    expect(shootability({ name: 'Monmouth', area: '', kinds: ['coffee shop'] }, []).ok).toBe(true);
    expect(shootability({ name: 'Hampstead Heath', area: '', kinds: ['park'] }, ['Burberry']).ok).toBe(true);
  });
});

describe('copy checker', () => {
  const orig = 'Creative direction: matcha, linen and film, the Qloo tags most tied to Ari Tseng.';
  it('accepts a rephrase with the same facts', () => {
    expect(checkLine(orig, 'The look draws on matcha, linen and film, the Qloo tags closest to Ari Tseng.', ['Ari Tseng'], [])).toBeNull();
  });
  it('treats possessives as the same name', () => {
    expect(checkLine('Shot of Ingrid Brekkhus at the wheel.', "Ingrid Brekkhus's hands at the wheel.", [], [])).toBeNull();
  });
  it('rejects new names, brands, numbers, testimonials and dropped disclosures', () => {
    expect(checkLine(orig, 'Matcha and linen, as worn by Zendaya.', [], [])).toMatch(/name/);
    expect(checkLine(orig, 'Matcha, linen and Aesop, the Qloo tags tied to Ari Tseng.', ['Ari Tseng'], ['Aesop'])).toMatch(/Aesop/);
    expect(checkLine(orig, 'Matcha, linen and film for 30 days.', [], [])).toMatch(/number/);
    expect(checkLine(orig, 'I love matcha and linen.', [], [])).toMatch(/testimonial/);
    expect(checkLine(`End card. ${DISCLOSURE}`, 'End card.', [], [])).toMatch(/disclosure/);
  });
  it('falls back to the template when the AI fails, and keeps evidence ids', async () => {
    const pkg: any = { character: { name: 'Ari Tseng' }, brand: { name: 'Nokdu Lab', product: 'toner' }, city: 'Taipei',
      angle: [{ text: orig, sourceIds: ['ev1'] }], script30s: [0, 1, 2, 3].map((i) => ({ t: `${i}`, text: `Line ${i}.`, sourceIds: [`ev${i + 2}`] })) };
    const broken = { run: async () => { throw new Error('down'); } };
    const out = await rewriteCopy(pkg, [], broken, []);
    expect(out.copy?.mode).toBe('template');
    expect(out.angle[0]).toEqual(pkg.angle[0]);
    const liar = { run: async () => ({ response: { 'angle.0': 'Matcha and linen, loved by Zendaya.', 'script.0': 'Line 0, slower.' } }) };
    const out2 = await rewriteCopy(pkg, [], liar, []);
    expect(out2.angle[0].text).toBe(orig);
    expect(out2.script30s[0].sourceIds).toEqual(['ev2']);
  });
});
