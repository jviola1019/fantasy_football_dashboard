# Repository audit — what is reachable, and what was removed

2026-08-24. Reproduce with `npx tsx scripts/audit-reachability.ts`.

The question is not "what is never imported" — that finds leaves and misses
whole subtrees, because a module imported only by another dead module looks
referenced. The question is **reachability from something that actually runs**:
Next entry points, `scripts/`, and the test suites.

---

## Before and after

| | before | after |
|---|---|---|
| non-test `src` modules | 215 | 211 |
| reached by the app | 202 (25,651 lines) | 202 (25,825 lines) |
| reached only by scripts | 7 (1,585 lines) | 8 (1,699 lines) |
| reached only by tests | 5 (443 lines) | **1 (14 lines)** |
| unreachable | 1 (93 lines) | **0** |

**540 lines deleted**, one duplicate implementation collapsed, and one silent
functional defect found and fixed along the way.

---

## Removed

| module | lines | why |
|---|---|---|
| `components/ui/card.tsx` | 92 | Unreachable. A shadcn component nothing ever imported. |
| `lib/weather/openmeteo.ts` | 166 | Reachable only from its own test. |
| `lib/weather/stadiums.ts` | 52 | Only consumer was `openmeteo.ts`. |
| `lib/weather/openmeteo.test.ts` | 53 | Its subject is gone. |
| `lib/ktc/match.ts` | 94 | Superseded — see below. |
| `lib/ktc/match.test.ts` | 83 | Its subject is gone. |

### Weather was a claim with nothing behind it

`CLAUDE.md` listed **open-meteo — weather** among the product's data sources.
Nothing in `src/components` or `src/app` referenced weather in any form: no
panel, no field, no governance assumption. 271 lines of schema, fetching and
stadium coordinates that had never run outside a test.

Deleted **and the guardrails corrected in the same commit**. A data source listed
in CLAUDE.md is a claim about the product, and leaving the claim while the code
sits unwired is the documentation equivalent of a green check that isn't
checking. Git history has it if it is ever wired for real.

### `ktc/match.ts` was superseded, and taught us something on the way out

It resolved a player record to a KeepTradeCut entry through a three-tier
normalised index. Nothing imported it. The generic problem it solved —
reconciling one source's player names against another's — is now solved by
`keyValuesBySleeperId` in `trade/values.ts`, in the direction the code actually
needs.

**Reading it before deleting it caught a real bug in its replacement.** It
carried a position map noting that KTC writes defenses as `DST` while the
product writes `DEF`. The new resolver compared raw position strings, so every
defense would have fallen to the weakest name-only tier where "Ravens" and
"Baltimore Ravens" may never meet. `canonicalPosition()` and two tests exist
because that module was read rather than trusted to be redundant.

---

## Kept, with reasons

**8 modules reachable only from `scripts/` (1,699 lines).** Not dead: each is the
implementation behind a CI gate or a model harness — `docSecrets` behind
`check:secrets`, `lockfileAdvisories` and `vulnExceptions` behind their scans,
`smokeRoutes` behind `npm run smoke`, `pointsCurve` / `logistic` /
`seasonCalibration` behind the holdout protocols, and now `trade/backtest`.

**1 module reachable only from tests (14 lines).** `components/systems.ts` is the
nine-system naming contract that `visualContract.test.ts` locks. It is a
contract, not architecture, and it is doing its job.

### One duplicate implementation collapsed

`scripts/verify-inseason-fidelity.ts` carried its own mid-rank Spearman under a
comment reading *"matching `src/lib/trade/backtest.ts` after P2-4"*. Two
implementations of one statistic, with a comment asserting they agree, is a drift
hazard wearing a disclaimer — and this script is the CI gate proving the shipped
ranker reproduces protocol 5.

It imports the real one now. Verified: the gate still reports gain **0.0195**
against protocol 5's published 0.0195, difference **0.000006**, tolerance
0.0002 — unchanged. That also gave `trade/backtest.ts` the non-test caller it
should always have had.

---

## The defect the audit found

Chasing why `ktc/match.ts` was unused surfaced something worse than dead code.

`trade/values.ts` has three valuation providers and had **two keying schemes**:

| provider | keyed by | `sleeperId` | `espnId` |
|---|---|---|---|
| FantasyCalc (primary) | Sleeper id | set | set |
| KeepTradeCut (secondary) | `position-name` | **null** | **null** |
| DynastyProcess (tertiary) | `position-name` | **null** | **null** |

`normalizeSleeperTrades` looks up `valueMap.get(playerId)` with a **Sleeper id**,
and `indexByEspnId` re-keys by `espnId`. So whenever FantasyCalc was unavailable
and the code fell through to either backup, **every lookup missed and every
league trade graded as though both sides were empty** — not a wrong number, an
absent one.

`loadLeagueTrades` guards on `values.size === 0`. The map was not empty. It was
populated, and keyed by something nobody asked for, so the guard passed and
grading proceeded on nothing.

**Why it survived.** Every test in `transactions.test.ts` builds the value map by
hand with Sleeper-id keys. Correct for testing that consumer in isolation, and it
meant the provider→consumer boundary was never crossed by a test.

**Why raw lowercase was never going to work.** Measured against the cached
FantasyPros snapshot: **59 of 527 players (11.2%)** have a name whose normalised
form differs from its raw lowercase — Ja'Marr Chase, A.J. Brown, Amon-Ra
St. Brown, Marvin Harrison Jr., Kenneth Walker III, De'Von Achane. Two sources
spelling the same player differently is the normal case, not the edge case.

**Fixed** by `keyValuesBySleeperId`, which reuses the same normaliser, team
aliasing and three-tier fallback as the FantasyPros matcher. Ten tests, written
against the current code first and confirmed failing (3 of 4 red) before the fix
existed. Unmatched entries keep their original key, so the trade pool — which is
rendered by iterating `.values()` — loses nobody.

The governance layer had been honest about this all along: both fallbacks
declared `missingFields: ["sleeperId"]`. That disclosure is now **derived from
what actually resolved** rather than assumed, and the assumptions state the
resolved count, because claiming ids are missing when they are present understates
the data as surely as the reverse overstates it.

### The ESPN half, measured

`indexByEspnId` depends on `espn_id` surviving in the Sleeper catalog payload.
The schema is `.passthrough()`, so it should — and rather than assume it,
measured against the live endpoint:

```
players in payload:            12,224
carrying espn_id:               6,736  (55.1%)
QB/RB/WR/TE:                    4,040
  of those carrying espn_id:    2,210  (54.7%)
```

So the ESPN trade path now resolves roughly **half** the catalog on the fallback
providers, against none before. That is an improvement and not a fix: an ESPN
league falling back to KTC or DynastyProcess will still fail to price about half
the players in a trade. The Sleeper path is unaffected — `player_id` is the map
key and is present for every entry.

Worth noting the 55% includes long-retired players (the sample above returned
Roddy White and GJ Kinne), so the rate among currently rostered players is
probably higher than the headline. Not measured; it would need an active-roster
filter, and the number that matters is per-league.
