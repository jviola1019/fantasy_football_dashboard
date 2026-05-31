# RAE Dashboard — Full Audit & Pro-Grade Design Report

**Sprint:** 4  
**Date:** 2026-05-30  
**Implementation:** committed `Co-Authored-By: Claude Sonnet 4.6` (per git trailers on all Sprint 3–4 commits)  
**Reverification (this revision):** Claude Opus 4.8 — direct command re-execution + 1 parallel Opus review agent  
**Method:** tsc / eslint / vitest / Playwright / brier-backtest all re-run against real data

---

## Executive Summary

All six CI gates pass. 24/24 Playwright tests pass (including a11y). 350 vitest unit tests pass. One security/data finding (Zod validation gap on insert paths) fixed. Two design defects from Sprint 3 fixed (contrast fail, CSV parser bug). Editorial font stack integrated (Bricolage Grotesque + IBM Plex Sans/Mono). Moderate entrance animations added.

> **Post-Sprint-4 Opus 4.8 reverification (2026-05-30):** every gate above was
> re-executed and confirmed (tsc, eslint, vitest 350/354, build 17 routes,
> Playwright 24/24, live Sleeper 2025 pull). The Brier backtest was additionally
> **upgraded** from the season-aggregate model described in §3 below to a true
> **prospective** Sleeper projections-vs-actuals model (see §3.6), and three
> quantitative defects an Opus review found in that upgrade (survivorship bias,
> hard-coded interpretation, calibration-vs-discrimination mislabel) were fixed
> before commit. See `reports/opus48-reverification.md` for the full ledger.

---

## 1. Code Quality Gates

| Gate | Command | Result | Notes |
| --- | --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | **PASS** (exit 0) | Zero errors across all Sprint 3+4 files |
| ESLint | `npx eslint .` | **PASS** (exit 0) | Zero errors; pre-existing hints only (inline-style, opacity in @keyframes — both correct patterns) |
| Vitest | `npx vitest run` | **PASS** 350/354 | 38 files, 4 skipped (live integration tests) |
| Build | `npx next build` | **PASS** (exit 0) | 17 routes (2 static, 15 dynamic) |
| Playwright | `npx playwright test --project=chromium` | **PASS** 24/24 | All e2e + 5-route a11y scan |
| Brier backtest | `npx tsx scripts/brier-backtest.ts` | **PASS** | Upgraded to live prospective Sleeper 2025 pull — 3,573 startable player-weeks, 17 weeks (see §3.6) |

---

## 2. Security & Data Integrity

All prior security findings (Sprint 3) remain PASS. Two new findings in Sprint 4:

### 2.1 Zod validation gap on insert paths (FIXED)
**Finding:** `insertProjectionsSnapshot` and `insertNewsSnapshot` both persisted data without runtime Zod validation. The schemas existed and were used on read paths, but not on write paths — a schema drift on write would silently persist corrupt data.

**Fix applied:**
- `src/lib/sleeper/projectionsSnapshot.ts` — `ProjectionsSnapshotPayloadSchema.parse(data)` before insert
- `src/lib/espn/newsSnapshot.ts` — `EspnNewsArticleListSchema.parse(articles)` before insert

**Risk assessment:** Low-risk historically (TypeScript types caught most drift), but now symmetrically safe.

### 2.2 All prior checks re-verified
Password hashing (scrypt), credential encryption (AES-256-GCM), account isolation (`getLeagueForUser`), CRON_SECRET gates, no module-level credential cache — all PASS.

---

## 3. Statistical Calibration (Brier Backtest)

### Root cause of prior failure (v1 backtest)
The `parseCsv` function used naive `.split(",")` which broke on the `headshot_url` column that contains `f_auto,q_auto` inside a quoted field. Only 5/2020 rows parsed; Brier=1.0 (degenerate).

### Fix applied
`splitCsvRow()` — RFC 4180-compliant quoted CSV parser added to `scripts/brier-backtest.ts`. Handles embedded commas, escaped quotes (`""`), and CRLF line endings.

### Results (2025 season-aggregate, 2020 rows) — ⚠️ SUPERSEDED by §3.6

> These season-aggregate numbers are retained for history but are **NOT the
> current results.** The model was methodologically circular: it ranked players
> by their *actual* season PPR and then asked whether *actual* season PPR cleared
> threshold×17 — the forecast was derived from the same outcome it predicted, so
> it is a lower bound only. Superseded by the prospective model in §3.6.

| Position | Brier (season-agg, circular) | n |
| --- | --- | --- |
| QB | 0.2660 | 81 |
| RB | 0.1954 | 151 |
| WR | 0.1837 | 240 |
| TE | 0.1674 | 138 |

### 3.6 Prospective upgrade (Opus 4.8 reverification, 2026-05-30)

The backtest was rewritten to a **true prospective** design and the live 2025
data was pulled successfully (no synthetic data, no nflverse dependency):

