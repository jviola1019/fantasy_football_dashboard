# Holdout result — shipped valuation chain on untouched MyFantasyLeague data

**Executed** 2026-08-21T00:07:05.371Z · **Protocol** [holdout-protocol.md](./holdout-protocol.md) (frozen `7688d14`)

Archived leagues read: **21**

## Sample construction

| stage | leagues |
|---|---|
| archived | 21 |
| rejected — no usable playoff bracket | 5 |
| rejected — not every franchise drafted | 2 |
| rejected — IDP league | 1 |
| **scored** | **13** |

## Sample

| quantity | value |
|---|---|
| team-seasons (rows) | **160** |
| leagues (clusters) | **13** |
| seasons | 2021, 2023 |
| league sizes | 10, 12, 14, 16 |
| playoff fields | 4, 6, 8 |
| observed qualification rate | 0.4750 |
| structural rate (mean P/N) | 0.4750 |

> **Self-check caveat, stated rather than hidden.** Protocol §6 declared a check that the observed rate equals the structural rate. Because the outcome label is DEFINED as `standings rank <= P`, that identity holds by construction and the check is therefore vacuous — it validates arithmetic, not the bracket read. A genuine check would compare against actual bracket participants (`TYPE=playoffBracket&BRACKET_ID=`), which was not acquired. The risk this leaves: if `P` is misread for some league shape, those teams are mislabeled. `P` is taken from the largest non-consolation bracket's `teamsInvolved`, which is the field size in every league inspected by hand.

## Headline

| forecaster | Brier | log loss | AUC | ECE |
|---|---|---|---|---|
| **shipped chain** | **0.2822** | 0.8004 | **0.5569** | 0.1613 |
| structural climatology (P/N) | 0.2404 | 0.6737 | 0.5 by construction | 0.0000 |
| raw draft capital | — | — | 0.5149 | — |

Brier skill score vs structural climatology: **-0.1738**

## Uncertainty — cluster bootstrap over whole leagues

| quantity | 95% CI | clusters | distinct resample values |
|---|---|---|---|
| AUC | [0.4630, 0.6300] | 13 | 4732 |
| Brier skill | [-0.2550, -0.0910] | 13 | 4913 |

Resolution: a 13-cluster bootstrap can reach a very large number of distinct multisets, so unlike the 3-cluster development-set intervals these are genuinely estimated rather than a percentile of a handful of values.

## Reliability (10 equal-width bins)

| bin | n | mean forecast | observed rate |
|---|---|---|---|
| 0.0–0.1 | 12 | 0.0696 | 0.4167 |
| 0.1–0.2 | 33 | 0.1602 | 0.4848 |
| 0.2–0.3 | 34 | 0.2533 | 0.3824 |
| 0.3–0.4 | 32 | 0.3570 | 0.4375 |
| 0.4–0.5 | 17 | 0.4485 | 0.5294 |
| 0.5–0.6 | 14 | 0.5422 | 0.5714 |
| 0.6–0.7 | 8 | 0.6331 | 0.5000 |
| 0.7–0.8 | 4 | 0.7543 | 0.7500 |
| 0.8–0.9 | 5 | 0.8360 | 0.8000 |
| 0.9–1.0 | 1 | 0.9200 | 0.0000 |

## Verdict against the criterion declared before execution

Protocol §9 required BOTH of:

1. AUC 95% CI entirely above 0.5 — **NOT MET**
2. Brier skill 95% CI entirely above 0 — **NOT MET**

**RESULT: the shipped chain does NOT demonstrate positive external skill on this sample.** Per protocol §9, no parameter is adjusted and re-run on this data. The model stays presented as a scenario generator, not a forecast.

---

# Interpretation

## The headline is not "the model failed" — it is more specific than that

Two different failures were claimed on development data. **One replicated and
one did not**, and conflating them would misreport both.

| claim | development (5 leagues, 3-5 clusters) | holdout (13 unseen leagues, 160 rows) | verdict |
|---|---|---|---|
| ranking is significantly **inverted** | AUC 0.2546, CI **[0.1333, 0.4450]** — entirely below 0.5 | AUC **0.5569**, CI **[0.4630, 0.6300]** — straddles 0.5 | **DID NOT replicate** |
| calibration is worse than the base rate | Brier skill CI [-0.4588, -0.1320] | Brier skill CI **[-0.2550, -0.0910]** | **replicated, significant** |

