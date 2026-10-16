# TasteCast

**Brand brief in, ranked AI characters out. Every claim cites its Qloo evidence, and close calls are called close.**

Built for the **Qloo Agentic Hackathon** (2026).

- **Live demo:** https://tastecast.swanky-models.workers.dev
- **MCP endpoint:** `https://tastecast.swanky-models.workers.dev/mcp` (streamable HTTP)
- **License:** code MIT ([LICENSE](LICENSE)); character images CC BY-NC 4.0 ([LICENSE-images](LICENSE-images)); fonts SIL OFL 1.1 ([public/assets/fonts](public/assets/fonts))

TasteCast is for a studio that runs a small roster of original, disclosed AI characters (virtual models). A brand sends a brief; TasteCast asks Qloo which character the brand's audience actually shares taste with, shows its working, drafts the endorsement package, quotes a license, and then **stops for people to approve**. Every endorsement carries **`#ad · AI-generated character`**. The three characters (Itzel Robles, Mexico City; Ari Tseng, Seoul; Ingrid Brekkhus, London) are fictional and are not real users of any product.

## Try it (judges, about 2 minutes)

1. Open the [home page](https://tastecast.swanky-models.workers.dev) and pick one of the four **demo briefs**. Each card shows its stored verdict.
2. The brief fills itself, Qloo's `/search` candidates appear, and the exact match is confirmed (the human checkpoint). For **North Kiln**, Qloo lists two entries named "Le Creuset": the more popular one is preselected and the other is labelled.
3. Read the result: the verdict banner, the ranked characters (fit score /100, Qloo taste index in σ, audience similarity as a signed cosine), the **Agent run** timeline, the package, the license JSON (`charged:false`) and the evidence list. Every `evN` chip opens the Qloo call behind it.

| Demo brief (fictional brand) | Qloo reference brand | Verdict |
|---|---|---|
| Pica Pica Fruit Co., chili-lime fruit cups | Tajín | Qloo decided: Itzel Robles (lead 0.368) |
| Nokdu Lab, green tea toner | Innisfree | Qloo decided: Ari Tseng (lead 0.184) |
| North Kiln, stoneware tea set | Le Creuset | Qloo decided: Ingrid Brekkhus (lead 0.380) |
| Loma Coffee Gear, pour-over dripper | Blue Bottle Coffee | Close call: Itzel or Ingrid (lead 0.104 clears 0.08, but the two index measures disagree) |

Direct links: `/brief?demo=0&confirm=1` … `demo=3`. Demo briefs are served from **stored Qloo results** and cost no live calls. Custom briefs make live Qloo calls under a small public budget (40 calls in total; per network 5 searches and 1 ranking a day). When it runs out, the site says so and points back to the demos.

**Instant reference brands.** Eleven well-known brands were run through Qloo ahead of time and stored, so a custom brief that uses one of them as the reference brand returns at once and makes no new Qloo calls. The brief page lists them, and the result carries a "Precomputed" note. Typed variants work (`nike`, `Tajin`, `Stüssy`, `Blue Bottle`). Leave the campaign city empty: a city adds an in-city check that was not precomputed. Verdicts below are for a generic brief and were not tuned.

| Instant brand | Verdict (generic brief) |
|---|---|
| Nike | Close call, Itzel leads. Nike is one of the six baseline brands, so the taste index cannot measure it |
| Starbucks | Close call, Itzel and Ari tied. Also a baseline brand |
| Glossier | Close call, Itzel leads (lead 0.091, measures disagree) |
| Aesop | Close call, Ingrid leads by 0.005 |
| Stüssy | Qloo decided: Itzel Robles (lead 0.190) |
| Fender | Qloo decided: Ingrid Brekkhus (lead 0.306) |
| Gentle Monster | Close call, Ari leads (lead 0.071) |
| Tajín, Innisfree, Le Creuset, Blue Bottle Coffee | Same as the demo briefs above |

Precomputing them cost 27 Qloo calls (Nike 6, Starbucks 5, Glossier, Aesop, Stüssy and Fender 4 each; the other five reused cached results), counted by a dry run before spending (`scripts/instant-cost.ts`).

## Use it from an agent (MCP)

The same loop is a remote MCP server. Add it to any MCP client:

```json
{ "mcpServers": { "tastecast": { "type": "http", "url": "https://tastecast.swanky-models.workers.dev/mcp" } } }
```

Tools: `list_demo_briefs` → `resolve_brand` → (your user confirms a `candidate_id`) → `rank_roster` → `draft_package` → `quote_license`. `rank_roster` refuses an entity that did not come from `resolve_brand`, returns the verdict, the ranking, the agent-run trace with evidence ids, and a `view_url` that opens the same run in the browser.

Smoke test with the official SDK client (uses a demo brief, no live Qloo calls):

```bash
npm install
node scripts/mcp-smoke.mjs https://tastecast.swanky-models.workers.dev/mcp 2
# rank_roster: Qloo decided (decided) lead 0.38 / needs 0.08; served stored; ...
#   agent run: plan → human → tool → tool → tool → tool → tool → check → check → check → check → tool → stop
# quote_license: US$11340 charged=false approvals={"character_operator":false,"brand":false}
```

Stateless and session-free (official `@modelcontextprotocol/server` SDK, JSON responses); works with 2025-era clients and the 2026-07-28 revision.

## How Qloo powers it

Qloo is the decision-maker, not decoration. For each confirmed reference brand the agent calls:

1. **`/search`** to resolve the brand. A person confirms the entity before any insights call.
2. **Audience** (`/v2/insights` demographics): the brand's age and gender profile, compared with each character's seed profile as a cosine.
3. **Taste index** (`/v2/insights`, `signal.interests.entities=<brand>`, `filter.results.entities=<all characters' seeds>`): how strongly the brand's fans like each character's artists, brands, TV and film, against a baseline of six everyday brands, as z-scores. One query scores all three characters.
4. **Context, no weight:** shared taste tags and a house-brand fit check with explainability.
5. **Package research:** tags, artists and brands for the winning character's city and age bucket. Places that are shops or other brands are left out as shoot locations.

Fit score = 0.6 × taste index + 0.4 × (cosine + 1) / 2. **"Qloo decided"** needs a lead of at least 0.08 **and** the taste index must pick the same leader by z-score and by raw lift. Otherwise it is a **close call**, with the viable characters and their tradeoffs. Thresholds were set before the test runs and are not tuned per demo (see `docs/milestone-2.md`, `docs/limitations.md`).

Optional: Workers AI rewrites five copy lines once per package, in the background after the result is shown (the page swaps in the checked lines when they are ready). A checker rejects any rewrite that adds a name, a brand from the evidence, a number, or first-person/testimonial wording, or drops the disclosure; rejected lines keep the template text, and evidence ids are never written by the model.

## Architecture

```
browser ──/api/*──┐                    ┌── Qloo Insights API (server-side key)
MCP client ─/mcp──┤  Cloudflare Worker ├── Workers KV (stored runs, cache, ledger, per-IP limits)
                  └──  Hono + service  └── Workers AI (optional checked copy rewrite)
```

- `src/agent/` the loop: resolve, rank, decision, agent-run trace. `src/content/` package, copy checker, license. `src/qloo/client.ts` cached client with ledger and budget guards. `src/mcp.ts` MCP tools over the same service as the web app. `src/server.worker.ts` Workers entry; `src/server.node.ts` local Node server.
- Details: [`docs/architecture.md`](docs/architecture.md), milestones 2–4, and [`docs/limitations.md`](docs/limitations.md).

## Run it yourself

This repo contains **no Qloo data**: no response cache, no KV seed, no entity IDs. The live demo serves stored results from its own KV. To run locally you need your own Qloo key:

```bash
npm install
export QLOO_API_KEY=...     # server side only; never committed or sent to the browser
npm run precompute          # character profiles + everyday-brand baseline (about 40 Qloo calls)
npm run dev                 # http://localhost:8787 ; MCP at http://localhost:8787/mcp
```

Without a key the server still starts and Qloo-backed routes return a plain 503. Deploying to Workers: create a KV namespace, put its id in `wrangler.toml`, `wrangler secret put QLOO_API_KEY`, then `npm run deploy`.

Checks:

```bash
npm test             # 52 unit, route and MCP tests (no network)
npm run typecheck
npm run scan-public  # fails on cache/, .env, the key, raw Qloo JSON or UUID-shaped ids
```

## Data and disclosure rules

- The Qloo key lives only in the server environment. Clients never see entity IDs; candidates use opaque tokens.
- Every live Qloo call is logged (timestamp, tag, path, status, latency) and counted against a total cap and a public sub-cap.
- License quotes are never charged and both approvals stay false until people sign off.
- The characters are AI-generated, labelled as such on every page and in every package.
