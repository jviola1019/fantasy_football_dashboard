# RAE Dashboard — Full Audit & Pro-Grade Design Report

**Sprint:** 4  
**Date:** 2026-05-30  
**Method:** Parallel Opus 4.8 agents + dynamic workflow (tsc / eslint / vitest / Playwright / brier-backtest all run)

---

## Executive Summary

All six CI gates pass. 24/24 Playwright tests pass (including a11y). 350 vitest unit tests pass. One security/data finding (Zod validation gap on insert paths) fixed. Two design defects from Sprint 3 fixed (contrast fail, CSV parser bug). Editorial font stack integrated (Bricolage Grotesque + IBM Plex Sans/Mono). Moderate entrance animations added. Real 2025 Brier scores computed from 2020 local data rows.

---

## 1. Code Quality Gates

| Gate | Command | Result | Notes |
| --- | --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | **PASS** (exit 0) | Zero errors across all Sprint 3+4 files |
| ESLint | `npx eslint .` | **PASS** (exit 0) | Zero errors; pre-existing hints only (inline-style, opacity in @keyframes — both correct patterns) |
| Vitest | `npx vitest run` | **PASS** 350/354 | 38 files, 4 skipped (live integration tests) |
| Build | `npx next build` | **PASS** (exit 0) | 17 routes (2 static, 15 dynamic) |
| Playwright | `npx playwright test --project=chromium` | **PASS** 24/24 | All e2e + 5-route a11y scan |
| Brier backtest | `npx tsx scripts/brier-backtest.ts` | **PASS** | 2020 rows; real 2025 season scores |

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

### Results (2025 season-aggregate, 2020 rows)

| Position | Brier Score | n | vs. Random (0.25) |
| --- | --- | --- | --- |
| QB | 0.2660 | 81 | +6.4% worse (high QB variance expected) |
| RB | 0.1954 | 151 | 21.8% better |
| WR | 0.1837 | 240 | 26.5% better |
| TE | 0.1674 | 138 | 33.0% better |

**Interpretation:** The rank-order model is meaningfully calibrated for skill positions (RB/WR/TE), confirming within-position ECR rank predicts binary "exceeded threshold" outcomes significantly better than chance. QB's higher Brier reflects the well-known high variance of QB scoring (binary outcome threshold at 18 pts; many QBs cluster near threshold).

**Limitation:** Results are season-aggregate only (no `week` column in local 2025 data). Per-week k-fold CV requires `stats_player_week_2025.csv` from nflverse (not yet published). Script will auto-upgrade when the file becomes available.

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

All routes tested on chromium:

| Category | Spec | Tests | Result |
| --- | --- | --- | --- |
| Dashboard render | 01-dashboard | 3 | ✅ |
| Auth flows | 02-auth, 04-sign-out | 4 | ✅ |
| A11y (axe) | 03-a11y | 5 routes | ✅ |
| No-shared-data isolation | 07-no-shared-data | 2 | ✅ |
| Panel degradation | 09-panel-degradation | 1 | ✅ |
| League switcher | 10-league-switcher | 1 | ✅ |
| No-league CTA | 11-no-league-cta | 1 | ✅ |
| Mock draft | 12-mock-draft | 1 | ✅ |
| Account flows | 13-account-flows | 2 | ✅ |
| Wrong-password UX | 14-wrong-password | 1 | ✅ |

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

*Report generated by Claude Opus 4.8 via parallel audit agents + direct command execution.*
