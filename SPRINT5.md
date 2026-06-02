# Sprint 5 — League-Universe Data Model, Model Accuracy & Total QA

**Author:** Claude Opus 4.8 (`claude-opus-4-8`)
**Date opened:** 2026-06-01
**Status:** PLAN (awaiting approval — no code written yet)
**Predecessors:** Phases 1–9 (`TASKS.md`), Sprint 4 reverification (`reports/opus48-reverification.md`), 2026-06-01 audit (`reports/audit-2026-06-01.md`)

> **Prime directive (unchanged):** no synthetic data presented as real. Every number
> is a real source value, a real simulated frequency, or an explicitly-labeled demo
> fixture. Empty is honest; fabricated is not.

---

## 0. Scope decisions (locked with the owner 2026-06-01)

| # | Decision | Consequence |
| --- | --- | --- |
| D1 | **Plan first, then execute.** | This document is the deliverable; implementation starts after approval. |
| D2 | **ESPN = mocked coverage** (no real ESPN cookies this sprint). | ESPN correctness is proven by mocked-fixture integration tests + the public-path code; real-data verification stays Sleeper (jviola) + a second test account. |
| D3 | **Draft "2nd button" = "taken by opponent"** (generic). | One extra button per row removes the player from the pool to mock how the board falls. No per-team board this sprint. |
| D4 | **Season-mirror model.** Importing a league = the **completed season** (e.g. 2025) with full rosters. The app derives a **2026 upcoming league** (same teams / settings / size, **empty** rosters) — all players available pre-draft. Rosters are **re-pulled from ESPN/Sleeper on every account load**, so once the real 2026 draft completes the mirror auto-populates and the market flips to free-agents-only. Must work for **non-jviola** accounts and **PPR / Half-PPR / Non-PPR**. |

---

## 1. Guiding principles (Definition of Done for every phase)

1. **Real data only.** Empty rosters render as empty; missing fields render via `DataUnavailable`/`—`; fixtures stay `mode:"fixture"` behind the DEMO banner.
2. **Quant rigor.** Every model output is bounded, deterministic where seeded, and unit-tested for range + monotonicity + an honest calibration/identity. No magic constants without a documented anchor.
3. **Both data modes per tab.** Every tab of every model is verified against (a) the demo fixture and (b) live signed-in league data, in pre-draft and post-draft states.
4. **Designer-grade UI.** Consistent spacing scale, aligned numerics, fixed-width bar tracks, accessible (axe `serious`/`critical` = 0), responsive at 1440/1024/768/390.
5. **Multi-account safety.** Two accounts can never see each other's league/team data; no password/credential leaves the server.
6. **Test everything.** Playwright covers every route × viewport × auth-scope; vitest covers every model/tab transform.

---

## 2. Architecture decision — the season-mirror data model (the spine of this sprint)

Today every panel receives `players = envelope.records` = **the signed-in user's own roster** (`src/components/RaeApp.tsx:47`). That is why Market Intelligence, Waiver Wire, and Player Universe only ever see ~17 players. The fix is a new league-universe layer on the envelope.

### 2.1 New envelope shape (`src/lib/governance.ts`)
Add (all nullable/optional so legacy/fixture callers are unaffected):
- `draftState: "pre" | "post" | "unknown"` — derived from league status + roster fill.
- `season: { completed: string; upcoming: string }` — e.g. `{completed:"2025", upcoming:"2026"}`.
- `leagueUniverse: PlayerMarketRecord[]` — every draftable NFL player (Sleeper-active, fantasy positions), enriched with FantasyPros ECR where available. **Pre-draft market set.**
- `freeAgents: PlayerMarketRecord[]` — `leagueUniverse` minus the union of **all** teams' rosters. **Post-draft market + waiver set.**
- `allRosters: PlayerMarketRecord[][]` — already fetched in `LiveLeagueSnapshot`; surface it on the envelope so panels can verify every team, not just `myRoster`.

### 2.2 Draft-state detection (`src/lib/leagues/draftState.ts`, new)
- **Sleeper:** `league.status` (`pre_draft`/`drafting` → pre; `in_season`/`complete` → post) and/or the draft object; corroborate with "all rosters empty ⇒ pre".
- **ESPN:** `settings` present + any roster entries ⇒ post; zero rostered ⇒ pre.
- Pure function + unit tests over both platforms' fixtures.

