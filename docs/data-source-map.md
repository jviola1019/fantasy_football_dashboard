# Data Source Map

Per-metric provenance for every user-visible KPI, table column, chart, and badge
across the RAE fantasy-football dashboard. This satisfies **Phase 7 — Data Source
Map** of the redesign blueprint: for each number on screen, this doc records where
it comes from, how it is derived, how its freshness/confidence is governed, and
what the UI shows when the underlying source is missing.

This document maps **sources, not values.** It contains no real player names,
projections, probabilities, scores, or dashboard numbers — only the fields,
functions, adapters, and files that produce them.

> Scope note: file:line references point at the line of the rendering/derivation
> code at the time of writing. Where a source genuinely cannot be determined from
> the code, the cell reads `UNKNOWN` rather than a guess.

---

## The governance contract

Every metric must trace to a real source or render a neutral placeholder
(`"—"`, "data unavailable", or a `<DataUnavailable>` banner). The contract is
enforced by the shared `RAEEnvelope` / `PlayerMarketRecord` / `SourceMeta`
shapes in `src/lib/governance.ts`:

- **`RAEEnvelope.mode`** is `"live" | "fixture" | "unavailable"`. `mode` plus the
  `LIVE`/`FIXTURE` badge tells the user whether the panel is reading real data.
- **`SourceMeta`** (carried on `envelope.sourceState` and on each record's
  `sources[]`) declares `source`, `fetchedAt`, `ttlSeconds`, `freshness`
  (`fresh | stale | missing | unavailable | fixture`), `confidence` (0–1),
  `validation` (`valid | invalid | not-run`), `missingFields[]`, `assumptions[]`,
  and `failure`. These are **preserved end-to-end** — the envelope builder takes
  the union of `missingFields` and the worse of two freshnesses
  (`src/lib/leagues/toEnvelope.ts` (composite sourceState block)).
- **`evaluateFreshness()`** (`governance.ts` (`evaluateFreshness`)) derives `fresh`/`stale`/`missing`
  from `fetchedAt` + `ttlSeconds`. **`unavailableSource()`** (`governance.ts` (`unavailableSource`))
  is the canonical "adapter could not provide data" `SourceMeta`, whose
  assumptions literally state "No production values are fabricated when the
  adapter cannot provide data."
- **`derivePanelState(envelope, dependsOn)`** (`src/lib/panelState.ts` (`derivePanelState`)) is the
  shared gate: a panel declares which behavioral fields it needs; the helper
  returns `ready | degraded | unavailable` from `envelope.sourceState.missingFields`.
  Panels render `"—"`, a partial-data note, or a `<DataUnavailable>` banner
  accordingly. Identity-only records get every market field flagged missing by
  `withMissingMarketFields()` (`src/lib/normalize.ts` (`withMissingMarketFields`)).

### Key honesty rules found in code

- **No `Math.random` in displayed data.** All probabilistic output comes from a
  **seeded** Monte Carlo (`mulberry32` + Box–Muller, `src/lib/rng.ts`,
  `src/lib/seasonSim.ts`). `deriveAppData` uses fixed `seed: 20260513`
  (`src/lib/envelope/derive.ts` (`deriveAppData`)); confidence-band replicates use
  `seed + i` and run **server-side** in `deriveReplicationRange`
  (`src/lib/envelope/derive.ts:59`) — RouteView/ReportsView are server components,
  so the seeded sim + bootstrap bands never block the client main thread.
  (Was `deriveConfidenceBands` plus a client-side `widen()`. Both are gone:
  the rename came with audit P0-4's retraction of the "95% confidence"
  framing, and `widen()` went with the multipliers below.)
- **Trending = a waiver/news signal applied to the market pool, not sentiment NLP.**
  `trendingMomentum` priority ladder (`src/lib/fantasypros/enrich.ts` (`enrichRoster`)): (1) ESPN
  headline-velocity score, (2) Sleeper 24h trending adds/drops proxy
  (`src/lib/sleeper/trendingProxy.ts`), (3) zero + declared missing. The assumption
  string explicitly says "Not NLP sentiment classification."
- **Fragility / availability via REAL injury `status`.** The Roster Availability
  X-Ray reads each record's `status` (`active|questionable|out|ir|bye|unknown`),
  mapped from Sleeper `injury_status` / ESPN `injuryStatus`
  (`src/lib/normalize.ts` (`sleeperPlayerToRecord`)). The numeric `fragility` field stays 0 (no
  injury-probability model) and is declared missing — so the DEF construction grade
  shows `"—"` when fragility is missing.
- **Opportunity = nflverse snap share.** `opportunity` is stamped from the FREE
  nflverse `offense_pct` snap-count CSV (CC-BY), recency-weighted to 0–100
  (`src/lib/nflverse/opportunity.ts`). When absent it stays missing and usage bars
  / liquidity views degrade honestly.
- **Sims are seeded and ordering-safe.** Probability tiers are clamped to `[0,100]`
  and forced into `champ ⊆ top3 ⊆ playoffs` ordering (`src/lib/derivedMetrics.ts` (`deriveOutcomeDistribution`)).
- **Empty pools never assert a regime.** `marketRegime` returns `"Unknown"` for an
  empty pool (`derivedMetrics.ts` (`deriveCommandMetrics`)); `leagueAdvantage` returns `NaN` → renders
  `"—"`; aggregate value returns `"—"` rather than a fabricated currency
  (`derivedMetrics.ts` (`deriveNarrativeMovers`)).

### Upstream adapters & their `SourceMeta`

