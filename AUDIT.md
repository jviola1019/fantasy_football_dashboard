# RAE Dashboard — Production State Audit

> Captures the state of the deployed app on `fantasy-football-dashboard-seven.vercel.app` after the May 2026 infrastructure stand-up (auth, DB bootstrap, JSONB fixes, players-catalog cron, refresh-endpoint rewire). Identifies which features actually work today, which are demo-only, which are blocked on data sources, and the recommended order of work to make the dashboard honestly useful pre-draft for the 2026 season.

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
| `CRON_SECRET` | ⚠️ **Currently set to a value pasted in chat** (`m6w-9-wIcoqim8iQYR1k8cPye8dI2FFZ`) — **rotate** | Used only for cron auth; low blast radius but in chat history |
| `DB_INIT_TOKEN` | ⚠️ **Currently set to a value pasted in chat** (`O1XPAxA1AHygmy5u63aa8JRZ1oqoa3Q2`) — **rotate** | One-shot use, schema already created |
| Neon DB password (`DATABASE_URL`) | ⚠️ Original value (`npg_wkamJZAcjQ01`) leaked in chat, rotated once via Vercel/Neon integration; the rotated value is **not** in chat | Already replaced; new value never shared |
| User account password (`Matthew1019`) | ⚠️ Leaked in chat, **change from the app** | If you ever re-use this password elsewhere, change there too |

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