### 2.3 The 2026 mirror (`src/lib/leagues/seasonMirror.ts`, new)
Three import cases, all converging on the same honest rule — *empty rosters are real, settings are real, the player universe is the current one*:
- **Case A — imported COMPLETED league (has history):** record its season as `completed`. Compute `upcoming = String(Number(completed)+1)` (clamp to the live `getNflState().season`). **Sleeper:** look up the user's leagues for `upcoming`; if a successor exists (match by `previous_league_id`/name) use it directly (genuinely pre-draft/empty until their draft). If none exists yet, synthesize an **upcoming view** from the completed league's real settings (teams, size, scoring, roster slots) with **empty** rosters — labelled "2026 (upcoming · undrafted)".
- **Case B — imported UPCOMING league with a predecessor (renewal chain):** use the real upcoming league directly.
- **Case C — brand-NEW empty league, no history (owner refinement):** the user adds a fresh league that has no prior season. Treat it as a pre-draft league: **all rosters empty** (same as the Case-A mirror), **settings taken from the newest available year** (the live `getNflState().season`), and the **full player universe** available pre-draft. `completed` is null; `upcoming` = current season.
- In every case rosters are either genuinely empty (undrafted) or the real fetched rosters — **never fabricated**. The "upcoming · undrafted" label is shown whenever rosters are empty.
- **Refresh-on-load:** on every authenticated homepage load, re-pull leagues + rosters (bounded, cached by short TTL) so a completed real draft flips `draftState` to `post` automatically. Wire in `src/app/page.tsx` + `loadRAEEnvelope`.

### 2.4 League player universe (`src/lib/leagues/universe.ts`, new)
- Source: the Sleeper players snapshot filtered to fantasy positions + active; enrich each with FantasyPros ECR (value/market) and Sleeper trending (momentum) via the existing `enrichRoster`/`fpDataToRecords` path. Honest missing-field declaration preserved.
- `freeAgents = universe.filter(p => !rosteredIdSet.has(p.id))` where `rosteredIdSet` = union of `allRosters`.

### 2.5 Scoring formats (PPR / Half / Non-PPR) — Phase 2
- `LeagueFormat.scoringFormat` is already parsed per league (`parseSleeperFormat`/`parseEspnFormat`). Thread it into: FantasyPros rankings selection (`STD`/`HALF`/`PPR` cheatsheets already exist), the weekly-points model in `seasonSim`/`simulation`, value/VOR in `models.ts`, and draft tiers. Add a format unit-matrix test (same roster, three scorings ⇒ ordered, sensible deltas; PPR lifts pass-catchers).

**Owner for §2:** `feature-dev:code-architect` (blueprint) → `feature-dev:code-explorer` (trace current flow) → implementation → `pr-review-toolkit:type-design-analyzer` (the new league/season types) + `pr-review-toolkit:silent-failure-hunter` (refresh-on-load error paths).

---

## 3. Phase plan

> Each phase: **Diagnosis (file:line) → Approach → Files → Tests → Acceptance.** Agents/plugins named per phase.

### Phase 0 — Spikes & research (de-risk before building)
- **Free-narrative sources** (replaces "paid sentiment/news"): verify and prototype, ToS-checked, all free —
  - ESPN hidden news API (already wired: `src/lib/espn/news.ts`) → headline velocity.
  - Sleeper trending adds/drops (already wired) → momentum proxy.
  - Reddit public JSON (`/r/fantasyfootball`, `/r/nfl` `.json`, no auth) → mention volume + lexicon sentiment.
  - nflverse / nflreadr (depth charts, snap %, target share, routes) → **opportunity** without a paid feed.
  - The Odds API free tier / ESPN scoreboard → implied team totals (game environment).
  - **Research agent:** `general-purpose` + `firecrawl`/`WebSearch` to confirm endpoints, rate limits, ToS; output a one-page source matrix.
