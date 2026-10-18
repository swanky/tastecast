# TasteCast architecture (build phase, 2026-10-15)

## 1. Sharpened problem

A small brand (or an agency acting for one) wants a disclosed endorsement from a virtual character. It has to know three things before paying anything:

1. **Which of our characters fits the brand's audience?** Answered with Qloo evidence, not vibes.
2. **What should the content look like in that character's city?** Local angles, places and music that Qloo ties to the character and the city.
3. **What would the license cost and cover?** A machine-readable quote. The price is displayed and never charged.

**Done for this milestone:** on a local server, a person enters a brief, confirms the brand entity Qloo found, and gets back:
- ranked characters with per-claim Qloo evidence;
- an endorsement package as JSON, ending with `#ad · AI-generated character`;
- a license quote at `GET /api/license/:id`.

Everything is proven with tests, live runs and a headless-Chrome screenshot.

**Out of scope for this milestone:** LLM writing, image generation, payments, hosting, the public repo, and the LLM-only comparison column. Package text came from templates filled with Qloo results.

**Later (Milestone 4, live now):** Workers AI (Llama 3.3 70B) can rewrite five template lines once per stored package, using only each line's cited Qloo evidence. A checker rejects any rewrite that adds a name, an unmentioned evidence brand or a number, uses first-person or testimonial wording, writes evidence ids, drops the disclosure, or runs past 260 characters. A rejected line keeps the template text, and a failed AI call leaves the whole package on the template. Hosting (Cloudflare Workers) and the public repo also shipped. See [limitations.md](limitations.md) item 14 and [milestone-4.md](milestone-4.md).

## 2. Decisions and deviations from the roadmap

The roadmap (`roadmap-plan.md`) and the API spike notes (`spike-results-20261015.md`) are planning documents in the private photography repo; they are not in this repo.

| Topic | Roadmap said | Built | Why |
| --- | --- | --- | --- |
| Framework | Next.js | **Hono + static HTML/JS** | Swanky asked for portability: the same `createApp()` runs on Node (local) and Cloudflare Workers Free through Hono adapters (it is deployed on Workers). No framework build step. |
| Brief parsing | LLM picks entity candidates | **Structured form + `/search`** | Kept after Workers AI was added: no LLM picks entities. The user confirms the Qloo entity, so every ID comes from Qloo. |
| Package text | LLM writes it with source IDs | **Templates filled from Qloo results, then an optional checked Workers AI rewrite** | Every line carries a source evidence ID, always taken from the template line. The rewrite sees only that line's evidence; the checker rejects added names, brands, numbers, first-person wording or a dropped disclosure, and rejected lines keep the template text. |
| Repo | `swanky/tastecast`, public | **Local git only** at this milestone | Public repo and host were Swanky's decision. Later published as `swanky/tastecast` and hosted on Cloudflare Workers. |

## 3. Product loop (from the spike's recommended usage)

Precomputed once per character (`npm run precompute`, cached, gitignored):

| Step | Qloo call | Output |
| --- | --- | --- |
| P1 | `/search` per seed (4 per character) | seed entity IDs |
| P2 | `/v2/insights filter.type=urn:demographics` with all 12 seeds (1 call) | per-seed age/gender vector, averaged per character |
| P3 | `urn:tag` + seeds + `filter.tag.types` (style, aesthetic, personal_style, lifestyle) + `signal.location.query=<home city>` | character aesthetic tags |
| P3b | `urn:tag` + seeds + `filter.tag.types`, **no location** | taste tags, compared like-for-like with the brand tags (L3). Added after the first live run showed city-biased tags overlapped 0–10% with every brand |
| P4 | `urn:entity:place` + seeds + `filter.location.query=<home city>` | shoot location candidates |
| Drift | derived from P2 | stated age bucket compared with the seed-averaged peak bucket |

Live loop per brief, 7 to 8 calls, all cached by the sorted query string:

| Step | Qloo call | Used for |
| --- | --- | --- |
| L1 resolve | `/search?query=<reference brand>&types=urn:entity:brand` | candidates; **the user confirms one before any insights call** |
| L2 audience | `urn:demographics` + brand | cosine with each character's vector |
| L2b taste index (x2) | `urn:entity:artist` and `urn:entity:brand`, `signal.interests.entities=<brand>`, `filter.results.entities=<all character seeds>` | per-seed affinity among the brand's fans vs the everyday-brand baseline |
| L3 brand tags | `urn:tag` + brand + `filter.tag.types` | tag overlap with each character |
| L4 fit (x3) | `urn:entity:brand`, `signal.interests.entities=<character seeds>`, `filter.results.entities=<brand + 3 house brands>`, `feature.explainability=true` | brand rank against the house brands; the seed that contributed most |
| L5 local angle | `urn:tag` + top character seeds + `signal.location.query=<city>` + `filter.tag.types` | content angles |
| L6 local picks | `urn:entity:artist` + top character seeds + `signal.location.query` + `signal.demographics.age` | soundtrack picks |
| places | from P4 cache | shot list locations |

