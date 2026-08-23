# RAE validation dossier

**Compiled** 2026-08-22 · **Branch** `fix/2026-08-06-forensic-remediation`

## What this document is, and is not

This is the **evidence** a certification would rest on. It is not a
certification: no body certifies this application, and I cannot grant one.
Everything below is a measurement with a command that reproduces it.

It also records, per model, what the evidence says — including where the
evidence is **negative**. Three of RAE's models were tested against real,
untouched data and **failed**. That is a finding, not a gap to be closed by
further testing, and re-testing a refuted model until it passes is precisely the
malpractice the frozen-protocol discipline exists to prevent.

---

## 1. Model-by-model status

| model | status | evidence |
|---|---|---|
| **Season simulation** (win/playoff outcomes) | **REFUTED out-of-sample** | Protocols 1 & 2. AUC 0.5569 [0.4630, 0.6300], Brier skill −0.1738 [−0.2550, −0.0910]. Both pre-declared criteria NOT MET. |
| **Reputation edge / scarcity gap** | **REFUTED — inverted within position** | Protocol 3 on 115 real drafts. Across positions +0.058; **within position −0.048, significantly inverted**. Concordance at matched cost 0.510 — chance. |
| **`trueValue`** (ECR-derived valuation) | **No demonstrated edge** | Protocol 3 D4: `trueValue` alone correlates 0.0628 with beating draft cost; `trueValue − perceivedValue` correlates 0.0579. Subtracting consensus makes it *worse*. |
| **Draft recommendation** | **Inherits the refutation** | Built on `scarcityGap`; no independent validation. Presented as positional scarcity, not as bargain-finding. |
| **In-season opportunity (usage)** | **VALIDATED** | Protocols 4 & 5, both pre-registered and out-of-sample. See §2. |
| **Opportunity weight** | **Direction validated, magnitude not** | Protocol 5. Generalises in sign on untouched seasons; refit magnitude drifts 0.76 → 1.42. |
| **Trade values** (FantasyCalc / KTC) | **External, not RAE's model** | Third-party values consumed as-is, with source and freshness surfaced. RAE makes no accuracy claim about them. |
| **Points curve / replacement level** | **Measured, documented, uncalibrated** | Sensitivity swept over 96 league shapes; assumptions published. Presented as a scenario input, not a forecast. |

**The single structural finding tying the refutations together:** every predictor
in RAE's valuation is a monotone function of consensus rank. A model built from
the market's own opinion *is* the market. That one fact explains protocol 1,
protocol 2's directly-fitted model still losing to the base rate, and protocol
3's inverted within-position result simultaneously.

---

## 2. The validated signal, stated precisely

In-season usage predicts rest-of-season scoring **beyond what points already
scored predict**. Established twice, on data neither test was tuned on.

| | protocol 4 | protocol 5 |
|---|---|---|
| evaluation data | 2021–2024 | **2017–2019** (untouched by protocol 4) |
| players | 452 | 392 |
| primary statistic | partial ρ **0.2289** | gain **+0.0195** |
| within position | **0.2259** | **+0.0199** |
| decision concordance | **0.5749** | **0.5961** |
| all three Holm-corrected | **yes** | **yes** |
| out-of-sample gain | 0.7342 → 0.7479 | 0.6390 → 0.6585 |

**Homogeneity** (two-way ANOVA, cluster-permutation inference, 1,882
player-seasons / 689 players): usage quintile F(4, 1867) = **412.47**,
p < 0.0005; **position × usage interaction F = 1.351, p = 0.2429 — not
significant**. Every position rises monotonically across all five quintiles. The
effect is not carried by one position.

### The three caveats that travel with it

1. **The gain is small.** +0.0137 and +0.0195 Spearman. Reliable and replicated;
   not transformative.
2. **η² = 0.468 is the TOTAL association, not the incremental one.** Usage
   correlates strongly with future scoring, but most of that overlaps with points
   already scored. Quoting the ANOVA without the overlap overstates the finding
   by an order of magnitude.
3. **In-season only.** Before kickoff there is no usage to observe, and that
   regime is exactly where protocols 1–3 failed.

### What is deliberately NOT shipped

Protocol 5's weight (0.7613) is **not** in the waiver formula. That formula
weights `trueValue`, which is consensus-derived; protocol 5 fitted against
points-to-date. They are different models, and protocols 1–3 established the two
behave nothing alike. Shipping it requires RAE to compute points-to-date as a
real feature, which it does not yet.