| Adapter | File | Produces | TTL / freshness | confidence |
|---|---|---|---|---|
| Sleeper league/roster identity | `src/lib/sleeper/league.ts`, `src/lib/leagues/fetchLive.ts` (Sleeper path) | `id/name/position/team/status`, rosterSlot, headshot | 120s, `fresh` | 0.85 |
| ESPN league/roster identity | `src/lib/espn/league.ts`, `fetchLive.ts` (ESPN path) | identity + status (`mTeam/mRoster/mSettings`) | 300s, `fresh` | 0.85 |
| FantasyPros ECR | `src/lib/fantasypros/scrape.ts`, `enrich.ts`, `toEnvelope.ts` (rankings enrichment) | perceivedValue, trueValue, ownershipLeverage, volatility, confidence | 24h, `fresh`/`stale` | 0.85 |
| Sleeper trending add/drop | `src/lib/sleeper/trendingProxy.ts` | trendingMomentum (proxy) | 24h window | — |
| ESPN headline velocity | `src/lib/espn/news.ts`, `newsMatch.ts` | trendingMomentum (preferred) | 72h window | — |
| nflverse snap counts | `src/lib/nflverse/opportunity.ts` | opportunity (snap share) | per-season CSV | — |
| Sleeper weekly projections | `src/lib/sleeper/projections.ts`, `projectionsSnapshot.ts` | weekly `pts_ppr` + `pts_half_ppr` + `pts_std`, all three carried; the unit is chosen at the simulation boundary from the league format (audit 2026-08-20 §7) | in-season cron | — |
| FantasyCalc → KTC → DynastyProcess | `src/lib/trade/values.ts` | trade `value` (3-tier fallback) | 12h | 0.9 / 0.75 / 0.6 |
| Fixture catalog | `src/lib/fixtures.ts` | demo records | `fixture` (1y) | 0.42 |

**Envelope assembly:** live data is composed by `buildLiveEnvelope`
(`src/lib/leagues/toEnvelope.ts` (`buildLiveEnvelope`)); pools/sim/metrics are derived once per
request by `deriveAppData` (`src/lib/envelope/derive.ts` (`deriveAppData`)) and routed to panels
by `RouteView` (`src/components/app/RouteView.tsx`). Pool selection:
Command Center / Nexus use the user's **roster** (`d.players`); Market /
Narrative / Waiver use the **market pool** (whole universe pre-draft, free agents
post-draft); Draft / Universe use the **universe pool**.

**Test coverage anchors (whole-pipeline):** `src/lib/governance.test.ts`,
`src/lib/derivedMetrics.stats.test.ts`, `src/lib/simulation.test.ts` +
`simulation.calibration.test.ts`, `src/lib/seasonSim.test.ts`,
`src/lib/outcomeHeat.test.ts`, `src/lib/visualContract.test.ts`,
`src/lib/panelState.test.ts`, `src/lib/nflverse/opportunity.test.ts`,
`src/lib/sleeper/trendingProxy.test.ts`, `src/lib/draft/{tiers,recommend}.test.ts`,
`src/lib/trade/{evaluate,values,transactions,backtest}.test.ts`,
`src/lib/leagues/{draftState,mirrorLeague,buildUniverse,fetchLive}.test.ts`.

---

## Overview tiles + re-homed team sections

The former monolithic `CommandCenter.tsx` was **decomposed** (June 2026 audit-fix pass):
the KPI strip + leaderboard became the `/dashboard` tiles, and the deep sections were
**re-homed** to the routes where they belong. Pool = user roster (`d.players`) unless
noted. Component files:
- `/dashboard` tiles — `dashboard/{SeasonNotice,LeagueHealth,LeaguePulse,TopInsights}.tsx`
- `/analytics` — `panels/sections/TeamSignals.tsx` (win prob + intel feed + narrative momentum)
- `/players` — `panels/sections/RosterHealth.tsx` (availability X-ray + start/sit)
- `/draft` — `panels/sections/TeamConstruction.tsx` (position grades)
- mode pill — `governance/ModeBanner.tsx` (in `TopCommandBar`, on every route)