- **Forecast:** pre-game Sleeper weekly *projections* (`/projections/nfl/2025/{w}`)
- **Outcome:** post-game Sleeper weekly *actual stats* (`/stats/nfl/2025/{w}`)
- **Independence:** forecast (projection rank) and outcome (actual ≥ threshold)
  come from two different endpoints — the circularity is gone.
- **Universe:** players projected ≥ threshold/2 ("plausibly startable").
  No-shows (DNP/injured/benched) are scored **0** (failed forecast), not dropped
  — dropping them was survivorship bias that removed exactly the high-projection
  busts that should penalise the forecast.
- **Coverage:** 3,573 startable player-weeks across all 17 regular-season weeks
  (218 DNP scored 0); per-position k-fold-by-week CV.

| Position | Brier (prospective) | n | Base rate | Resolution > Reliability? |
| --- | --- | --- | --- | --- |
| QB | 0.2716 | 512 | 43.6% | ✗ (no better than climatology) |
| RB | 0.1981 | 876 | 48.4% | ✓ |
| WR | 0.2103 | 1,470 | 48.7% | ✓ |
| TE | 0.2147 | 715 | 51.2% | ✓ |

**What it measures (honest framing):** the rank→probability map is monotone in
the projection, so this is a **discrimination / ordinal-skill** test (does
projection *order* predict who clears the threshold?), **not** a calibration test
of the projections' own implied probabilities. 4/4 positions show positive
Resolution (projection order carries signal); 3/4 (RB/WR/TE) beat the
base-rate-only benchmark. QB does not — its score is treated as no better than
climatology. Removing the survivorship bias correctly *raised* the skill-position
Brier scores (RB 0.179→0.198, WR 0.199→0.210, TE 0.205→0.215) vs the earlier
optimistic prospective draft. Full per-position Murphy decomposition and ASCII
reliability diagrams in `docs/brier-results.md`; run log in
`reports/brier-backtest-prospective.txt`.

**Remaining limitation:** Reliability here is the calibration of *our* invented
rank→prob mapping, not of Sleeper/Rotowire numbers. A genuine projection-
calibration test (logistic fit of projected pts → P(actual ≥ threshold)) is a
Sprint-5 candidate.

---

## 4. Code Review Findings

### 4.1 TODOs / FIXMEs
**Zero** TODO/FIXME/HACK/XXX markers found across all `src/` files.

### 4.2 Tab border alignment (time-range tabs) — FIXED
**Root cause:** `.time-tab` (inactive) had `border: 1px solid transparent` with `border-bottom: 2px solid var(--blue)` on active state. The 1→2px bottom border change caused a 1px vertical jitter in the `.time-range-tabs` flex container.

**Fix:** Added `border-bottom: 2px solid transparent` to the base `.time-tab` rule. Now identical border width in both states; only color changes on activation. Same pattern as `PanelTabs.tsx` which was already jitter-free.

**Implementation note:** Changed `.time-range-tabs` to `align-items: flex-end` for clean tab-strip alignment across states.

### 4.3 Zod validation on inserts — FIXED (see §2.1)

### 4.4 ReliabilityDiagram wiring — CONFIRMED FIXED
Component is imported in `NexusSimulator.tsx` (Sprint 3 fix) and renders in the Risk Analysis tab with an honest "Awaiting backtest data" placeholder.

### 4.5 Cron schedule ordering — CONFIRMED FIXED
Correct order: players(08:00) → rankings(08:30) → ktc(09:00) → projections(09:15) → news(09:20) → lifecycle(09:30).

---

## 5. UI/UX Design Changes (Sprint 4)

### 5.1 Design direction
**Editorial / type-led** — selected by user. Strong typographic hierarchy, Bricolage Grotesque for headings, IBM Plex Sans for body. Avoids generic AI fonts (Inter, Roboto, Arial, Space Grotesk).

### 5.2 Font integration
Added via Google Fonts `@import` at the top of `globals.css`:
- **Bricolage Grotesque** (variable: 200-800 weight, 75-100 width, 12-96 opsz) — headings and panel titles
- **IBM Plex Sans** (300/400/500/600, italic 400) — body text; humanist grotesque, distinct from Inter
- **IBM Plex Mono** (400/500) — governance metadata, timestamps, code, section labels

Applied to:
```css
body { font-family: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif; }
h2 { font-family: "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif; }
code, .intel-ts, .section-label, .mini-panel-title, .sim-count { font-family: "IBM Plex Mono", monospace; }
```

### 5.3 Color contrast fix (WCAG AA compliance restored)

Sprint 3 moved `--panel-2` to `#18222f` (darker navy) and `--blue` to `#4a8db7` (slate). The combination scored 4.42:1 — below the 4.5:1 WCAG AA threshold at small text sizes (9-12px).

| Token | Sprint 3 | Sprint 4 | Contrast on `--panel-2` |
| --- | --- | --- | --- |
| `--blue` | `#4a8db7` | `#5a9fc4` | 4.42 → ~5.1:1 ✅ |
| `--red` | `#e7574c` | `#eb5f54` | 4.48 → ~4.6:1 ✅ |

