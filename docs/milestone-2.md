# Milestone 2: make the ranking Qloo-decided

## Premise under attack

In milestone 1, two of the three demo winners (coffee → Itzel, eyewear → Ari) came from the operator-niche tiebreak, not from Qloo. The combined scores were within 0.03. The question: can Qloo separate the characters, or does TasteCast have to be honest that it can't?

## Success criteria (stated before the sensitivity run)

For each demo brief:

1. **Margin.** The winner leads the runner-up by at least **0.08** on the combined score.
2. **No niche needed.** The operator-niche tiebreak does not change the order. It stays visible, but only for gaps under 0.03.
3. **Robustness.** The Qloo taste index alone picks the same winner under both normalisations: spread-adjusted (z, in baseline standard deviations) and raw lift (affinity minus baseline). If the two disagree, the result is a close call, whatever the margin says.

Across briefs:

4. **Sensitivity.** Changing the reference brand or the campaign city moves the ranking in the direction you would expect. The expectations below were written down before the calls were made.

| Test | Change | Expected |
|---|---|---|
| S1 | Gentle Monster, campaign city Mexico City | Itzel gains on Ari (the index is conditioned on Mexico City fans) |
| S2 | Le Creuset, campaign city Seoul | Ari gains; Ingrid probably still first |
| S3 | Blue Bottle Coffee, campaign city Seoul | Ari gains on Itzel |
| S4 | Carhartt WIP | Itzel first (workwear; her house brand is Dickies) |
| S5 | Barbour | Ingrid first (British heritage, older audience) |
| S6 | Innisfree | Ari first (Korean skincare, young female audience) |

Budget for this milestone: at most 60 new Qloo calls, every one logged in `cache/qloo-ledger.jsonl`.

## What was tried (56 new Qloo calls, all logged; 55 returned 200, one returned 400)

| # | Idea | Calls | Result | Kept? |
|---|---|---|---|---|
| 1 | **Reverse affinity**: among the brand's fans, how strong is the affinity for each character's seeds (one query scores all characters) | 6 | Separates Itzel and Ari on eyewear (Ari's seeds 0.96 / 0.86 against Itzel's 0.79–0.84). Raw values are compressed (0.70–0.96), and popular seeds like NewJeans score high for any brand | Yes, with a baseline |
| 2 | **Comparison panel** of 6 everyday brands (Starbucks, Nike, Uniqlo, IKEA, Patagonia, L.L.Bean) as a per-seed baseline, instead of 3 house brands | 5 searches + 12 + 1 | Removes the popularity bias: each seed is scored as lift and z against its own baseline | Yes, as the core of the taste index |
| 3 | **City-conditioned brand affinity**: character seeds + home city, brand vs the panel | 9 | Too sparse: in Mexico City and London Qloo returned only 1–2 of the 7 brands, and Le Creuset not at all in Mexico City | No |
| 4 | **Brand audience per city** (location signal only) | 3 | Every brand scores 0.98–1.00 in every city. No contrast | No |
| 5 | **Weighted tag matching**: the brand's fans' affinity for each character's taste tags (`filter.results.tags`) | 2 (one 400: take > 50) | Returns 18 of 48 tags. Gentle Monster's fans score Ingrid's generic adjectives (Experimental, Dreamy) highest, which contradicts both the entity signal and the audience. The tag vocabulary is too generic and the characters share none of their top tags | No; tag overlap stays as zero-weight context |
| 6 | **City-conditioned taste index** (sensitivity S1–S3, first version) | 6 | Moved the expected way in all three cases, but on a different scale: every seed jumped +2 to +5σ against the global baseline, and Qloo returned no affinity at all for Itzel's seeds among Seoul fans (which first scored as a neutral 0σ) | Changed: the city is now a no-weight, same-query context line |
| 7 | **New brands** (sensitivity S4–S6) | 3 searches + 3 demographics + 6 | See below | – |
| 8 | **Seed refinement** for Itzel and Ari | 0 | Not needed. The taste index separates them where it matters (eyewear 3.33σ vs 1.94σ, Innisfree 1.96σ vs 0.39σ, coffee 0.03σ vs 1.22σ). Their audience vectors stay near-identical for youth brands. **No seed was changed; the approved identities are untouched** | – |