| UI label | data field | source adapter | derivation fn | freshness source | confidence/validation | live/fixture/unavailable | fallback when missing | file | test |
|---|---|---|---|---|---|---|---|---|---|
| LIVE / FIXTURE / UNAVAILABLE pill | `envelope.mode` | envelope assembler | — | n/a | — | command-bar pill shows live / fixture / unavailable | n/a | `governance/ModeBanner.tsx` | `03-a11y.spec.ts` |
| Season notice (pre-draft / final) | `envelope.draftState`, `envelope.season` | Sleeper/ESPN draft-state + season-mirror (`leagues/draftState.ts`, `mirrorLeague.ts`) | `deriveLeagueMeta` (`toEnvelope.ts:81`) | envelope `generatedAt` | — | hidden when no season / no players | renders nothing | `dashboard/SeasonNotice.tsx` | `leagues/draftState.test.ts`, `mirrorLeague.test.ts` |
| Scarcity Gap (KPI) | `trueValue`,`perceivedValue`,`ownershipLeverage`,`fragility` | FantasyPros ECR | `scarcityGap` → `deriveCommandMetrics` | `sourceState.fetchedAt` | FP 0.85 / valid | real number | `"—"` not used here; avg of present records | `models.ts:18`, `dashboard/LeagueHealth.tsx` | `derivedMetrics.stats.test.ts` |
| Valuation Gap (KPI) | `trueValue`,`perceivedValue`,`confidence`,`ownershipLeverage` | FantasyPros ECR | `valuationGap` (`models.ts:22`) | `sourceState.fetchedAt` | FP 0.85 | unitless VOR index (no "%") | avg of present | `dashboard/LeagueHealth.tsx` | `derivedMetrics.stats.test.ts` |
| Narrative Velocity (KPI) | `trendingMomentum`,`volatility`,`fragility` | ESPN news / Sleeper trending proxy | `narrativeVelocity` (`models.ts:26`) | `sourceState.fetchedAt` | — | renders `"—"` + "Data source not integrated" | `"—"` when `trending_momentum` ∈ missingFields | `dashboard/LeagueHealth.tsx` | `derivedMetrics.stats.test.ts`, `panelState.test.ts` |
| League Advantage (KPI) | `scarcityGap` aggregate | FantasyPros ECR | `deriveCommandMetrics` (`derivedMetrics.ts:46`) | `sourceState.fetchedAt` | FP 0.85 | `"—"` when `NaN` (empty roster) | `"—"` for non-finite | `dashboard/LeagueHealth.tsx` | `derivedMetrics.stats.test.ts` |
| Chaos Exposure (KPI) | `volatility`,`fragility`,`trendingMomentum` | FantasyPros + trending | `chaosExposure` (`models.ts:30`) | `sourceState.fetchedAt` | — | `"—"` when `trending_momentum` or `opportunity` missing | `"—"` per `missingFields` | `dashboard/LeagueHealth.tsx` | `derivedMetrics.stats.test.ts` |
| League Pulse leaderboard + bars | `trueValue`, `name`, `position` | FantasyPros ECR | sort by `trueValue` | `sourceState.fetchedAt` | FP 0.85 | "Awaiting league data" empty state | empty state when 0 players | `dashboard/LeaguePulse.tsx` | `15-sprint5-panels.spec.ts` |
| League Pulse "Market Edge" pill | `metrics.scarcityGap` | FantasyPros ECR | `50 + avgEdge*1.4`, clamped (`RouteView.tsx`) | `sourceState.fetchedAt` | FP 0.85 | real number | derived from present records | `dashboard/LeaguePulse.tsx` | `derivedMetrics.stats.test.ts` |
| Top Insights (biggest mispricings) | `scarcityGap` per player | FantasyPros ECR | top-6 by `\|scarcityGap\|` | `sourceState.fetchedAt` | FP 0.85 | "No market data" empty state | empty when 0 market players | `dashboard/TopInsights.tsx` | `15-sprint5-panels.spec.ts` |
| Narrative Momentum (gainers/decliners) | `trendingMomentum` (via `narrativeVelocity`) | ESPN news / Sleeper proxy | `deriveNarrativeMovers` (`derivedMetrics.ts:57`) | `sourceState.fetchedAt` | — | "Trending/sentiment source not integrated" note | whole section replaced by note | `panels/sections/TeamSignals.tsx` | `derivedMetrics.stats.test.ts` |
| Intelligence Feed lines + "As of" | `sourceState.assumptions/failure/freshness`, `fetchedAt`/`generatedAt` | envelope `SourceMeta` | — (provenance lines, not events) | `sourceState.fetchedAt` ?? `generatedAt` | reflects `validation`/`freshness` | shows assumptions/failure/mode verbatim | one real timestamp, never fabricated ages | `panels/sections/TeamSignals.tsx` | — |
| Playoff Probability (triangle, LOW/EST/HIGH) | `sim.playoffProbability`, `sim.params.iterations` | season Monte Carlo | `runNexusSimulation` (`simulation.ts`) + `wilsonInterval` (`stats/distribution.ts`) | sim `source` | clamped `[0,100]` | 90% Wilson Monte-Carlo interval — sampling error only, excludes model uncertainty (labeled) | renders sim output | `panels/sections/TeamSignals.tsx` | `stats/distribution.test.ts` |
| Team Construction Score (overall + per-pos grades) | `scarcityGap` per position; DEF uses `fragility` | FantasyPros ECR | `derivePositionGrades` (`derivedMetrics.ts:174`) | `sourceState.fetchedAt` | FP 0.85 | DEF grade `"—"` when `fragility` missing | DEF `"—"`; others graded from present edges | `panels/sections/TeamConstruction.tsx` | `derivedMetrics.stats.test.ts` |
| Roster Availability X-Ray (chips, bars, labels) | `status` (real injury designation) | Sleeper `injury_status` / ESPN `injuryStatus` | `STATUS_RISK` map (`RosterHealth.tsx`) | roster `SourceMeta` (120/300s) | identity 0.85 | "Roster healthy" all-clear or "No roster to scan" | always-present signal; never blanks | `panels/sections/RosterHealth.tsx` | `lifecycle/byes.test.ts` (status), `normalize` mapping |
| Start / Sit Edge (Proj / Repl / Edge) | `trueValue`,`perceivedValue` | FantasyPros ECR | `deriveStartSitEdge` (`derivedMetrics.ts:219`) | `sourceState.fetchedAt` | FP 0.85 | "No data available" | empty when no players | `panels/sections/RosterHealth.tsx` | `derivedMetrics.stats.test.ts` |

---

## Market Intelligence (`analytics` + `dashboard`)
`src/components/panels/MarketIntelligence.tsx` · pool = market pool · gating via `derivePanelState`

| UI label | data field | source adapter | derivation fn | freshness | confidence/validation | live/fixture/unavailable | fallback when missing | file:line | test |
|---|---|---|---|---|---|---|---|---|---|
| Valuation Gap (KPI) | `trueValue`,`perceivedValue`,`confidence`,`ownershipLeverage` | FantasyPros ECR | `deriveMarketMetrics`→`valuationGap` | `sourceState.fetchedAt` | FP 0.85 | raw VOR index | avg of present | `MarketIntelligence.tsx:115` | `derivedMetrics.stats.test.ts` |
| Liquidity Score (KPI) | `opportunity`,`valuationGap` | nflverse snaps + ECR | `liquidityScore` (`models.ts:34`) | `sourceState.fetchedAt` | — | `/10` index | avg of present | `MarketIntelligence.tsx:116` | `derivedMetrics.stats.test.ts` |
| Arbitrage Opps (KPI) | count of `|scarcityGap|>8` | FantasyPros ECR | `deriveMarketMetrics` (`derivedMetrics.ts:70`) | `sourceState.fetchedAt` | FP 0.85 | integer count | 0 on empty | `MarketIntelligence.tsx:117` | `derivedMetrics.stats.test.ts` |
| Aggregate Value (KPI) | sum of `perceivedValue` | FantasyPros ECR | `deriveAggregateValueIndex` (`derivedMetrics.ts` (`deriveNarrativeMovers`)) | `sourceState.fetchedAt` | FP 0.85 | unitless `"k"` index, NOT currency | `"—"` when total ≤ 0 | `MarketIntelligence.tsx:118` | `derivedMetrics.stats.test.ts` |
| Volatility Index (KPI) | `volatility` (avg) | FantasyPros `rank_std` | `deriveMarketMetrics.priceDiscoveryPct` (`derivedMetrics.ts:73`) | `sourceState.fetchedAt` | FP 0.85 | avg variance index | avg of present | `MarketIntelligence.tsx:119` | `derivedMetrics.stats.test.ts` |
| Market Regime (KPI) | mean `valuationGap` | FantasyPros ECR | `deriveMarketMetrics` (`derivedMetrics.ts` (`deriveCommandMetrics`)) | `sourceState.fetchedAt` | FP 0.85 | `"—"`/"No market data" on empty pool | `"Unknown"`→`"—"` when empty | `MarketIntelligence.tsx:120` | `derivedMetrics.stats.test.ts` |
| Largest Valuation Gaps table (Market/Value/Gap/Own%/Trend) | `perceivedValue`,`trueValue`,`scarcityGap`,`ownershipLeverage`,`trendingMomentum` | FantasyPros ECR (+ trending for arrow) | `scarcityGap` (`models.ts:18`) | `sourceState.fetchedAt` | FP 0.85 | "No validated market records..." row | empty-row message | `MarketIntelligence.tsx` | `derivedMetrics.stats.test.ts` |
| Value × Usage Board (value bar, usage bar, edge) | `trueValue`, `opportunity`, `scarcityGap` | ECR + nflverse snaps | inline sort + `scarcityGap` | `sourceState.fetchedAt` | FP 0.85 | usage bar omitted when no snap data (`anyUsage`) | usage bar hidden; "No validated market records" | `MarketIntelligence.tsx:213` | `derivedMetrics.stats.test.ts` |
| Liquidity Flow tab (bars by opportunity) | `opportunity` | nflverse snaps | sort by `opportunity` | `sourceState.fetchedAt` | — | `<DataUnavailable>` when `opportunity` missing | full banner | `MarketIntelligence.tsx:75`,`:184` | `panelState.test.ts` |
| Sentiment tab (Positive/Neutral/Negative) | sign of `trendingMomentum` | ESPN news / Sleeper proxy | inline count by sign | `sourceState.fetchedAt` | — | `<DataUnavailable>` when `trending_momentum` missing; single snapshot, no forecast | full banner | `MarketIntelligence.tsx:85`,`:305` | `panelState.test.ts` |
| Trends tab — Outcome Probability Landscape (heatmap) | `sim.distribution` (seeded) | season Monte Carlo | `runNexusSimulation` + `buildOutcomeHeat` | sim `source` | seeded; columns sum to 100% | "No simulated seasons to chart" | null heat → note | `MarketIntelligence.tsx:330`, `outcomeHeat.ts:34` | `outcomeHeat.test.ts`, `seasonSim.test.ts` |
| Price Discovery scatter (true vs market) | `trueValue`,`perceivedValue` | FantasyPros ECR | inline scatter (fair-value diagonal) | `sourceState.fetchedAt` | FP 0.85 | "No validated market records to chart" | empty note | `MarketIntelligence.tsx:373` | — |

