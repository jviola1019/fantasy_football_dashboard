# 03 — Data Pipeline Audit (adapters, envelope, schemas, freshness, crons)

Worker: `data_pipeline_auditor`. Branch `audit/2026-06-09` (== origin/main = production).
Scope: envelope/contracts, league core, adapters, crons/refresh, freshness, fixture/live switching.
Method: READ-ONLY. Evidence = file:line and/or commit. Severity S0–S3, confidence H/M/L.

Decision standards applied: code is source-of-truth over docs; a fallback that
degrades **honesty** (labels data unavailable/stale) is GOOD; a fallback that
degrades **usefulness silently** (substitutes without labeling) is BAD; a
truncated "full universe" is a correctness/governance issue.

---

## Strengths (verified)

1. **Schemas are real zod contracts, not type-only.** `SourceMeta`, `PlayerMarketRecord`,
   `RAEEnvelope` are all `z.object(...)` with `z.infer` types (`src/lib/governance.ts:7,20,41`).
   `FreshnessState` is an enum (`governance.ts:4`). Optional Sprint-5 fields
   (`leagueUniverse`, `freeAgents`, `draftState`, `season`, `allRosters`) are
   `.nullable().optional()` so older payloads parse (`governance.ts:77–94`).

2. **Adapter payloads are validated at every network boundary — never trusted.**
   The shared `fetchWithEnvelope` does `schema.safeParse(raw)`; on failure it
   returns `data:null` with `validation:"invalid"`, `freshness:"unavailable"`,
   and a redacted failure reason (`src/lib/http.ts:57–74`). ESPN
   (`espn/client.ts:46`→`league.ts:24` w/ `EspnLeagueResponseSchema`), Sleeper
   players (`sleeper/players.ts:65`), FantasyPros (`fantasypros/scrape.ts:60`
   `FpEcrDataSchema.safeParse`), nflverse (`OpportunityMapSchema`,
   `opportunity.ts:37`), FantasyCalc (`FantasyCalcResponseSchema.parse`,
   `trade/values.ts:43,56`) all validate.

3. **Snapshot store validates on BOTH read and write.** `makeSnapshotStore`
   `safeParse`s on read (`db/snapshotStore.ts:95`) and `schema.parse`s on write
   (`:123`) so schema drift is caught before persisting. A corrupt cached row
   returns `null` → caller declares the source missing.

4. **Crons are auth-guarded with a timing-safe compare and write timestamped
   snapshots.** Every cron checks `CRON_SECRET` and `safeEqual(auth, "Bearer …")`,
   returning 503 if unset and 403 if mismatched (e.g.
   `cron/players-refresh/route.ts:13–21`, `rankings-refresh:26–34`,
   `opportunity-refresh:29–36`, `ktc-refresh:27–34`, `news-refresh:25–33`,
   `projections-refresh:34–41`, `lifecycle-check:23–30`). Each insert records
   `fetchedAt` and prunes older rows. Errors are redacted (`lib/redact.ts`).

5. **Honest degradation is the default.** `unavailableSource` (`governance.ts:106`)
   carries the assumption "No production values are fabricated when the adapter
   cannot provide data." Identity-only records get every market field flagged via
   `withMissingMarketFields` (`normalize.ts:117`). `buildLiveEnvelope` still emits
   `mode:"live"` with identity-only records + `degradedSourceState` adding
   `market_value/true_value/ownership` to missingFields when rankings are absent
   (`toEnvelope.ts:136–155,231`). nflverse/trending fetches fail-open to null
   (`load.ts:101–107`, `opportunity.ts:136–148`).

6. **Fixtures are always labeled.** `freshness:"fixture"`, `confidence:0.42`, and
   assumptions "must not be presented as live rankings" (`fixtures.ts:4–17`).
   `publicDemoEnvelope` keeps the demo roster labeled while attaching a real
   searchable universe when crons have cached data (`load.ts:194–214`).

7. **`loadEnvelope` is request-cached.** `export const loadEnvelope = cache(resolveEnvelope)`
   (`load.ts:221`) dedupes the expensive resolution across the route shell + all
   route segments per request.

8. **Free-agent id namespace is correct and regression-tested.** Universe and all
   rosters both come from `sleeperPlayerToRecord` (`sleeper:<id>`), so
   `buildFreeAgents` subtraction matches exactly (`buildUniverse.ts:21–52`;
   tests `buildUniverse.test.ts:61–78`, including a REGRESSION test). Verified
   green: `npx vitest run buildUniverse.test.ts` → 4 passed.

---

## Issues (exact, with root cause)