**Ranking score, milestone 2 (deterministic, all parts shown in the UI):** `0.6 × taste index + 0.4 × audience`.
- **Taste index (L2b, 2 calls per brief).** Qloo is asked: among fans of the reference brand, what is the affinity for each character's artist and brand seeds (`filter.type=urn:entity:artist|brand`, `signal.interests.entities=<brand>`, `filter.results.entities=<all characters' seeds>`)? Every character is scored inside the same query. Each seed is compared with its own baseline: the mean and SD of the same affinity among fans of six everyday brands (Starbucks, Nike, Uniqlo, IKEA, Patagonia, L.L.Bean), precomputed once (6 searches + 12 calls). z = (affinity − baseline mean) / max(SD, 0.02). The character's index is the mean z over covered seeds, mapped onto 0..1 as 0.5 + z/6, clamped (±3σ saturates).
- audience = (cosine + 1) / 2 of the 6 age buckets + female affinity.
- Taste-tag overlap (L3) and house-brand fit (L4) are still computed and shown as **context with zero weight**.
- **Decision.** "Qloo decided" only if the lead is ≥ 0.08 **and** the taste index picks the same leader under z and under raw lift. Otherwise "Close call": the UI lists the viable characters with their tradeoffs.
- **Niche tiebreak.** Operator data, labelled as such. It only acts when the gap is under 0.03.
- **Campaign city.** It does not change the score. It adds a same-query in-city line (the same reverse question with `signal.location.query`) as context. Reason: see `docs/milestone-2.md`.

Milestone-1 formula, kept for the record: `0.5 × audience + 0.3 × tag overlap + 0.2 × fit` (fit against 3 house brands).

Scores are relative signals, not purchase probability (see `docs/limitations.md` later).

## 3b. Pages (milestone 3)

| Route | File | Data |
|---|---|---|
| `/` | `public/index.html` | `GET /api/characters` |
| `/c/:slug` | `public/character.html` + `character.js` | `GET /api/characters/:slug` (names and derived numbers only; never Qloo entity IDs) |
| `/brief[?character=slug][&demo=N&confirm=1]` | `public/brief.html` + `brief.js` | `/api/resolve`, `/api/match`, `/api/license/:id` |

- Shared chrome, disclosures and helpers live in `public/common.js`. Styles are in `public/styles.css`: an editorial system with Fraunces (display) and DM Sans (UI), both SIL OFL and self-hosted.
- `public/assets/` holds web-size character images (≤1280 px, CC BY-NC 4.0, see `LICENSE-images`) and the OFL fonts with their licenses; `scripts/build-assets.py` rebuilds them from the source library.
- The brief takes an optional `character`. Every match still ranks all three; `featured` says which one the package is built for and where she ranks.
- The taste index uses all four seed types by default (artist, brand, TV, film); see `docs/milestone-3.md`.

## 4. Module structure

```
src/
  qloo/types.ts        Qloo response types used by the app (Entity, Tag, DemographicsRow, Explainability)
  qloo/client.ts       QlooClient: GET only, X-Api-Key from env, redirect: 'manual', one retry on 429 after Retry-After, optional caps, call log;
                       caching is inside the client: cacheKey(path, params) = path + sorted query, stored in KV under qloo:<key>
  store/kv.ts          KV interface; MemoryKV (tests); FileKV (Node, ./cache, gitignored); store/workers-kv.ts (Workers KV); store/ip-limit.ts (per-network daily limit)
  domain/characters.ts static character definitions (English copy, seeds by name/type, city, age bucket, disclosure)
  domain/profile.ts    CharacterProfile type + buildProfiles() (P1–P4) + driftCheck()
  domain/score.ts      cosine, tagOverlap, fitScore, combine (pure, unit tested)
  agent/match.ts       runMatch(brief, brandId): L2–L6, returns MatchResult with an evidence ledger
  agent/evidence.ts    Evidence entries: id, endpoint, params (no key), top result names, timestamp
  content/package.ts   buildPackage(match) -> EndorsementPackage; every line has sourceIds; ends with the disclosure
  content/license.ts   quote(package, brief) -> LicenseQuote (price displayed, charged: false)
  app.ts               createApp(deps): Hono routes
  agent/run.ts         agentRun(): the agent-run trace shown on the results page and returned by rank_roster
  agent/affinity.ts    taste index (reverse affinity against the everyday-brand baseline)
  content/copywriter.ts optional checked Workers AI rewrite of five copy lines
  content/places.ts    shoot-location filter (other brands' shops, department stores, hotels/bars/clubs for non-hospitality products)
  mcp.ts               MCP tools over the same service as the HTTP routes
  server.node.ts       Node entry: FileKV, serves public/, binds 127.0.0.1
  server.worker.ts     Cloudflare Workers entry: Workers KV, per-network abuse guard, branded 404
scripts/precompute.ts  builds the character profiles and the baseline in ./cache (gitignored)
scripts/build-demos.ts, precompute-instant.ts, robustness.ts, seed-kv.mjs  rebuild the stored runs (see README)
scripts/scan-public.mjs fails on key values, cache/ or private/ files, JSON with entity_id, or UUID-shaped ids
public/                index.html, brief.*, character.*, common.js, styles.css, assets/ (web-size images + OFL fonts)
test/                  vitest unit tests
```

## 5. API contracts

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/health` | none | `200 {"ok":true,"qloo":"reachable"\|"unknown","profiles":3}`. Returns `503 {"ok":false,"error":"QLOO_API_KEY not set"}` without the key, with no stack trace. |
| `GET /api/characters` | none | `[{slug,name,city,age,bio,signature,images[],seeds[{name,type}],drift}]`. No entity IDs reach the client. |
| `POST /api/resolve` | `{"query":"Gentle Monster"}` | `{candidates:[{id,name,disambiguation,popularity,exact,preselected,duplicateOf?}],evidence}`. `id` is an opaque token that the server maps back to the Qloo entity; the confirm step sends it back. No entity IDs reach the client. |
| `POST /api/match` | `{"brief":{brandName,referenceQuery,category,channels[],durationMonths,city?},"candidateId"}` | `MatchResult {id, brief, brand:{name}, ranking:[{slug,name,score,parts,evidenceIds,why[]}], package, evidence[]}` |
| `GET /api/package/:id` | none | the stored `MatchResult.package` |
| `GET /api/instant` | none | `[{name,query,category,stored,verdict:{level,reason,leader,viable[]}}]`: the instant reference brands with their stored generic-brief verdict. |
| `GET /api/s5/:id` | none | `{ok:true,available:false}` unless the `S5_PANEL` flag is `on` and an LLM-only comparison is stored; then the LLM-only package for that demo, with `results:null` until a rating exists. |
| `GET /api/license/:id` | none | `LicenseQuote {id, licensor, licensee, character, usage, channels, duration, price_quote:{amount,currency,basis,charged:false}, approvals:{character_operator:false,brand:false}, disclosure, qloo_evidence:[evidenceId], terms_url:null}` |

Evidence entries the client sees carry the endpoint, the parameter **names and display values** (entity IDs replaced by display names), and the top result names.

## 6. Security and data rules

- `QLOO_API_KEY` is read only on the server (`process.env` or the Workers `env`). It never appears in responses, logs or the client bundle; the client calls `/api/*` only.
- Raw Qloo responses and derived profiles live in `cache/`, which is gitignored. `scripts/scan-public.mjs` runs as a local pre-push hook after `npm run hooks`; `docs/ci/check.yml` is a ready GitHub Actions workflow (copy it to `.github/workflows/` to run it on every push).
- The call log `cache/qloo-ledger.jsonl` records the timestamp, tag, path, status and latency only.
- Limits: there is no project-side cap. `QLOO_MAX_CALLS` and `QLOO_PUBLIC_MAX_CALLS` are optional (unset or 0 means no cap) and are not set in `wrangler.toml`. The ledger still counts every network call, and `/api/health` reports the count and the limits in force. The deployed site keeps a per-network daily abuse guard (20 live matches, 60 live searches). A Qloo 429 is retried once after Retry-After; a second 429 returns the friendly demo-briefs answer. The client never retries a 401 or 403.
- Fictional brands only in the demo. The brand's real **reference** brand is the Qloo seed, and the UI says so.
- Every endorsement output carries `#ad · AI-generated character`.

## 7. Verification plan for this milestone

1. **Unit (vitest):** cache key; client header, redirect block, 429 retry and budget guard (fetch mocked); score functions; package lines all carry sourceIds and the disclosure; license `charged:false`; scan-public detects a fake `cache/x.json`.
2. **Live:** `npm run precompute` (logged calls), then 3 demo briefs end to end through the HTTP API, then a repeat run served from cache (0 new calls). Also an unknown brand (no candidates) and a no-key 503.
3. **Screenshot:** headless Chrome of the result page for demo brief 1, plus the license JSON.
4. **Security:** grep the repo and the served HTML/JS for the key value; `git status` shows no cache files.
