# Trade Value Backtest — Calibration Report (2024 Season)

## Purpose

This document records the methodology, data provenance, and empirical results for the
statistical backtest harness in `src/lib/trade/backtest.test.ts`. The backtest validates
whether preseason trade values meaningfully predict realized fantasy production.

---

## Data Sources

### Preseason Trade Values (`tradeValue`)

Source: **FantasyPros 2024 PPR Composite ADP**
URL: https://www.fantasypros.com/nfl/adp/ppr-overall.php?year=2024
(Consensus across ESPN, CBS Sports, NFL.com, RTSports, and Sleeper; September 2024)

For quarterbacks not appearing in the top 150 PPR ADP, the QB-specific ADP was used:
URL: https://www.fantasypros.com/nfl/adp/qb.php?year=2024

The `tradeValue` field is a descending cardinal derived from the player's PPR ADP using:

```
tradeValue = Math.round(1000 * (1 - (adp - 1) / 249))
```

This is a monotone linear transform mapping ADP 1 → 1000, ADP 125 → ~499, ADP 250 → ~4.
Higher values = more preseason value, exactly as expected for a trade value metric.

**Important constraint**: FantasyCalc's free API serves only current values and does not
expose historical (2024 preseason) trade values. This backtest therefore uses preseason ADP
as a proxy for preseason redraft trade value — a reasonable substitute that reflects
community consensus on player value before the season began.

### Realized Fantasy Points (`fantasyPoints`)

Source: **FantasyPros 2024 Full PPR Season Statistics**
URLs:
- Quarterbacks: https://www.fantasypros.com/nfl/stats/qb.php?year=2024&scoring=PPR&range=full
- Running Backs: https://www.fantasypros.com/nfl/stats/rb.php?year=2024&scoring=PPR&range=full
- Wide Receivers: https://www.fantasypros.com/nfl/stats/wr.php?year=2024&scoring=PPR&range=full
- Tight Ends: https://www.fantasypros.com/nfl/stats/te.php?year=2024&scoring=PPR&range=full

All points are full-PPR (1 pt per reception), full-season (Weeks 1–18) totals.

---

## Fixture Coverage

File: `src/lib/trade/fixtures/backtest-2024.json`

| Position | Count |
|----------|-------|
| QB       | 17    |
| RB       | 29    |
| WR       | 37    |
| TE       | 12    |
| **Total**| **95**|

The fixture deliberately includes both preseason favorites who delivered (Ja'Marr Chase ADP
6.6, 403.0 pts; Saquon Barkley ADP 9.2, 355.3 pts; Lamar Jackson ADP 37.2, 434.4 pts) and
preseason favorites who busted due to injury or underperformance:
- Christian McCaffrey (ADP 1.0, 47.8 pts — Achilles/knee injury, 4 games played)
- Isiah Pacheco (ADP 20.2, 56.9 pts — fibula fracture Week 2)
- Stefon Diggs (ADP 43.0, 59.8 pts — trade to Houston, then injury)
- Brandon Aiyuk (ADP 35.0, 100.8 pts — holdout, knee injury)
- Travis Etienne Jr. (ADP 17.4, 130.2 pts — limited by injury)
- Dak Prescott (ADP 68.4, 124.5 pts — hand injury, missed significant time)

Also includes genuine 2024 undervalued breakouts:
- Baker Mayfield (ADP 166.6, 381.8 pts)
- Sam Darnold (ADP 249.0, 319.8 pts)
- Bo Nix (ADP 184.6, 329.1 pts)
- Jayden Daniels (ADP 102.6, 364.8 pts)
- Brock Bowers (ADP 100.6, 262.7 pts)

---

## VOR Baselines

The `REPLACEMENT_RANKS` used for computing realized VOR are:

```ts
export const REPLACEMENT_RANKS: Record<string, number> = {
  QB: 13,  // 12-team, 1QB league: replacement = QB outside starting 12
  RB: 25,  // 2 starters + flex tier (12 teams)
  WR: 37,  // 3 starters + flex tier (12 teams)
  TE: 13   // 1 starter per team
};
```

The baseline player for each position is the player at 0-based index `ranks[pos]` in the
descending-points-sorted list for that position. With `ranks.RB = 25`, the replacement
player is the 26th-best RB by realized points — the first "off the waiver wire" back.

Actual 2024 baselines computed from the fixture:
- QB: Jordan Love, 244.9 pts (QB14 in 17-player sample)
- RB: Javonte Williams, 157.9 pts (RB26 in 29-player sample)
- WR: Stefon Diggs, 59.8 pts (WR37 = last in 37-player sample)
- TE: Dalton Kincaid, 45.6 pts (TE12 = last in 12-player sample)

Note: The WR baseline (59.8 pts, Diggs) is unusually low because Diggs was ADP-43 but
suffered a season-ending injury. In a typical year the WR37 would score ~150+ pts.

---

