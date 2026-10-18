# Milestone 3: character pages and robustness

## Robustness plan (written before the calls)

Twelve new reference brands across six categories, plus one fictional brand. The expected winner is our guess before running, based on each character's backstory and city. It is not Qloo data.

| # | Category | Reference brand | Expected winner | Why we expect it |
|---|---|---|---|---|
| R1 | beauty | Glossier | Ari | young, female, social-first |
| R2 | beauty | Aesop | Ingrid | design-led, older, quiet luxury |
| R3 | outdoor | The North Face | Itzel | streetwear crossover, young |
| R4 | outdoor | Arc'teryx | Ari | Seoul gorpcore |
| R5 | music/audio | Bang & Olufsen | Ingrid | heritage design, older |
| R6 | music/audio | Fender | Itzel | guitar music, her seeds are guitar-led |
| R7 | fashion | Stussy | Itzel | skate and streetwear, Dickies house brand |
| R8 | fashion | Acne Studios | Ari | Scandinavian minimal, beloved in Seoul |
| R9 | food | Tajín | Itzel | Mexican |
| R10 | food | Nongshim | Ari | Korean |
| R11 | food | Fortnum & Mason | Ingrid | London, older |
| R12 | home | Muji | Ari | minimal, East Asian |
| U1 | – | Loma Coffee Gear (fictional) | no candidates | unknown-brand path |

Recorded for every brief:
- Qloo decided or Close call;
- whether the winner matches the expectation;
- whether adding Ari's TV seed and Ingrid's film seed to the taste index changes the winner or the decision;
- failures: unknown brand, fuzzy name match, empty or partial results.

## Results (98 new Qloo calls this round, all 200; cumulative 205 of the 300 cap)

| Calls | What |
|---|---|
| 12 | Everyday-brand baseline for the TV and film seeds (6 brands × 2 types) |
| 12 | TV and film taste index for the 6 briefs already cached (3 demos, Carhartt, Barbour, Innisfree) |
| 72 | 12 new briefs × (search 1 + demographics 1 + taste index 4) |
| 2 | Fictional-brand test: search 1, plus 1 demographics call for Starbucks that was wasted before the exact-match fix (its taste-index calls were already cached from the baseline) |

### Robustness table (taste index with all four seed types, the app default from this milestone)

| # | Category | Reference (Qloo match) | Expected | Winner | Decision | Lead | Index leader (z / lift) | Same winner as expected? |
|---|---|---|---|---|---|---|---|---|
| R1 | beauty | Glossier | Ari | Itzel | Close | 0.091 | Itzel / Ari | No |
| R2 | beauty | Aesop | Ingrid | Ingrid | Close | 0.005 | Ingrid / Ingrid | Yes |
| R3 | outdoor | The North Face | Itzel | Itzel | Close | 0.010 | Ingrid / Ingrid | Yes (flipped from Ingrid when TV/film were added) |
| R4 | outdoor | Arc'teryx | Ari | Ingrid | Close | 0.093 | Itzel / Itzel | No |
| R5 | music/audio | Bang & Olufsen | Ingrid | Ingrid | Close | 0.060 | Ingrid / Ingrid | Yes |
| R6 | music/audio | Fender | Itzel | Ingrid | **Qloo decided** | 0.306 | Ingrid / Ingrid | No |
| R7 | fashion | Stüssy | Itzel | Itzel | **Qloo decided** | 0.190 | Itzel / Itzel | Yes |
| R8 | fashion | Acne Studios | Ari | Itzel | Close | 0.057 | Ingrid / Ingrid | No |
| R9 | food | Tajín | Itzel | Itzel | **Qloo decided** | 0.368 | Itzel / Itzel | Yes |
| R10 | food | Nongshim | Ari | Ari | **Qloo decided** | 0.130 | Ari / Ari | Yes |
| R11 | food | Fortnum & Mason | Ingrid | Ingrid | **Qloo decided** | 0.099 | Ingrid / Ingrid | Yes |
| R12 | home | Muji | Ari | Ari | Close | 0.047 | Ari / Ari | Yes |
| U1 | – | Loma Coffee Gear (fictional) | no match | – | – | – | – | Qloo returned near names (Starbucks, Blue Bottle Coffee, Black Rifle), not an empty list |

Earlier briefs, re-run with all four seed types:

| Brief | Before (artist + brand seeds) | After (all four) |
|---|---|---|
| D1 Blue Bottle Coffee | Itzel, close, 0.119 | Itzel, close, 0.104 |
| D2 Gentle Monster | Ari, **clear**, 0.105 | Ari, **close**, 0.071 |
| D3 Le Creuset | Ingrid, clear, 0.448 | Ingrid, clear, 0.380 |
| S4 Carhartt WIP (Qloo: "Carhartt") | Itzel, close, 0.089 | Itzel, close, 0.083 |
| S5 Barbour | Ingrid, clear, 0.354 | Ingrid, clear, 0.296 |
| S6 Innisfree | Ari, clear, 0.177 | Ari, clear, 0.184 |

