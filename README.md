# TasteCast

**Brand brief in, ranked AI characters out. Every claim cites its Qloo evidence, and close calls are called close.**

Built for the **Qloo Agentic Hackathon** (2026).

- **Live demo:** https://tastecast.swanky-models.workers.dev
- **MCP endpoint:** `https://tastecast.swanky-models.workers.dev/mcp` (streamable HTTP)
- **License:** code MIT ([LICENSE](LICENSE)); character images CC BY-NC 4.0 ([LICENSE-images](LICENSE-images)); fonts SIL OFL 1.1 ([public/assets/fonts](public/assets/fonts))

TasteCast is for a studio that runs a small roster of original, disclosed AI characters (virtual models). A brand sends a brief; TasteCast asks Qloo which character the brand's audience actually shares taste with, shows its working, drafts the endorsement package, quotes a license, and then **stops for people to approve**.

What kind of agent this is: a deterministic, auditable loop exposed as MCP tools. The tool order is fixed and enforced on the server (a `candidate_id` that did not come from `resolve_brand` gets a 409). The loop checks its own verdict and can refuse to decide: when the lead is small or the two taste measures disagree, it returns a close call instead of a winner. The one model step, a copy rewrite, is checked line by line and falls back to the template. It stops before anything is published or paid. Every endorsement carries **`#ad · AI-generated character`**. The three characters (Itzel Robles, Mexico City; Ari Tseng, Seoul; Ingrid Brekkhus, London) are fictional and are not real users of any product.

## Try it (judges, about 2 minutes)

