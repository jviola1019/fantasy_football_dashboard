# Brier Score Backtest Results

> **Season:** 2025  
> **Source:** Sleeper projections API (forecast) + Sleeper stats API (outcome)  
> **Method:** TRUE PROSPECTIVE — pre-game projection vs post-game actual PPR  
> **Two models per position:** (1) DISCRIMINATION — rank→prob (ordinal skill of projection order); (2) CALIBRATION — out-of-fold logistic mapping projected pts → P(≥ threshold), scored by Expected Calibration Error (the projections' true calibration error)  
> **Coverage:** 17 regular-season weeks, 3573 startable player-weeks (218 DNP scored 0)  
> **Universe:** players projected ≥ threshold/2; no-shows scored 0 (no survivorship filter)  
> **Inputs:** snapshot reports/2026-08-20/brier-prospective.json.gz captured 2026-08-23T19:39:27.895Z  
> **Input fingerprint:** `bba1d103` over 3573 rows. Two reports are comparable only when this value matches.  

---

## QB

**Threshold:** ≥ 18 PPR pts | **n:** 512 forecasts | **Base rate:** 43.6% positive (0 DNP scored 0)

### Discrimination model — rank→prob (Murphy decomposition)

| Component | Value | Notes |
| --- | --- | --- |
| **Score** | 0.2716 | Lower is better (0=perfect, 0.25=random) |
| Reliability | 0.0890 | Calibration error |
| Resolution | 0.0633 | Sharpness beyond base rate |
| Uncertainty | 0.2458 | Irreducible base-rate variance |
| Check R−Res+U | 0.2716 | = Score ✓ |
| **Climatology** | 0.2458 | Always forecast the base rate — the bar to clear |
| **Brier Skill Score** | -10.5% | vs climatology; ≤ 0 means no skill |

> **RETIRED — this model has no skill and must not be used.** Its Brier (0.2716) is worse than simply forecasting the QB base rate (0.2458), so a constant number beats it. Reported here only so the result stays reproducible; protocol 7 recommendation 3 (`reports/2026-08-25/holdout-result-7.md`). The calibration model below is the one with measured skill at this position.

### 5-Fold Cross-Validation (by week)

| Mean Brier | Std | Fold scores |
| --- | --- | --- |
| 0.2730 | 0.0303 | 0.271, 0.261, 0.246, 0.325, 0.263 |

### Reliability Diagram (ASCII)
```
Obs.freq │
0.66     │█████████████░░░░░░░ f=0.96 n=59
0.49     │██████████░░░░░░░░░░ f=0.85 n=51
0.52     │██████████░░░░░░░░░░ f=0.74 n=50
0.50     │██████████░░░░░░░░░░ f=0.65 n=44
0.55     │███████████░░░░░░░░░ f=0.55 n=51
0.35     │███████░░░░░░░░░░░░░ f=0.45 n=51
0.33     │███████░░░░░░░░░░░░░ f=0.35 n=45
0.35     │███████░░░░░░░░░░░░░ f=0.25 n=51
0.33     │███████░░░░░░░░░░░░░ f=0.15 n=49
0.27     │█████░░░░░░░░░░░░░░░ f=0.04 n=60
         └──────────────────────────
           Forecast probability →
```

### Calibration model — out-of-fold logistic (projected pts → P(≥ threshold))

| Metric | Value | Notes |
| --- | --- | --- |
| **Brier** | 0.2368 | OOF logistic Brier (leave-one-week-out) |
| **ECE** | 0.0331 | Expected Calibration Error (10-bin) — the projections' TRUE calibration error |
| MCE | 0.2238 | worst-bin calibration gap |
| rank-model ECE | 0.1683 | same metric for the rank→prob model, for comparison |

```
Obs.freq │
0.50     │██████████░░░░░░░░░░ f=0.72 n=4
0.64     │█████████████░░░░░░░ f=0.65 n=39
0.55     │███████████░░░░░░░░░ f=0.54 n=86
0.47     │█████████░░░░░░░░░░░ f=0.45 n=175
0.31     │██████░░░░░░░░░░░░░░ f=0.36 n=163
0.34     │███████░░░░░░░░░░░░░ f=0.27 n=44
0.00     │░░░░░░░░░░░░░░░░░░░░ f=0.18 n=1
         └──────────────────────────
           Forecast probability →
```

## RB

**Threshold:** ≥ 10 PPR pts | **n:** 876 forecasts | **Base rate:** 48.4% positive (7 DNP scored 0)

### Discrimination model — rank→prob (Murphy decomposition)

| Component | Value | Notes |
| --- | --- | --- |
| **Score** | 0.1981 | Lower is better (0=perfect, 0.25=random) |
| Reliability | 0.1103 | Calibration error |
| Resolution | 0.1620 | Sharpness beyond base rate |
| Uncertainty | 0.2497 | Irreducible base-rate variance |
| Check R−Res+U | 0.1981 | = Score ✓ |
| **Climatology** | 0.2497 | Always forecast the base rate — the bar to clear |
| **Brier Skill Score** | 20.7% | vs climatology; ≤ 0 means no skill |

### 5-Fold Cross-Validation (by week)

| Mean Brier | Std | Fold scores |
| --- | --- | --- |
| 0.1981 | 0.0194 | 0.186, 0.190, 0.231, 0.183, 0.200 |

### Reliability Diagram (ASCII)
```
Obs.freq │
0.84     │█████████████████░░░ f=0.96 n=93
0.75     │███████████████░░░░░ f=0.85 n=91
0.75     │███████████████░░░░░ f=0.75 n=81
0.59     │████████████░░░░░░░░ f=0.65 n=86
0.51     │██████████░░░░░░░░░░ f=0.54 n=86
0.44     │█████████░░░░░░░░░░░ f=0.45 n=82
0.35     │███████░░░░░░░░░░░░░ f=0.35 n=86
0.24     │█████░░░░░░░░░░░░░░░ f=0.25 n=82
0.20     │████░░░░░░░░░░░░░░░░ f=0.15 n=89
0.15     │███░░░░░░░░░░░░░░░░░ f=0.04 n=94
         └──────────────────────────
           Forecast probability →
```

### Calibration model — out-of-fold logistic (projected pts → P(≥ threshold))

| Metric | Value | Notes |
| --- | --- | --- |
| **Brier** | 0.1969 | OOF logistic Brier (leave-one-week-out) |
| **ECE** | 0.0327 | Expected Calibration Error (10-bin) — the projections' TRUE calibration error |
| MCE | 0.0869 | worst-bin calibration gap |
| rank-model ECE | 0.0499 | same metric for the rank→prob model, for comparison |

```
Obs.freq │
0.84     │█████████████████░░░ f=0.93 n=31
0.81     │████████████████░░░░ f=0.85 n=74
0.76     │███████████████░░░░░ f=0.75 n=92
0.68     │██████████████░░░░░░ f=0.65 n=90
0.58     │████████████░░░░░░░░ f=0.55 n=120
0.50     │██████████░░░░░░░░░░ f=0.45 n=90
0.29     │██████░░░░░░░░░░░░░░ f=0.35 n=110
0.23     │█████░░░░░░░░░░░░░░░ f=0.25 n=177
0.21     │████░░░░░░░░░░░░░░░░ f=0.18 n=92
         └──────────────────────────
           Forecast probability →
```

## WR

**Threshold:** ≥ 8 PPR pts | **n:** 1,470 forecasts | **Base rate:** 48.7% positive (134 DNP scored 0)

### Discrimination model — rank→prob (Murphy decomposition)

| Component | Value | Notes |
| --- | --- | --- |
| **Score** | 0.2103 | Lower is better (0=perfect, 0.25=random) |
| Reliability | 0.1293 | Calibration error |
| Resolution | 0.1688 | Sharpness beyond base rate |
| Uncertainty | 0.2498 | Irreducible base-rate variance |
| Check R−Res+U | 0.2103 | = Score ✓ |
| **Climatology** | 0.2498 | Always forecast the base rate — the bar to clear |
| **Brier Skill Score** | 15.8% | vs climatology; ≤ 0 means no skill |

### 5-Fold Cross-Validation (by week)

| Mean Brier | Std | Fold scores |
| --- | --- | --- |
| 0.2087 | 0.0142 | 0.229, 0.206, 0.192, 0.200, 0.217 |

### Reliability Diagram (ASCII)
```
Obs.freq │
0.83     │█████████████████░░░ f=0.95 n=157
0.74     │███████████████░░░░░ f=0.85 n=145
0.66     │█████████████░░░░░░░ f=0.75 n=140
0.66     │█████████████░░░░░░░ f=0.65 n=145
0.50     │██████████░░░░░░░░░░ f=0.55 n=145
0.42     │████████░░░░░░░░░░░░ f=0.45 n=145
0.41     │████████░░░░░░░░░░░░ f=0.35 n=145
0.25     │█████░░░░░░░░░░░░░░░ f=0.25 n=140
0.22     │████░░░░░░░░░░░░░░░░ f=0.15 n=145
0.20     │████░░░░░░░░░░░░░░░░ f=0.05 n=157
         └──────────────────────────
           Forecast probability →
```

### Calibration model — out-of-fold logistic (projected pts → P(≥ threshold))

| Metric | Value | Notes |
| --- | --- | --- |
| **Brier** | 0.2036 | OOF logistic Brier (leave-one-week-out) |
| **ECE** | 0.0175 | Expected Calibration Error (10-bin) — the projections' TRUE calibration error |
| MCE | 0.0903 | worst-bin calibration gap |
| rank-model ECE | 0.0695 | same metric for the rank→prob model, for comparison |

```
Obs.freq │
0.83     │█████████████████░░░ f=0.92 n=42
0.87     │█████████████████░░░ f=0.85 n=78
0.75     │███████████████░░░░░ f=0.75 n=190
0.65     │█████████████░░░░░░░ f=0.65 n=178
0.61     │████████████░░░░░░░░ f=0.55 n=179
0.44     │█████████░░░░░░░░░░░ f=0.45 n=190
0.35     │███████░░░░░░░░░░░░░ f=0.35 n=225
0.23     │█████░░░░░░░░░░░░░░░ f=0.24 n=305
0.19     │████░░░░░░░░░░░░░░░░ f=0.19 n=83
         └──────────────────────────
           Forecast probability →
```

## TE

**Threshold:** ≥ 6 PPR pts | **n:** 715 forecasts | **Base rate:** 51.2% positive (77 DNP scored 0)

### Discrimination model — rank→prob (Murphy decomposition)

| Component | Value | Notes |
| --- | --- | --- |
| **Score** | 0.2147 | Lower is better (0=perfect, 0.25=random) |
| Reliability | 0.1529 | Calibration error |
| Resolution | 0.1880 | Sharpness beyond base rate |
| Uncertainty | 0.2499 | Irreducible base-rate variance |
| Check R−Res+U | 0.2147 | = Score ✓ |
| **Climatology** | 0.2499 | Always forecast the base rate — the bar to clear |
| **Brier Skill Score** | 14.1% | vs climatology; ≤ 0 means no skill |

### 5-Fold Cross-Validation (by week)

| Mean Brier | Std | Fold scores |
| --- | --- | --- |
| 0.2130 | 0.0137 | 0.196, 0.224, 0.217, 0.201, 0.227 |

### Reliability Diagram (ASCII)
```
Obs.freq │
0.89     │██████████████████░░ f=0.95 n=80
0.71     │██████████████░░░░░░ f=0.85 n=70
0.61     │████████████░░░░░░░░ f=0.75 n=67
0.59     │████████████░░░░░░░░ f=0.65 n=69
0.60     │████████████░░░░░░░░ f=0.54 n=75
0.47     │█████████░░░░░░░░░░░ f=0.44 n=64
0.43     │█████████░░░░░░░░░░░ f=0.35 n=70
0.33     │███████░░░░░░░░░░░░░ f=0.25 n=67
0.28     │██████░░░░░░░░░░░░░░ f=0.15 n=71
0.16     │███░░░░░░░░░░░░░░░░░ f=0.04 n=79
         └──────────────────────────
           Forecast probability →
```

### Calibration model — out-of-fold logistic (projected pts → P(≥ threshold))

| Metric | Value | Notes |
| --- | --- | --- |
| **Brier** | 0.2059 | OOF logistic Brier (leave-one-week-out) |
| **ECE** | 0.0246 | Expected Calibration Error (10-bin) — the projections' TRUE calibration error |
| MCE | 0.0559 | worst-bin calibration gap |
| rank-model ECE | 0.0882 | same metric for the rank→prob model, for comparison |

```
Obs.freq │
0.97     │███████████████████░ f=0.93 n=30
0.82     │█████████████████░░░ f=0.84 n=40
0.71     │██████████████░░░░░░ f=0.75 n=83
0.65     │█████████████░░░░░░░ f=0.65 n=117
0.57     │███████████░░░░░░░░░ f=0.55 n=100
0.44     │█████████░░░░░░░░░░░ f=0.44 n=85
0.40     │████████░░░░░░░░░░░░ f=0.35 n=98
0.22     │████░░░░░░░░░░░░░░░░ f=0.25 n=138
0.25     │█████░░░░░░░░░░░░░░░ f=0.19 n=24
         └──────────────────────────
           Forecast probability →
```

---

## Interpretation

This is a **true prospective backtest**: pre-game projections vs post-game actual PPR. It measures the **discrimination/ordinal skill** of projection rank, not the calibration of the projection's own implied probabilities (the rank→prob map is ours, so Reliability reflects that map's calibration, not Sleeper's).

Mean Brier across positions: **0.2237**. 4/4 positions show positive Resolution (projection order carries signal: QB, RB, WR, TE). 3/4 beat the base-rate-only benchmark, i.e. Resolution > Reliability (RB, WR, TE).

**1 of 4 positions are RETIRED** (QB): the rank→prob model scores WORSE than always forecasting the base rate, so a constant number beats it — QB 0.2716 vs climatology 0.2458 (skill -10.5%). Use the calibration model at those positions. Protocol 7 recommendation 3.

**Calibration model (out-of-fold logistic, projected pts → P(≥ threshold)).** Mean Brier **0.2108** vs the rank model's 0.2237; mean Expected Calibration Error (10-bin) **0.0270** vs the rank model's 0.0940. Lower ECE means the projected POINTS carry genuine probability information beyond rank order — mapping them through a fitted logistic yields better-calibrated start/sit probabilities and a defensible probability the production model can consume directly. ECE is occupancy-weighted |observed − forecast| over 10 bins — comparable across models, unlike the Murphy reliability term which over-bins the logistic's continuous probabilities.

**Scope:** this backtest measures weekly *start/sit projection discrimination* only. The season simulator's `playoffProbability` / `championshipProbability` calibration (targets Brier ≤ 0.20 / ≤ 0.10) is a different quantity, measured separately — and by TWO harnesses that must not be confused. `scripts/brier-season-sim.ts` → `docs/season-calibration.md` is SYNTHETIC self-consistency: it checks the simulator against its own generative model and says nothing about real outcomes. `scripts/backtest-sleeper-2025.ts` → `docs/season-backtest-2025.md` is the REAL one, and it currently rests on a single league — one independent cluster — so it carries no significance either. Neither establishes that the season targets are met.

See `docs/calibration.md` for the full calibration contract.