---

## Player Universe (`players` + `dashboard`)
`src/components/panels/PlayerUniverse.tsx` · pool = universe pool · per-axis gating via `asMetricSet`

| UI label | data field | source adapter | derivation fn | freshness | confidence/validation | live/fixture/unavailable | fallback when missing | file:line | test |
|---|---|---|---|---|---|---|---|---|---|
| Galaxy grid (cards, value, bar) | `trueValue`,`name`,`position`,`team`,`imageUrl` | FantasyPros ECR + Sleeper/ESPN identity | sort by `trueValue` | `sourceState.fetchedAt` | FP 0.85 | "No players found" | empty grid | `PlayerUniverse.tsx:171` | — |
| Player Profile (True/Market/Edge/Trending) | `trueValue`,`perceivedValue`,`scarcityGap`,`trendingMomentum` | FantasyPros ECR (+ trending) | `scarcityGap`, `trendingLabel` | `sourceState.fetchedAt` | FP 0.85 | profile hidden when no selection | n/a | `PlayerUniverse.tsx:229` | `utils.test.ts` (trendingLabel) |
| Universe Stats (Total / Value Above Consensus / Avg Valuation Gap) | count, `trueValue>perceivedValue`, `valuationGap` avg | FantasyPros ECR | `valuationGap`, inline | `sourceState.fetchedAt` | FP 0.85 | counts reflect pool | derived from present | `PlayerUniverse.tsx:270` | `derivedMetrics.stats.test.ts` |
| Rising Stars list | `narrativeVelocity` | ESPN news / Sleeper proxy | `deriveRisingStars` (`derivedMetrics.ts:233`) | `sourceState.fetchedAt` | — | ranks present records (0 hype if trending missing) | list shrinks | `PlayerUniverse.tsx:298` | `derivedMetrics.stats.test.ts` |
| Player News (headline, age, link) | `envelope.playerNews[record.id][]`, `envelope.playerNewsMeta` | ESPN NFL news (`news-refresh` cron, daily 09:20) | `buildPlayerNewsIndex` (`espn/newsMatch.ts`); age vs `envelope.generatedAt` | `playerNewsMeta.fetchedAt`, stated in the panel | ESPN-attributed, no NLP, no scoring | `<DataUnavailable>` when no snapshot; explicit "no article mentions X" when covered-but-empty | named empty state, never blank | `panels/sections/PlayerNews.tsx` | `newsMatch.test.ts`, `e2e/30-news-and-faab.spec.ts` |
| Metric Profile radar (Value/Oppty/Trending/Confidence/Stability) | `trueValue`,`opportunity`,`trendingMomentum`,`confidence`,`volatility` | ECR + nflverse snaps + trending | inline axis mapping; `RADAR_AXIS_DEPS` | `sourceState.fetchedAt` | FP 0.85 | axis drops to 0 + `*` footnote when its dep ∈ missingFields | per-axis dashed/zero | `PlayerUniverse.tsx:27`,`:119` | `panelState.test.ts` |
| Tiers tab (value bands per position) | `trueValue`,`position` | FantasyPros ECR | `TIER_BANDS` inline | `sourceState.fetchedAt` | FP 0.85 | empty positions skipped | per-position skip | `PlayerUniverse.tsx:323` | — |
| Comparison tab (True/Market/Edge/Trend vs peers) | `trueValue`,`perceivedValue`,`scarcityGap`,`trendingMomentum` | FantasyPros ECR | `scarcityGap` (same as all panels) | `sourceState.fetchedAt` | FP 0.85 | "Select a player…" prompt | prompt when no selection | `PlayerUniverse.tsx:358` | `derivedMetrics.stats.test.ts` |
| Watchlist tab (risers/fallers) | `narrativeVelocity` | ESPN news / Sleeper proxy | sort by `narrativeVelocity` | `sourceState.fetchedAt` | — | `<DataUnavailable>` when `trending_momentum` missing | full banner | `PlayerUniverse.tsx:396` | `panelState.test.ts` |
| Projections tab (weekly proj pts) | `envelope.weeklyProjections`, `weeklyProjectionsMeta` | Sleeper projections cron | join `id` → pts | `weeklyProjectionsMeta.fetchedAt` | in-season only | `<DataUnavailable>` off-season / pre-cron | full banner | `PlayerUniverse.tsx:427` | `sleeper/projections.test.ts` |
| Weekly start probability, P(clears line) | `envelope.weeklyProjections[id].ppr` → `weeklyStartProbability` | Sleeper projections cron (input); the model itself is FROZEN constants fitted offline | `weeklyStartProbability` (`models/weeklyProbability.ts`) → `predictLogisticProba` (`stats/logistic.ts`) | `weeklyProjectionsMeta.fetchedAt` for the input; the model has no freshness — it is a fixed artefact of the 2025 fit | **Measured out of sample.** Leave-one-week-out over 3,573 player-weeks: Brier skill +21.2 RB / +18.5 WR / +17.6 TE / **+3.7 QB**, ECE 1.7–3.3%. Fingerprint `bba1d103`, re-derivable offline by `npm run verify:weekly-prob` (43 checks) | `<DataUnavailable>` naming the INPUT as missing, not the model — and the disclosure still renders | probability omitted for any player without a PPR projection; never converted from another unit | `panels/sections/WeeklyStartProbability.tsx` | `WeeklyStartProbability.test.tsx`, `weeklyProbability.test.ts`, `e2e/20-model-failure-disclosure` |
| …its per-position disclosure + reliability diagram | `WEEKLY_PROB_MODELS[pos].reliabilityBins` | same frozen fit | `weeklyProbDisclosure`, `describeReliability` | — | Prints its own ECE and Brier skill inline; that is what earns the phrase "calibrated probability" past the `e2e/20` ban, which is an EARN and not an allow-list | always renders, including when there is no projection to convert | n/a | `WeeklyStartProbability.tsx`, `charts/ReliabilityDiagram.tsx` | `chartKit.test.tsx` |