### Rates (18 briefs with a real reference brand)

| | Artist + brand seeds | All four seed types |
|---|---|---|
| Seeds with Qloo data | 10 of 12 on every brief | **12 of 12 on every brief** |
| Qloo decided | 9 / 18 (50%) | 8 / 18 (44%) |
| Close call | 9 / 18 | 10 / 18 |
| Winner as we expected | 13 / 18 | 14 / 18 |
| Qloo-decided winner as we expected | 9 / 9 | 7 / 8 (Fender → Ingrid is the exception) |
| Niche tiebreak needed | 0 | 0 |

New briefs only (R1–R12, all four types): 5 of 12 Qloo decided, 7 close calls.

**TV and film seeds: included.** Coverage goes from 83% to 100% of seeds on every brief, at 2 more calls per brief. The TV and film seeds behave sensibly: Ari's K-drama scores +2.24σ for Innisfree and +1.57σ for Nongshim; Ingrid's *Phantom Thread* scores −3.03σ for Tajín and +2.77σ for Acne Studios. The cost is one Qloo-decided brief fewer (Gentle Monster drops to 0.071). Switching back is one constant (`INDEX_TYPES` in `src/agent/affinity.ts`).

**Flips** between the two variants: R3 changes winner (Ingrid → Itzel, both close calls). D2 and R5 go from clear to close. R6 goes from close to clear.

**Disagreements with our expectations** are not bugs, but they are worth knowing:
- Fender → Ingrid: Ingrid wins on audience similarity (Fender's age and gender profile against hers: cosine +0.82, against −0.42 for Ari and −0.20 for Itzel). Her taste index is weak (+0.37σ, raw lift −0.008), but no one else's is stronger, so both measures still pick her.
- Arc'teryx → Ingrid on audience, while the index prefers Itzel.
- Glossier and Acne Studios → Itzel.
- Ari's Qloo profile reads older than her stated age (her Drift Check warning), so Qloo rarely picks her for young-skewing brands.

### Failures and bugs found and fixed

1. **Fuzzy search results looked like a match.** For a brand Qloo doesn't know, `/search` returns nearest names (Starbucks for "Loma Coffee Gear"), not an empty list. The first robustness run silently ranked Starbucks. Fixed:
   - candidates now carry `exact`, and the UI marks exact names;
   - when no candidate is exact, the confirm step warns "No exact match… these are Qloo's nearest names, not your brand";
   - the robustness script records a failure instead of ranking.
2. **A baseline brand used as the reference.** Starbucks is in the everyday-brand panel, so its taste index is about 0 by construction. The decision is now forced to Close call with an explanation.
3. **Key redaction mangled responses when the key was very short** (test keys such as `k` removed every "k"). Redaction now only applies to keys of 8 or more characters.
4. **Character pages:**
   - duplicate Qloo tag names (Rugged ×2) are now shown once;
   - lowercase tags are sentence-cased;
   - street addresses are no longer shown as neighbourhoods;
   - the hero image no longer repeats as the first portfolio tile;
   - a fictional brief no longer appears in "strongest fits";
   - fixed horizontal overflow at phone width (grid items had no `min-width: 0`; disclosure chips no longer use `nowrap`);
   - fixed the strap typo ("not a real persons").
5. **No empty or partial Qloo results** on any of the 18 briefs. All four seed types returned an affinity every time.

## Character showcase (TC-5)

- `/` is the roster: three covers with No., city, age, and an "AI character" label on every image.
- `/c/<slug>` is the character page. It shows, in order:
  - hero portrait;
  - name, role, home city, age and drift status;
  - the disclosures "Original AI character, not a real person" and "#ad · AI-generated character on every endorsement";
  - backstory and signature;
  - the approved v5 portfolio (6 images);
  - identity references (the v3 full-length reference and the v5 turnaround sheet);
  - the Qloo taste profile: audience skew, seeds, taste tags, home-city tags and places, and the strongest and weakest fits across the test briefs;
  - the Drift Check panel: a warning on Ari only; Itzel's is labelled "within tolerance";
  - two links to "Brief <name>".
- `/brief?character=<slug>` pre-selects the character. All three are still ranked. The verdict says where the requested character ranks, and the package and license are built for her.
- Images and fonts are built by `scripts/build-assets.py` into `public/assets/`. At this milestone that folder was gitignored; since the public repo it is tracked (web-size JPEGs, CC BY-NC 4.0, and OFL fonts). `src/domain/characters.ts` holds file names, titles and alt text.
