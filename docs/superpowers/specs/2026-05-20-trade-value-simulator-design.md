# Trade Value Simulator — Design Spec

**Date:** 2026-05-20
**Status:** Approved (brainstorming complete; pending implementation plan)
**Sprint goal:** Replace the abstract, incorrect trade evaluator with a statistically validated, backtested, professional trade value simulator.

## 1. Problem

The Trade Center grades trades by summing `reputationEdge` — an internal *mispricing* score derived from abstract 0–100 `trueValue`/`perceivedValue` fields. Those fields are fixture/placeholder data, not real player worth, and `reputationEdge` measures market inefficiency rather than value. Result: an elite RB (Jahmyr Gibbs) traded for a mid-tier QB (Caleb Williams) grades as "even." The panel also only shows two hardcoded demo trades (`mockTradeFeed`) and offers no way to build or test a trade.

## 2. Goals

- Grade trades on **real, comparable player value**.
- An **interactive trade builder**: pick players for each side, see live value totals and a fairness verdict.
- Grade **real recent transactions** from a connected league.
- **Auto-detect league format** (PPR, 1QB/Superflex, team count) from connected-league settings.
- **Verify league settings** at league-add time.
- **Statistically validate and backtest** the value model; ship a calibration doc.
- Free data sources only; honor the no-synthetic-data governance principle.

## 3. Non-goals

3+ team trades; dynasty-mode toggle (redraft only for v1); draft-pick valuation; rebuilding panels other than Trade Center.

## 4. Approach

A standalone `src/lib/trade/` module mirroring the existing adapter pattern (`sleeper/`, `espn/`, `weather/`, `news/`), each governance-wrapped. Trade Center becomes an interactive client island fed by a server action. The core `PlayerMarketRecord` schema is untouched.

Rejected alternatives:
- **(B)** Baking value into `PlayerMarketRecord` / `normalize.ts` — pollutes the central schema and forces one global format.
- **(C)** Browser-side FantasyCalc fetch — no governance envelope, no server cache, CORS-exposed.

## 5. Data sources (all free, no API key)

- **FantasyCalc API (primary)** — `GET https://api.fantasycalc.com/values/current?isDynasty=false&numQbs={1|2}&numTeams={n}&ppr={0|0.5|1}`. Returns a JSON array; per record: `player` { name, position, maybeTeam, sleeperId, espnId }, `value`, `redraftValue`, `overallRank`, `positionRank`, `trend30Day`, `maybeAdp`. Market-derived (aggregated real league trades), cardinal scale, redraft-aware.
- **DynastyProcess `values.csv` (fallback)** — `https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv`. Columns: player, pos, team, age, ecr_1qb, ecr_2qb, ecr_pos, value_1qb, value_2qb, fp_id, scrape_date. Used only when FantasyCalc fails.
- **nflverse historical actuals (backtest ground truth)** — committed as a static fixture; see §10.

## 6. Module layout — `src/lib/trade/`

- `format.ts` — `LeagueFormat` type + Sleeper/ESPN parsers.
- `values.ts` — FantasyCalc adapter + DynastyProcess fallback; governance-wrapped.
- `evaluate.ts` — pure trade math (supersedes `src/lib/lifecycle/trades.ts`).
- `transactions.ts` — Sleeper/ESPN transaction → `TradeProposal`.
- `backtest.ts` — statistical validation harness.
- `fixtures/` — committed nflverse historical season totals.

## 7. Components

### 7.1 LeagueFormat & detection (`format.ts`)

`LeagueFormat = { ppr: 0 | 0.5 | 1; numQbs: 1 | 2; numTeams: number }`.

- `parseSleeperFormat(league)` — from `scoring_settings.rec` (→ ppr), `roster_positions` (contains `SUPER_FLEX` → numQbs 2, else count of `QB`), `total_rosters` (→ numTeams).
- `parseEspnFormat(settings)` — ESPN `mSettings` view: scoring + roster settings.
- `DEFAULT_FORMAT = { ppr: 1, numQbs: 1, numTeams: 12 }` for logged-out / no league / parse failure.