**The unit on that row is load-bearing.** The weekly model was fitted on Sleeper's
`pts_ppr` against PPR thresholds, so the panel selects the PPR field BY NAME
whatever the league scores. Feeding it a half-PPR projection is the same class of
mismatch audit 2026-08-20 §7 already had to fix once, and it is invisible: the
number stays entirely plausible and means nothing.

---

## Narrative Engine (`analytics` + `dashboard`)
`src/components/panels/NarrativeEngine.tsx` · pool = market pool · gating via `derivePanelState(["trending_momentum"])`

| UI label | data field | source adapter | derivation fn | freshness | confidence/validation | live/fixture/unavailable | fallback when missing | file:line | test |
|---|---|---|---|---|---|---|---|---|---|
| Summary line (N up / N down) | `trendingMomentum` | ESPN news / Sleeper proxy | inline counts | `sourceState.fetchedAt` | — | "source not connected" copy when missing | drops to value-only copy | `NarrativeEngine.tsx:50`,`:60` | `panelState.test.ts` |
| SELL-HIGH board (hype, edge) | `trendingMomentum` (hype), `scarcityGap` (edge), gap = hype − edge | ESPN news / Sleeper proxy + ECR | inline `ranked`/`gap` (`NarrativeEngine.tsx:40`) | `sourceState.fetchedAt` | FP 0.85 (edge always present) | hype axis = 0 when trending missing → pure value-mispricing ranking; hype column hidden | degrades to edge-only; never blanks | `NarrativeEngine.tsx:79`,`:99` | `derivedMetrics.stats.test.ts` (scarcityGap) |
| BUY-LOW board (hype, edge) | same as SELL-HIGH (gap < 0) | same | inline | `sourceState.fetchedAt` | FP 0.85 | same degrade; "No qualifying players" when empty | edge-only board | `NarrativeEngine.tsx:86` | as above |

---

## Nexus Simulator (`analytics` + `dashboard`)
`src/components/panels/NexusSimulator.tsx` · pool = user roster · gating via `derivePanelState(["trending_momentum","opportunity"])`

The simulation **always runs**; missing behavioral fields add a disclosure banner
(`NexusSimulator.tsx:34-44`).

**Nothing is widened, and this line used to say it was.** `CI_MULTIPLIER` and
`CI_LABEL` inflated the band 1.5× when a source was degraded and 2.5× when it was
unavailable. Audit P0-4 removed them on 2026-08-22: multiplying a Monte-Carlo
replication range by a number chosen for how a source *feels* produces a band that
is neither the replication range nor any measured uncertainty — it is a made-up
interval wearing the units of a real one. Missing inputs are now disclosed in
words, and the band keeps meaning the one thing it can mean.