- **Draft-state + mirror spike:** confirm Sleeper `previous_league_id` chaining + `status` values against the live API (jviola's WDNY FFL 2024→2025 chain).
- **Test account:** create a 2nd local RAE account + attach a public Sleeper league (no creds needed) for multi-account/isolation testing.
- **Acceptance:** `docs/data-sources.md` written; spikes proven against live Sleeper.

### Phase 1 — Season-mirror data model (§2.1–2.4)
- **Approach:** as §2. New modules `draftState.ts`, `seasonMirror.ts`, `universe.ts`; envelope fields; refresh-on-load.
- **Tests:** pure-function unit tests (draft-state both platforms; universe/free-agent set ops; mirror settings copy + empty rosters); integration test that a completed league yields `draftState:"post"` + non-empty `freeAgents`, and an empty-roster league yields `draftState:"pre"` + `leagueUniverse` = full pool.
- **Acceptance:** envelope exposes `draftState`, `leagueUniverse`, `freeAgents`, `allRosters`, `season`; verified live on jviola's 2025 league (post) and a synthesized 2026 mirror (pre).

### Phase 2 — Scoring formats (§2.5)
- **Acceptance:** PPR/Half/Non-PPR each select the right FantasyPros cheatsheet, weight the weekly model, and reorder value sensibly; format-matrix tests pass; UI shows the active scoring per league.

### Phase 3 — Command Center "League Pulse" fix
- **Diagnosis:** bar lives in the variable-width `.player-row-info` flex column (`src/components/PlayerRow.tsx:64-70`), so equal `barPct` ⇒ unequal pixels; the metric column isn't fixed-width; "amount of green" tracks `trueValue/maxVal` against an inconsistent track.
- **Approach:** give the bar a **fixed-width track** (own grid column, not under the name), scale by a stable league max, right-align the metric in a fixed numeric column, cap rows shown, and make the leaderboard a proper 3-column grid (rank | player+bar | value). Make the bar genuinely useful: encode a meaningful, labeled quantity (e.g. value-vs-replacement percentile) with a legend, not a bare ratio.
- **Tests:** Playwright visual + a unit test on the bar-scale helper; axe.
- **Acceptance:** bars monotonic with the numbers, aligned numerics, looks designed at all four widths.
- **Plugin:** `frontend-design` for the redesign; `pr-review-toolkit:code-reviewer` after.

### Phase 4 — Global UI/UX: tabs + spacing
- **TopBar (the 10px):** the system nav sits too close to the header bottom (`src/components/shell/TopBar.tsx`). Add top breathing room / nudge the nav up ~10px via the header padding + nav `pb`; verify the sliding underline still clears the baseline. (Recommended: increase header top padding rather than negative-margin the nav.)
- **PanelTabs spacing/aesthetic** (`src/components/ui/PanelTabs.tsx`): increase inter-segment gap + horizontal padding, add a touch more vertical rhythm, ensure the Market Intelligence 6-tab strip breathes and scrolls cleanly; keep the segmented sliding pill. Apply consistently to every panel's tab strip.
- **Acceptance:** consistent spacing scale across all tab strips; no clipped wording; axe + responsive pass.
- **Plugin:** `frontend-design`; `vercel:react-best-practices` pass on the touched TSX.

### Phase 5 — Market Intelligence
- **Player set:** consume `leagueUniverse` pre-draft and `freeAgents` post-draft (Phase 1) instead of `envelope.records`. Verify **all teams** contribute (free agents = universe − ∪ allRosters).
- **Tabs:** Market Pulse, Liquidity Flow, Sentiment, Arbitrage, **Trends** (already the honest joint heatmap), **Price Discovery**. Space the strip (Phase 4). Each tab audited for accuracy on demo + live, pre + post draft.
- **Price Discovery:** the line graph is weak for an unordered cross-section (`src/components/panels/MarketIntelligence.tsx`). Replace with a **value-vs-ECR scatter / ranked dot-plot** (perceived vs true, mispricing as the gap) — genuinely informative, honest, accessible.
- **Acceptance:** pre-draft shows the full draftable universe; post-draft shows only free agents; every tab correct in both data modes; Price Discovery replaced and useful.
- **Agents:** `feature-dev:code-reviewer` + `pr-review-toolkit:comment-analyzer`.

### Phase 6 — Player Universe
- **Audit:** accuracy of grid values, radar axes (already honest per the 2026-06-01 review), search/sidebar sync, tab set (Universe/Tiers/Comparison/Watchlist/Projections) — confirm each tab is wired, spaced, and correct on demo + live; fix any dead/placeholder tab.
- **Acceptance:** every tab functional + spaced; values reconcile with source; responsive + axe pass.

### Phase 7 — Narrative Engine (free sources)
- **Approach:** wire the Phase-0 free sources into real `trendingMomentum` + a new **opportunity** signal (snap %/target share/routes from nflverse) so the panel stops declaring everything unavailable — while still declaring genuinely-missing fields honestly. Keep "heuristic, not detected news" labelling where it applies.
- **Acceptance:** Narrative Engine shows real momentum/opportunity from free data with provenance; no paid dependency; honest gaps remain labeled.

### Phase 8 — Nexus Simulator
- **Points-for/against:** replace the magic `sum(trueValue)*16` / `*(2-scale)*0.97` (`src/lib/derivedMetrics.ts:83,102-103`) with values anchored to the **real weekly-points model** (`starterWeeklyMean × regularSeasonWeeks`, opponents from the field model) so scenario points reconcile with the season sim.
- **Drivers:** make `keyDrivers` reflect actual marginal contribution (per-starter weekly mean above replacement), not raw mean; label units.
- **Full-dataset test:** run the sim across demo, live-roster, and live-projection paths; verify champ/playoff/points all bounded and sensible; extend calibration tests.
- **Acceptance:** points-for/against realistic and tied to the model; drivers meaningful; tests green across all datasets.
- **Agent:** `general-purpose` quant-review pass (like the 2026-05-30 model review).

### Phase 9 — Draft Intelligence
- **Per-round system:** make `recommend.ts` round-aware — early rounds weight elite RB/WR/positional scarcity; **K and DEF heavily de-prioritized until the last 1–2 rounds** (lower their value + target-round). Replace the flat `DEFAULT_TARGETS` (`src/lib/draft/recommend.ts:23`) with round/positional-scarcity logic; unit-test the round behavior + kicker de-prioritization.
- **Two buttons per row (D3):** add a second action — **"Draft to my team"** and **"Taken (opponent)"** — the latter removes the player from the available pool to mock board flow. Track both sets; reset control.
- **Pool:** confirm the full FantasyPros pool (incl. rookies — verified 2026-06-01) drives the board.
- **Acceptance:** recommendations sane per round; kickers late; two-button mock flow works; tests cover round logic + both buttons (Playwright).

### Phase 10 — Waiver Wire
- **Player set:** consume `freeAgents` (post-draft) / `leagueUniverse` (pre-draft) — currently it gets `players={players}` (my roster), which is wrong. "Importance" from scarcity + opportunity (Phase 7) + value, real data only.
- **Acceptance:** shows all unrostered players (verified against ∪ allRosters); ranked by a defensible importance score; honest when opportunity data absent.

### Phase 11 — Trade Center
- **Verify:** Trade Builder + Recent League Trades against demo + live (Sleeper); tab spacing (Phase 4); confirm format-aware values (Phase 2); honest degradation when value sources fail.
- **Acceptance:** both tabs correct + spaced; values format-aware; graceful failure.

### Phase 12 — Account / security / multi-account
- **Multi-account:** create a 2nd account + league (Phase 0); Playwright proves account B sees **none** of account A's leagues/rosters/notifications; passwords/credentials never serialized to client; ESPN creds stay encrypted/server-only.
- **Re-audit:** run the `security-review` skill + a `pr-review-toolkit:silent-failure-hunter` pass over the new refresh-on-load + universe code.
- **Acceptance:** isolation e2e green for 2 accounts; security review clean; no secret in any client payload.

### Phase 13 — Comprehensive Playwright ("every line, every scope/size")
- **Matrix:** every route (`/`, `/login`, `/settings/leagues`, `/settings/account`, `/mock-draft`) × {chromium, mobile-chrome, 1440/1024/768/390} × {anonymous, signed-in-no-league, signed-in-pre-draft, signed-in-post-draft}.
- **Per-panel specs:** each model × each tab × {demo, live} — assert real values render, no `NaN`/`undefined`/placeholder, no horizontal overflow, axe `serious`/`critical` = 0.
- **Acceptance:** full matrix green in CI; coverage report shows every panel/tab touched.

### Phase 14 — Quant / backtest / docs audit + final review
- **Re-run** all gates + the live 2025 Brier backtest (must reproduce); re-validate trade calibration (`docs/trade-calibration.md`).
- **Docs:** update README (player-universe model, scoring formats, draft 2-button, narrative free-sources), `TASKS.md` Phase 10, a new `reports/audit-sprint5.md` ledger; zero context rot.
- **Final review:** `coderabbit` + `pr-review-toolkit` (code-reviewer, type-design-analyzer, pr-test-analyzer, comment-analyzer) + optional owner-run `/code-review ultra`.
- **Acceptance:** all gates green, CI green, backtest reproduced, docs accurate, reviews clean.

---

## 4. Agent / plugin map

| Work | Agent / plugin / skill |
| --- | --- |
| Architecture blueprint (§2) | `feature-dev:code-architect` |
| Trace existing data flow | `feature-dev:code-explorer` |
| Free-source + endpoint research | `general-purpose` + `firecrawl` / `WebSearch` / GitHub (nflverse) |
| UI redesign (League Pulse, tabs, Price Discovery) | `frontend-design` + `vercel:shadcn` + `vercel:react-best-practices` |
| Quant-model correctness | `general-purpose` quant-review (per 2026-05-30 pattern) |
| Type design (new league/season types) | `pr-review-toolkit:type-design-analyzer` |
| Error handling (refresh-on-load, fetch) | `pr-review-toolkit:silent-failure-hunter` |
| Test coverage | `pr-review-toolkit:pr-test-analyzer` |
| Comments/docstrings | `pr-review-toolkit:comment-analyzer` |
| Simplification pass | `code-simplifier` |
| Security / isolation | `security-review` skill |
| Automated review | `coderabbit` + (owner) `/code-review ultra` |
| E2E | Playwright (`@axe-core/playwright`, mobile-chrome) |

---

## 5. Sequencing & risk

1. Phase 0 (spikes) → 1 (data model) → 2 (scoring) are the **foundation**; everything else depends on the league-universe + draftState landing first.
2. UI phases (3,4,5 visuals, 6, 11) can parallelize after the data model.
3. Model phases (7,8,9,10) depend on the universe/free-agent sets.
4. 12–14 are the closing gates.

**Top risks:** (a) the 2026-mirror synthesis must never look like fabricated rosters — mitigate with explicit "undrafted" labeling + empty arrays; (b) refresh-on-load latency/cost — mitigate with short-TTL cache + bounded fetch; (c) nflverse/Reddit ToS + rate limits — gate behind Phase-0 verification, fall back to honest "unavailable" if a source is unusable; (d) format matrix correctness — lock with the Phase-2 test matrix.

---

## 6. Definition of Done (sprint)

- [ ] Market Intelligence + Waiver Wire show the **whole league universe** pre-draft and **free agents** post-draft, verified across **all teams** and a **non-jviola** account, for **PPR/Half/Non-PPR**.
- [ ] 2026 mirror auto-derives from an imported completed league; rosters refresh on load; draft completion flips pre→post automatically.
- [ ] League Pulse, all tab strips, Price Discovery redesigned — aligned, spaced, accessible, responsive.
- [ ] Narrative Engine runs on **free** sources; Nexus points/drivers realistic; Draft per-round + kicker-late + 2-button; every model/tab correct on demo **and** live data.
- [ ] Multi-account isolation proven; no credential/password leak.
- [ ] Playwright covers every route × viewport × scope; vitest covers every transform; backtest reproduces.
- [ ] Docs accurate (no context rot); CI green; final reviews clean.

---

## 7. Open assumptions (flag if any is wrong before execution)

- A1: ESPN real-league behaviour is acceptable to verify via mocked fixtures this sprint (D2).
- A2: The 2026 mirror may be **synthesized** from the completed league's settings with empty rosters when no real successor league exists yet (D4) — labeled "upcoming · undrafted".
- A3: "Importance" for waivers may combine scarcity + opportunity (free nflverse) + value; exact weights tuned in-phase and disclosed.
- A4: Free sources (Reddit/nflverse/Odds) are usable under their ToS at our volume; if not, the affected signal degrades to an honest "unavailable" rather than blocking the sprint.

*Plan authored by Claude Opus 4.8, 2026-06-01. Awaiting approval before any code is written.*
