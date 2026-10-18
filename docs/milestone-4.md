# Milestone 4: agentic surface, demo set, clarity, package quality

Written before the code, as the plan. Results are appended at the end.

## Goals

1. **TasteCast is usable as an agent tool.** A remote MCP server at `/mcp` on the same Worker uses Streamable HTTP and the official MCP TypeScript SDK v2 (`createMcpHandler`). The SDK is stateless. Checked with the SDK client (negotiates 2025-11-25) and one raw 2026-07-28 `tools/list` request (see Verification). It has five tools:
   - `list_demo_briefs`: read-only, no Qloo calls.
   - `resolve_brand`
   - `rank_roster`
   - `draft_package`
   - `quote_license`

   `rank_roster` only accepts a `candidate_id` that `resolve_brand` returned. The tool descriptions tell the calling agent to show the candidates to its user and confirm one, so the confirmation step survives over MCP. The server can only check that the token came from that search, so an MCP run's trace says "confirmed by the calling agent" rather than claiming a person chose it. The tools are thin wrappers around the HTTP routes and share one service layer, the same budget guard and the same `clientSafe` scrub.
2. **The agent run is visible.** `agentRun(match)` derives a step list from stored run data:
   - **plan:** the calls this brief needs, which depend on city, requested character and context.
   - **tool:** one per evidence step, with ev ids and cache state.
   - **confirmation:** the confirmed candidate, whether it was an exact name match, and how it was confirmed: a person in the browser, a demo link that pressed Confirm (`confirm=1`), the calling MCP agent, or unknown (a stored run opened by id).
   - **check:** margin against threshold, the z leader and lift leader, coverage, the baseline-brand guard and the niche tiebreak.
   - **package:** template or AI copy, with the checker's verdict.
   - **stop:** why the loop ended.

   The results page and `rank_roster` both render this list. The step order and the short phase descriptions are fixed text, and the plan is assembled from the brief by a template (labelled "derived from the brief, not generated"); what each step reports (entity, calls, cache hits, evidence ids, check results, verdict, package) comes from the run's data.
3. **Demo set: three decisive briefs and one close call.**
   - Tajín → Itzel, Innisfree → Ari, Le Creuset → Ingrid, all expected decisive.
   - Blue Bottle → close call, kept on purpose.
   - Decisive means "Qloo decided" under the unchanged rule (lead ≥ 0.08 and both index measures agree).
   - Every demo is verified by running it, not by reading the milestone-3 table. Seeds and weights stay as they are. Any brief that is not decisive is reported and replaced with the next best one.
   - The home page gets one-click demo cards fed by `/api/demos`, which reads the stored matches.
4. **Clarity fixes.**
   - The decision eyebrow states the actual reason. A close call says either "lead below 0.08" or "lead 0.104 clears 0.08, but the two taste measures pick different leaders".
   - Scores are shown as "fit score /100".
   - The audience term is shown as a signed cosine with a diverging bar, and the formula note says the score uses (cosine+1)/2.
   - Brief placeholders become "e.g. …" examples. An empty submit points to the demo briefs.
   - Add an SVG favicon and a 1200×630 OG image.
   - Duplicate resolve candidates with the same name get grouped and labelled. Qloo's order is kept, so the first one stays the default. Non-exact names collapse under "Other Qloo names".
5. **Package quality.**
   - Places whose Qloo categories are retail (store, shop, shopping, boutique, mall, department) are dropped as shoot locations, and so are places whose names match a brand in the evidence.
   - Profiles store place categories. They are rebuilt from the cache, which costs 0 Qloo calls.
   - Optional Workers AI rewrite (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, binding `AI`; the 8B model was planned first) of five copy lines: the angle lead and the four script beats.
   - A checker rejects any rewritten line that:
     - drops its evidence ids or adds new ones
     - adds a number
     - adds a capitalised name that is not on the allowed vocabulary (brief, character, city, evidence result names, and the original line)
     - names a brand from the evidence that the original line did not name
   - A rejected line keeps the template text. If the AI call fails or there is no binding, the whole package uses the template.
   - The result is stored once per match: one KV write, and one AI call of about 2k tokens, well inside the free daily neurons.