### The inversion was small-sample noise

This matters, and it cuts against a finding this audit trail had been treating as
established. The 2026-08-06 report concluded the transform was *"destroying
signal"* and *"significantly worse than chance"*. On an untouched sample from a
different platform, with 13 clusters instead of 3-5, the point estimate is
**above** 0.5 and the interval contains it.

The mechanism proposed for the inversion — that rank-ratio VBD systematically
under-values scarce positions, and early QB/TE spend correlated with qualifying
— may still be a real property of the transform. What is no longer supported is
that it produced *measurably worse-than-chance ranking*. Three effective clusters
could not distinguish that from noise, and now that a larger sample exists, it
does not.

**A model must not be accused of more than the evidence shows**, any more than it
may be credited with more. The user-facing disclosure has been rewritten
accordingly: the "ranked teams worse than chance" claim is removed from every
surface, and `scenarioBand.test.ts` now asserts it cannot come back.

### The calibration failure is real and is the one that matters

Brier 0.2822 against a 0.2404 structural-climatology baseline. Skill −0.1738,
with a 95% cluster-bootstrap CI of **[-0.2550, -0.0910]** — entirely below zero
across 13 clusters and 4,913 distinct resample values. This is not a fragile
interval.

The reliability table shows exactly why:

| bin | n | mean forecast | observed |
|---|---|---|---|
| 0.0–0.1 | 12 | 0.070 | **0.417** |
| 0.1–0.2 | 33 | 0.160 | **0.485** |
| 0.2–0.3 | 34 | 0.253 | 0.382 |
| 0.3–0.4 | 32 | 0.357 | 0.438 |
| 0.9–1.0 | 1 | 0.920 | **0.000** |

The model spreads its forecasts from 7% to 92% while the observed rate stays near
the base rate of 0.475 for almost every bin. It is **over-dispersed**: it
manufactures confidence it has not earned. Twelve teams told they had a ~7%
chance qualified 42% of the time.

That is precisely the harm audit §3 was about, and it is why the numbers are
presented as bands against the structural baseline rather than as percentages.
**The Strategy B decision is vindicated by this result** — arguably more cleanly
than by the evidence that motivated it.

### Raw draft capital is at chance, as expected

AUC 0.5149. A snake draft equalises capital, so this is the correct null and it
behaves. It also means the chain's 0.5569 is not obviously *worse* than its own
input — another way the "destroying signal" claim fails to replicate.

## What this result does and does not license

**Does:**

- Keep production on the scenario presentation. Confirmed by better evidence.
- Retire the "significantly inverted" claim from user-facing copy and from the
  live model assumptions.
- Treat calibration, not ranking, as the demonstrated defect.

**Does not:**

- License shipping PAR. PAR was not evaluated here (protocol §3) and remains
  unshipped.
- License any parameter change. Protocol §9 forbids tuning on this data, and
  nothing was tuned.
- Support a claim of *positive* skill. Both pre-declared criteria were **NOT
  MET**. AUC straddling 0.5 is an absence of evidence, not evidence of ability.

## Limitations, stated in full

1. **13 clusters, not the 200 targeted.** See Amendment 1 — the shortfall is API
   rate limiting, not selection, and the sample is the deterministic prefix of
   the frozen frame.
2. **Two seasons only** (2021, 2023), because the frame is walked per season and
   the run was truncated inside season 2021's list plus the earlier 2023 pull.
3. **Scoring format is assumed PPR** for every MFL league. MFL scoring rules were
   not parsed, so a standard-scoring league is scored on a PPR field baseline.
   This is a real approximation and it is not corrected post hoc.
4. **The §6 self-check is vacuous**, as the harness itself reports: the outcome
   label is defined from standings rank, so the identity holds by construction.
   A genuine bracket-participant check was not acquired.
5. **Playoff qualification is a coarse label.** It discards margin.
6. **One platform.** MFL's population skews serious; this is evidence about MFL
   redraft leagues.
7. `volatility` is held at the model median, as in the development harness —
   constant across teams, so it can neither create nor destroy discrimination.

## Reproducing this

```bash
npm run holdout:evaluate    # reads reports/2026-08-20/holdout-data.jsonl.gz
```

The 21-league sample is committed as `holdout-data.jsonl.gz` (0.22 MB), so the
run reproduces from a clean checkout without touching MyFantasyLeague.