## Before and after on the three demo briefs

| Brief (reference) | Milestone 1: top two by Qloo score | Gap | Winner shown | Milestone 2: top two | Gap | Index leader z / lift | Decision |
|---|---|---|---|---|---|---|---|
| Loma (Blue Bottle Coffee) | Ari 0.288, Itzel 0.273 | 0.015 | Itzel, **by niche** | Itzel 0.640, Ari 0.521 | **0.119** | Itzel / **Ingrid** | **Close call**: Itzel and Ingrid shown as viable |
| Kōen (Gentle Monster) | Itzel 0.508, Ari 0.506 | 0.002 | Ari, **by niche** | Ari 0.845, Itzel 0.740 | **0.105** | Ari / Ari | **Qloo decided** |
| North Kiln (Le Creuset) | Ingrid 0.307, Itzel 0.208 | 0.099 | Ingrid | Ingrid 0.659, Ari 0.211 | **0.448** | Ingrid / Ingrid | **Qloo decided** |

Against the success criteria:
- Margin ≥ 0.08: met on 3 of 3.
- No niche needed: met on 3 of 3 (the tiebreak never fires).
- Robustness: met on 2 of 3. Coffee fails. The spread-adjusted index picks Itzel (+1.22σ), but raw lift picks Ingrid (+0.026 vs +0.010). Itzel's lead comes mostly from the audience term and from her seeds' tight baseline. The honest answer is that Qloo does not clearly separate Itzel and Ingrid for Blue Bottle. TasteCast now says so and shows both, with their tradeoffs.

## Sensitivity (expectations were written before these calls)

| Test | Expected | Result | As expected? |
|---|---|---|---|
| S4 Carhartt WIP (Qloo resolved "Carhartt") | Itzel first | Itzel 0.593 > Ingrid 0.504 > Ari 0.451, **close** (z leader Ingrid, lift leader Itzel) | Yes, winner; low confidence |
| S5 Barbour | Ingrid first | Ingrid 0.833 > Ari 0.479, **clear** | Yes |
| S6 Innisfree | Ari first | Ari 0.859 > Itzel 0.682, **clear** | Yes |
| S1 Gentle Monster @Mexico City | Itzel gains | In-city line: Itzel's seeds first (0.904, tied with Ari's). First-version city score: Itzel z 5.62 vs Ari 4.76 | Direction yes; score unchanged by design |
| S2 Le Creuset @Seoul | Ari gains, Ingrid still first | Ingrid stays first. In-city line: Ari first (0.846 vs 0.829); Qloo returned nothing for Itzel | Yes |
| S3 Blue Bottle @Seoul | Ari gains on Itzel | In-city line: Ari first (0.879); Qloo returned nothing for Itzel | Yes |

## Product framing

TasteCast shows a decision banner above the ranking:
- **Qloo decided**: the lead clears 0.08 and both index measures agree.
- **Close call**: the viable characters are named, and each gets one line saying which Qloo signal favours them (spread-adjusted index, raw lift, or audience). The operator chooses. The niche tiebreak only reorders gaps under 0.03, and when it does, it is labelled as operator data.

## Limits of this evidence

- Three demo briefs and six sensitivity briefs are not a validation set.
- The baseline panel (6 brands) and the weights (0.6 / 0.4) were chosen during this milestone, not before it.
- The SD floor (0.02) was added because two seeds have very tight baselines (0.018).
- TV and film seeds (Ari's Twenty Five Twenty One, Ingrid's Phantom Thread) are not in the index. Covering them would take 2 more calls per brief.