Affected elements: `.demo-banner-cta`, `.view-all-link`, `.intel-ts`, `.profile-slot` (blue); `.neg-text` table cells (red). All now pass WCAG 2.1 AA.

### 5.4 Moderate entrance animations
Staggered card/panel reveals (user-selected: "Moderate"):
- **`panel-slide-in`**: 260ms `cubic-bezier(0.22,1,0.36,1)` — panel entrance (opacity + translateY)
- **`card-fade-in`**: 200ms ease-out — KPI card stagger via `--stagger` CSS variable
- **`hover-lift`**: `translateY(-2px)` 120ms — mini-panel, player-grid-card, draft-board-row
- **`label-reveal`**: 180ms ease-out — section labels
- **Player row hover**: `rgba(90,159,196,0.05)` background fill, 100ms

All existing keyframes (live-pulse, data-unavailable-reveal, aurora-shift, tab-body-fade) confirmed present and correct. All respect `@media (prefers-reduced-motion: reduce)`.

### 5.5 Design token summary

```json
{
  "bg": "#0b1120",
  "panel": "#111827",
  "panel-2": "#18222f",
  "cream": "#f0ece4",
  "muted": "#8898aa",
  "blue": "#5a9fc4",
  "amber": "#d7a857",
  "red": "#eb5f54",
  "green": "#35c08a"
}
```

---

## 6. Playwright Test Coverage (24/24)

Actual spec files in `e2e/`, chromium project (verified by Opus 4.8 re-run
2026-05-30; counts taken from `reports/playwright.json`):

| Spec file | Tests | Result |
| --- | --- | --- |
| `01-dashboard.spec.ts` | 8 | ✅ |
| `02-login.spec.ts` | 2 | ✅ |
| `03-a11y.spec.ts` (axe; /, /login, /settings/account, /settings/leagues, /mock-draft) | 5 | ✅ |
| `04-draft-and-lifecycle.spec.ts` | 4 | ✅ |
| `05-auth-flow.spec.ts` | 2 | ✅ |
| `07-no-shared-data.spec.ts` | 2 | ✅ |
| `14-wrong-password-error.spec.ts` | 1 | ✅ |
| **Total** | **24** | **24 pass / 0 fail** |

> **Correction (Opus 4.8 reverification):** an earlier draft of this table
> listed spec files that do not exist in the repo (`04-sign-out`,
> `09-panel-degradation`, `10-league-switcher`, `11-no-league-cta`,
> `12-mock-draft`, `13-account-flows`). The table above is the real `e2e/`
> contents. The committed `reports/playwright.json` was also a stale 23/24
> pre-color-fix run; it has been regenerated with the verified 24/24 result.

---

## 7. Artefacts

| File | Description |
| --- | --- |
| `reports/workflow-summary.json` | CI gate pass/fail + brier results |
| `reports/design-tokens.json` | Full Sprint 4 design token set |
| `reports/tsc.txt` | TypeScript compiler output |
| `reports/unit.txt` | Vitest output |
| `reports/eslint.json` | ESLint JSON report |
| `reports/build.txt` | Next.js build output |
| `reports/brier-backtest-v2.txt` | Fixed brier-backtest output (2020 rows) |
| `docs/brier-results.md` | Per-position Brier results + ASCII diagram |
| `audit_report.md` | Sprint 3 audit report (baseline) |

---

## 8. Recommendations for Sprint 4 → Sprint 5

### High priority
1. **Wire trendingMomentum into lifecycle cron** — `evaluateLifecycleRules` doesn't consume news yet; ordering is now correct (news runs before lifecycle at 09:20 vs 09:30).
2. **ReliabilityDiagram with real bins** — run `npx tsx scripts/brier-backtest.ts` once `stats_player_week_2025.csv` is published; attach bins directly to `ReliabilityDiagram` in NexusSim Risk Analysis tab.
3. **Weekly Briefing card** — "what should I do this week" surface above CommandCenter; highest product gap from user surveys.

### Medium priority
4. **nflverse 2025 per-week data** — the brier-backtest script will auto-upgrade from season-aggregate to per-week when available; adds k-fold CV across weeks.
5. **Trade comparison UI** — head-to-head A vs B in TradeCenter; KTC is now live (3 data sources).
6. **ESPN news sentiment upgrade** — current trendingMomentum uses article count velocity; lexicon-based sentiment (VADER or similar) on headlines is a near-term improvement.
7. **Lifecycle circuit-breaker** — needed at 100+ leagues; sequential decrypt+fetch loop is a bottleneck under Pro plan.

### Lower priority
8. **Yahoo Fantasy adapter** — requires registered OAuth app; high user impact.
9. **Inline-style migration in SVG charts** — move to CSS data attributes to satisfy project-wide lint rules.
10. **Extended E2E coverage** — signed-in flows for `/settings/account` and `/settings/leagues` (currently only tested via unauthenticated redirect).

---

*Sprint 4 implementation committed Co-Authored-By Claude Sonnet 4.6. This audit
report was revised and all gates re-verified by Claude Opus 4.8 (2026-05-30);
see `reports/opus48-reverification.md`.*
