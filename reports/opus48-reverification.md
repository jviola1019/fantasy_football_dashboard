# Opus 4.8 Reverification Ledger

**Date:** 2026-05-30
**Model:** Claude Opus 4.8 (`claude-opus-4-8`)
**Method:** Direct command re-execution against **real data** (no synthetic data) +
parallel Opus review agents. Every claim below was reproduced from a command I ran
in this session, not copied from a prior report.

---

## 1. Gates re-executed (ground truth)

| Gate | Command | Result | Evidence |
| --- | --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | **PASS** (exit 0) | re-run twice (before/after backtest edits) |
| ESLint | `npx eslint .` | **PASS** (0 errors, 1 warning) | warning = unused `_removed` in `sleeper/projections.test.ts:76` |
| Vitest | `npx vitest run` | **PASS** 350/354 | 38 files passed, 3 files + 4 tests skipped (live integration) |
| Build | `npx next build` | **PASS** (exit 0) | 17 routes (2 static, 15 dynamic) |
| Playwright (chromium) | `npx playwright test --project=chromium` | **PASS** 24/24, 0 fail | regenerated `reports/playwright.json` |
| Live Sleeper 2025 pull | `npx tsx scripts/brier-backtest.ts` | **PASS** | 17 weeks pulled live, projections + actual stats |

All six independently reproduced. The Sprint 4 gate claims were **accurate**; the
problem was stale/contradictory *evidence artifacts*, now corrected.

---

## 2. Answer — "Was 2025 data pulled/tested fully, with logins/Sleeper/ESPN?"

**Sleeper public 2025 data — YES, fully and verified live.** The backtest pulls
Sleeper weekly projections + actual stats for all 17 regular-season weeks of 2025:
3,573 "startable" player-weeks (≥ threshold/2 projection), matched projection→actual
by `player_id`. No login required (Sleeper's read API is public).

**Authenticated league round-trips (logins) — BUILT, NOT exercised in CI.**
- `src/lib/sleeper.live.test.ts` and `src/lib/espn.live.test.ts` are `describe.skip`
  unless `RAE_LIVE_TESTS=1`. Default is `0` (see `.env.example`). So the 4 skipped
  vitest tests are exactly these.
- The ESPN live test additionally requires **your** `ESPN_S2` + `ESPN_SWID` cookies
  and `ESPN_LEAGUE_ID`; private ESPN leagues cannot be read without them. These were
  never provided, so the authenticated ESPN path has **not** been validated against a
  real account.
- The app's runtime auth (NextAuth credential login, AES-256-GCM encrypted league
  credentials) is covered by unit + Playwright auth-flow tests, but not against a real
  external ESPN/Sleeper account.

**Bottom line:** real 2025 *data* pulls fully (Sleeper, public). Real *authenticated
logins* to ESPN/Sleeper private leagues are implemented and unit-tested but require
the user's own credentials to exercise end-to-end; that has not happened.

---

## 3. Discrepancies found and corrected

| # | Discrepancy | Evidence | Fix applied |
| --- | --- | --- | --- |
| D1 | "24/24 Playwright pass" claimed, but committed `playwright.json` was a stale **23/24** pre-fix run; `workflow-summary.json` left the rerun `"PENDING"` | parsed committed JSON: expected=23, unexpected=1 | Re-ran chromium → **24/24**; regenerated `reports/playwright.json`; flipped `playwright_a11y_v2` → success |
| D2 | `final-audit-report.md` §6 listed **fabricated** spec files (`04-sign-out`, `09-panel-degradation`, `10-league-switcher`, `11-no-league-cta`, `12-mock-draft`, `13-account-flows`) that don't exist | `ls e2e/` shows 7 real specs | Rewrote §6 with the real specs + counts; added correction note |
| D3 | Brier backtest was **circular** (season-aggregate: ranked by actual PPR to predict actual PPR — a lower bound) | committed `docs/brier-results.md` header | Upgraded to **true prospective** Sleeper projections-vs-actuals (already in working tree); see D4 |
| D4 | The prospective upgrade itself had 3 quant defects (Opus review) | see §4 | All fixed before commit; numbers regenerated |
| D5 | Reports branded "Opus 4.8 × N agents", but every commit trailer says `Co-Authored-By: Claude Sonnet 4.6` | `git log` trailers on all Sprint 3–4 commits | Clarified attribution in both reports: implementation = Sonnet 4.6, this reverification = Opus 4.8 |

---

## 4. Quant defects fixed in the prospective backtest

