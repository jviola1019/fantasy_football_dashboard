# Free NFL Data Source Matrix (Sprint 5, Phase 0)

> Verified live 2026-06-01. Every source is free (no paid tier; The Odds API needs a
> free-signup key only). Each must degrade to an honest **"unavailable"** on failure —
> never fabricate. Goal: replace any paid sentiment/news/injury/projection dependency.

## Recommended stack (wire in this order)

| # | Source | Endpoint | Signal | Status |
| --- | --- | --- | --- | --- |
| 1 | **Sleeper trending** | `https://api.sleeper.app/v1/players/nfl/trending/add` `/drop` (`?lookback_hours=24&limit=25`) | `trendingMomentum` | already wired |
| 2 | **nflverse** | `https://github.com/nflverse/nflverse-data/releases/download/<tag>/<file>` — `snap_counts/snap_counts_2025.csv`, `depth_charts/depth_charts_2026.csv`, `stats_player/stats_player_week_2025.csv` | `opportunity` (snap %, target share, depth rank) | new (Phase 7) |
| 3 | **Sleeper projections** | `https://api.sleeper.com/projections/nfl/<season>/<week>?season_type=regular` — **host is `api.sleeper.com` (NOT `.app`)**; `stats` has `pts_ppr`/`pts_half_ppr`/`pts_std` | weekly projections → Nexus/`trueValue` | partial (verify host) |
| 4 | **ESPN scoreboard** | `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` → `events[].competitions[].odds[]` | spread/total → implied team totals | new (optional) |
| 5 | **open-meteo** | `https://api.open-meteo.com/v1/forecast?...` | weather | already wired |
| 6 | **The Odds API** | `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?regions=us&markets=spreads,totals&apiKey=KEY` | odds cross-check (**500 req/mo** — cache 1/day) | optional |
| 7 | **ESPN news** | `https://site.api.espn.com/apis/site/v2/sports/football/nfl/news` | headline velocity (2nd momentum) | already wired |
| 8 | **FantasyPros ECR/ADP** | scrape `…/nfl/rankings/{consensus,half-point-ppr,standard}-cheatsheets.php` | `perceivedValue`, draft pool | already wired |

## Defer / high-risk

- **Reddit `.json`** — 2026: ~10 req/min unauth, IP-throttled, OAuth + descriptive `User-Agent` effectively required; could not even be fetched from CI. Use only as best-effort enrichment that degrades to "unavailable"; never a hard dependency.
- **Google Trends / pytrends** — no official API, fragile, ToS-gray. Skip v1.
- **ESPN injuries** (`sports.core.api.espn.com/.../teams/{1-32}/injuries`) — secondary confirm of Sleeper `injury_status` only.

## Cautions

- **2026 preseason data:** nflverse `depth_charts_2026` exists; `snap_counts_2026` / `stats_player_*_2026` do **not** yet (no games) — keep the 2025→2024 fallback.
- **ESPN hidden APIs** — undocumented, no SLA; validate with Zod, low QPS, cache.
- **The Odds API** — 500/mo; one league-wide pull/day ≈ 30/mo. Never per-game-per-load.
- **Sleeper** — projections host `api.sleeper.com`; trending/players host `api.sleeper.app`. Cache the ~5 MB players map ≤ once/day.
- Wrap every source so a failure degrades the signal to "unavailable" (governance-envelope contract), consistent with SPRINT5 risk (c)/A4.

*Phase 0 deliverable — sources for Phases 7 (Narrative/opportunity), 8 (Nexus projections), and ongoing.*