| UI label | data field | source adapter | derivation fn | freshness | confidence/validation | live/fixture/unavailable | fallback when missing | file:line | test |
|---|---|---|---|---|---|---|---|---|---|
| SIMULATIONS count | `sim.params.iterations` | season sim params | `deriveAppData` (`seed 20260513`, 2500 iters) | sim `source` | seeded/deterministic | static count | n/a | `NexusSimulator.tsx:90` | `simulation.test.ts` |
| Data-state disclosure banner | `panelState.status`, `weeklyProjectionsMeta` | `derivePanelState` + projections | — (qualitative only) | `weeklyProjectionsMeta.fetchedAt` | — | "Speculative" / live-week label | banner text only; the band is never rescaled | `NexusSimulator.tsx:34-44` | `panelState.test.ts` |
| Outcome Multiverse (5 buckets) | `sim.championship/playoff/catastrophicRisk` | season Monte Carlo | `deriveOutcomeDistribution` (`derivedMetrics.ts:134`) | sim `source` | buckets sum to 100, each ≥0 | "No player data" overlay | normalized to 100% | `NexusSimulator.tsx:165` | `derivedMetrics.stats.test.ts` (outcome %) |
| Outcome Multiverse heatmap | `sim.distribution` (wins×tier joint, seeded) | season Monte Carlo | `buildOutcomeHeat` (`outcomeHeat.ts:34`) | sim `source` | conditional, each column = 100% | "No simulated seasons to chart" | null heat → note | `NexusSimulator.tsx:188` | `outcomeHeat.test.ts` |
| Scenario Outlook — replication range (Championship/Playoffs) | `sim.championshipProbability`,`playoffProbability` | seeded replicate sims (`seed+i`), **server-computed** (`deriveReplicationRange`) | `bootstrapCI` (`stats/distribution.ts`), N=500, alpha 0.05, seed 1019 | sim `source` | 20×800 iters; clamped `[0,100]`. **Not a confidence interval** — it measures how far the answer moves when the simulation is re-run, not whether the model is right; measured season calibration error is 16.13pp against a ±1.5pp range (audit P0-4) | "No data — scenario outlook unavailable" | empty-state note | `derive.ts:59` (`deriveReplicationRange`), `NexusSimulator.tsx:311-334` (`ScenarioBands`) | `continuity.test.ts`, `stats/distribution.test.ts` |
| Scenario Comparison table (Champ/Top3/Playoffs/PF/PA/Rank) | best/baseline/worst sims; PF/PA from weekly means × weeks | season Monte Carlo | `deriveScenarioComparison` + `simToRow` (`derivedMetrics.ts:159`,`:86`) | sim `source` | clamped + well-ordered tiers | "No data available" | empty-state note | `NexusSimulator.tsx:335` | `derivedMetrics.stats.test.ts`, `simulation.test.ts` |
| Key Drivers (proj pts/week bars) | `sim.keyDrivers[].contribution` = starter weekly mean | season sim starters | `runNexusSimulation` (`simulation.ts:157`) | sim `source` | real pts/week | "No data." | empty-state | `NexusSimulator.tsx:376` | `simulation.test.ts` |
| Risk of Regret (donut + assumptions) | `sim.regretIndex` = `1 − playoffProbability` | season Monte Carlo | `runNexusSimulation` (`simulation.ts:169`) | sim `source` | clamped `[0,100]` | "No data." | empty-state | `NexusSimulator.tsx:397` | `simulation.test.ts` |
| Calibration — Reliability Diagram | external backtest output | `scripts/brier-backtest.ts` (offline) | `ReliabilityDiagram` | n/a | placeholder caption — not populated at runtime | static "Run … to populate" caption | empty diagram + caption | `NexusSimulator.tsx:152` | `stats/brierBacktest.test.ts` |
| Risk Detail — Assumptions (seed/iterations) | `sim.assumptions`,`sim.seed`,`sim.params.iterations` | season sim | `runNexusSimulation` (`simulation.ts:171`) | sim `source` | seeded/deterministic | always shown | n/a | `NexusSimulator.tsx:423` | `simulation.test.ts` |

---

## Draft Intelligence (`draft` + `dashboard`)
`src/components/panels/DraftIntelligence.tsx` · pool = universe pool (draftable) · client-side mock-draft state

| UI label | data field | source adapter | derivation fn | freshness | confidence/validation | live/fixture/unavailable | fallback when missing | file:line | test |
|---|---|---|---|---|---|---|---|---|---|
| Live Board (Player/Pos/Team/True/Edge) | `name`,`position`,`team`,`trueValue`,`scarcityGap` | FantasyPros ECR + identity | `scarcityGap`; ★ from `recommend` | `sourceState.fetchedAt` | FP 0.85 | "No available players (or empty envelope)" | empty-row message | `DraftIntelligence.tsx:98` | `derivedMetrics.stats.test.ts` |
| ★ recommended flag + "On the Clock" | `recommend()` composite score | ECR + nflverse opportunity + fragility + tiers | `recommend` (`draft/recommend.ts:38`) | `sourceState.fetchedAt` | — (heuristic; opportunity/fragility may be 0) | "No recommendations yet." | empty profile | `DraftIntelligence.tsx:228`, `recommend.ts` | `draft/recommend.test.ts` |
| Recommendation Queue (Category/Score/Why) | `Recommendation.category/score/reasons` | same as above | `recommend` | `sourceState.fetchedAt` | — | "No recommendations." | empty-row | `DraftIntelligence.tsx:274` | `draft/recommend.test.ts` |
| Tier Collapse Forecast (Remaining/Cliff/Intensity) | `trueValue` gaps per position | FantasyPros ECR | `tiersByPosition` + `tierCollapseSignals` (`draft/tiers.ts`) | `sourceState.fetchedAt` | FP 0.85 | "No tier signals." | empty-row | `DraftIntelligence.tsx:313` | `draft/tiers.test.ts` |
| Position Strength Radar | `derivePositionGrades(myRoster)` → score | FantasyPros ECR | `derivePositionGrades` (`derivedMetrics.ts:174`) | `sourceState.fetchedAt` | FP 0.85 | grades from picked roster only | reflects current picks | `DraftIntelligence.tsx:356` | `derivedMetrics.stats.test.ts` |
| Draft Recommendation Board (score bars) | `Recommendation.score` | ECR + opportunity + tiers | `recommend` | `sourceState.fetchedAt` | — | "No recommendations yet…" | empty-state | `DraftIntelligence.tsx:383` | `draft/recommend.test.ts` |

---

## Pre-Draft Audit (`draft` + `dashboard`)
`src/components/panels/PreDraftAudit.tsx` · reads `envelope.leagueFormat`

| UI label | data field | source adapter | derivation fn | freshness | confidence/validation | live/fixture/unavailable | fallback when missing | file:line | test |
|---|---|---|---|---|---|---|---|---|---|
| Detected League Settings (scoring, teams, roster, starters) | `envelope.leagueFormat` fields | Sleeper `roster_positions`+settings / ESPN `mSettings` | `parseSleeperFormat`/`parseEspnFormat` (`trade/format.ts`) | snapshot `SourceMeta` | platform-validated; source named via `platformLabel` | "Connect a league at /settings/leagues" when `leagueFormat` null | whole table replaced by CTA | `PreDraftAudit.tsx:104`,`:32` | `trade/format.test.ts` |
| Trade deadline / Playoff week / Playoff teams | `format.tradeDeadlineWeek`,`playoffWeekStart`,`playoffTeams` | same | `rowsForFormat` (`PreDraftAudit.tsx:32`) | snapshot `SourceMeta` | "not provided" + "Field not present in {platform}" when null | `"—"` / "not provided" | per-field `"—"` | `PreDraftAudit.tsx:71` | `trade/format.test.ts` |
| Source column ("detected"/"not provided") | `row.status` | derived from format presence | inline | snapshot `SourceMeta` | — | reflects per-field presence | "not provided" | `PreDraftAudit.tsx:142` | — |
| Pool Strength by Position (grades) | `derivePositionGrades(players)` | FantasyPros ECR | `derivePositionGrades` | `sourceState.fetchedAt` | FP 0.85 | "against the demo fixture" note when no format | grades on fixture pool | `PreDraftAudit.tsx:156` | `derivedMetrics.stats.test.ts` |