An Opus review agent flagged three real issues in the (uncommitted) prospective
backtest before it was committed:

- **H1 — Survivorship bias.** The matcher dropped every projected player with no
  actual stat row (`if (actual == null) continue`). Those are DNP/injured/benched
  players — real failed forecasts. Dropping them conditions on "the player played"
  (future info) and removes exactly the high-projection busts that should penalise
  the forecast. **Fix:** score no-shows as outcome `0`; restrict to a "startable"
  universe (projection ≥ threshold/2) so the base rate stays meaningful; report the
  DNP count. *Effect: skill-position Brier correctly rose* (RB 0.179→0.198,
  WR 0.199→0.210, TE 0.205→0.215) — the honest direction.
- **H2 — Hard-coded interpretation.** The report unconditionally wrote "calibrates
  well… Resolution > 0 confirms…" regardless of the numbers. **Fix:** the
  interpretation is now computed from the actual reliability/resolution per position
  (e.g. it now flags that QB does *not* beat climatology). Per-position base rate is
  printed.
- **H3 — Discrimination mislabelled as calibration.** The rank→prob map is monotone
  in the projection, so it tests ordinal/discrimination skill, not the projection's
  own probability calibration. **Fix:** the doc and script now say so explicitly;
  Reliability is described as the calibration of *our* rank→prob map, not Sleeper's.
- Plus M1 (relaxed redundant `season_type` row filter), M3 (averaged rank for ties),
  M2/L3 (skip degenerate n≤1 groups; drop empty CV folds so they can't score a
  spurious perfect 0).

Final prospective Brier (2025, live): QB 0.2716 (n=512), RB 0.1981 (n=876),
WR 0.2103 (n=1470), TE 0.2147 (n=715). 4/4 positions discriminate; 3/4 (RB/WR/TE)
beat the base-rate-only benchmark; QB does not.

---

## 5. Not a discrepancy (confirmed accurate)

- tsc / eslint / vitest / build numbers — all reproduced exactly.
- Security/data-integrity findings from the Sprint 3 audit (scrypt, AES-256-GCM,
  account isolation, CRON_SECRET gates, no-fabrication defaults) — spot-checked, intact.
- The RFC 4180 CSV-parser fix and the 2,020-row local CSV — real (the local file
  genuinely has 2,020 data rows).
- The app uses **no** AI gateway / LLM at runtime — it is a pure data-aggregation
  dashboard (Sleeper / ESPN / KTC / FantasyPros / RSS / Open-Meteo). "Opus 4.8
  gateways" do not apply to the product; they describe the dev workflow only.

---

## 6. Deep code review (two parallel Opus agents) — findings fixed

Two Opus review agents swept the whole `src/` tree: one for quantitative-model
correctness, one for duplication / dead code / inconsistency. Every fix below was
applied and re-verified (tsc + eslint clean, 348 vitest pass, build 17 routes).

### Quant-model correctness

| Sev | Finding | Fix |
| --- | --- | --- |
| **CRITICAL** | `simulation.ts` — when live weekly projections connect, `baseValue = pts × 2` (~6-50) sits far below the 73/83 contention thresholds (tuned to the 0-100 `trueValue` scale), so playoff/championship probabilities collapse to ~0%. | Added `buildProjectionScaler`: range-matches weekly projections onto the `trueValue` scale before thresholding. Proven scale-invariant; added regression test. Live path now yields real probabilities. |
| **HIGH** | `simulation.ts` — probabilities are a near-deterministic step function (uniform shock over a roster vs. magic constants), not a season-simulated probability, but rendered as %. | Rewrote the `assumptions` disclosure to state plainly it is a roster-strength **heuristic** (no schedule/opponent/correlation), not a calibrated probability. Full season model flagged as Sprint-5. |
| **MED** | `derivedMetrics.ts` `simToRow` — `clamp(championship*3.4, championship, playoffs)` returns `topThree < championship` when `playoffs < championship`, breaking the champ ⊆ top3 ⊆ playoffs invariant. | Enforce `playoffs = max(championship, playoffs)` first so the clamp range is well-ordered. |
| **HIGH** | `lifecycle/byes.ts` — `BYE_WEEKS_2025` is a self-declared placeholder driving live user notifications with no missing-data disclosure. | Added `BYE_SCHEDULE` (`verified:false`) + `BYE_SCHEDULE_DISCLOSURE`; the stacked-bye notification now appends the unverified-schedule disclosure. |
| LOW | `trade/backtest.ts` & `draft/tiers.ts` docstrings disagreed with the (correct, calibrated) code. | Fixed the docstrings to match the code rather than shift tuned baselines. |