### 7.2 League-add settings capture & verification

- New `verifyLeague(platform, externalLeagueId, season, credentials?)` fetches the league once (Sleeper `getLeague`, ESPN league `mSettings`). Returns `{ ok: true, format, resolvedLabel } | { ok: false, error }`.
- `src/app/settings/leagues/actions.ts` calls `verifyLeague` before `createLeague`. On `ok: false`, the add form shows the error and **no row is created**. On success, the parsed `LeagueFormat` is persisted with the league.
- This also gives the add flow the real validation it currently lacks — today any string is accepted as a league id.

### 7.3 Value adapter (`values.ts`)

- `PlayerValue = { sleeperId: string | null; espnId: string | null; name: string; position: Position; team: string | null; value: number; overallRank: number; positionRank: number; trend30Day: number }`.
- `fetchTradeValues(format): Promise<{ values: Map<string, PlayerValue>; source: SourceMeta }>` — map keyed by `sleeperId`.
- The FantasyCalc call uses `fetch(url, { next: { revalidate: 43200 } })`. Confirmed via context7: Next.js 16 `fetch` defaults to `auto no cache` and is **not** cached on dynamic routes, so an explicit `revalidate` (12h) is required. The response is Zod-validated.
- On FantasyCalc failure → DynastyProcess CSV (parsed, mapped to `PlayerValue`; `value_1qb`/`value_2qb` chosen by format). On both failing → `unavailableSource(...)` with an empty map. **No fabrication.**

### 7.4 Evaluation logic (`evaluate.ts`)

- `evaluateTrade(sideA: PlayerValue[], sideB: PlayerValue[]): TradeVerdict` where `TradeVerdict = { totalA, totalB, delta, pctDelta, fairness, verdict, winner }`.
- `pctDelta = |totalA - totalB| / max(totalA, totalB, 1)`; verdict: `balanced` ≤ 0.10, `slight-edge` ≤ 0.25, `lopsided` > 0.25; `fairness = clamp(1 - pctDelta, 0, 1)`. These are the **starting thresholds**; Backtest B (§10) validates them empirically and they are adjusted once if calibration fails.
- Pure, deterministic, fully unit-tested. The old `src/lib/lifecycle/trades.ts` is removed; `TradeCenter.tsx` and any importers are updated.

### 7.5 Transactions (`transactions.ts`)

- `fetchLeagueTrades(league, format): Promise<{ trades: GradedTrade[]; source: SourceMeta }>`.
- Sleeper: `getTransactions(leagueId, week)` across recent weeks, filtered to `type === "trade"`. ESPN: league `mTransactions2` view (add if not already present).
- Each transaction is normalized to `TradeProposal` (manager names, player lists), joined to the value map by player id, and graded via `evaluateTrade`.

### 7.6 Trade Center UI rebuild (`TradeCenter.tsx`)

Two `PanelTabs` sections inside the existing `PanelCard`:

- **Trade Builder** — two columns ("You give" / "You get"); each has a searchable player picker (pool = the FantasyCalc value list, headshots joined from the Sleeper snapshot), an added-players list with per-player value, and a running total. A verdict bar shows totals, `pctDelta`, the verdict, and the winning side. A chip shows the detected league format.
- **Recent League Trades** — graded real transactions for the connected league; empty/unavailable state when logged-out or no league connected.

A server action / loader supplies the value map + format. The UI honors reduced-motion, accessibility, and the governance-banner pattern used elsewhere.

## 8. Data flow