---

## Waiver Wire (`waivers` + `dashboard`)
`src/components/panels/WaiverWire.tsx` · pool = market pool (free agents post-draft) · gating via `derivePanelState(["opportunity"])`

| UI label | data field | source adapter | derivation fn | freshness | confidence/validation | live/fixture/unavailable | fallback when missing | file:line | test |
|---|---|---|---|---|---|---|---|---|---|
| Ranked Free Agents (Player/Pos/Team/Value) | `name`,`position`,`team`,`trueValue` | FantasyPros ECR + identity | `rankFreeAgents` (`WaiverWire.tsx:131`) | `sourceState.fetchedAt` | FP 0.85 | "No free agents in the current envelope…" | empty-row message | `WaiverWire.tsx:91` | — |
| Edge column | `scarcityGap` | FantasyPros ECR | `scarcityGap` | `sourceState.fetchedAt` | FP 0.85 | **column hidden** when `opportunity` missing (`showEdge`) | column dropped + disclosure note | `WaiverWire.tsx:34`,`:97` | `panelState.test.ts`, `derivedMetrics.stats.test.ts` |
| Scarcity | count of startable (`trueValue≥50`) per position | FantasyPros ECR | `rankFreeAgents` (`WaiverWire.tsx:141`) | `sourceState.fetchedAt` | FP 0.85 | always real (value-based) | computed from present pool | `WaiverWire.tsx:103` | — |
| Score | `trueValue` + edge·0.4 + `opportunity`·0.4 + scarcity·0.8 (edge/oppty only when present) | ECR + nflverse snaps | `rankFreeAgents` | `sourceState.fetchedAt` | FP 0.85 | value+scarcity only when `opportunity` missing | drops opportunity/edge terms | `WaiverWire.tsx:154` | — |
| FAAB board (per-team remaining budget, richest first) | `envelope.faab.budgets[]` = `{teamId, teamName, isMine, total, remaining, ratio}` | Sleeper `settings.waiver_type/waiver_budget` + per-roster `waiver_budget_used`; ESPN `acquisitionSettings` + per-team `transactionCounter` | `buildSleeperFaabState` / `buildEspnFaabState` (`lib/leagues/faab.ts`) | roster call (live, 120s TTL) | measured, not modelled | `<DataUnavailable>` naming the settings read, when the league is not FAAB | no board; "this league does not use FAAB" | `panels/sections/FaabBoard.tsx` | `faab.test.ts`, `toEnvelope.test.ts`, `e2e/30-news-and-faab.spec.ts` |

> **S4 (2026-08-31).** This row previously read *"UNKNOWN — no FAAB data integrated
> into this panel"*, and the panel said budgets were "not connected", while
> `fetchLive` extracted the budget for both platforms and the lifecycle cron fired
> `faab-depleted` alerts on it. The panel and the alert now read the SAME object.
>
> **Detection requires an explicit FAAB flag.** Sleeper sends
> `waiver_budget: 100` for every league whether or not it is bid — measured on
> 2026-08-31 against both of this account's leagues, each `waiver_type: 0`
> (rolling waivers) with `waiver_budget: 100`. Keying on the budget alone (which
> the pre-S4 extractor did) reports a full budget for every Sleeper league, so
> the gate is `waiver_type === 2`, mirroring ESPN's `isUsingAcquisitionBudget`.

---

## Trade Center (`trades` + `dashboard`)
`src/components/panels/TradeCenter.tsx` → `loadTradeValues`/`loadLeagueTrades` (`src/app/trade/actions.ts`)

| UI label | data field | source adapter | derivation fn | freshness | confidence/validation | live/fixture/unavailable | fallback when missing | file:line | test |
|---|---|---|---|---|---|---|---|---|---|
| Loading / Unavailable state | `state` from `loadTradeValues().available` | FantasyCalc → KTC → DynastyProcess | `fetchTradeValues` (`trade/values.ts:164`) | `source.fetchedAt` | 0.9 / 0.75 / 0.6 by tier | builder disabled with "showing fabricated values" refusal when all 3 fail | `unavailableSource` → disabled UI | `TradeCenter.tsx:55`, `values.ts:227` | `trade/values.test.ts`, `values.live.test.ts` |
| Trade Builder search + sides + total | `PlayerValue.value` | FantasyCalc/KTC/DynastyProcess | `fetchTradeValues` | `source.fetchedAt` | per-tier | builder hidden until `state==="ready"` | n/a | `TradeBuilder.tsx:21`,`:92` | `trade/values.test.ts` |
| Trade verdict (totals, fairness, winner) | side `value` sums | trade-values pool | `evaluateTrade` (`trade/evaluate.ts:24`) | `source.fetchedAt` | thresholds 0.1/0.25 | reads sums; no fabrication | n/a | `TradeBuilder.tsx:69` | `trade/evaluate.test.ts`, `trade/backtest.test.ts` |
| Recent League Trades (Side A/B, value, verdict) | executed transactions joined to `PlayerValue` by `sleeperId`/`espnId` | Sleeper/ESPN transactions + values | `fetchSleeperLeagueTrades`/`fetchEspnLeagueTrades` (`trade/transactions.ts`) | tx + value `SourceMeta` | grades only id-matched players | "No league trades to grade. Connect…" | empty state; KTC/DynastyProcess (no ids) grade nothing | `RecentLeagueTrades.tsx:7`, `transactions.ts:34` | `trade/transactions.test.ts` |