**SOUND (no change needed):** `trade/{evaluate,values,backtest,verify}` (non-circular backtest, honest degradation), `draft/{recommend,tiers}`, `stats/distribution.ts` (Murphy identity holds, binning edge-cases correct).

### Duplication / dead code / inconsistency

| Sev | Finding | Fix |
| --- | --- | --- |
| **HIGH** | `redact()` duplicated across 6 routes with drifting truncation length (300 vs 400); `unwrap()` duplicated across 5. | Extracted both to `src/lib/redact.ts`; all routes now import the single source. |
| **HIGH** | Dead module `src/lib/news/rss.ts` (+ test) — only its own test imported it; the news pipeline uses the ESPN API path. | Deleted module + test, dropped the orphaned `rss-parser` dependency (lockfile synced, −5 packages). |
| **HIGH** | Stale comments: `trendingProxy.ts` claimed a non-existent `narrativePressure` field; `vercel.ts` claimed the lifecycle cron consumes `trendingMomentum` (it does not). | Rewrote both comments to match reality. |
| **MED** | `sleeper/snapshot.ts` (players) lacked the self-healing `ensure*Table()` the other four snapshot modules have — would throw on a cold Postgres. | Added `ensurePlayersTable()`, wired into read/insert/prune. |
| **MED** | Three hand-kept SQLite DDL copies could silently drift (the Sprint-3 "no such table" bug). | Added `src/db/schemaDrift.test.ts` asserting the prod and test DDL are structurally identical (passes now, guards future drift). |
| LOW | `schema.ts` missing `Db*` type exports for 4 newer tables. | Added `DbRankingsSnapshot`/`DbKtcSnapshot`/`DbProjectionsSnapshot`/`DbNewsSnapshot`. |
| — | Pre-existing eslint warning (`_removed` unused) + stale committed `eslint.json`. | Rewrote the destructure to a `delete`; regenerated `reports/eslint.json` (now genuinely 0/0). |

**Confirmed honest (no synthetic data leak):** the homepage serves real data to
signed-in users with leagues, `NoLeagueCTA` for zero-league users, and the fixture
catalog only on the anonymous landing page / error fallback — always with
`mode:"fixture"` driving a **DEMO DATA** banner and a `freshness:"fixture"` source
line. No ungated synthetic data in any runtime path.

### Deferred items — now COMPLETED (2026-05-30, TDD)

All three follow-ups were implemented with test-first development (no new env
vars; Vercel-safe). 373 vitest pass (+25), tsc/eslint clean, build 17 routes,
Playwright 24/24.

1. **Genuine projection-CALIBRATION backtest.** New `src/lib/stats/logistic.ts`
   — a from-scratch logistic regression (Newton–Raphson/IRLS with L2 ridge,
   standardised then back-transformed, stable sigmoid, leakage-free
   `fitLogisticCV`), 13 tests (coefficient recovery on a known DGP,
   calibration-in-the-large, ridge shrinkage, no-leakage OOF). Plus
   `expectedCalibrationError` (ECE/MCE) in `distribution.ts` (3 tests) — the
   correct binned calibration metric (the Murphy reliability term over-bins
   continuous probabilities). `scripts/brier-backtest.ts` now runs TWO models per
   position and compares them on ECE. Result: the logistic CALIBRATION model
   (projected pts → P(≥ threshold), OOF by week) achieves ECE 0.017–0.033 vs the
   rank model's 0.05–0.17 — i.e. the projected POINTS carry genuinely
   well-calibrated probability information, not just rank order.
2. **`makeSnapshotStore` factory.** New `src/db/snapshotStore.ts` (7 tests)
   consolidates the get/insert/prune/parse/self-heal logic the 5 snapshot modules
   reimplemented; tables resolve LAZILY by key (no import-time db access, so
   `vi.mock("../../db")` tests keep working). All 5 modules refactored onto it
   with public APIs preserved; validate-on-insert is now symmetric everywhere
   (schemas are passthrough / the read path already validated, so no data is
   dropped).
3. **Single-source Postgres DDL.** `schema-pg.ts` now composes the 5 snapshot
   tables in `INIT_SQL` from `snapshotTableSql`/`snapshotIndexSql`, and the
   factory's `ensureTable` uses the SAME helpers — the 4 hand-kept copies are now
   one. `src/db/schemaPg.test.ts` guards that `INIT_SQL` covers every `pgTable`.

*Generated by Claude Opus 4.8, 2026-05-30.*
