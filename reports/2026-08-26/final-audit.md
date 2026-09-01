# Final audit — 2026-08-26

Full-repository audit: model outputs, statistical significance, duplicated and
unnecessary code, and reconciliation of every branch and planning document
against what is actually in the tree.

Scope was the whole repository at local `main` `69381b7` (= PR #35's branch,
thirteen commits ahead of `origin/main` `2acf331`).

---

## 1. The finding that matters most

**The best-evidenced model in this repository does not ship.**

`src/lib/stats/logistic.ts` — the out-of-fold calibration logistic — is
classified `REACHED ONLY BY SCRIPTS` by `npm run audit:reachability`. Its only
callers are `brier-backtest.ts`, `holdout-evaluate-6.ts` and
`holdout-evaluate-7.ts`. It exists to generate a report.

Measured on 3,573 startable player-weeks (fingerprint `bba1d103`). These are the
**calibration** model's numbers — the out-of-fold logistic — not the rank→prob
discrimination model that shares the same report and whose skill scores differ:

| position | calibration Brier | climatology | Brier skill | ECE |
|---|---|---|---|---|
| RB | 0.1969 | 0.2497 | **+21.1%** | 0.0327 |
| WR | 0.2036 | 0.2498 | **+18.5%** | 0.0175 |
| TE | 0.2059 | 0.2499 | **+17.6%** | 0.0246 |
| QB | 0.2368 | 0.2458 | +3.7% | 0.0331 |

Meanwhile every probability the product renders traces to the season simulator,
whose valuation chain **failed** protocols 1 and 2 out-of-sample.
`grep -rni "probability" src/components/` returns nine hits, and all nine resolve
to one of four things:

- `NexusSimulator.tsx:337,343` — `sim.playoffProbability` / `sim.championshipProbability`
- `TeamSignals.tsx:65` — the same `sim.playoffProbability`, with a Wilson interval
- `MarketIntelligence.tsx:355` — the outcome heatmap, a conditional distribution
  from that same sim
- `ReliabilityDiagram.tsx` and `ScenarioOutlook.tsx` — a chart axis label and the
  disclosure that says this is "simulated frequency under model assumptions, not
  a forecast probability"

**There is no weekly player-level probability surface anywhere in the app.**

So the product ships its refuted model and files its validated one in `docs/`.

**Not fixed here, deliberately.** Surfacing a weekly probability is a new product
surface — panel, governance metadata, assumptions disclosure, empty states,
tests, a11y — not the repair of a defect. Doing it inside an audit commit would
be exactly the kind of unreviewable scope creep the frozen-protocol discipline
exists to prevent. It is the top recommendation in §10.

---

## 2. Statistically unsupported output that was shipping

### 2.1 A fabricated confidence interval — flagged in June, never fixed

`confidenceInterval(center, confidence)` returned `center ± (1 − confidence)·18`
and was rendered as `[lo, hi]` immediately after `trueValue` in the Market
Intelligence table. A bracketed pair beside a point estimate reads as an interval
estimate. It was not one: no sampling distribution, no coverage guarantee, no
stated level — a magic 18-point half-width scaled by a heuristic.

The 2026-06-09 quant audit found this and recommended removing or relabelling it
(`reports/audit-2026-06-09/02-quant-audit.md:37`, item 6; recommendation 2 at
`:69`). **The recommendation was recorded and never executed.** It shipped for
another two and a half months, and `docs/data-source-map.md:156` documented the
defect — `CI width = (1-confidence)*18` — without fixing it.

**FIXED.** Function removed; call site removed. Nothing replaces it, because
nothing honest can: FantasyPros' `rank_std` is real expert disagreement but in
*overall* rank units, while `ecrToTrueValue` is a function of *positional* rank.
Pushing one through the other is a unit error — the class of bug
`npm run check:projection-units` exists to catch. The reasoning is recorded in
`src/lib/models.ts` where the function used to be.

### 2.2 A result with no baseline, no interval, and a false independence claim

