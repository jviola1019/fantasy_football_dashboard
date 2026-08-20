# Audit 2026-08-20 — remediation ledger

**Repository** `jviola1019/fantasy_football_dashboard` ·
**Product** RAE — Reputation Arbitrage Engine

| | |
|---|---|
| Source branch | `fix/2026-08-06-forensic-remediation` |
| Audited source head | `69634d33a1347486a1d61eec33bde4a10cad4a2d` |
| Remote head at start | `69634d33a1347486a1d61eec33bde4a10cad4a2d` (**verified unmoved**) |
| Base branch / merge-base | `main` / `efb124bd7f5bf867f3fb29040d5cb1d680a6f7b3` |
| New fix branch | `fix/2026-08-20-audit-remediation` (created from the audited SHA) |
| PR | #21 OPEN **DRAFT** — stays draft while any P1 is open |
| Audit date | 2026-08-20 |

## 0. Capability inventory

Determined by execution, never from configuration files.

| Capability | State | Evidence |
|---|---|---|
| Local repository | `AVAILABLE` | `git status --short` clean at `69634d3` |
| Git | `AVAILABLE` | `git version 2.53.0.windows.3` |
| Terminal | `AVAILABLE` | Git Bash + PowerShell 5.1, win32 |
| GitHub | `AVAILABLE` | `gh` 2.95.0, account `jviola1019`, scopes `gist, read:org, repo` |
| GitHub Actions + logs | `AVAILABLE` | `gh run list` returned CI/CodeQL/Security runs on the audited SHA |
| Browser | `AVAILABLE` | Playwright chromium 1208/1217/1223/1228 installed |
| Playwright | `AVAILABLE` | `npm run e2e` wired to `playwright test` |
| SQLite | `AVAILABLE` | `better-sqlite3` native binding present |
| Isolated real PostgreSQL | `AVAILABLE` | **new** isolated cluster, PG **17.11**, `C:\tmp\rae-pgtest`, `127.0.0.1:55432`, db `rae_test`, role `raetest`. Separate from the operator's service on 5432, which is password-gated and was NOT touched. |
| Vercel | `BLOCKED` | Vercel CLI not installed; Vercel MCP unauthorized in a non-interactive session |
| Production database | `BLOCKED` | no credentials; not required and not attempted |
| Production deployment | `BLOCKED` | requires human approval; not attempted |
| Secret manager | `BLOCKED` | no authorized access — see §11 |
| Sleeper | `AVAILABLE` | `GET /v1/state/nfl` → 200 |
| ESPN | `UNKNOWN` | needs `ESPN_S2`/`SWID` for a private league; no public league id supplied |
| nflverse | `AVAILABLE` | releases endpoint → 200 |
| FantasyPros | `AVAILABLE` | cheatsheets endpoint → 200 |
| FantasyCalc | `AVAILABLE` | `values/current` → 200 |
| KTC / DynastyProcess | `AVAILABLE` | DynastyProcess `values.csv` → 200 |
| **MyFantasyLeague (new)** | `AVAILABLE` | public `export` API: `leagueSearch`, `league`, `draftResults`, `playerScores`, `leagueStandings`, `playoffBrackets` all 200 (302 → league host, needs redirect-follow). Rate-limits with HTTP 429 — throttle required. |
| Fleaflicker | `UNKNOWN` | API answers but returns "can not find league 1"; no league-discovery endpoint found |
| Plugins / MCP | `PARTIAL` | context7 available; figma/neon/supabase/vercel/huggingface MCP **unauthorized** (a non-interactive session cannot run OAuth) |

## Product decisions taken (per §3 / §11 / §19)

- **§3 → Strategy B.** The operator delegated the choice with the constraint
  "simplistic yet extremely accurate and readable for a regular user, mobile and
  desktop". Rationale and usability tradeoff: `docs/model-presentation-decision.md`.
- **§11 → generate a replacement token, persist nowhere.** A 256-bit candidate was
  produced and handed to the operator in-session only. It is written to no file and
  no commit. Independent verification that the *historical* token is dead remains
  `BLOCKED` (no secret-manager access) — operator runbook supplied.
- **§19 → acquire a genuinely untouched holdout from MyFantasyLeague.** Measured
  yield: **18,723** unique candidate league ids for season 2023 from 10 search
  terms; a 12-league structural probe found 7 full-draft redraft leagues at 8, 12,
  14 and 16 franchises. This replaces a 5-cluster development sample with hundreds
  of independent clusters and real format diversity.

## Finding ledger

Status values: `OPEN`, `IN-PROGRESS`, `FIXED`, `BLOCKED`, `CLOSED-VERIFIED`, `NOT-A-DEFECT`.

