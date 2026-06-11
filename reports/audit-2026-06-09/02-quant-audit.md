# 02 — Quant / Modeling Layer Audit

**Worker:** quant_auditor
**Branch:** audit/2026-06-09 (== origin/main = production)
**Scope:** seasonSim, outcomeHeat, derivedMetrics, models, draft/recommend, draft/tiers, rng, brier-backtest, plus the stats helpers, simulation adapter, and reconciliation against docs/season-sim.md, docs/calibration.md, docs/brier-results.md, docs/trade-calibration.md.
**Method:** read-only static review + doc reconciliation. Code is source-of-truth; doc drift is flagged. Severity S0–S3, confidence H/M/L.

---

## Strengths (verified, with evidence)

- **Reproducibility is real and clean.** `mulberry32` (`src/lib/rng.ts:7-16`) is the single seeded PRNG; `gaussian()` uses Box–Muller off the same stream (`seasonSim.ts:85-90`). `runSeasonSimulation` threads one `rng = mulberry32(config.seed)` (`seasonSim.ts:184`). `seasonSim.test.ts:40-45` asserts bit-identical output for a fixed seed. **No `Math.random` appears in any displayed-quantity path** — the only two hits are a skeleton width in `src/components/ui/sidebar.tsx:611` (cosmetic, and the comment notes shadcn's stock `Math.random` was deliberately removed) and a test-only id in `src/lib/ktc/match.test.ts:8`. Item 3: **CONFIRMED clean.**
- **Season sim is a genuine Monte Carlo, not the old threshold heuristic.** Full circle-method round-robin (`seasonSim.ts:110-130`), sampled weekly scores, `(wins, points-for)` seeding (`:232`), re-seeded single-elimination bracket with byes (`simulateBracket :137-173`). Two-level variance (between-team season strength + within-team weekly noise) is the defensible structure (`:208-211`, docs/season-sim.md:39-50).
- **Outcome-multiverse semantics are correct and explicitly labeled.** The sim returns a true JOINT pmf `winOutcomeJoint[w][tier]` that sums to 1 (`seasonSim.ts:71-77`, enforced by `seasonSim.test.ts:158-191`). `outcomeHeat.ts` then renders the *conditional* `P(outcome | wins)` (`:54-59`), every column sums to ~1, and the caption says so verbatim (`:77-79`). The conditional-vs-joint trap is called out in the code comment (`outcomeHeat.ts:16-32`). Item 4: **CONFIRMED — not a governance defect; it is handled well.**
- **A real, leakage-free calibration model exists.** `scripts/brier-backtest.ts` fits an out-of-fold (leave-one-week-out) logistic via `fitLogisticCV` (`logistic.ts:192-224`) mapping projected pts → P(≥ threshold), scored by ECE/MCE (`distribution.ts:478-496`). The single-fold degenerate case emits 0.5, not the in-fold base rate, avoiding leakage (`logistic.ts:212-218`). Brier uses a correct Murphy decomposition with an arithmetic self-check `R−Res+U == Score` printed in the report (`brier-backtest.ts:545`).
- **The trade-value model is the one component with honest empirical calibration.** `docs/trade-calibration.md` documents a 784-player-season pooled backtest (2022–2025) against real DynastyProcess + nflverse data, pooled Spearman ρ = 0.648 with a bootstrap 95% CI [0.602, 0.692], and — critically — it *refused to fabricate* the nominal ρ≥0.7 / d≥0.5 gates, lowering them to the data-supported 0.62 / 0.30 with justification. This is the gold standard the rest of the layer is not held to.
- **Honest unit labeling fixes are present** (anti-fabrication): `priceDiscoveryPct` is relabeled to raw volatility with a comment (`derivedMetrics.ts:69-71`); `deriveAggregateValueIndex` dropped the invented "$X.XXM" currency magnitude (`:210-220`); empty pools return "Unknown"/"—" rather than asserting signal (`:73`, `:217`).

---

## Issues + root causes

### S1 — Core player metrics are hand-tuned coefficients, not fitted models, yet docs/UI present them with statistical trappings. (confidence: H)

The five behavioral metrics are fixed linear combinations with hand-picked weights:

- `reputationEdge = trueValue − perceivedValue + 0.18·ownershipLeverage − 0.08·fragility` (`models.ts:3-5`)
- `marketInefficiency = |trueValue − perceivedValue|·confidence + 0.12·max(0,ownershipLeverage)` (`:7-9`)
- `narrativeVelocity = 0.54·trendingMomentum + 0.28·volatility − 0.11·fragility` (`:11-13`)
- `chaosExposure = 0.45·volatility + 0.4·fragility + 0.15·|trendingMomentum|` (`:15-17`)
- `liquidityScore = (0.6·opportunity + 0.4·marketInefficiency)/10` (`:19-21`)

**Root cause / provenance:** `docs/calibration.md:57` itself states grid-search tuning of these constants is *future* work ("Use grid search over the documented constants ... Each constant change is a PR that must improve the validation Brier scores"). There is no fit, no backtest, no Brier score behind any of these weights. The upstream inputs are also deterministic rank rescalings, not fits: live `perceivedValue` is `1−(rank−1)/(maxRank−1)` ×100 (`fantasypros/enrich.ts:53-57`) and `trueValue` is `50 + ((replacementRank − posRank)/replacementRank)·50` (`:64-73`) — both anchored at "replacement = 50" by hand. **Plainly: heuristic / hand-tuned, end to end.** This is acceptable for a fixture/demo decision aid, but the weights carry the *appearance* of fitted coefficients in `docs/calibration.md`'s metric table (`:18-22`). Severity is S1 because the product identity is "model-governed decision platform" and these are the headline player scores; they are not fabricated, but they are not calibrated and the governance surface should say "heuristic" next to them.

### S1 — `confidence` and the displayed "confidence interval" in Market Intelligence are heuristic, not statistical, yet rendered as a CI. (confidence: H)

`confidenceInterval(center, confidence) = [center − (1−confidence)·18, center + (1−confidence)·18]` (`models.ts:23-26`). This is a fixed-width band keyed off a heuristic `confidence`, with **no sampling distribution, no coverage guarantee, and no relationship to any 95% level.** It is rendered directly next to `trueValue` as `[lower, upper]` in the players table (`MarketIntelligence.tsx:162,170`) — visually indistinguishable from a real interval estimate. Meanwhile `confidence` itself is heuristic: live-path `confidence = 1 − min(rank_std,30)/30` (expert-disagreement proxy, `enrich.ts:307`); fixture confidence is hand-authored (`fixtures.ts:49-56`, e.g. 0.42–0.62); Sleeper identity confidence is a constant 0.85/0.9 (`sleeper/players.ts:46`, `toEnvelope.ts:267`). Item 6: **"confidence" is a heuristic label, not a statistical quantity, and the ±18·(1−c) band is presented as a CI.** This is a governance defect (a displayed quantity that can be misread as a calibrated uncertainty).

> Contrast: the Nexus Simulator's "95% Confidence Bands" ARE real — `bootstrapCI` over 20 replicate sims with different seeds (`NexusSimulator.tsx:273-296`, `distribution.ts:59-87`). That band measures **Monte-Carlo sampling noise of the estimate**, NOT model/calibration uncertainty about the true playoff odds. Both are honest *as sampling CIs* but neither quantifies model error, and the UI label "95% Confidence Bands" can be read as the latter. (confidence: H)

### S1 — Production calibration of the SEASON SIM against real outcomes does not exist; the Brier backtest measures a different thing entirely. (confidence: H)

The Brier backtest (`scripts/brier-backtest.ts`) is genuinely **prospective** (pre-game Sleeper projection vs post-game actual PPR, 17 weeks, 3,573 player-weeks, DNPs scored 0 to avoid survivorship bias — `:166-185`, `docs/brier-results.md:7`). But it scores **per-player weekly start/sit threshold-clearing of Sleeper's projections**, NOT the season sim's `playoffProbability` / `championshipProbability`. The report even closes with "**Production targets:** playoffProbability Brier ≤ 0.20 · championshipProbability ≤ 0.10" (`brier-backtest.ts:662`, `docs/brier-results.md:266`) — targets for which **zero measurement is produced**, because the season-sim outputs are never backtested against realized league standings. So:

- The season sim has **structural** calibration only: an internal anchor (league-average roster ≈ playoffTeams/numTeams, `simulation.calibration.test.ts`, `seasonSim.test.ts:47-57`), monotonicity, and bounds. These are self-consistency tests, not agreement with reality.
- `docs/calibration.md:12` is honest about this ("production *calibration against real outcomes* is still pending"), and `docs/season-sim.md:93-100` lists the limitations. **But `docs/brier-results.md` and the `brier-backtest.ts` header read as if the playoff/championship targets are being evaluated**, when the harness only evaluates player-projection discrimination. Item 2 + item 5: structural tests yes; **production calibration of the sim's headline probabilities: absent.** A reliability curve exists, but for the *projection* model, not the *season* model.

### S2 — `derivedMetrics` scenario/outcome derivations are post-hoc algebraic re-derivations with magic multipliers, presented as scenarios. (confidence: H)

`simToRow` invents `topThree = clamp(championship · 3.4, championship, playoffs)` (`derivedMetrics.ts:102`) and best/worst scenarios scale probabilities by hardcoded `1.12` / `0.87` and points by the same (`:171-173`). `deriveOutcomeDistribution` splits the playoff mass with `topThree = min(aboveChamp, champ · 2.0)` (`:139`). These factors (3.4, 2.0, 1.12, 0.87) have **no derivation** — they are shape constants chosen to make the buckets look plausible and sum to 100. The clamps that enforce `champ ⊆ top3 ⊆ playoffs` are good governance (`:95-102`), but "Top 3 = 3.4× championship" is a fabricated relationship, not a simulated one. The sim *could* emit a real top-3 frequency (it already computes seeds), so this is avoidable. Severity S2: the numbers are internally bounded and labeled as scenarios, but the multipliers are undocumented magic.

### S2 — No train/validation/test split, no hyperparameter tuning, no ensembling anywhere in the production model. (confidence: H)

Item 5, confirmed by absence. The only CV in the codebase is inside the **offline** backtest script: `kFoldCV` by week (`distribution.ts:523-544`) and leave-one-week-out logistic (`logistic.ts:192`). Neither feeds back into production weights. There is no held-out validation set for the `models.ts` coefficients, no grid search (explicitly deferred, `docs/calibration.md:57`), no model selection, no ensemble. The season-sim field constants (`AVG_STARTER_PTS=11.5`, `TV_SLOPE=0.18`, `PLAYER_SIGMA_BASE=4`, `PLAYER_SIGMA_SLOPE=0.08`, `betweenTeamSigma = fieldMean·0.13`, `simulation.ts:57-62,118`) are hand-set anchors with no fit. This is the expected state for a pre-calibration product; the gap is that it is not consistently surfaced at the metric level.

### S3 — Pre-draft vs post-draft modeling continuity: no break in the math, but a silent input-distribution shift. (confidence: M)

Item 7. The model formulas are identical pre/post-draft — the only switch is the data *pool* (whole-league universe pre-draft, free agents + roster post-draft, per the league-universe model in MEMORY). `starterWeeklyMean` has a clean live/off-season fork (`simulation.ts:64-68`): real Sleeper `pts_ppr` when projections cron has fired, else the `11.5 + (trueValue−50)·0.18` map. No continuity *break*, but the two paths produce values on subtly different scales (a real PPR projection vs a trueValue-derived synthetic mean) and the sim mixes whichever is present per player; there is no test asserting the two paths agree at the anchor. Low severity — flagged for completeness.

### S3 — Draft recommender and tiers are entirely heuristic (correctly, but undocumented as such). (confidence: H)

`recommend.ts` score = `edge·1.5 + opportunity·0.6 − fragility·0.25`, with `+need·8`, `+12` last-in-tier, `−100` K/DEF-too-early, `−4` kicker penalty (`recommend.ts:70-111`). `tiers.ts` uses a fixed `TIER_GAP_THRESHOLD = 6` on `trueValue` (`tiers.ts:16,36`) and `intensity = cliff/20` (`:67`). All hand-tuned and reasonable for draft heuristics; none claim to be fitted. No defect, but no doc states "heuristic" — consistent with the S1 theme.

---

## Recommended remediations

1. **Label heuristic metrics as heuristic at the governance surface.** Every `models.ts` output and the draft scores should carry `validation: "heuristic"` (or an `assumptions` line "hand-tuned weights, not fitted") in their SourceMeta, matching the CLAUDE.md rule "if logic is heuristic, say so plainly." (S1)
2. **Stop rendering `confidenceInterval()` as a CI.** Either replace it with a real interval (bootstrap over the input uncertainty) or relabel it "heuristic band (±18·(1−confidence))" so it cannot be misread (`MarketIntelligence.tsx:162-170`, `models.ts:23-26`). Rename the Nexus "95% Confidence Bands" to "95% Monte-Carlo sampling band" so it is not confused with model/calibration uncertainty. (S1)
3. **Build the missing season-sim calibration harness** to honor the targets already printed (`brier-backtest.ts:662`). It requires: (a) historical league standings as ground truth (Sleeper completed seasons are available — MEMORY notes jviola1019 has completed-2025 leagues); (b) re-run `runSeasonSimulation` from *kickoff-time* inputs each completed season; (c) compute Brier + reliability diagram for `playoffProbability` and `championshipProbability` specifically (not the player-projection proxy); (d) k-fold across seasons. Until then, change `docs/brier-results.md` and the script header to state plainly that the season-sim probability targets are **unmeasured**, so the report does not imply they are met. (S1)
4. **Derive scenario buckets from the sim, not from multipliers.** The season sim already computes seeds; emit a real top-3 frequency and real best/worst via parameter perturbation rather than `·3.4`, `·2.0`, `·1.12`, `·0.87` (`derivedMetrics.ts:102,139,171-173`). At minimum, document the multipliers. (S2)
5. **Once data exists, add the train/validation/test discipline** the trade backtest already models: a held-out split for the `models.ts` weights and the season-sim anchors, with each weight change gated on validation Brier — exactly the procedure `docs/calibration.md:48-58` promises but does not yet run. (S2)
6. **Add a pre/post-draft continuity test** asserting `starterWeeklyMean` synthetic and live paths agree at the median anchor (≈11.5 at trueValue 50), guarding against scale drift. (S3)

### What a proper calibration/backtest harness would require (for the season sim specifically)

- A ground-truth store of settled league outcomes (made playoffs y/n, won title y/n) per team per completed season.
- A frozen input snapshot at decision time (kickoff / pre-playoffs) so the forecast uses no future information.
- Per-metric Brier + Murphy decomposition + reliability diagram on the **probability outputs** (`playoff`, `championship`, `catastrophicRisk`), reusing the existing `brierScore`/`reliabilityDiagram`/`expectedCalibrationError` helpers, which are correct and ready.
- Cross-season k-fold (the `kFoldCV` helper exists) to avoid in-season leakage.
- A documented recalibration cadence wired to the cron (`docs/calibration.md:58` already specifies post-Week 4/9/13).

---

## Open questions

1. Were the `models.ts` weights (0.18, 0.08, 0.54, 0.28, 0.11, 0.45, 0.4, 0.15, 0.6, 0.4) ever fit against anything, or are they purely authored? Code + docs say authored — confirm no external fit exists that the repo doesn't capture.
2. Do any completed Sleeper leagues in the user's account actually have enough teams/seasons to backtest `championshipProbability` (Brier ≤ 0.10 needs a lot of seasons to estimate a ~8% event)? The target may be statistically unmeasurable at available sample sizes — worth stating explicitly.
3. The Nexus CI runs only 20 replicates × 800 iters (`NexusSimulator.tsx:273-274`) vs the headline sim's larger iteration count — is the displayed band's own Monte-Carlo error acknowledged anywhere? It is a CI on a CI.
4. `simToRow` points-for uses `weeklyFor·weeks·scale` while points-against does NOT scale (`derivedMetrics.ts:112-113`) — intended ("you face an average schedule"), but the best-case column then shows your points rising while opponents' stay fixed, which can look like a modeling inconsistency to a user. Is that disclosed in the panel copy?