`docs/season-backtest-2025.md` reported **Brier 0.1657** and described its sample
as *"~10 independent outcomes per league"*.

They are not independent. Exactly `playoff_teams` of `num_teams` rosters qualify,
by construction — knowing nine outcomes in a ten-team league determines the
tenth. A league is **one** observation, not ten. The report overstated its
evidence by roughly a factor of ten, and it was the same clustering error that
every frozen holdout protocol in this repository exists to avoid, committed in
the script those protocols were meant to discipline.

There was also no climatology baseline and no confidence interval, so the number
could not be judged at all.

**FIXED.** `scripts/backtest-sleeper-2025.ts` now computes the climatology
baseline (a constant forecast at each league's own base rate), the Brier Skill
Score against it, and a cluster bootstrap over **leagues**. Re-measured:

| quantity | value |
|---|---|
| Model Brier | 0.1696 |
| Climatology Brier | 0.2400 |
| Brier Skill Score | +29.3% |
| Team-seasons | 10 |
| **Independent clusters** | **1** |

With one cluster the bootstrap is degenerate — it resamples identical data and
returns a zero-width interval. The report now says so in those words rather than
printing a false precision. **No significance is claimed.**

Two incidental findings from re-running it:

- The committed number was **stale**: 0.1657 against today's 0.1696. The shipped
  season sim changed and the report was never regenerated.
- The harness is genuinely **deterministic** — two consecutive runs produced
  byte-identical output — so the drift was code change, not seed instability.

### 2.3 A model with negative skill, presented as merely caveated

The QB rank→prob discrimination model scores **Brier 0.2716 against a climatology
of 0.2458** — a Brier Skill Score of **−10.5%**. `docs/brier-results.md` handled
this with a footnote at the bottom of the document saying to "treat its score as
no better than climatology". That is too kind: negative skill is *worse* than
climatology, not equal to it. Protocol 7 recommendation 3 called for retiring it.

**FIXED.** `scripts/brier-backtest.ts` now emits, for every position, the
climatology Brier and the Brier Skill Score beside the Murphy decomposition, and
a **RETIRED** banner directly under any table whose skill is ≤ 0. The
interpretation section names retired positions instead of burying them.

Note the arithmetic detail: the per-position summary object carries `clim`, the
base *rate* p, not a Brier score. Climatology Brier is p(1−p) — which is the same
quantity the Murphy decomposition already calls Uncertainty, so the two now agree
by construction and each cross-checks the other.

---

## 3. A refuted claim still on ten live surfaces

Protocol 3 tested `scarcityGap` on 115 real drafts and found it does not identify
mispriced players — within a position it was inverted (−0.048, CI [−0.076,
−0.020]). The product was renamed on 2026-08-22 and `EDGE_LABELS` was introduced
so the wording could not drift.

**The rename covered roughly a third of the surfaces.** Ten user-visible strings
went on asserting the refuted claim:

| route | string | file |
|---|---|---|
| /dashboard | "Biggest market mispricings." | `TopInsights.tsx:24` |
| /dashboard | "Undervalued +N" / "Overvalued N" | `TopInsights.tsx:37` |
| /dashboard | "Market Inefficiency" / "Avg Market Mispricing" | `LeagueHealth.tsx:31,33,37` |
| /analytics | "Market Inefficiency" / "Avg market mispricing index" | `MarketIntelligence.tsx:126` |
| /analytics | "TOP INEFFICIENCIES" | `MarketIntelligence.tsx:152` |
| /analytics | "Undervalued (true > market)" | `MarketIntelligence.tsx:409` |
| /analytics | "…points above the diagonal are undervalued" | `MarketIntelligence.tsx:413` |
| /analytics | "fair value" (the y = x diagonal) | `MarketIntelligence.tsx:420` |
| /analytics | "distance from the dashed fair-value line = mispricing" | `MarketIntelligence.tsx:443` |
| /players | "Avg Market Mispricing" / "Undervalued" | `PlayerUniverse.tsx:295,299` |
| /analytics | "ranked by value mispricing only" | `NarrativeEngine.tsx:72` |

### Why both guards missed all of it

`e2e/20-model-failure-disclosure.spec.ts` carries a comment stating the rule
exactly right — *"any assertion of arbitrage, mispricing or exploitable
inefficiency fails"* — above a regex that read `/(arbitrage|exploit
inefficien|mispriced)/i`. **The prose was correct and the pattern was narrower
than the prose.** `mispriced` does not match `mispricing`. The unit guard in
`edgeDisclosure.test.ts` had the identical gap.

This is the **third** failure of this one guard: first a literal backspace byte
made it vacuous, then it missed the "Arbitrage" tab, now the noun form.

**FIXED.**
- All ten strings renamed through `EDGE_LABELS`, so they cannot drift apart.
  Directional wording matters here: "Undervalued / Overvalued" asserts the market
  is wrong and we are right; "Above / below consensus" states the same arithmetic
  and claims nothing. The y = x diagonal is a **parity** line, not a "fair value"
  line — calling it fair value asserts our number is the fair one.
- Both guards now match **stems** (`mispric`, `inefficienc`, `underval`,
  `overval`, `fair.value`), with a canary per alternative. One canary only proves
  one branch works, which is how a partly-dead regex survives.
- The unit guard gained a negation escape so a *denial* still passes — the
  disclosure has to be able to say "not proven bargains".

### 3.1 The guard was reading serialized props, not the page

Widening the pattern immediately failed `/analytics`, and the offending strings
were not on the page at all — they were **object keys inside the RSC flight
payload**: `marketMetrics.inefficiencyPct` and `topInefficiencies`, matched from
inside a `<script>` tag.

The helper cloned `<body>` and read `textContent`, which includes the contents of
every script. In a Next.js App Router page that is the serialised props of every
server component. **A wording guard is a claim about what a person reads, and
this one was scanning internal field names.** It had been that way since the test
was written; the narrow regex simply never happened to match anything in there.

**FIXED.** The helper now strips `script, style, noscript, template` before
taking the text. The narrower pattern hid the scoping bug rather than avoiding it,
and it would have mis-fired on the next prop name regardless.

### 3.2 The data model still carried the refuted vocabulary

Renamed as well, so the payload is clean on its own terms rather than only being
excluded from a scan: `marketInefficiency` → `valuationGap` (15 call sites),
`topInefficiencies` → `topValuationGaps` (8), `inefficiencyPct` →
`valuationGapPct` (4). The quantity is a confidence-weighted distance from
consensus; protocol 3 D4 is what says it is not evidence of an inefficiency.

### 3.3 A third narrow wording pattern

`src/lib/models/opportunityEvidence.test.ts:51` banned `/mispriced?/i` — the
same one-suffix gap, in a third file. Widened to the shared stem set with a live
canary.

### 3.4 The backspace byte, again

While widening the unit guard I introduced `/\b(not|no longer|…)/i` where the
`\b` was a literal 0x08 byte — **the exact defect this file documents**. It was
caught only because that assertion happened to fail loudly; the original one
failed silently open for months.

**FIXED**, and mechanised: `src/lib/ops/sourceHygiene.test.ts` scans every `.ts`,
`.tsx`, `.mjs`, `.js` and `.css` file in `src/`, `scripts/` and `e2e/` for stray
C0 control bytes, with a canary proving the predicate is live and a floor on the
file count so a broken directory walk cannot pass vacuously. Twice is a pattern,
and the failure mode is invisible in every editor and every diff.

---

## 4. A hardcoded placeholder rendered as data

`PlayerUniverse.tsx:270` rendered `{player.rosterSlot}` in the player profile.
On the **live** path that value was the literal string `"FLEX"` for every player
(`enrich.ts:392`, and `normalize.ts` twice). On fixtures it showed RB1 / WR1 /
QB2. So a demo displayed varied, plausible lineup slots and a real connected
league displayed FLEX several hundred times.

That is a hardcoded constant presented as data, which the guardrails forbid
outright, and it is worse for being invisible in fixture mode.

**FIXED.** `rosterSlot` is nullable in `PlayerMarketRecordSchema`, both live
paths set `null` rather than inventing one, and the profile renders an em dash.
Widening the schema means previously stored snapshots keep parsing, the same
treatment `byeWeek` already had.

The unwired other half went with it: `espnLineupSlot` and `ESPN_LINEUP_SLOT_MAP`
mapped ESPN's `lineupSlotId` to a slot name and **nothing ever called them**
(`schemas.ts:20` parses the field; no consumer exists). Removed, following the
precedent set when `weather/` was deleted — code that looks connected and is not
is a claim the product cannot support. Git history has it if ESPN lineup slots
are ever wired for real.

---

## 5. CI: a required check that could not fail

`main-protection` (ruleset `18698526`) requires six status checks:

```
typecheck + lint + vitest · playwright + axe · lighthouse perf + a11y
gitleaks secret scan · dependency review · codeql (javascript-typescript)
```

Two of the six were not checking what their names imply.

**`dependency review` had `continue-on-error: true`** (`security.yml:89`). A
required status check that reports success unconditionally is the same defect
class as a test that asserts nothing. **FIXED** — removed. Its scope is the PR
diff, so it fails only when a pull request *introduces* a moderate-or-worse
advisory; the advisories already resolved in the lockfile do not retroactively
block `main`.

**Consequence for the Dependabot queue, stated up front.** `dependency review`
can now block, and it fails when a PR *introduces* a moderate-or-worse advisory.
Several of the open Dependabot PRs pull new transitive dependencies, so one of
them may now fail a check that previously could not. **That is the gate working,
not a regression** — but it is a change in behaviour the owner should expect
before working through the merge order in §9. Verified on this PR: `dependency
review` completed in 6s and passed with the flag removed.

**`gitleaks secret scan` scans only the pushed commit range.** The repository
already knows this — `security.yml:108-113` documents it and adds a
`gitleaks FULL-HISTORY secret scan` job that walks all history. But the
*required* check is the shallow one, and the thorough one is optional. **OWNER
ACTION** (§8): this is a repository-settings change, not a code change.

Separately, `OSV lockfile scan` reports **pass** while the scanner exits 1 having
found High-severity issues, because of `continue-on-error` at `security.yml:76`.
Left non-blocking on purpose — most findings are dev-scope and at least one has
no published patch — but **renamed** to `OSV lockfile scan (advisory,
non-blocking)`. A green tick beside "OSV lockfile scan" reads as "the lockfile is
clean" and is not evidence of that. Renaming is safe precisely because it is not
a required check.

---

## 6. Documentation reconciled against the tree

| defect | evidence | disposition |
|---|---|---|
| README: *"All 20 are listed"* | **42** scripts existed, **16 of them unmentioned** (20 once the four newly-wired harnesses below are counted) | FIXED — all 46 now listed |
| Three scripts had **no npm entry at all** | incl. `brier-backtest.ts`, which generates `docs/brier-results.md` | FIXED — `brier:backtest`, `audit:reachability`, `holdout:acquire-players` |
| README: *"Four protocols"* | seven protocol documents on disk | FIXED — all seven, with verdicts |
| Protocol 7 had no npm script | protocols 1–6 all had one | FIXED — `holdout:evaluate7` |
| README advertised **open-meteo weather** | `src/lib/weather/` deleted in `29e6744` | FIXED — replaced with an explicit "no weather feed" note |
| `data-source-map.md`: **19** `reputationEdge` references | renamed to `scarcityGap` on 2026-08-22 | FIXED |
| `data-source-map.md`: 4 stale surface labels, 6 stale line refs, 1 row for a removed function | — | FIXED |
| `season-calibration.md`: *"No real-data backtest run"* | `season-backtest-2025.md` exists | FIXED — both generators now cross-reference and distinguish synthetic from real |
| README: *"three GitHub Actions jobs"* | **eleven** across three workflows; `ci.yml` alone has four | FIXED — all eleven listed, plus which six actually gate a merge |
| README omitted the `postgres integration` job | it is the job that fails when a suite is *skipped* rather than run | FIXED |

The README's script-count claim has now been wrong twice — first nine of twenty,
then "all 20" of forty-two. A prose count decays silently on the next commit, so
the claim is no longer made in prose: **`src/lib/ops/readmeScripts.test.ts`**
fails if any script is undocumented, if the README documents a script that no
longer exists, or if a script points at a missing file.

Verified clean: **zero dead relative links**, and all 39 file paths named in
README prose exist.

---

## 7. Clean negatives — checked, nothing wrong

These were investigated and found sound. Recording them so the next audit does
not re-derive them.

**Every merged branch landed in full.** `audit/2026-06-09` (PRs #16–20),
`fix/2026-08-06-forensic-remediation` (#21), `fix/2026-08-20-audit-remediation`
(#26) and `fix/2026-08-23-p2-final` (#34) are all ancestors of `origin/main`;
`git log origin/main..<branch>` is empty for all four. Every concrete deliverable
claimed in those PR bodies was located at HEAD with a file:line citation. **Zero
lost work.** The only files added-then-removed trace to deletion commits that
state the intent (13 superseded screenshots, `card.tsx`, `ktc/match.ts`,
`weather/`). Items marked PARTIAL or BLOCKED were declared so in their own PR
bodies — open work, not dropped work.

**No divergent statistical implementations.** Every duplicated statistic was read
side by side:

| statistic | copies | agree? |
|---|---|---|
| Spearman | `trade/backtest.ts:42`, `holdout-evaluate-3.ts:163` | **yes** — both mid-rank; the theoretical rank mean (n+1)/2 and the empirical mean are identical under average ranks |
| AUC | `brier-backtest.ts:500`, `holdout-evaluate-7.ts:90`, `-2.ts:50`, `holdout-diagnostics.ts:76` | **yes** — `(i+j)/2+1` and `(rank + rank + j−i)/2` are the same expression |
| `holm` | `holdout-evaluate-{2,3,4,5}.ts` | yes — known, documented |
| `rankAverage`, `pearson` | `holdout-evaluate-{3,4,5}.ts` | yes |

All remaining duplication is confined to `scripts/holdout-evaluate-*.ts`, which
are **executed-protocol archives**: their committed results must keep reproducing
byte-identically, so refactoring them to share a helper would trade a real
guarantee for tidiness. That is deliberate and documented in the header of
`src/lib/stats/multipleComparisons.ts`. `verify-inseason-fidelity.ts` already
imports `spearman` rather than reimplementing it.

**Module reachability is clean.** `npm run audit:reachability`: 0 unreachable
modules, 1 test-only module (`components/systems.ts`, 14 lines).

**The symbol-level dead-export scan was too noisy to act on** and is reported as
such rather than acted on. A regex scan cannot see same-file usage, so it flagged
225 "unreferenced" exports that are overwhelmingly TypeScript types consumed via
`z.infer` or used within their own module. Narrowing to functions with genuinely
zero occurrences anywhere left **two**: `espnLineupSlot` (removed, §4) and
`ensureSeasonStatsTable` (**kept** — `snapshotStore` self-heals by calling
`ensureTable()` internally before every read and write, its sibling
`ensureOpportunityTable` *is* called by the opportunity cron, and deleting three
lines to make two snapshot modules asymmetric is not an improvement).

The 95 exports referenced only by tests are mostly deliberate: helpers extracted
to be unit-testable (`parseRgba`, `compareVersions`, `findSecretLeaks`). That is
good design, not dead code.

---

## 8. Model inventory — what each output is worth

| model | shipped? | evidence | status |
|---|---|---|---|
| `inSeasonScore` (points + usage ranking) | yes, `InSeasonBoard` | protocols 4 **and** 5, replicated on disjoint years; +0.0137 / +0.0195 Spearman | **best-governed thing in the repo.** Ranking only, never a probability, returns null without in-season data |
| Trade values | yes, Trade Center | pooled Spearman ρ 0.648, n=784, bootstrap CI, gate `ρ ≥ 0.62` in test | sound |
| Calibration logistic (weekly) | **no — script only** | BSS +21.1/+18.5/+17.6% at RB/WR/TE | validated and unshipped (§1) |
| Season Monte Carlo | yes, Nexus | synthetic self-consistency; real backtest = 1 cluster | presented via `scenarioBand` against the structural baseline, with the failure notice adjacent — correct handling |
| Valuation chain (`trueValue`) | yes, everywhere | failed protocols 1–2 out-of-sample | disclosed |
| `scarcityGap` | yes | protocol 3: inverted within position | disclosed via `edgeDisclosure` — now on all ten surfaces, not three |
| `confidenceInterval` | **was** | none | **removed** (§2.1) |
| QB rank→prob | report only | BSS −10.5% | **retired** in the report (§2.3) |
| `models.ts` composites | yes | ten hand-authored weights, never fitted | disclosed as "fixed hand-tuned weights — not yet fitted to observed outcomes (QNT-01)" on both panels that show them |
| Draft `recommend` / `tiers` | yes | hand-tuned, no fit | disclosed as of this audit — see below |

**The last open 2026-06-09 recommendation is now closed.** Recommendation 1 asked
that every heuristic metric be labelled heuristic at the governance surface. It
had been carried out for the `models.ts` composites (`MarketIntelligence.tsx:145`,
`LeagueHealth.tsx:93`) and **not** for the draft scoring. Neither
`src/lib/draft/recommend.ts` nor `src/lib/draft/tiers.ts` contained the word
"heuristic", and neither surface told the user that the numbers ordering their
draft board are authored constants.

**FIXED.** `src/lib/draft/disclosure.ts` holds two notes, rendered under the
Recommendation Queue and the Tier Collapse Forecast. They **quote the weights**
rather than describing them — "ranked by a heuristic" tells a reader nothing they
can argue with; `scarcity gap x1.5 + opportunity x0.6 - fragility x0.25` tells
them exactly what to disagree with. `disclosure.test.ts` reads `recommend.ts` and
`tiers.ts` and asserts the quoted numbers match the code, so changing a weight
without changing the disclosure fails the suite. That guard exists because this
repository has already shipped a sub-label describing an implementation the code
no longer had.

## 9. Owner actions — cannot be done from code

> **Provenance of the claims in this section.** The branch reconciliation (§7)
> and the Dependabot merge-order analysis below were produced by delegated
> agents. I independently re-verified the structural facts I act on or assert
> elsewhere in this report — the `main-protection` required-check list
> (`gh api .../rulesets/18698526`), both `continue-on-error` flags, the
> `npm audit --omit=dev` scope, and the five entries in `ADVISORY_FLOORS`. The
> **merge-order simulation and the specific advisory identifiers below I did not
> re-run**, so treat the ordering as a well-argued plan to verify against the
> actual CI run, not as a measurement I made.


1. **Add the real security jobs to the required-check list.** `main-protection`
   requires `gitleaks secret scan` (diff-scoped). `gitleaks FULL-HISTORY secret
   scan`, `lockfile advisory scan` and `tracked-file secret scan` all block on
   failure and none of them is required. Adding them is a ruleset edit.
2. **Merge PR #35.** Fourteen checks green as of the last run; this audit adds to
   it. Merging is a human decision and was never taken automatically.
3. **Dependabot: eleven open PRs.** Merge order that avoids conflicts, verified by
   simulating the merges against `origin/main`:
   - Workflow files, independent: **#27 → #28 → #29 → #31**
   - Then `@dependabot rebase` **#32** (conflicts with #27 on adjacent lines)
   - Lockfile, in this order: **#23 → #24 → #30** (closes three open High
     advisories: `brace-expansion` ×2, `ip-address`, and `vite` 8.0.12 → 8.2.2)
   - Then `@dependabot rebase` **#33**, merge last, and re-read e2e + lighthouse —
     it moves radix-ui and lucide-react, the two bumps most likely to change
     rendered output
   - **Close #22 and #25** as stale: the lockfile already resolves `nanoid` at
     3.3.18, and #25 would *downgrade* root postcss 8.5.26 → 8.5.23
4. **After #23/#24 merge**, add `brace-expansion` and `ip-address` floors to
   `src/lib/security/lockfileAdvisories.ts`. The blocking audit gate is
   `npm audit --omit=dev`, which structurally cannot see dev-scope advisories, so
   the floor mechanism is the only thing that would stop them reappearing. Adding
   the floors *before* those PRs merge would fail CI on `main` immediately.
5. **Delete two merged branches:** `fix/2026-08-23-p2-final` and
   `fix/2026-08-20-audit-remediation` are content-identical to what is in
   `origin/main`. Not done here — deleting remote branches is destructive.

---

## 9a. Gate evidence

Every gate run on the final tree, output quoted rather than asserted.

| gate | command | result |
|---|---|---|
| typecheck | `npx tsc --noEmit` | exit 0, no output |
| lint | `npx eslint .` | exit 0, no output |
| unit | `npx vitest run` | **1,225 passed / 39 skipped** (107 files, 7 skipped) |
| build | `npm run build` | clean |
| e2e | `npx playwright test` | **405 passed / 1 skipped** (16.4m, chromium + mobile-chrome) |
| tracked secrets | `npm run check:secrets` | 346 files, no secret-shaped literals |
| advisory floors | `npm run check:advisories` | OK — nothing below a floor |
| vuln exceptions | `npm run check:exceptions` | OK — 1 exception, none expired |
| projection units | `npm run check:projection-units` | PASS |
| in-season fidelity | `npm run verify:inseason` | PASS — gain 0.0195 vs protocol 5's 0.0195, diff 0.000006 |
| reachability | `npm run audit:reachability` | 0 unreachable modules |
| UI audit | `e2e/27-ui-audit.spec.ts` | 0 findings on all 10 routes, both viewports |

The unit count moved from 1,200 to 1,225: +25 assertions from the four new
guards (`sourceHygiene`, `readmeScripts`, `draft/disclosure`, and the widened
wording tests).

Regenerated model documents reproduce from committed inputs: `docs/brier-results.md`
still carries input fingerprint `bba1d103` over 3,573 rows, and its diff contains
only the new climatology/skill rows — **no underlying number moved**, which is what
makes the before/after comparable.

---

## 9b. One thing this audit did not resolve

The 16.4-minute Playwright run logged a **single server-side stack trace** from
the Next.js RSC renderer. All 405 tests passed and no test attributed a failure
to it. I could not identify it: the message line was cut off by my own
`| tail -22` on the run, leaving only `at async` frames.

A clean reproduction found nothing — `next start`, then all eight app routes plus
six consecutive requests to `/trades` (the one route that fetches FantasyCalc over
the live network during SSR, and the known source of load-dependent flake here):
every request 200, zero errors in the server log.

So it is transient and probably the live-network path degrading under parallel
load, which the envelope handles by design. **Probably is not measured**, and it
is recorded here rather than written off. To catch it next time, run the suite
without truncating the log: `npx playwright test 2>&1 | tee reports/e2e-full.txt`.

---

## 10. Recommendations, in priority order

1. **Ship the calibration logistic**, or state in the README that the validated
   weekly model is deliberately report-only. Today the product ships the model
   that failed and files the one that works. Either resolution is defensible;
   the current silence is not.
2. **Add leagues to the season backtest.** One league is one observation. Ten
   completed public leagues would make the +29.3% skill figure testable; until
   then it is a point estimate with no error bar.
3. **Retire, or re-derive, the ten `models.ts` weights.** They have never been
   fitted to anything, and protocol 3 showed the construction they encode
   (`trueValue − perceivedValue`) performs slightly *worse* than `trueValue`
   alone at the one thing it is supposed to do.