---

## 3. Security and authentication

| area | result | how |
|---|---|---|
| Auth + security unit/integration | **115 passed** | `vitest src/lib/auth src/lib/security` |
| Throttle atomicity under concurrency | **passed on real PostgreSQL 17.11** | simultaneous-failure counting, independent account/IP/global dimensions, exact threshold crossing, no lock-sliding |
| Session revocation | **passed** | F-004 |
| Account-existence non-disclosure | **passed** | F-005/F-009 — errors reveal neither existence nor operational detail |
| Cross-user data isolation | **passed** | user B sees none of user A's league data |
| CSP in a real browser | **0 violations on 10 routes** | fresh nonce per request; no wildcard, no `unsafe-eval` |
| Security headers | **full set on every document route** | framework not advertised; API responses never cached |
| Secret scanning — full history | **278 commits, no leaks** | `gitleaks FULL-HISTORY` (the prior job scanned 29 of 299) |
| Secret scanning — tracked files | **311 files clean** | `check:secrets` |
| Burned-secret deny-list | **passed** | rotated secrets are permanently uncommittable |
| Encryption at rest | AES-256-GCM, single unversioned key | rotatable via `reencrypt:credentials` (dry-run default, round-trip verified, all-or-nothing) |
| CodeQL | **17 alerts fixed, 1 dismissed** | dismissal adjudicated in `docs/security/codeql-adjudications.md` |
| Dependency advisories | **clean** | OSV + lockfile floor + expiring-exception gate |

**Not verified, and stated as such:** that the rotated `DB_INIT_TOKEN` is
actually dead. That requires replaying the old value against the deployment,
which only the owner can do — `npm run verify:rotation`. CI proves the repository
is clean; it cannot prove a live credential was invalidated.

---

## 4. Accessibility, UX and engineering

| gate | result |
|---|---|
| axe (serious/critical) | **0 violations**, all routes |
| Lighthouse accessibility | **100 / 100 / 100** |
| Console errors | **0 across 12 routes** |
| Broken same-origin requests | **0 across 12 routes** |
| Horizontal overflow | **none at 320px or 360px**, 12 routes |
| Text clipping | **none** in unavailable-data panels |
| Playwright + axe | **319 passed, 1 skipped, 0 failed** (320 listed) |
| vitest | **920+ passed** |
| typecheck / lint | **0 / 0** |
| PostgreSQL integration | **31 passed** on real PG 17.11 |
| Live network integration | **9 passed** against real Sleeper / FantasyCalc / nflverse |

**Lighthouse performance is not reported as a gate.** Repeated runs of the same
route on identical code scored **90, 82, 78** — ±12 points of noise on a local
Windows machine. At that variance the metric cannot distinguish a real change.
Accessibility, which is stable, is the metric that carries meaning here.

---

## 5. Honest limits

1. **Three models are refuted.** They are disclosed in-product, not silently
   shipped. What is fixed is the *honesty*, not the prediction.
2. **The validated gain is small** and in-season only.
3. **The opportunity weight is validated for a model RAE has not built.**
4. **`espn.live.test.ts` is unrun** — it needs private league cookies this
   session must not handle.
5. **Credential invalidation is attested, not verified** (§3).
6. **No certification exists.** This dossier is evidence, not a certificate, and
   describing it as one would be the same category of overclaim the audit spent
   five protocols removing.

---

## 6. Reproducing everything here

```bash
npm run typecheck && npm run lint && npm run test && npm run build
npm run e2e                       # 320 tests, both viewports
npm run check:secrets

npm run holdout:evaluate          # protocol 1
npm run holdout:evaluate2         # protocol 2
npm run holdout:evaluate3         # protocol 3
npm run holdout:evaluate4         # protocol 4  — PASSED
npm run holdout:evaluate5         # protocol 5  — PASSED
npm run anova:opportunity         # homogeneity diagnostic

RAE_PG_TEST_URL=postgres://... npx vitest run src/db src/lib/auth src/lib/lifecycle
RAE_LIVE_TESTS=1 npx vitest run src/lib/schedule/schedule.live.test.ts src/lib/trade/values.live.test.ts
```

Every protocol reproduces from a committed archive with no network access. Each
harness has a `--self-test` that verifies its arithmetic without touching the
holdout.
