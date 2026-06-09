# RAE Dashboard — Production State Audit

> Captures the state of the deployed app on `fantasy-football-dashboard-seven.vercel.app` after the May 2026 infrastructure stand-up (auth, DB bootstrap, JSONB fixes, players-catalog cron, refresh-endpoint rewire). Identifies which features actually work today, which are demo-only, which are blocked on data sources, and the recommended order of work to make the dashboard honestly useful pre-draft for the 2026 season.

---

## Sprint update (2026-05-24)

Subsequent to the original audit, the following features from the priority list shipped via the `plan-for-all-four-composed-waterfall.md` sprint:

- **A — PreDraftAudit reads real league.settings.** `LeagueFormat` extended with `rosterSize`, `starters`, `tradeDeadlineWeek`, `playoffWeekStart`, `playoffTeams`, `scoringFormat`. Both Sleeper and ESPN parsers populate the new fields. `LiveLeagueSnapshot.format` and `RAEEnvelope.leagueFormat` thread the value through; PreDraftAudit panel reads it. Commits: `39dc095`, `9cea668`.
- **B (partial) — `<DataUnavailable>` shell + NarrativeEngine banner.** `src/lib/panelState.ts` + `src/components/ui/DataUnavailable.tsx`. NarrativeEngine renders the banner when narrative_pressure is missing. Commit: `c29ea67`. **Still TODO**: same wiring for MarketIntelligence, NexusSimulator, PlayerUniverse, WaiverWire.
- **C — multi-league switcher.** `src/lib/activeLeague.ts` httpOnly cookie + ownership-validated reads. `<LeagueSwitcher>` in the topbar (hidden for 0 leagues, label-only for 1, select for 2+). `setActiveLeagueAction` server action. Commit: `9628b58`.
- **D — NoLeagueCTA.** Signed-in users with zero connected leagues see the dedicated CTA instead of the fixture envelope. Commit: `b340b85`.
- **G — narrative_pressure proxy.** Sleeper 24h trending adds/drops normalised to `[-100, 100]` per player. Disclosure surfaced in SourceMeta.assumptions. Commit: `b340b85`.
- **Account isolation.** Two new tests in `leagues.test.ts` — cross-user credential retrieval defense + cascading-delete of encrypted creds. Commit: `b340b85`.
- **ESPN parity integration test.** `fetchLive.espn.test.ts` covers happy-path roster materialisation + SWID team identification + format extraction, plus cross-user defense + missing-credentials path. Commit: `12978b6`.
- **Statistical battery extension.** One-way ANOVA + Tukey connecting-letters (Bonferroni-corrected pairwise Welch) added to `src/lib/stats/distribution.ts`. Three risk-tolerance buckets of `runNexusSimulation` validated via ANOVA + connecting letters in `simulation.calibration.test.ts`. Commit: `7b6d0d9`.

**E — KTC adapter (Sprint 1 status: DEFERRED).** Day-1 probe confirmed `playersArray` is embedded inline on `keeptradecut.com/dynasty-rankings` (same pattern as FantasyPros), so the integration is feasible. Scope deferred because: (a) FantasyCalc API + DynastyProcess CSV fallback already meet the trade-grading need today, and (b) the cron schedule + ktc_snapshots DDL + values.ts integration is a coherent standalone PR. **Shipped in Sprint 2 — see below.**

**F — weekly projections (Sprint 1 status: DEFERRED).** Day-1 probe showed FantasyPros weekly projections pages have NO inline JSON; data is rendered as plain HTML `<table>` (cheerio-scrapable but more brittle). Pre-draft has no 2026 NFL schedule anchor for weekly projections, so deferring is honest. NexusSimulator currently presents season-aggregate sim outputs; a future commit can add a "Season-aggregate simulation — weekly projections not yet integrated" banner inside the panel. **Sprint 3 supersedes this with the undocumented Sleeper projections endpoint at `api.sleeper.app/projections/nfl/{season}/{week}` — see below.**

**B follow-ons (Sprint 1 status: PENDING).** Per-panel `<DataUnavailable>` wiring for MarketIntelligence + NexusSimulator + PlayerUniverse + WaiverWire follow the same pattern (`derivePanelState(envelope, [field-deps])` then conditional render). Each is a < 50-line PR. **Shipped in Sprint 2 — see below.**