## Backtest A: Spearman Rank Correlation

**Method**: Compute realized VOR for each player in the fixture (using `REPLACEMENT_RANKS`
above). Then compute Spearman rank correlation between the 95 players' `tradeValue` scores
and their realized VOR scores.

**Measured result**: rho = **0.185**

**Threshold in test**: >= 0.7

**Test result**: FAIL

**Explanation**: The 0.185 rho reflects the genuinely weak predictive power of preseason
ADP for 2024 realized fantasy production, driven by:

1. **Cross-position mixing**: VOR baselines differ by position. A WR drafted at ADP 5 has
   much lower absolute fantasy points than a QB drafted at ADP 38, but the WR may have higher
   VOR relative to their replacement baseline and vice versa. Cross-position Spearman on raw
   VOR does not capture positional scarcity, producing a noisy signal.

2. **2024 injury anomalies**: The 2024 season saw an unusually high number of top-5 ADP
   players suffer season-altering injuries (CMC, Pacheco, Diggs, Aiyuk, Etienne, Prescott,
   Anthony Richardson). In any single NFL season, injuries create substantial noise, but 2024
   had above-average top-end bust rates.

3. **Breakout emergence**: Multiple genuinely unpredictable breakouts (Baker Mayfield, Sam
   Darnold, Bo Nix, Jayden Daniels, Brock Bowers, Brian Thomas Jr.) came from very low ADP
   positions, inverting the expected rank relationship.

Within-position Spearman correlations are also low: QB 0.017, RB 0.347, WR 0.104, TE 0.091.
The RB position shows the strongest correlation (0.347) — still well below 0.7 — as running
backs' usage is more predictable preseason than other positions.

**Conclusion**: The 0.7 threshold is not achievable with real 2024 data. This is not a data
error but an empirical finding about 2024's predictability. A multi-year average (2019–2024)
would likely produce a higher rho, but using 2024 alone was specified by the task.

---

## Backtest B: Verdict Calibration

**Method**: For every pair of players in the fixture, call `evaluateTrade` to get the
preseason verdict (balanced / slight-edge / lopsided). Record the absolute VOR gap between
the two players. Test whether balanced-verdict trades have smaller realized VOR gaps than
lopsided-verdict trades using Welch's t-test and Cohen's d.

**Measured results**:
- Balanced VOR gaps: mean = 96.27 pts (n = 1,302 pairs)
- Lopsided VOR gaps: mean = 95.26 pts (n = 1,707 pairs)
- meanDelta (balanced − lopsided) = **+1.01** (expected: < 0)
- pTwoSided = > 0.05 (not significant)
- Cohen's d ≈ 0.01 (expected: |d| >= 0.5)

**Threshold in test**: meanDelta < 0, pTwoSided < 0.05, |cohensD| >= 0.5

**Test result**: FAIL

**Explanation**: The verdict calibration test fails because preseason trade values are not
sufficiently predictive of realized production for 2024 (as established in Backtest A). When
the underlying correlation is near zero, there is no reason for "balanced" trades to have
systematically smaller realized VOR gaps than "lopsided" ones. The `evaluateTrade` verdict
thresholds (BALANCED_MAX=10%, SLIGHT_MAX=25%) appear reasonable in principle but cannot be
validated against a single season with near-zero predictive ADP.

---

## What Is Empirically Validated vs. Assumed

### Validated (by this backtest)
- The `spearman()` implementation is correct (unit tests pass: perfect positive and negative
  rank correlations).
- The `realizedVor()` implementation correctly subtracts the positional replacement baseline
  (unit test passes).
- The fixture contains 95 real 2024 NFL players with real preseason ADP-derived trade values
  and real season-end PPR totals. No data was fabricated.

### Not Validated
- **Backtest A threshold (rho >= 0.7)**: The real 2024 cross-position ADP → VOR Spearman rho
  is 0.185, failing the threshold. The 2024 season is an outlier for top-end busts.
- **Backtest B verdict calibration**: The evaluate thresholds (10% / 25%) cannot be validated
  against 2024 because the underlying signal is too noisy.

### Assumed / Limitations
- **ADP as proxy for trade value**: FantasyCalc does not expose historical preseason values via
  API. We use FantasyPros PPR ADP (consensus across major platforms) as the best available
  public proxy for "what the community would have paid" for each player in August 2024.
- **Single-season backtest**: One NFL season is a small sample for calibrating thresholds.
  Multi-year validation (e.g., 2019–2024) would provide more robust signal but is out of
  scope for this task.
- **Replacement ranks are fixed**: REPLACEMENT_RANKS assumes a standard 12-team 1QB league.
  Different formats (2QB, 14-team) would shift all baselines.
- **No injury adjustment**: VOR is computed from final season totals including missed games.
  A "games-played-adjusted" VOR would likely produce a stronger correlation but would obscure
  the real-world risk that justifies position scarcity discounts.
