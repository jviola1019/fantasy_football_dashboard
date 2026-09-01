# Lighthouse baseline — before the redesign

**Source:** CI run `33035114690`, commit `08ca10d`, `ubuntu-latest`, 5 runs per URL,
median aggregation. Artifact `lighthouse-reports`, downloaded 2026-08-28.

This file exists because there was no baseline. `reports/lighthouse/` is gitignored
and empty, `reports/2026-08-20/lighthouse.txt` is a single-run log with no scores,
and `reports/2026-08-06/final/lighthouse.txt` records a failed run. Without a
recorded starting point, "the redesign did not regress performance" is not a claim
anyone can check — which is redesign risk R3.

## Scores

| URL | performance | accessibility | best-practices | SEO |
|---|---|---|---|---|
| `/` | **0.90** | 1.00 | 0.96 | 1.00 |
| `/login` | **0.90** | 1.00 | 1.00 | 1.00 |
| `/dashboard` | **0.84** | 1.00 | 0.96 | 1.00 |

Medians of 5. Only accessibility can fail the build (`lighthouserc.json:19-24`,
error at ≥0.90); performance ≥0.70, best-practices ≥0.85 and SEO ≥0.85 warn.

**Accessibility is 1.00 on all three URLs.** That is the number with the least room
and the most consequence: it is the only error-level assertion, so a redesign has
nowhere to go but down on the one metric that blocks.

## Run-to-run spread, which is the part that matters for judging a regression

| URL | performance min | median | max | spread |
|---|---|---|---|---|
| `/` | 0.60 | 0.90 | 0.90 | **0.30** |
| `/dashboard` | 0.83 | 0.84 | 0.87 | 0.04 |
| `/login` | 0.89 | 0.90 | 0.93 | 0.04 |

`/` swings **30 points** across five runs of identical code. `scripts/lighthouse-variance.ts`
flags a spread of 5 points as `<-- NOISY`; this is six times that.

The practical consequence: **a performance regression on `/` of less than ~0.30 is
not measurable by this harness.** Comparing single numbers after the redesign would
be reading noise. Any performance claim about `/` needs the full five-run
distribution compared against the distribution above, not median against median.
`/dashboard` and `/login` are stable at ±0.04 and can be compared directly.

## Coverage gap, recorded rather than fixed

Lighthouse collects `/`, `/login` and `/dashboard` (`lighthouserc.json:6-10`).
**None of the chart-heavy routes are measured** — `/analytics` carries four panels
and up to four charts, `/players` and `/draft` render radar charts. Those are
precisely the routes the chart kit (session 3) and the new model panel (session 5)
will change most, and precisely the routes with no performance measurement at all.

Adding them widens the CI job, which already sits inside a 25-minute cap alongside
a 16-minute Playwright run (risk R4). Left as a decision for session 7, when the
final re-baseline happens and the true cost of the redesign is known.

## Reproducing

```bash
gh run download <run-id> -n lighthouse-reports -D <dir>
```

then read `categories.*.score` from each `*.report.json`.

Running `npm run lighthouse` locally on Windows fails at cleanup with
`EPERM ... \\?\C:\Users\...\Temp\lighthouse.<id>` from `chrome-launcher`'s
`destroyTmp`, after the audit completes but before any report is written. The CI
artifact is the reliable source on this machine.