Current sprint commits: `39dc095`, `9cea668`, `7b6d0d9`, `b340b85`, `9628b58`, `c29ea67`, `12978b6`. Test count: 215 → 259 (added 44, no regressions). CI green on every commit after the verify.test.ts fix in `9cea668`.

---

## Sprint update (2026-05-25): Sprint 2 completion

Sprint 2 ships the items left over from Sprint 1 plus a frontend polish pass and a security-relevant e2e regression gate. All four commits green on GitHub Actions (typecheck + eslint + vitest + playwright + lighthouse) and the KTC cron triggered live on prod, snapshotting 500 dynasty + 379 redraft player rows into Neon.

- **CI fix — e2e/07-no-shared-data.spec.ts.** Feature D's full-page `<NoLeagueCTA>` replacement (Sprint 1) silently broke the DemoBanner assertion. Spec rewritten to assert the CTA copy (`/bring your league/i` heading + `/connect a league/i` link) and to confirm DemoBanner is absent. Commit: `b4f01d7`.
- **B follow-ons — 4 panels honestly degrade.** `MarketIntelligence` (Sentiment + Liquidity Flow tabs gate on `narrative_pressure` / `opportunity`), `NexusSimulator` (CI bands widen 1.5× degraded / 2.5× unavailable via `widen()` helper), `PlayerUniverse` (radar axes for missing metrics render dashed via new `unavailable?: boolean` prop on `RadarChart`), `WaiverWire` (Edge column hidden when opportunity unavailable, "Pre-draft mode" footnote). `RaeApp` wires `envelope` through to all four. Commit: `b4f01d7`.
- **E — KTC adapter shipped.** `src/lib/ktc/{types,scrape,snapshot,match}.ts` + `/api/cron/ktc-refresh` (CRON_SECRET-gated, loops dynasty + redraft). New `ktc_snapshots` table in dual-driver schema (`src/db/schema.ts`, `schema-pg.ts`, INIT_SQL). `vercel.ts` cron registered at `0 9 * * *` (lifecycle-check moved to `30 9 * * *`). `src/lib/trade/values.ts` extended to a 3-source chain: FantasyCalc → KTC → DynastyProcess → unavailable, with KTC source meta `{ confidence: 0.75, freshness: "stale" }`. Commit: `31346dd`. **Live verification**: cron triggered 2026-05-25, 500 dynasty + 379 redraft players ingested.
- **Design polish.** `src/app/globals.css` — LIVE-badge pulse (opacity-only pseudo-element, 2s loop), KPI grid `repeat(auto-fit, minmax(140px, 1fr))` with 1-col mobile media query, `data-unavailable-reveal` animation (fade + slide-up, 280ms), `aurora-shift` background-position keyframe on NoLeagueCTA, `[data-tab-fade]` opacity-only tab body fade-through. All composite-path only; Lighthouse perf gate stayed ≥ 0.9. Commit: `4ef4673`.
- **Wrong-password e2e regression gate.** `e2e/14-wrong-password-error.spec.ts` registers a user, signs out, attempts sign-in with the wrong password, asserts the friendly error string from `src/lib/auth/errors.ts:mapAuthError` appears in the `.error-banner` `<p role="alert">` without redirect, asserts no Auth.js internals leak (no `CredentialsSignin`, no stack trace, no SQL/Drizzle/Postgres strings), then confirms the correct password still works. Located by class (not role) to avoid strict-mode collision with Next.js's built-in `<div role="alert" id="__next-route-announcer__">`. Commit: `4ef4673`.

Sprint 2 commits: `b4f01d7`, `31346dd`, `4ef4673`. Test count: 259 → 275 (added 16). All GH Actions jobs green. Prod sanity post-deploy: `/api/health` `status:"ok"`, `/` 200 with NoLeagueCTA aurora animating, KTC cron returning `{ ok: true, results: [{ scoring: "dynasty", playerCount: 500 }, { scoring: "redraft", playerCount: 379 }] }`.

---

## Sprint plan (2026-05-27): Sprint 3 in flight