| § | P | Finding | Status |
|---|---|---|---|
| 3 | P1 | Shipped rank-ratio model fails out of sample; failure notice is not adjacent to the decision-facing percentages | `OPEN` |
| 4 | P1/P2 | PAR is an experiment, not a production replacement; the five leagues are now development data | `OPEN` |
| 5 | P2 | Pseudo-replication of player-seasons across leagues in PAR training data is unquantified | `OPEN` |
| 6 | P2 | Isotonic monotonicity is a structural assumption and must be labeled as one | `OPEN` |
| 7 | P1 | Live PPR/HALF/STD unit consistency | `OPEN` |
| 8 | P1 | Sleeper injury/status provenance is stamped fresh from a cached snapshot | `OPEN` |
| 9 | P1 | `injured-starter` is marked evaluated on roster membership alone | `OPEN` |
| 10 | P2 | 29 PostgreSQL integration tests are skipped in ordinary CI | `OPEN` |
| 11 | P1 | Historical `DB_INIT_TOKEN` invalidation is unverified | `BLOCKED` |
| 12 | P2 | League-format defaults are assumptions; need independent sensitivity | `OPEN` |
| 13 | — | Provenance classification of every decision-facing value | `OPEN` |
| 14 | — | Security/auth clean-room review + negative tests | `OPEN` |
| 15 | — | Supply chain, `GHSA-9wv6-86v2-598j` expiry 2026-11-11, Node-20 action runtime migration | `OPEN` |
| 16 | — | PR #21 body + README badge carry stale test counts | `OPEN` |

### Evidence established by reading source at `69634d3`

- **§7** — format selection *does* already happen before the numeric crosses the
  boundary (`src/lib/envelope/load.ts:154` calls `pickProjectionPoints(p, scoring)`).
  The residual defects are narrower than the audit brief states, but real:
  1. `pickProjectionPoints` falls back to `pts_ppr` when the format-specific field
     is null (`src/lib/leagues/scoringPoints.ts:18-19`), so a STD league can mix
     PPR-unit players into a STD-unit team measured against a 9.5 STD field.
  2. `SimulationParams.weeklyProjections` is documented "Real weekly **pts_ppr**"
     (`src/lib/simulation.ts:19-20`) — false for HALF/STD leagues.
  3. The user-visible assumption string claims "its real Sleeper **pts_ppr**
     projection" (`src/lib/simulation.ts:236`) — a provenance misstatement.
  4. No unit is carried across the boundary, so nothing structurally prevents a
     future mix.
- **§8** — `materializeSleeperRoster` (`src/lib/leagues/fetchLive.ts:303-329`)
  stamps `fetchedAt: new Date().toISOString()`, `ttlSeconds: 120`,
  `freshness: "fresh"`, `validation: "valid"` on every record, while
  `injury_status` originates in `playersMap` = `snapshot.players` from
  `getLatestPlayersSnapshot()`. `snapshot.fetchedAt` is in scope at line 219 and is
  discarded. **Confirmed as stated.**
- **§9** — `src/lib/lifecycle/notifications.ts:303`,
  `if (rosterKnown) evaluated.push("injured-starter")`, where
  `rosterKnown = input.roster.length > 0` (line 256). Roster membership is not
  injury knowledge. **Confirmed as stated.**
- **§3** — the "NOT VALIDATED OUT-OF-SAMPLE" string is `sim.assumptions[4]`.
  `RiskOfRegret` renders `assumptions.slice(0, 3)` truncated to 60 chars, so it is
  excluded; `RiskDetails` renders the full list but only inside the "Risk Analysis"
  tab. The default "Multiverse" tab shows `ConfidenceBands` —
  "Championship 12.4% [8.1 – 17.0]" under the heading "95% Confidence Bands" —
  with **no adjacent warning**. **Confirmed as stated.**

## Execution plan (verify + commit each segment)

1. **P1 code** — §7 scoring units, §8 injury provenance, §9 injury evidence gating.
2. **P1 UX** — §3 Strategy B.
3. **P2 CI** — §10 Postgres service job + local isolated-cluster evidence.
4. **Model validation infrastructure** — §5 dependence quantification, §6 curve
   assumption documentation, frozen protocol, MFL acquisition harness.
5. **Holdout execution** — acquire, execute **once**, report including failure.
6. **Close-out** — §12 sensitivity, §13 provenance, §14 security negatives,
   §15/§16 supply chain + docs, §11 runbook, clean-room re-review, PR update.

## Authorizations NOT exercised

No merge, no deployment, no credential rotation, no history rewrite, no production
database mutation, no destructive external write.