6. **Versioning.**
   - `SCORING_VERSION` 3 → 4 because the stored "why" text changes (the audience wording). The numbers do not change.
   - Stored demo matches are rebuilt locally from cached Qloo responses at 0 calls, apart from the two new demos.
   - Packages carry `copyVersion`. A Worker serving a stored match whose package is older rebuilds it once, then writes it back.

## Budget

- **Ledger:** 206 / 300 (live and local merged on 2026-10-16).
- **New calls:** only the two new demo matches, Tajín and Innisfree. Each needs brand tags 1, fit 3 and local package 3, so about 14 calls. The ranking calls are already cached by the robustness run.
- **Dry run first:** a run with no key lists exactly which calls are missing. The hard cap for this milestone is 16.

## Deployment order

1. Run tests, typecheck and `scan-public` locally.
2. Exercise MCP locally with the SDK client.
3. Run the demo rebuild script and seed KV. The live ledger is re-diffed first, so that no public call is lost.
4. Run `wrangler deploy`.
5. Verify live: Playwright at 1280 and 390, an MCP client against the live server, 0 UUIDs, no key, the disclosure, and `charged:false`.

## Risks

- MCP clients that judges' agents use may hit the per-network abuse guard. The demo tools cost nothing, and the guard is stated in the tool descriptions.

**Update 2026-10-18:** the self-imposed caps (300 project, 40 public) were removed at the owner's request; the call volume is small. The per-network guard was loosened from 1 ranking and 5 searches a day to 20 and 60. The ledger still counts every call.
- Workers AI output can drift. The checker is strict, and the template is always the fallback.

## Results (2026-10-16, deployed version 4d6a779a)

**Demo set** (fictional client brands, real Qloo reference brands; 8 new Qloo calls, ledger 214/300; no seeds tuned):

| Demo | Reference | Verdict | Leader | Lead (needs 0.08) | Match |
|---|---|---|---|---|---|
| Pica Pica Fruit Co. | Tajín | Qloo decided | Itzel Robles | 0.368 | 6ad95d3ab1e456ab |
| Nokdu Lab | Innisfree | Qloo decided | Ari Tseng | 0.184 | 13323d272ce6fc72 |
| North Kiln | Le Creuset | Qloo decided | Ingrid Brekkhus | 0.380 | 046fd0bbd86b65a9 |
| Loma Coffee Gear | Blue Bottle Coffee | Close call (lead clears 0.08, but index picks Itzel by z and Ingrid by lift) | Itzel / Ingrid viable | 0.104 | 66537ffb1d55f003 |

**MCP.** `/mcp` serves `list_demo_briefs`, `resolve_brand`, `rank_roster`, `draft_package`, `quote_license` via the official SDK's stateless handler (JSON responses). Checked with the SDK client against local and live (`scripts/mcp-smoke.mjs`, negotiates 2025-11-25) and with a raw 2026-07-28 `tools/list` (per-request `_meta` envelope). 0 UUIDs in any tool output; `charged:false`; disclosure present.

**Copy.** Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) rewrites 5 lines once per stored package; the checker kept 5/5, 5/5, 5/5 and 3/5 lines on the four demos. First deploy found a checker bug (possessive "Brekkhus's" flagged as a new name), fixed and re-run with COPY_VERSION 3.

**Fixed during verification.** Channel order changed the brief hash (Tajín demo stored twice). Channels are now canonicalised in `validateBrief`.

**Verification.** At the time: 52 tests, typecheck, scan-public OK. Live Playwright at 1280 and 390: 4 demo cards, all 4 demos render banner + 13–14 agent-run steps + package + license, no console errors, no UUIDs, disclosure present. That 390 px check missed a horizontal overflow on result pages (page 432–445 px wide: timeline grid items without `min-width:0`, evidence chips set to `nowrap`); fixed on 2026-10-18 and re-measured locally with headless Chrome at 390×844 on all four demo runs (`scrollWidth` = `clientWidth` = 390). The suite is now 77 tests (75 run from a clean clone, 2 need a local Qloo cache); empty submit shows a pointer to the demos; `/brief?match=<id>` reloads a stored run. `GET /mcp` from a browser redirects to `/#agents`.