1. Format: connected league → persisted `settings.LeagueFormat`; else `DEFAULT_FORMAT`.
2. Values: server action → `fetchTradeValues(format)` (12h-cached) → value map + SourceMeta.
3. Builder: client island; the user adds players; `evaluateTrade` runs client-side from the value map.
4. Real trades: `fetchLeagueTrades` for the connected league → graded list.
5. Values unavailable → builder disabled with an honest message; the real-trades section shows an unavailable state.

## 9. Schema change

Add a `settings` column to the `leagues` table (`text` JSON in SQLite, `jsonb` in Postgres) holding the serialized `LeagueFormat` (with room for future league settings). Update `src/db/schema.ts`, `src/db/schema-pg.ts`, the SQLite `applySqliteSchemaIfNeeded` block, and `INIT_SQL`. For an already-initialized Postgres database, ship `ALTER TABLE leagues ADD COLUMN IF NOT EXISTS settings JSONB`, applied via the idempotent init-db route. The column is nullable — existing rows default to null → `DEFAULT_FORMAT`.

## 10. Statistical validation & backtesting

- **Ground truth:** realized fantasy production from nflverse historical actuals; compute realized **VOR** per player per season (replacement baselines: QB13, RB25, WR37, TE13 for a 12-team, 1QB league).
- **Backtest A — concurrent validity:** Spearman rank correlation between trade values and realized VOR, with a bootstrap CI (reuse `src/lib/stats/distribution.ts`). Target ρ ≥ 0.7; `backtest.test.ts` asserts it.
- **Backtest B — verdict calibration:** generate many synthetic 1-for-1 and 2-for-1 trades from a season's player set; for "balanced" verdicts, assert the realized-VOR gap is statistically small (Welch t-test, small Cohen's d); for "lopsided," assert it is large. Validates the §7.4 thresholds.
- **Reproducibility:** historical nflverse season totals are committed as `src/lib/trade/fixtures/` — real data, snapshotted so the backtest is deterministic and offline in CI (the `players_snapshots` precedent).
- **Honest constraint:** FantasyCalc's free API serves only *current* values — no historical snapshots. Backtest A's value side therefore uses DynastyProcess dated historical files for past seasons, and live FantasyCalc values vs. season-to-date VOR for the current season. `docs/trade-calibration.md` states plainly what is empirically validated vs. assumed — no overclaiming, consistent with the no-synthetic-data principle.

## 11. Error handling & governance

- Every external call is wrapped in `SourceMeta`. FantasyCalc → DynastyProcess → unavailable.
- The builder disables with an honest message if values are unavailable; it never fabricates.
- Format-detection failure falls back to `DEFAULT_FORMAT`, surfaced in the UI.

## 12. Testing

- `evaluate.test.ts` — verdict boundaries, empty sides, determinism.
- `values.test.ts` — Zod parse of a sample FantasyCalc payload; fallback path; unavailable path (mocked fetch).
- `format.test.ts` — Sleeper + ESPN settings → LeagueFormat; default path.
- `transactions.test.ts` — Sleeper/ESPN transaction → TradeProposal normalization.
- `backtest.test.ts` — asserts ρ and calibration thresholds against the committed fixture.
- Live FantasyCalc round-trip test, gated by env (the existing `*.live.test.ts` pattern).
- Playwright e2e for the Trade Builder (add players, see a verdict) and the no-horizontal-overflow viewport sweep.

## 13. Plugin usage

- **context7** — verify library docs during implementation (Next.js fetch caching/`revalidate` — already confirmed; Drizzle column addition; Zod).
- **Playwright / chrome-devtools MCP** — browser-test the new Trade Builder UI interactively before declaring the sprint done.

## 14. Out of scope

3+ team trades; dynasty toggle; draft-pick values; non-Trade-Center panels; FantasyPros (paid).

## 15. Definition of done

`tsc` + `eslint` + `vitest` (including the backtest threshold tests) + `next build` + Playwright (including the new Trade Builder e2e) all green; backtest thresholds met; `docs/trade-calibration.md` written; Trade Center verified in a browser.
