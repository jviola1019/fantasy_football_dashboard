# UI audit — spacing, tabbing, opacity, model outputs

2026-08-24. Ten routes, measured in every tab state, at 1440×900 (the script)
and at 393×851 (the gate's mobile project) — the mobile pass found things the
desktop pass did not.

Reproduce: `npm run build && npm run start` then `npm run audit:ui`.
Standing gate: `e2e/27-ui-audit.spec.ts`, same module, both viewports, in CI.

---

## Result

| check | before | after |
|---|---|---|
| opacity → contrast | **never ran** (see below) | 0 findings, 9 dimmed elements measured |
| tabbing | 42 dangling `aria-controls` + 6 target-size | 0 |
| spacing | 3 off-scale values | 0 |
| model outputs | 1 route off the governance component | 0 |

`npm run test` 1,149 passed / 39 skipped. `npm run typecheck`, `npm run lint`,
`npm run build` clean.

---

## What was wrong, and what it cost to find out

### The opacity check never ran, and reported zero

The first working version of the harness printed `opacity: 0` for all ten
routes. That was not a measurement. `Function.prototype.toString` carries
esbuild's `__name(fn, "fn")` wrapper into the page without the helper, so
`relativeLuminance` — which has an inner named arrow — threw
`ReferenceError: __name is not defined` for every element it was handed. Zero
findings, zero comparisons performed.

It surfaced only because a canary was injected before believing the zero. That
canary is now `--self-test`, run before every scan, and it covers the target-size
check too, since `tabbing: 0` became a headline claim the moment the real
findings were fixed. **A check that has stopped firing looks exactly like a page
that has stopped offending.**

### Three consecutive runs measured a build that no longer existed

A fix to `PanelTabs` appeared not to take effect. The fix was correct and present
in `.next`. The server answering on the port was an orphan from an earlier probe
that had survived `kill`, so every restart failed with `EADDRINUSE` into a log
nobody read.

The audit now reads `.next/BUILD_ID` and refuses to report unless the served HTML
contains it. A stale target is the most expensive wrong measurement available: it
is indistinguishable from a failed fix, and it sends you to re-fix working code.

### 42 dangling `aria-controls`, invisible to axe

`TabPanel` renders exactly one region and gave it a per-tab id, so the id changed
on every switch and every inactive tab pointed at an element that did not exist.
axe treats `aria-controls` as advisory, so this passed every scan since the
attribute was added in D-9 — an accessibility fix that was half-applied and
looked complete.

Three candidate repairs:

- **Omit it on inactive tabs.** Fixes the dangling reference, loses the
  relationship.
- **Render every panel, hide the inactive ones.** Fixes both and mounts every
  chart in the product.
- **One stable panel id.** ← chosen. There is one region; every tab controls it;
  the region names the tab currently driving it via `aria-labelledby`. Nothing
  dangles at any point in the interaction, and nothing extra renders.

### Two wrong target-size checks before a right one

Both failure directions, worth recording because each looked reasonable:

1. **Reading `getBoundingClientRect()`** called `.demo-banner-close` a violation
   at 20×20. It is not: that button carries a 44×44 positioned `::after`
   precisely so its hit area can grow without moving the glyph. A pseudo-element
   is hit-testable and has no border box. Acting on that finding would have
   "fixed" a correct control and deleted a deliberate technique.
2. **Hit-testing four corners of a 24×24 box** produced **169 findings**,
   including every in-panel tab. Those pass under WCAG 2.5.8's *spacing*
   exception: a 24px-diameter circle centred on each does not intersect its
   neighbour's. 169 false accusations is worse than no checker — it buries the
   real ones.

The check now follows the criterion as written: pass on size, else on effective
hit area, else on spacing, with the inline-link and disabled exceptions.

### The scan was measuring a fade-in

The desktop script reported zero. The same scan as an e2e gate reported twelve
contrast failures on `/analytics` at mobile width — `opacity 0.69` compositing to
3.60:1 on "Market Inefficiency", "Liquidity Score" and their captions.

All twelve were frames of `card-fade-in` (`opacity 0→1`, 200ms, staggered per
card). The settled style passes. **0.69 is not a value anybody writes**, which is
what gave it away.

The first repair awaited whatever `document.getAnimations()` returned at one
instant, and was flaky — one mobile run in three failed on `/trades`. Staggered
reveals carry an `animation-delay`, and an element that mounts a frame later has
not registered its animation yet, so the snapshot came back empty and the scan
measured the fade anyway. `WAIT_FOR_ANIMATIONS` now waits two frames, then loops
until no finite animation is pending across a frame boundary, bounded at 5s.
Infinite animations — the live-status blink and pulse — are excluded, because
awaiting them would hang forever.

Verified with three consecutive mobile runs, 11 passed each.

A gate that fails one run in three is worse than no gate, and reporting a
transient frame as a defect is a false accusation — the same failure as the 169
target-size findings that ignored WCAG's spacing exception.

### The governance check asked the wrong question first

Scoped per panel, it produced twelve findings against five panels. **All twelve
were wrong.** Provenance in this product is stated once per route, and per-panel
source badges were deliberately removed as repetition by an earlier audit. Acting
on that output would have re-added exactly what someone had taken out.

Rescoped to the route — the scope CLAUDE.md actually specifies — it found one
real thing, below.

A related false accusation: the mode check reported that `/dashboard` never
states fixture/live mode, on a page whose visible text contains the word
"fixture". `includes("fixture")` was true while the word-boundary regex was
false, because the pattern crosses a template literal, a serialised function and
an eval, and one of those layers eats a backslash. It tokenises now, which needs
no escaping.

---

## Changes shipped

| file | change |
|---|---|
| `PanelTabs.tsx` | one stable panel id; tab rail gap 20px → 16px |
| `PanelCard.tsx` | panel header padding 14px → 16px |
| `Onboarding.tsx` | footer padding 64px → 48px |
| `GovernanceBanner.tsx` | `GovernanceFields` split out, decoupled from the envelope |
| `mock-draft/page.tsx` | uses the shared governance row instead of its own |
| `uiAudit.ts` + test | the scan, and 22 tests for the arithmetic under it |
| `audit-ui.ts` | the runner, with build-identity guard and self-test |
| `cache-rankings.ts` | fills the FantasyPros cache locally |
| `e2e/27-ui-audit.spec.ts` | the standing gate |

`/mock-draft` had all six governance values already — its `SourceMeta` carries
confidence 0.85, validation `valid`, assumptions and missing fields like every
other route — but rendered them as a badge and a sentence. Nothing was invented;
the same values now appear in the same field row as everywhere else. It keeps no
league line, because there is no league, and the "not your league" framing
survives as the note, since it is the most important thing to understand about a
consensus board.

---

## Observations, not defects

- **FantasyPros returns 882 players for HALF against 527 for PPR and 517 for
  STD.** Same source, same season, same scrape path. Probably an upstream page
  shape rather than a bug here, but a PPR user sees a shallower pool than a
  half-PPR user, and nothing in the product says so. Worth confirming before the
  pool depth is used for anything.
- **`/mock-draft` is built from inline style objects**, off the Tailwind design
  system every other route uses. The governance row is now shared; the rest of
  the page is not. Not measured by any of the four checks, and not changed here.
- **Nine dimmed elements pass contrast.** `opacity: 0` means no violations, not
  no opacity — the value is used, and where it is, it stays legible.

---

## A flake the audit surfaced but did not fix

`15-sprint5-panels.spec.ts › trade-center: each tab is selectable` timed out once
in a full run (404 passed, 1 failed) and passes **3/3 in isolation** — 45.5s,
16.5s, 17.9s for the same two tests.

The spread is the tell. `/trades` calls `fetchTradeValues()` on every render,
which fetches **FantasyCalc over the live network** before the page can paint.
Under full-suite load that occasionally exceeds the test timeout. The suite is
not hermetic on that route, and no amount of retrying makes it so — it makes the
result depend on a third party's latency.

Not fixed here: stubbing the valuation providers at the Playwright layer is its
own change, and it touches the request path this audit had just modified. Worth
doing before the flake is mistaken for a real failure — which is exactly what
happened on the first encounter with it.
