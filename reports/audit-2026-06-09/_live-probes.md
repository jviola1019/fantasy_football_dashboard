# Live probes — 2026-06-09T18:29:22Z

## Deployment route status (unauthenticated)
| route | http | redirect | bytes | x-vercel-cache |
|---|---|---|---|---|
| / | 200 | - | 19301 | MISS |
| /dashboard | 200 | - | 753078 | MISS |
| /players | 200 | - | 849201 | MISS |
| /analytics | 200 | - | 777772 | MISS |
| /draft | 200 | - | 758833 | MISS |
| /waivers | 200 | - | 744088 | MISS |
| /trades | 200 | - | 743006 | MISS |
| /reports | 200 | - | 746671 | MISS |
| /login | 200 | - | 14400 | HIT |
| /settings/leagues | 307 | /login | 13739 | MISS |
| /settings/account | 307 | /login | 13699 | MISS |
| /mock-draft | 200 | - | 394977 | MISS |
| /api/health | 200 | - | 110 | MISS |


## /api/health body
```json
{"status":"ok","checks":{"authSecret":true,"credentialEncryptionKey":true,"databaseUrl":true,"database":"ok"}}
```

## /dashboard SSR signal scan (rendered HTML, 753078 bytes)
| signal | count |
|---|---|
| Loading | 0 |
| loading | 8 |
| skeleton | 1 |
| animate-pulse | 1 |
| Demo | 2 |
| demo | 6 |
| Fixture | 22 |
| fixture | 31 |
| Live | 0 |
| Unavailable | 0 |
| unavailable | 0 |
| Stale | 0 |
| stale | 0 |
| confidence | 1819 |
| Confidence | 0 |
| P( | 0 |
| Assumptions | 2 |
| Source | 610 |
| freshness | 1212 |

### sample mode/governance text (first matches)
```
live="polite" aria-label="Data mode: fixture. Freshness: fixture
Demo fixture data">fixture
fixture
demo-banner" role="status" aria-live="polite">
demo-banner-tag">DEMO DATA
demo-banner-msg">These tiles use a curated fixture catalog, not 
demo-banner-cta" href="/settings/leagues">Add a league →
demo-banner-close" aria-label="Dismiss demo notice for this sess
fixture catalog
fixture
Fixture values are handcrafted for UI, schema, and simulation devel
Fixture values must not be presented as live rankings, projections,
DemoBanner\"]\n14:I[98247,[\"/_next/static/chunks/0cycg-.8t8-8l.
fixture\",\"freshness\":\"fixture\",\"leagueOptions\":[],\"activeLe
fixture catalog\",\" · freshness \",\"fixture\",\" · confidence\"
Fixture values are handcrafted for UI, schema, and simulation devel
Fixture values must not be presented as live rankings, projections,
fixture\",\"generatedAt\":\"2026-05-13T00:00:00.000Z\",\"records\":
fixture catalog\",\"fetchedAt\":\"2026-05-13T00:00:00.000Z\",\"ttlS
fixture\",\"confidence\":0.42,\"validation\":\"valid\",\"missingFie
```

## Public free-data API probes
### Sleeper state/nfl
```json
{"week":0,"leg":0,"season_type":"off","season":"2026","league_season":"2026","previous_season":"2025","season_start_date":null,"display_week":1,"league_create_season":"2026","season_has_scores":true}
```
### Sleeper trending add (limit 5)
```json
[{"count":11628,"player_id":"8800"},{"count":6632,"player_id":"13424"},{"count":6324,"player_id":"13413"},{"count":6209,"player_id":"2078"},{"count":5373,"player_id":"13411"}]
```
### FantasyCalc current values (12tm, 1QB, PPR) — first 600 bytes
```json
[{"player":{"id":9833,"name":"Bijan Robinson","mflId":"16161","sleeperId":"9509","position":"RB","maybeBirthday":"2002-01-30","maybeHeight":"71","maybeWeight":215,"maybeCollege":"Texas","maybeTeam":"ATL","maybeAge":24.4,"maybeYoe":3,"espnId":"4430807","fleaflickerId":"17603","ffpcId":"28755"},"value":10464,"overallRank":1,"positionRank":1,"trend30Day":-3,"redraftDynastyValueDifference":0,"redraftDynastyValuePercDifference":0,"redraftValue":10464,"combinedValue":20928,"maybeMovingStandardDeviation":0,"maybeMovingStandardDeviationPerc":0,"maybeMovingStandardDeviationAdjusted":2,"displayTrend":fa
```
### nflverse data repo release availability (HTTP status)
- 200 https://github.com/nflverse/nflverse-data/releases/tag/player_stats
- 200 https://raw.githubusercontent.com/nflverse/nflverse-data/master/README.md

## Live browser runtime (/dashboard, Playwright)
- Console errors: 0, warnings: 0 (validates ba9f26e svg/favicon fix + 'no console errors' rule)
- Page title: 'RAE — Reputation Arbitrage Engine'
- Screenshots: screens/audit-dashboard-desktop.png (1440w full), screens/audit-dashboard-mobile.png (390w full)