1. Open the [home page](https://tastecast.swanky-models.workers.dev) and pick one of the four **demo briefs**. Each card shows its stored verdict.
2. The brief fills itself, Qloo's `/search` candidates appear, and the demo link presses **Confirm** for you (the agent run says "confirmed automatically (demo link)"). To make the checkpoint yourself, open [`/brief?demo=2`](https://tastecast.swanky-models.workers.dev/brief?demo=2) without `&confirm=1`: Qloo lists two entries named "Le Creuset", the more popular one is preselected and the other is labelled, and nothing is ranked until you press Confirm.
3. Read the result: the verdict banner, the ranked characters (fit score /100, Qloo taste index in σ, audience similarity as a signed cosine), the **Agent run** timeline, the package, the license JSON (`charged:false`) and the evidence list. Every `evN` chip opens the Qloo call behind it.

| Demo brief (fictional brand) | Qloo reference brand | Verdict |
|---|---|---|
| Pica Pica Fruit Co., chili-lime fruit cups | Tajín | Qloo decided: Itzel Robles (lead 0.368) |
| Nokdu Lab, green tea toner | Innisfree | Qloo decided: Ari Tseng (lead 0.184) |
| North Kiln, stoneware tea set | Le Creuset | Qloo decided: Ingrid Brekkhus (lead 0.380) |
| Loma Coffee Gear, pour-over dripper | Blue Bottle Coffee | Close call: Itzel or Ingrid (lead 0.104 clears 0.08, but the two index measures disagree) |

Direct links: `/brief?demo=0&confirm=1` … `demo=3`. The 4 demo briefs and the 11 instant reference brands below are served from **stored Qloo results**: they return at once and never call Qloo. Other reference brands make live Qloo calls. There is no project-side cap on them, only a generous abuse guard of 20 live matches and 60 live searches per network a day, so a judging team behind one office network is not blocked. If the guard is reached, or Qloo itself answers 429 twice in a row, the site says so and links back to the demos.

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

Tools: `list_demo_briefs` → `resolve_brand` → (your user confirms a `candidate_id`) → `rank_roster` → `draft_package` → `quote_license`. `rank_roster` refuses an entity that did not come from `resolve_brand`, returns the verdict, the ranking, the agent-run trace with evidence ids, and a `view_url` that opens the same run in the browser. The server can check that the token came from that search, not that a person chose it, so an MCP run's trace says "confirmed by the calling agent".

Smoke test with the official SDK client (uses a demo brief, no live Qloo calls):

```bash
npm install
node scripts/mcp-smoke.mjs https://tastecast.swanky-models.workers.dev/mcp 2
# rank_roster: Qloo decided (decided) lead 0.38 / needs 0.08; served stored; ...
#   agent run: plan → check → tool → tool → tool → tool → tool → check → check → check → check → tool → stop
# quote_license: US$11340 charged=false approvals={"character_operator":false,"brand":false}
```

Stateless and session-free (official `@modelcontextprotocol/server` SDK, JSON responses). Tested with the SDK client, which negotiates protocol 2025-11-25, and with one raw 2026-07-28 `tools/list` request (`docs/milestone-4.md`).

## How Qloo powers it

Qloo is the decision-maker, not decoration. For each confirmed reference brand the agent calls:

1. **`/search`** to resolve the brand. The entity must be confirmed (by a person in the browser, or by the calling agent over MCP) before any insights call; the server enforces this.
2. **Audience** (`/v2/insights` demographics): the brand's age and gender profile, compared with each character's seed profile as a cosine.
3. **Taste index** (`/v2/insights`, `signal.interests.entities=<brand>`, `filter.results.entities=<all characters' seeds>`): how strongly the brand's fans like each character's artists, brands, TV and film, against a baseline of six everyday brands, as z-scores. One query scores all three characters.
4. **Context, no weight:** shared taste tags and a house-brand fit check with explainability.
5. **Package research:** tags, artists and brands for the winning character's city and age bucket. Places that are other brands' shops are left out as shoot locations, and so are hotels, bars and clubs unless the product is a hospitality one. Artists are a soundtrack direction ("X or similar"), not cleared music.

Fit score = 0.6 × taste index + 0.4 × (cosine + 1) / 2. **"Qloo decided"** needs a lead of at least 0.08 **and** the taste index must pick the same leader by z-score and by raw lift. Otherwise it is a **close call**, with the viable characters and their tradeoffs.

Where the numbers came from: the 0.08 margin and the two-measure agreement rule were written down before the sensitivity and robustness runs (`docs/milestone-2.md`). The 0.6/0.4 weights, the ±3σ mapping and the 0.02 SD floor were chosen during milestone 2 on 9 briefs, then frozen for the milestone-3 robustness run (18 briefs with a real reference brand). The three decisive demos were chosen from those runs; Blue Bottle was kept as the close call. Seeds were not re-tuned to make any demo come out a particular way. 10 of 18 real briefs end as close calls (`docs/limitations.md`).

Optional: Workers AI (Llama 3.3 70B) rewrites five copy lines once per package, in the background after the result is shown (the page swaps in the checked lines when they are ready). A checker rejects any rewrite that adds a name, a brand from the evidence, a number, first-person/testimonial wording, talent or licensing wording ("featuring", "starring", "licensed"), or a claim that the character uses the product ("daily", "routine"), or drops the disclosure or the "or similar" of a soundtrack direction. Rejected lines keep the template text, and evidence ids are never written by the model.

## Architecture

```
browser ──/api/*──┐                    ┌── Qloo Insights API (server-side key)
MCP client ─/mcp──┤  Cloudflare Worker ├── Workers KV (stored runs, cache, ledger, per-IP limits)
                  └──  Hono + service  └── Workers AI (optional checked copy rewrite)
```

- `src/agent/` the loop: resolve, rank, decision, agent-run trace. `src/content/` package, copy checker, license. `src/qloo/client.ts` cached client with ledger and budget guards. `src/mcp.ts` MCP tools over the same service as the web app. `src/server.worker.ts` Workers entry; `src/server.node.ts` local Node server.
- Details: [`docs/architecture.md`](docs/architecture.md), milestones 2–4, and [`docs/limitations.md`](docs/limitations.md).

## Run it yourself

This repo contains **no Qloo data**: no response cache, no KV seed, no entity IDs (the Qloo developer guide asks that responses are not stored in a public repository). The live demo serves stored results from its own KV. To run locally you need your own Qloo key:

```bash
npm install
export QLOO_API_KEY=...     # server side only; never committed or sent to the browser
npm run precompute          # character profiles + everyday-brand baseline (about 53 Qloo calls on a cold cache)
npm run dev                 # http://127.0.0.1:8787 ; MCP at http://127.0.0.1:8787/mcp (loopback only; HOST=0.0.0.0 to expose)
```

At this point custom briefs work, but the home page shows the demo cards without verdicts (`/api/demos` returns `verdict: null`) and character pages have no "fits", because those come from stored runs. Each demo brief costs about 13 live calls the first time it runs with your key (1 search + 12 insights; 4 more with a campaign city). To rebuild what the live site shows:

```bash
npm run build-demos         # the 4 demo briefs: about 49 calls on a cold cache (two demos share Itzel's package research)
npm run precompute-instant  # the 11 instant brands: about 10 calls per brand not already cached (the 4 demo brands reuse their runs)
npm run robustness          # character-page "fits": up to 6 calls per test brief, fewer when results are cached
npm run seed-kv             # 0 calls: writes out/kv-seed.json from ./cache for `wrangler kv bulk put` (gitignored)
```

The counts are worked out from the call pattern on an empty cache; every script prints the network calls it made. There is no cap by default. Set `QLOO_MAX_CALLS` to (calls used + allowance) if you want a hard stop for a script run; unset or 0 means no cap. Without a key the server still starts and Qloo-backed routes return a plain 503. Deploying to Workers: create a KV namespace, put its id in `wrangler.toml`, `wrangler secret put QLOO_API_KEY`, `npm run seed-kv` and bulk-put it, then `npm run deploy`.

Checks:

```bash
npm test             # 81 tests; from a clean clone 79 run and 2 are skipped (they need a local Qloo cache). No network.
npm run typecheck
npm run scan-public  # fails on cache/, .env, the key, raw Qloo JSON or UUID-shaped ids (any case, with or without dashes)
npm run hooks        # optional: run scan-public before every git push
```

A GitHub Actions workflow that runs all three checks on every push is in `docs/ci/check.yml`; copy it to `.github/workflows/` to enable it (it is not committed there because adding workflows needs a token with the `workflow` scope).

The git history was squashed before the repo was made public; the milestone docs (`docs/milestone-2.md` … `milestone-4.md`) record how it was built.

## Data and disclosure rules

- The Qloo key lives only in the server environment. Clients never see entity IDs; candidates use opaque tokens.
- Every live Qloo call is logged (timestamp, tag, path, status, latency) and counted for reporting. There is no project-side cap; the site keeps a per-network abuse guard.
- License quotes are never charged and both approvals stay false until people sign off.
- The characters are AI-generated, labelled as such on every page and in every package.