Sprint 3 ships the real-data adapters where the data is honestly free, the quant calibration that `docs/calibration.md` already promises, a doc-truthfulness pass, and the 3-D Volatility Surface → 2-D Heatmap swap. Mobile + a11y coverage extended along the way. Plan file: `~/.claude/plans/plan-for-all-four-composed-waterfall.md` (top section).

- **Feature A — doc truthfulness + FAAB + fragility banner.** Doc rot fix (this AUDIT update + `README.md:252` + `src/app/api/cron/lifecycle-check/route.ts:10` comment). FAAB extraction (`fetchSleeperLive` surfaces `faabRemainingRatio` per roster from `settings.waiver_budget − rosters[i].settings.waiver_budget_used`; lifecycle cron passes real ratio instead of `null`; FAAB-depleted rule activates). Fragility `<DataUnavailable>` banner in CommandCenter RosterFragilityXRay.
- **Feature B — real data adapters.** `narrativePressure` → `trendingMomentum` rename across 18 files (clarifies that today's value is roster-move momentum, not news sentiment, before B5 introduces a real news-driven `narrativePressure`). New `src/lib/sleeper/projections.ts` adapter (undocumented `api.sleeper.app/projections/nfl/{season}/{week}` endpoint, returns `{ player_id, stats: { pts_ppr, ... }, company: "rotowire" }`) + snapshot module + cron at `15 9 * * *`. New `src/lib/espn/news.ts` adapter (`site.api.espn.com/.../news` returns articles with `categories[type=athlete].athleteId`) + snapshot + matcher + cron at `45 9 * * *`. NexusSim accepts optional `weeklyProjections: Map<sleeperId, pts_ppr>` and overrides `player.trueValue` when present. ESPN news velocity replaces the Sleeper-trending proxy as the `trendingMomentum` source (Sleeper-trending stays as fallback).
- **Feature C — real-outcome quant calibration.** `brierScore` (with Murphy decomposition: reliability + resolution + uncertainty), `reliabilityDiagram` (decile bins), `kFoldCV` added to `src/lib/stats/distribution.ts` with property-based tests. New `<ReliabilityDiagram>` SVG component. `scripts/brier-backtest.ts` (not a route, not a cron) fetches nflverse `stats_player_week_2025.csv`, reconstructs Friday-kickoff historical rosters, runs `runNexusSimulation` per week, computes Brier on championship probability, writes `docs/brier-results.md` with per-fold scores + bootstrap CI + reliability diagram. `docs/calibration.md` updated to link to the rendered results.
- **Feature D — 3-D → 2-D + a11y coverage.** `e2e/03-a11y.spec.ts` extended to scan `/settings/account`, `/settings/leagues`, `/mock-draft` (today only `/` and `/login` are scanned). Spot-fixes (`role="alert"` on status messages, `aria-live` on conditional ESPN-credential block, `aria-describedby` on instruction text). New `src/components/charts/Heatmap2D.tsx` (~80 lines, SVG, accessible per-cell `<title>`). Replace `<Canvas3D><VolatilitySurface/></Canvas3D>` in `NexusSimulator.tsx:169-173` + `MarketIntelligence.tsx:267-273` with `<Heatmap2D>`. Delete `src/components/three/*` if no other consumers + drop `three` + `@react-three/*` deps for bundle-size win.

Out of scope for Sprint 3 (Sprint 4 candidates): real NLP sentiment classification on news article bodies (today's signal is article-count headline velocity, recency-weighted), Yahoo Fantasy adapter (OAuth registration required), per-league ADP view, real injury / snap-share adapter (no honest free source today — `fragility` stays declared-unavailable), trade-comparison head-to-head UI for TradeCenter, Weekly Briefing card above CommandCenter.

---

## 1. Executive summary

**What works today.** Authentication, account isolation, Sleeper league add/list/delete, the full Sleeper players catalog (12,188 NFL identities) cached in Neon and refreshed daily, and a `/api/leagues/[id]/refresh` endpoint that returns every team's roster materialized with real player names plus the signed-in user's team identified by their Sleeper username.

**What's demo-only.** Every analytics panel on the homepage (Command Center, Market Intelligence, Player Universe, Narrative Engine, Nexus Simulator, Pre-Draft Audit, Draft Intelligence, Waiver Wire, Trade Center). They render `fixtureEnvelope()` — hand-tuned demo data — because the `PlayerMarketRecord` schema requires behavioral-market fields (`perceivedValue`, `trueValue`, `ownershipLeverage`, `fragility`, `narrativePressure`, `volatility`, `opportunity`) that the codebase has no real data source for. The Sleeper adapter sets all of them to `0` and the source metadata explicitly states *"RAE refuses to fabricate market intelligence from identity records alone."*

**What can be fixed without a roadmap-scope effort.** A FantasyPros ECR / ADP adapter via Firecrawl scraping. Free, no-login data, refreshes daily. Populates `perceivedValue` (ECR rank inverted) and `trueValue` (positional VBD) so the existing derivation functions and panels produce realistic outputs. Plus a few targeted panel changes so league-aware features (Pre-Draft Audit, Draft Intelligence) read the user's actual league settings instead of hardcoded 12-team PPR defaults.

**What's a real roadmap item.** Weekly projections, ownership %, narrative pressure (news/social sentiment), trade values calibrated to the user's league — each needs its own adapter and integration plan. None are achievable in a single session.

**Your specific league context.** `1265735061127311360` ("Creamy Les Coot 4.0") is a **completed 2025 league**, status `complete`, 10 teams, PPR. No 2026 league exists yet for your Sleeper user_id. Your username `jviola1019` resolves to user_id `862861230795325440`, which the team-resolution code in `fetchLive.ts` matches correctly.

---

## 2. Production infrastructure — verified state

| Component | State | Evidence |
| --- | --- | --- |
| Auth.js v5 with Drizzle adapter | ✅ Working | Sign-in succeeds, JWT session, `auth()` returns user_id in server actions |
| Per-user data isolation | ✅ Enforced at query layer | Every `listLeagues`/`getLeagueForUser`/`deleteLeagueForUser` filters by userId; FK with CASCADE delete; covered by `src/lib/leagues.test.ts` |
| Password hashing | ✅ scrypt (memory-hard, salted, `timingSafeEqual`) | [src/lib/passwords.ts](src/lib/passwords.ts) |
| Credential encryption (ESPN cookies) | ✅ AES-256-GCM, per-record IV, AEAD | [src/lib/crypto.ts](src/lib/crypto.ts) |
| Neon Postgres | ✅ Connected, schema bootstrapped, all 9 tables present | `/api/health` returns `{status:"ok",database:"ok"}` |
| Players snapshot cache | ✅ 12,188 players, 14.6 MB, refreshes daily 08:00 UTC | First successful run: `snapshotId 73306433-…` at 2026-05-24T03:50:44Z |
| `/api/leagues/[id]/refresh` | ✅ Calls `fetchLeagueLive` → 12 (or 10) rosters with real player names + team identification via Sleeper username | Commit `a03323b` |
| Vercel deployment protection | ⚙️ **Disabled** (per your decision) | Required for the app to be publicly accessible on hobby plan |
| `CRON_SECRET` | ⚠️ A value was pasted in chat and committed — **rotate** (value redacted 2026-06-09) | Used only for cron auth; low blast radius but was exposed |
| `DB_INIT_TOKEN` | ⚠️ A value was pasted in chat and committed — **rotate** (value redacted 2026-06-09) | One-shot use, schema already created |
| Neon DB password (`DATABASE_URL`) | ⚠️ Original value leaked and **already rotated** via Vercel/Neon (old value redacted 2026-06-09); current value never shared | Already replaced |
| User account password | ⚠️ A test-account password was leaked and committed — **change it from the app** (value redacted 2026-06-09) | If reused elsewhere, change there too |

### Open infrastructure todos

- **Rotate `CRON_SECRET` and `DB_INIT_TOKEN`** — both have low blast radius but pasted secrets should always be rotated. Regenerate, update in Vercel env vars, no redeploy needed.
- **Add a `.env.example` row for `CRON_SECRET`** — it's already there in the example file, but worth a sanity check that the README walks new contributors through setting it.
- **Consider squashing the two diagnostic `/api/health` patches** — `cd21596` + `3f9c386` were debugging commits that turned out to be permanently useful. They're shipping. Worth a single rewrite commit if you care about clean history.

---

## 3. Data-flow architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Daily 08:00 UTC                                                              │
│   Vercel cron → /api/cron/players-refresh → Sleeper /v1/players/nfl (19 MB) │
│                                          → players_snapshots (Neon JSONB)    │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ Signed-in user adds league                                                   │
│   /settings/leagues → addLeague() server action                              │
│   → verifyLeague() (Sleeper or ESPN identity check)                          │
│   → createLeague() → INSERT into leagues (settings as JSONB)                 │
│   → leagueCredentials INSERT (encrypted, ESPN only)                          │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ User triggers a league refresh                                               │
│   POST /api/leagues/[id]/refresh                                             │
│   → auth() → getLeagueForUser() (scoped to userId)                          │
│   → fetchLeagueLive()                                                        │
│     → Sleeper: league + rosters + users + players-snapshot (parallel)        │
│       → resolveSleeperRosterId(users, rosters, sleeperUsername) → myTeam     │
│       → materialize PlayerMarketRecord for every player on every roster     │
│     → ESPN: mTeam + mRoster + mSettings + decrypted credentials              │
│       → resolveEspnTeam(teams, swid) → myTeam                                │
│   Returns: { allRosters, myRoster, source, failure }                         │
│                                                                              │
│   ⚠️  NOTHING CONSUMES THIS OUTPUT IN THE UI YET.                            │
│      The dashboard at / renders fixtureEnvelope() unconditionally.           │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ Homepage render (the gap)                                                    │
│   GET / → src/app/page.tsx                                                   │
│   → if RAE_ENABLE_LIVE_HOMEPAGE=true: loadRAEEnvelope()                      │
│       → Returns mode:"unavailable" records:[] because no behavioral data     │
│   → else (default): fixtureEnvelope()  ← DEMO DATA, ALWAYS                   │
│   → <RaeApp envelope={…} />                                                  │
│   → Every panel derives metrics from envelope.records                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

The architectural problem: **a complete data path exists (`fetchLeagueLive`) and a complete UI exists (`RaeApp` + panels), but they're not connected.** The connection layer requires the missing behavioral-market fields, which is why nobody wired it up.

---

## 4. Panel-by-panel inventory

Each row: what the panel renders, what data it consumes, what's real vs. demo today, what would have to be true for it to work honestly with a real Sleeper league.

### 4.1 Command Center ([src/components/panels/CommandCenter.tsx](src/components/panels/CommandCenter.tsx))

Top-of-page dashboard with reputation edge, market inefficiency, narrative velocity, league advantage, chaos exposure, league pulse chart, narrative momentum (gainers/decliners), start/sit edge, roster fragility x-ray, lineup win probability.

- **Consumes:** `metrics: CommandMetrics` (all 5 fields), `players: PlayerMarketRecord[]` (all behavioral fields), `sim: SimulationResult`, `envelope: RAEEnvelope`
- **Real-data status today:** 0% — every metric averages behavioral fields that are 0 for Sleeper-only records.
- **Mode badge:** Already displays `FIXTURE` when `envelope.mode === "fixture"`. Working honesty signal.
- **Blocking gap:** Needs `perceivedValue`, `trueValue`, `narrativePressure`, `volatility`, `fragility` to be populated from a real source.
- **Smallest honest fix:** Once a FantasyPros ECR adapter populates `perceivedValue`/`trueValue` from rankings, `reputationEdge` and `marketInefficiency` become meaningful; the narrative/volatility/fragility metrics stay 0 → render those tiles as "metric unavailable" rather than "0.0%".

### 4.2 Market Intelligence ([src/components/panels/MarketIntelligence.tsx](src/components/panels/MarketIntelligence.tsx))

Inefficiency %, liquidity score, arbitrage count, market regime (Efficient / Inefficient), top inefficiencies list.

- **Consumes:** `MarketMetrics` derived entirely from behavioral fields.
- **Real-data status:** 0%. With 0-valued inputs returns `{ inefficiencyPct: 0, liquidityScore: 0, arbitrageCount: 0, marketRegime: "Efficient" (constant), topInefficiencies: [random 5] }`.
- **Smallest honest fix:** Same ECR/ADP integration unlocks `reputationEdge` → `marketInefficiency`. Narrative/ownership tiles still need their own adapters.

### 4.3 Player Universe ([src/components/panels/PlayerUniverse.tsx](src/components/panels/PlayerUniverse.tsx))

Searchable player list with positional filters; player profile card showing rank, value, ownership %, narrative score.

- **Consumes:** Full `PlayerMarketRecord` list.
- **Real-data status:** Identity-side works (name/position/team would render correctly if real data was piped); behavioral side is all 0.
- **Smallest honest fix:** Pipe `fetchLeagueLive`'s `allRosters` flattened into `records`. Show identity columns + grey out behavioral columns with "—" until ECR adapter lands.

### 4.4 Narrative Engine ([src/components/panels/NarrativeEngine.tsx](src/components/panels/NarrativeEngine.tsx))

Story collisions, narrative half-life, viral velocity, rising stars.

- **Consumes:** `narrativePressure`, `volatility` exclusively. No identity fallback.
- **Real-data status:** 0%. With zeros: collisions degenerate to "Player Name Fade Meets Stability Window" for arbitrary players.
- **Blocking gap:** Requires news/social sentiment data. **No free public source.** Roadmap-scope.
- **Recommendation:** Mark panel "Narrative data unavailable — integration roadmap" or remove from default tab strip until an adapter lands.

### 4.5 Nexus Simulator ([src/components/panels/NexusSimulator.tsx](src/components/panels/NexusSimulator.tsx))

Monte Carlo over the roster: championship %, top-3 %, playoff %, points for/against, final rank, scenario comparison (best/baseline/worst).

- **Consumes:** `SimulationResult` from `runNexusSimulation(players, params)`. Sim seeds from `trueValue` per player.
- **Real-data status:** 0%. Fed all-zero `trueValue` → ~uniform 8.3 % championship for every team, ~50% playoff, flat scenarios.
- **Smallest honest fix:** Once `trueValue` is real (from ECR/projections), the sim outputs become meaningful for the user's roster vs. the rest of the league. Sim itself is well-implemented and the bounds in `simToRow` already prevent over-100% probability artifacts.

### 4.6 Draft Intelligence ([src/components/panels/DraftIntelligence.tsx](src/components/panels/DraftIntelligence.tsx))

Live draft board, recommendations, tier collapse signals, multiverse (alt-draft scenarios). Lets user toggle picks into "myPicks" set.

- **Consumes:** `PlayerMarketRecord[]`, `recommend()`, `tiersByPosition()`, `tierCollapseSignals()`.
- **Real-data status:** Tier logic is sound but tiers degenerate to one giant tier per position when all `trueValue`s are 0.
- **Pre-draft potential:** **High.** With real ECR/ADP, this becomes a working mock-draft tool: pick players, see recommendations, watch tiers collapse. This is the highest-leverage panel for "pre-draft analytics."
- **Smallest honest fix:** ECR integration + a button to "Start Mock Draft" that initialises an empty `myPicks` set. Could optionally read your league's `draft_id` from Sleeper to display draft order / your slot.

### 4.7 Pre-Draft Audit ([src/components/panels/PreDraftAudit.tsx](src/components/panels/PreDraftAudit.tsx))

League settings checklist (scoring format, roster size, trade deadline, playoff weeks) and position strength grades.

- **Consumes:** Hardcoded `DEFAULT_STRATEGY = { teams: 12, rosterSize: 16, ... }` ← **wrong for your 10-team league.**
- **Real-data status:** The panel itself already marks "Read from league settings" rows as "warn" with note "Pending live league fetch wiring." Honest about its limits.
- **Smallest honest fix:** Plumb `league.settings` (which we now store as JSONB) into the panel via props. The schema's already populated by `verifyLeague` at add-time — just needs to flow through. This is a ~30-minute change.

### 4.8 Waiver Wire ([src/components/panels/WaiverWire.tsx](src/components/panels/WaiverWire.tsx))

Top adds, FAAB budget bars, "claim windows" projections.

- **Consumes:** `PlayerMarketRecord[]` + a hardcoded `faabBars` array.
- **Real-data status:** Sleeper has a public `/v1/players/nfl/trending/add` endpoint (already integrated in `getTrendingPlayers`). FAAB budget is real per-team data available in `rosters.settings.waiver_budget_used` for Sleeper.
- **Pre-draft potential:** N/A — this is an in-season tool. Show "available after Week 1" pre-draft.
- **Smallest honest fix:** Wire `getTrendingPlayers` into the "Top Adds" list. Read FAAB from `fetchLeagueLive` snapshot. Hide pre-draft.

### 4.9 Trade Center ([src/components/panels/TradeCenter.tsx](src/components/panels/TradeCenter.tsx))

Trade value calculator, partner suggester, deal analyser.

- **Consumes:** Player trade values from a value map.
- **Real-data status:** There's actually a `src/lib/trade/values.ts` and a test suite — partial implementation exists.
- **Pre-draft potential:** Limited. Trade values change weekly with performance.
- **Real-data source candidates:** **KeepTradeCut** (free, public, scrapable) for dynasty; **FantasyPros trade analyzer** for redraft.
- **Smallest honest fix:** Add a `tradeValuesAdapter` that pulls KeepTradeCut weekly snapshots. Out of scope for pre-draft.

---

## 5. Critical gaps, in priority order

### P0 — Immediate, session-scope

1. **Rotate `CRON_SECRET` and `DB_INIT_TOKEN`** (you have to do this — 2 min).
2. **Change your app password** (you have to do this — 1 min via /settings or by deleting the user row).
3. **Pipe `league.settings` into PreDraftAudit** so it reads your real 10-team PPR config instead of hardcoded 12-team. Already verifiable via `/api/leagues/[id]/refresh` response.

### P1 — Single-session work, ECR adapter unlock

4. **Build a FantasyPros ECR/ADP adapter via Firecrawl** that scrapes the public consensus rankings page (no login required), caches in a new `rankings_snapshots` table, refreshes daily via a cron sibling to `players-refresh`. Maps each player to a `perceivedValue` (inverted rank normalised to 0-100) and a `trueValue` (positional VBD: value over replacement at the same position).
5. **Wire the homepage to render real data when the user is signed in + has a league:**
   - `src/app/page.tsx` → if session + league: `fetchLeagueLive` + ECR overlay → real envelope
   - else: keep `fixtureEnvelope`
6. **Add per-field "metric unavailable" rendering** in CommandCenter / MarketIntelligence so behavioral fields without a source display as "—" instead of "0.0%". The `source.missingFields` array is already populated correctly — panels just need to read it.
7. **Build a working mock-draft mode in DraftIntelligence:** "Start Mock Draft" button → initialises picks from ECR-ordered players → user clicks picks → recommendations + tier collapse update live. No connected league required.

### P2 — Roadmap, future sessions

8. **Weekly projections adapter.** Source: FantasyPros weekly projections (paywalled tier) or build from `nflfastR` historical + ADP. Powers Nexus Simulator with realistic numbers.
9. **News/social sentiment adapter for `narrativePressure` / `volatility`.** No free direct source. Options: scrape RotoWire headlines + classify, or buy a sentiment API. Until then, Narrative Engine should be hidden.
10. **KeepTradeCut adapter for trade values** (dynasty) and FantasyPros redraft trade values. Powers Trade Center.
11. **In-season game-data adapter.** Once Week 1 starts: scores, snaps, targets, red-zone touches. Source: `nflfastR` (R package, public CSV mirror) or ESPN's public scoreboard endpoints. Powers all in-season panels.

### P3 — Tech debt

12. **Drizzle dual-schema discipline.** The codebase aliases `schema = sqliteSchema` and uses it for both drivers. Writes to columns where SQLite and Postgres encoders disagree (JSONB, TIMESTAMP, BYTEA) will keep breaking until each call site uses `pgSchemaTables` when on Postgres. We've fixed the two known cases (`leagues.settings` and `players_snapshots.fetchedAt`); audit the rest.
13. **Replace ad-hoc hardcoded league assumptions** (12-team in PreDraftAudit, 16-week regular season elsewhere) with values read from `league.settings`.
14. **Add e2e Playwright coverage for the production path** — sign in → add real Sleeper league → /api/leagues/[id]/refresh returns expected shape. Currently the test suite mocks Sleeper.

---

## 6. Plugin / external data integration opportunities

Available via this session's plugins:

| Source | URL | Auth | What it gives | Suggested use |
| --- | --- | --- | --- | --- |
| **FantasyPros ECR (consensus rankings)** | `fantasypros.com/nfl/rankings/consensus-cheatsheets.php` | None (public) | Per-position ranks across 50+ experts; PPR/half/standard variants | Drives `perceivedValue`, fixes Command Center, Market Intelligence, Draft Intelligence |
| **FantasyPros ADP** | `fantasypros.com/nfl/adp/overall.php` | None | Average draft position by format | Drives `Pre-Draft Audit` strategy, mock-draft realism |
| **KeepTradeCut redraft + dynasty values** | `keeptradecut.com` | None | Crowdsourced trade values | Drives `Trade Center` |
| **Sleeper Trending Adds/Drops** | `api.sleeper.app/v1/players/nfl/trending/{add\|drop}` | None (already integrated) | Trending players over last N hours | Drives `Waiver Wire` Top Adds list |
| **NFL.com / ESPN scoreboard** | Public JSON endpoints | None | Live game scores, drive charts | Drives in-season `Command Center` live tiles |
| **nflfastR play-by-play** | `github.com/nflverse/nflfastR-data` (CSV mirror) | None | Every play 2010-current with EPA, WPA, advanced stats | Drives in-season `Player Universe` advanced stats; needed for projections |

**My recommendation for the highest single-fix ROI:** Build the FantasyPros ECR adapter (P1.4 + P1.5) plus the metric-unavailable rendering (P1.6). That unlocks honest pre-draft analytics for the user without any other roadmap work and turns Draft Intelligence into a working mock-draft tool.

---

## 7. What you can verify right now, manually

In a browser logged into <https://fantasy-football-dashboard-seven.vercel.app>:

```js
// In DevTools Console — replace LEAGUE_ID with the UUID from /settings/leagues
fetch('/api/leagues/<LEAGUE_ID>/refresh', { method: 'POST' })
  .then(r => r.json())
  .then(j => {
    console.log('Team count:', j.teamCount);
    console.log('My roster size:', j.myTeamSize);
    console.log('Source:', j.source);
    console.log('Missing fields:', j.source?.missingFields);
    console.log('First player on my roster:', j.myRoster[0]);
  });
```

Expected output for your "Creamy Les Coot 4.0":
- `teamCount: 10`
- `myTeamSize: 15` (or whatever your roster size is — 14 starters + bench)
- `source.missingFields: ["market_value", "true_value", "ownership", "narrative_pressure", "fragility", "opportunity"]`
- First player shown with real `name`, `position`, NFL `team`, `imageUrl` from Sleeper CDN

This is the contract that the homepage / panels will eventually consume.

---

## 8. Glossary of "ambiguous stat" sources

Where 0-valued or fabricated outputs originate, for quick reference if you spot one in the UI:

| Field | Origin | Fix |
| --- | --- | --- |
| `perceivedValue` | `sleeperPlayerToRecord` hard-codes 0 | FantasyPros ECR adapter (P1.4) |
| `trueValue` | hard-coded 0 | Positional VBD over ECR (P1.4) |
| `ownershipLeverage` | hard-coded 0 | Yahoo/ESPN ownership %; no free source today |
| `narrativePressure` | hard-coded 0 | News sentiment adapter; no free direct source |
| `fragility` | hard-coded 0 | Injury-history adapter (`nflverse/nfldata` has this) |
| `volatility` | hard-coded 0 | Compute from weekly std-dev once in-season data flows |
| `opportunity` | hard-coded 0 | Target share / snap share; in-season; `nflfastR` source |
| `championshipProbability` | `runNexusSimulation` of 0-valued players | Real once `trueValue` is real |
| `inefficiencyPct` | `marketInefficiency` of 0-valued | Real once `perceivedValue` ≠ `trueValue` |
| Position grades A/B/C | `derivePositionGrades` over 0-valued edges | Real once edge is real |

---

*Document generated 2026-05-24 against `main @ a03323b`. Should be reviewed before merging any P0/P1 work and updated as adapters land.*