### S2 — Free agents are derived from the **truncated top-600 universe**, not the full universe. (confidence H)

`toEnvelope.ts:132` truncates the universe to the top 600 by `trueValue`
(`UNIVERSE_LIMIT = 600`), then `:134` computes free agents from that **already
truncated** list:

```ts
const sorted = [...full].sort((a, b) => b.trueValue - a.trueValue).slice(0, UNIVERSE_LIMIT);
leagueUniverse = withOpportunity(sorted, oppScores);
freeAgents = buildFreeAgents(leagueUniverse, allRosters);   // ← from top-600, not `full`
```

Root cause: `buildFreeAgents` is given `leagueUniverse` (capped) instead of
`full`. Consequence: any genuinely-available waiver player ranked below 600 by
`trueValue` can never appear in the post-draft free-agent / waiver pool, even
though it exists upstream. Because the cap is value-sorted the *top* waiver
targets are present, and the cap is documented in the comment ("top ~600 covers
everything draftable plus deep waiver targets", `:30–32`) — so this is a
usefulness truncation, not silent data substitution. It is still a "full
universe is truncated" governance concern: the Waiver panel's pool is silently
bounded with no on-screen "showing top N" disclosure. The post-draft set is
also a *smaller* slice of a *larger* roster reality, which makes the bound more
visible than pre-draft.

Remediation: subtract rosters from `full` first, then cap the free-agent list
for serialization (and/or surface a "top N by value" note on the Waiver panel).

### S3 — `UNIVERSE_LIMIT` (600) duplicated across two files with no shared constant. (confidence H)

The cap exists independently at `toEnvelope.ts:32` (`UNIVERSE_LIMIT = 600`) and
`load.ts:205` (`.slice(0, 600)` in `publicDemoEnvelope`). Two literals that must
stay in lockstep can drift (the live universe and the demo universe would then
have different bounds). Drift risk only; behavior is consistent today.
Remediation: export one constant and import it in both places.

### S3 — DOC DRIFT: `data-source-map.md` cites `toEnvelope.ts:181–209` and `:231` for the freshness/missingField union, but the union now lives at `:181–183` and `degradedSourceState` at `:231`. (confidence M)

`docs/data-source-map.md:34` says the union + worse-of-two-freshnesses is at
`toEnvelope.ts:181–209`; the actual `missingUnion`/`compositeFreshness` is at
`:181–187`, and several other doc line refs (e.g. `governance.ts:98/:106`) are
correct. Minor line-number rot from refactors — the *described behavior* is
accurate and matches code. Decision standard says flag doc/code drift even when
benign. Remediation: refresh line anchors or replace with symbol references.

### S3 — Trade-value fallback: comment/code reviewed for mismatch — **NO mismatch found**, but the secondary/tertiary tiers are mislabeled "stale" regardless of snapshot age. (confidence H)

The specifically-requested check (a comment claiming one source order while code
does another) was performed on `src/lib/trade/values.ts`. The chain is
**consistent**: code runs FantasyCalc (`:164–183`) → KTC cached snapshot
(`:186–204`) → DynastyProcess CSV (`:207–226`) → `unavailableSource` if all fail
(`:227–240`); the doc (`data-source-map.md:87`) and the inline comments
(`:185` "Secondary: KeepTradeCut", `:206` "Tertiary: DynastyProcess") match.
However a secondary observation: the KTC and DynastyProcess branches hardcode
`freshness:"stale"` (`:194`, `:213`) and a fresh `fetchedAt:new Date()` even
though the underlying KTC snapshot has a real `fetchedAt` and could be fresh.
This is conservative (errs toward "stale" = honest under-claim, GOOD per the
honesty standard) but slightly misrepresents the snapshot age. Low priority.
Also note (`:143`): the Superflex value-scale branch is admittedly approximate
("a future commit can branch by format") — declared, not hidden.

### S3 — `RAE_ENABLE_LIVE_HOMEPAGE` ops-override path returns an empty `unavailable` envelope (no universe, no records). (confidence H)

When `RAE_ENABLE_LIVE_HOMEPAGE=true` (`load.ts:61`), `loadRAEEnvelope`
(`sleeper/players.ts:28–99`) returns `mode:"unavailable"` with `records:[]` and
NO `leagueUniverse`/`draftPool` — Sleeper "provides identity only; behavioral-
market metrics not derived from identity" (`:96`). This is honest (clearly
labeled unavailable, no fabrication) but the override is effectively a stub that
shows nothing useful; operators toggling it for a "live homepage" get an empty
board. Not a data-integrity defect (no silent substitution), but a foot-gun.
Remediation: either build the real universe in this path or document that the
override is identity-only.