> Format header (e.g. "N-team · QB · PPR") comes from `league.settings` (the
> connected league's `LeagueFormat`) or `DEFAULT_FORMAT` when no league is connected
> (`actions.ts:34`,`:48`). The fallback is explicitly the default, not a fabricated
> league.

---

## Fixture / unavailable behavior (cross-cutting)

- **Fixture mode** (`src/lib/fixtures.ts`): anonymous/demo users get the handcrafted
  8-player catalog with `freshness: "fixture"`, `confidence: 0.42`, and assumptions
  that state values "must not be presented as live rankings." When daily crons have
  cached FantasyPros + Sleeper data, `publicDemoEnvelope` attaches the **real**
  searchable universe to the demo envelope (`envelope/load.ts:194`) — so Player
  Universe / Draft board are real even for logged-out users, while roster tiles stay
  labeled DEMO.
- **No-league signed-in user**: `loadEnvelope` returns `kind:"no-league"` →
  `<NoLeagueCTA/>` instead of any panel (`envelope/load.ts:78`).
- **Live with empty rankings cache**: `buildLiveEnvelope` still emits `mode:"live"`
  with identity-only records and a `degradedSourceState` that adds
  `market_value/true_value/ownership` to `missingFields` (`toEnvelope.ts:136`,`:231`)
  — every market tile then renders `"—"`.
- **Adapter outage**: `unavailableSource` (`governance.ts` (`unavailableSource`)) and the fail-open
  pattern in `fetchOpportunity` (`opportunity.ts:136`) / trending fetches
  (`envelope/load.ts:101`) ensure a single upstream failure never blocks the page;
  the affected metric simply declares itself missing.

---

# Audit 2026-08-20 §13 — epistemic classification, licensing, retention

The sections above map *where* each number comes from. This section adds the two
things §13 asks for that were missing: an explicit **epistemic class** for each
decision-facing value, and per-source **attribution, licensing and retention**.

## Epistemic classes

Every decision-facing value is exactly one of:

| class | meaning | may be presented as fact? |
|---|---|---|
| `provider-measured` | a real observation reported by an upstream (a score, a roster membership, a draft pick) | yes, with its freshness |
| `derived` | a deterministic function of measured inputs (positional rank, standings order, FAAB ratio) | yes, with its inputs named |
| `assumed` | a model parameter chosen by us, not fitted to an outcome | **only with the assumption stated** |
| `simulated` | output of the seeded Monte Carlo | **never as a forecast** — see §3 |
| `cached` | measured, but served from a snapshot older than the request | yes, with the snapshot's age |
| `stale` | cached past its freshness contract | only with the staleness shown |
| `fixture` | demo data | only with the FIXTURE badge |
| `unavailable` | no usable source | render "—", never a number |

## Classification of the decision-facing values

| value | class | notes |
|---|---|---|
| Roster membership (Sleeper) | `provider-measured` | live rosters call, TTL 120s |
| Player identity / position / team | `cached` | daily players snapshot |
| **Injury / activity status** | `cached` → `stale` past 24h | **corrected by §8.** Was stamped `fresh, now, ttl 120` regardless of snapshot age. Now bounded by the older input, and `stale` blocks alert resolution (§9) |
| Weekly projections (`pts_ppr` / `pts_half_ppr` / `pts_std`) | `provider-measured`, `cached` | **corrected by §7.** Carries all three variants; the unit is chosen at the simulation boundary from the league format. Cross-format substitution only for QB/K/DEF, where the three are provably identical — re-measurable via `npm run check:projection-units` |
| FantasyPros ECR rank | `provider-measured`, `cached` | daily scrape |
| `trueValue` | `derived` + `assumed` | derived from ECR rank, but via `positionReplacementRank`, which depends on the **assumed** `depthCushion = 1.2` and `superflexQbOccupancy = 1.0` |
| Replacement rank | `derived` + `assumed` | same two assumptions; sensitivity across 96 league shapes in `reports/2026-08-20/replacement-sensitivity.txt` |
| Playoff / championship percentages | **`simulated`** | **not a forecast.** Failed out-of-sample validation; presented as a band against the structural baseline (§3) |
| League structural baseline (`P/N`) | `derived` | arithmetic about league shape; the one figure that cannot be wrong |
| Confidence intervals on the sim | `simulated` | Monte-Carlo **sampling** error only — excludes model error, which is far larger |
| Trending adds/drops | `provider-measured` | Sleeper waiver signal; applied to the market pool, not a set roster |
| Snap-share opportunity | `provider-measured`, `cached` | nflverse cron snapshot |
| Trade values | `provider-measured`, `cached` | FantasyCalc / KTC / DynastyProcess |
| Bye weeks | `provider-measured` | verified current-season schedule; fails closed when unverified |
| Points curve / PAR | `assumed` (structure) + `derived` (fit) | **not read by production.** Monotonicity is imposed, not observed — see `docs/points-curve-assumptions.md` |

## Sources — attribution, licensing, retention

| source | URL | retrieval | TTL / contract | fallback | failure behavior | attribution / licence | retention |
|---|---|---|---|---|---|---|---|
| Sleeper API | `api.sleeper.app` | daily cron (players, projections); per-request (league, rosters, state) | players warn 24h / expire 30h | previous snapshot | `infraNull` logs once, panel renders unavailable | free public API, no auth, no published licence; undocumented projections endpoint captured 2026-05-27 | snapshots pruned on a rolling window |
| FantasyPros ECR | `fantasypros.com` | daily cron scrape | warn 24h / expire 30h | previous snapshot | rankings degrade to identity-only envelope | scraped consensus; no redistribution of raw rankings | rolling 7 days |
| nflverse | `github.com/nflverse` | cron snapshot | warn 2d / expire 15d | previous snapshot | opportunity dropped from records, listed in `missingFields` | **CC-BY** — attribution required and given | snapshot table |
| ESPN | `fantasy.espn.com` | per-request, cookie-encrypted | 300s | none | `unavailableSource` | private league data; credentials encrypted at rest | not snapshotted |
| FantasyCalc / KTC / DynastyProcess | respective APIs | daily cron | — | prior snapshot | trade values render unavailable | free public endpoints | snapshot table |
| **MyFantasyLeague** (new, audit §19) | `api.myfantasyleague.com/{year}/export` | one-off research pull, 2026-08-20 | n/a — archived, not live | n/a | acquisition aborts the league | free public API; requests carry an identifying User-Agent and are throttled; **429 is respected with exponential backoff** | archived to `reports/2026-08-20/holdout-data.jsonl.gz` for reproducibility of the frozen holdout; **not used at runtime and not shipped in the app bundle** |

## Freshness is never inferred from a wrapper call

The rule §13 states explicitly, now enforced in code: a request completing does
not make its *contents* fresh. `materializeSleeperRoster` composes two upstreams
of different ages and bounds the record's decision-relevant freshness by the
**older** one; a missing snapshot yields `fetchedAt: null` rather than borrowing
the roster call's timestamp. Pinned by `src/lib/leagues/fetchLive.test.ts`.
