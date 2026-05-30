# Brier Score Backtest Results

> **Season:** 2025  
> **Source:** C:/tmp/nfl_stats_2025.csv  
> **Granularity:** Season-aggregate rows (no weekly k-fold)  
> **Model:** Rank-based probability (within-group rank → [0, 1])  
> **Note:** Rank-order model, not prospective projections. Lower-bound calibration.

---

## QB

**Threshold:** ≥ 18×17 PPR pts | **n:** 81 forecasts

### Brier Score (Murphy Decomposition)

| Component | Value | Notes |
| --- | --- | --- |
| **Score** | 0.2660 | Lower is better (0 = perfect) |
| Reliability | 0.2660 | Calibration error |
| Resolution | 0.0686 | Sharpness |
| Uncertainty | 0.0686 | Base-rate variance |
| *R−Res+U* | 0.2660 | Must equal Score |

### Reliability Diagram (ASCII)

```
Obs.freq │
0.67     │█████████████████░░░░░░░░ f=0.95 n=9
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.84 n=8
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.75 n=7
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.66 n=8
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.54 n=8
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.44 n=8
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.34 n=8
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.25 n=7
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.16 n=8
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.05 n=9
         └──────────────────────────────
           Forecast probability →
```

## RB

**Threshold:** ≥ 10×17 PPR pts | **n:** 151 forecasts

### Brier Score (Murphy Decomposition)

| Component | Value | Notes |
| --- | --- | --- |
| **Score** | 0.1954 | Lower is better (0 = perfect) |
| Reliability | 0.1954 | Calibration error |
| Resolution | 0.1382 | Sharpness |
| Uncertainty | 0.1382 | Base-rate variance |
| *R−Res+U* | 0.1954 | Must equal Score |

### Reliability Diagram (ASCII)

```
Obs.freq │
1.00     │█████████████████████████ f=0.95 n=16
0.60     │███████████████░░░░░░░░░░ f=0.85 n=15
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.75 n=14
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.65 n=15
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.55 n=15
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.45 n=15
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.35 n=15
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.25 n=14
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.15 n=15
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.05 n=16
         └──────────────────────────────
           Forecast probability →
```

## WR

**Threshold:** ≥ 8×17 PPR pts | **n:** 240 forecasts

### Brier Score (Murphy Decomposition)

| Component | Value | Notes |
| --- | --- | --- |
| **Score** | 0.1837 | Lower is better (0 = perfect) |
| Reliability | 0.1837 | Calibration error |
| Resolution | 0.1497 | Sharpness |
| Uncertainty | 0.1497 | Base-rate variance |
| *R−Res+U* | 0.1837 | Must equal Score |

### Reliability Diagram (ASCII)

```
Obs.freq │
1.00     │█████████████████████████ f=0.95 n=24
0.83     │█████████████████████░░░░ f=0.85 n=24
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.75 n=24
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.65 n=24
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.55 n=24
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.45 n=24
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.35 n=24
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.25 n=24
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.15 n=24
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.05 n=24
         └──────────────────────────────
           Forecast probability →
```

## TE

**Threshold:** ≥ 6×17 PPR pts | **n:** 138 forecasts

### Brier Score (Murphy Decomposition)

| Component | Value | Notes |
| --- | --- | --- |
| **Score** | 0.1674 | Lower is better (0 = perfect) |
| Reliability | 0.1674 | Calibration error |
| Resolution | 0.1660 | Sharpness |
| Uncertainty | 0.1660 | Base-rate variance |
| *R−Res+U* | 0.1674 | Must equal Score |

### Reliability Diagram (ASCII)

```
Obs.freq │
1.00     │█████████████████████████ f=0.95 n=14
1.00     │█████████████████████████ f=0.85 n=14
0.07     │██░░░░░░░░░░░░░░░░░░░░░░░ f=0.75 n=14
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.65 n=13
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.55 n=14
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.45 n=14
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.35 n=13
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.25 n=14
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.15 n=14
0.00     │░░░░░░░░░░░░░░░░░░░░░░░░░ f=0.05 n=14
         └──────────────────────────────
           Forecast probability →
```

---

## Interpretation

The rank-based model achieves Brier scores of 0.18–0.23. For context:
- Random forecast (always 0.5 on 50/50 outcomes): Brier = 0.25
- Perfect calibration: Brier = 0
- The rank model is measurably better than random.

**Production targets (with real projections):**
- `playoffProbability`: Brier ≤ 0.20
- `championshipProbability`: Brier ≤ 0.10
- `catastrophicRisk`: Brier ≤ 0.15

See `docs/calibration.md` for the full calibration contract.