### S3 — Demo universe is enriched WITHOUT trending/news signals. (confidence M)

`publicDemoEnvelope` calls `buildLeagueUniverse(playersSnap.players, rankings.data, { rankingsSource })`
(`load.ts:203`) with no `trendingAdds/trendingDrops/newsMomentumScores`. So the
logged-out demo universe has `trendingMomentum:0` and (correctly) declares
`trending_momentum` missing via `withFpMissingFields` (`enrich.ts:192–217`).
Honest (declared missing, not fabricated) but the public surface understates a
signal that is freely available. Per CLAUDE.md "Trending is a WAIVER signal …
apply it to the market pool", the demo market pool omits it. Low priority.

---

## Verification of each required item

1. **Schema contracts** — zod, validated at boundary (Strengths 1–3, `http.ts:57–74`,
   `snapshotStore.ts:95,123`). PASS.
2. **Lineage/provenance** — `SourceMeta` carries source/freshness/confidence/
   assumptions/validation/missingFields/failure (`governance.ts:7–17`); attached
   per-record (`sources[]`, `normalize.ts:37,78`) and on `envelope.sourceState`
   (`toEnvelope.ts:202–216`). Can be *narrowed but not lost*: the composite takes
   the union of missingFields and worse freshness (`toEnvelope.ts:181–187`).
   PASS, with the truncation caveat (S2).
3. **Freshness & missingness** — `evaluateFreshness` (`governance.ts:98`)
   fresh/stale/missing/unavailable from `fetchedAt`+ttl; missing rankings →
   `degradedSourceState` (`toEnvelope.ts:231`); missing opportunity/trending →
   declared in missingFields (`enrich.ts:197`, `toEnvelope.ts:170–183`).
   Surfaced honestly, never silently filled. PASS.
4. **Fallback chains** — trade values FantasyCalc→KTC→DynastyProcess→unavailable,
   comment/code **consistent** (no mismatch); see S3. nflverse/trending fail-open
   to null. PASS.
5. **Full universe** — `buildLeagueUniverse` itself is NOT truncated
   (`buildUniverse.ts:21–36`), but `toEnvelope.ts:132` caps the serialized
   universe at 600 and `:134` derives free agents from the capped list (S2). FA
   subtraction id-namespace is correct + tested. PARTIAL — see S2/S3.
6. **Cron behavior** — auth-guarded (timing-safe), timestamped snapshots,
   per-variant try/catch, prune old rows, redacted errors. Not strictly
   idempotent (each run appends a row) but latest-wins + prune makes this safe.
   PASS.
7. **Precompute vs on-demand** — crons snapshot players/rankings/ktc/projections/
   news/opportunity; `loadEnvelope` composes per-request and is `cache()`-wrapped
   (`load.ts:221`). PASS.
8. **Demo/fixture/live switching** — priority ladder in `resolveEnvelope`
   (`load.ts:60–185`); fixtures always labeled (`fixtures.ts:4–17`). PASS.

---

## Recommended remediations (priority order)

1. **(S2)** Compute free agents from the FULL universe, then cap for
   serialization — `buildFreeAgents(full, allRosters)` before `.slice`. Add a
   "showing top N by value" note to the Waiver panel.
2. **(S3)** Hoist `UNIVERSE_LIMIT` to one shared exported constant used by both
   `toEnvelope.ts` and `load.ts`.
3. **(S3)** In the KTC/DynastyProcess trade tiers, propagate the real snapshot
   `fetchedAt` and compute freshness via `evaluateFreshness` instead of
   hardcoding `"stale"` + `new Date()`.
4. **(S3)** Decide the `RAE_ENABLE_LIVE_HOMEPAGE` contract — build the universe
   or document identity-only.
5. **(S3)** Pass trending/news into the demo `buildLeagueUniverse`, or document
   the omission.
6. **(S3)** Refresh stale line anchors in `data-source-map.md`.

## Open questions

- Is 600 a deliberate SSR-payload-size budget? If so, the FA fix should cap the
  *serialized* FA list separately from the universe to keep both bounded.
- Should snapshot crons be made idempotent-per-day (UPSERT on `(source, date)`)
  to avoid multiple rows when Vercel retries a cron? Current latest-wins+prune is
  safe but accumulates intra-day rows.
- `loadEnvelope`'s `cache()` dedupes per request only — is there an intentional
  decision NOT to use `unstable_cache`/Next data cache for the cross-request
  snapshot reads (each request hits the DB for the latest snapshot)?
