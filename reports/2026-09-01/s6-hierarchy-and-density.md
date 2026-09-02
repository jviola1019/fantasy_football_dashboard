# Session 6 — hierarchy, density, and a gate that was reading prose

The design audit's verdict on this product was *"the failure is hierarchy, not
honesty"*: the governance content was there and correct, and the visual system
refused to rank it. S1 built the type scale. S6 is the session that makes the
product obey it.

---

## The measurement, first

`audit:ui` reported the collapsed-hierarchy finding on **7 of 10 routes**, with
48–94% of rendered text on the bottom two rungs against a 60% limit. A share
does not tell you which rule to change, and "make the text bigger" is exactly
the wrong instruction — RAE is a dense quant console and its grid labels are
legitimately small. So the first step was a per-class breakdown of what the
small text actually *is*.

| route | ≤11px, before | dominated by |
|---|---|---|
| `/mock-draft` | 93.6% | 144 `td`, 48 `.draft-btn` |
| `/waivers` | 87.1% | 128 `td` |
| `/draft` | 84.2% | 70 `td`, 28 `.draft-btn` |
| `/analytics` | 80.1% | 30 `td`, 24 `td.heatmap-cell` |
| `/players` | 73.6% | 15 `td`, 14 card names |
| `/reports` | 70.4% | 24 `td` |
| `/dashboard` | 63.0% | 14 `.lp-name`, 14 `.lp-rank` |

One declaration explains most of it:

```css
table { font-size: var(--text-xs); }   /* 11px */
```

And the scale's own documentation, at the top of the same file, says:

```
--text-xs    11px   metadata, captions, provenance.
--text-sm    13px   body copy and table cells — the default.
```

**Every table in the product was set to the metadata rung.** A table cell here is
the player, the number, the thing you came to read. The fix is not to enlarge
text; it is to obey the licensing already written down, which moves data up and
leaves labels exactly where they are.

## What moved, and what deliberately did not

**Moved to `--text-sm`:** table cells, the draft-action buttons, League Pulse
rank/name, player-card names, the Value×Usage and Narrative row values, the
Big Board rank and name, tier chips, profile rows, trade side headings, report
outcome labels, heatmap cell values.

**Stayed:** `th` (uppercase column headers, licensed micro), position badges and
category chips, `.gov-field-label`, the sidebar route numbers, `.small-note`,
`.src-badge-*`, and `.gov-assume-list li`. Those are metadata and captions, and
the scale is explicit that this is their rung. Raising them would have destroyed
the hierarchy rather than created it — if provenance prose sits at the same size
as the number it describes, nothing is ranked again.

### Two of my own calls here were wrong, and are corrected in place

- **`.mini-table`** was kept a rung down on the theory that a table beside a
  chart is a secondary readout. `/reports` renders its whole player ranking in
  one, so 24 of that route's 78 small elements were its primary content. What
  makes the variant dense is its 4px cell padding. Density bought by making the
  numbers harder to read is not density.
- **`.heatmap-cell`** likewise. S5 converted the heatmap to a real `<table>`
  *precisely because* the number in the cell is the data and the colour is a
  redundant encoding of it. A cell value is a table cell.

### Measured per tab, because the first pass was measured wrong

After the first pass the script reported `/mock-draft` at 14.4% and the audit
still failed it at 73.4%. Both were right: the audit visits **every tab state**
and takes the maximum, and the failing number belonged to a tab the default view
never shows. The Big Board tab on `/draft` and `/mock-draft`, and the
Projections tab on `/players`, were only reachable that way.

## Progressive disclosure, and a `<details>` that disclosed nothing

`/players` survived everything above at 61.5% on one tab, where four positions
each render a reliability diagram carrying twelve 9px SVG axis labels — **48 tick
labels, 27% of every sized element on the route.** The numbers a reader needs are
already in the heading above each chart; the diagram is the working. It moved
behind a `<details>` in the same idiom the assumptions drawer already uses, with
the heading, the limits and the evidence line staying open.

**That did not work, and the measurement caught it.** With the disclosure shipped
and closed, the route went *up* to 61.6%. Inspecting the DOM: four `<details>`
reporting `open === false`, and every one still laying out a 280×200 figure with
all twelve labels reporting a real bounding box. The progressive disclosure was
disclosing nothing.

The fix is one explicit rule rather than a reliance on user-agent behaviour:

```css
.weekly-prob-chart:not([open]) > :not(summary) { display: none; }
```

Verified in the browser: 48 visible SVG labels → **0**.

Had the audit not been re-run *after* the change, this would have shipped as a
progressive-disclosure improvement that improved nothing — the second time in
two sessions that re-measuring after the fix, rather than reasoning about it,
was what found the truth.

## Result

| route | before | after |
|---|---|---|
| `/dashboard` | 0.630 | 0.448 |
| `/players` | 0.736 | **0.471** |
| `/analytics` | 0.801 | 0.600 |
| `/draft` | 0.842 | 0.489 |
| `/waivers` | 0.873 | **0.220** |
| `/trades` | 0.556 | 0.525 |
| `/reports` | 0.704 | 0.400 |
| `/mock-draft` | 0.936 | 0.532 |

**`audit:ui`: 7 findings across 10 routes → 0.**

---

## Spacing: 166 → 0, and why not by extending the scale

166 off-scale values across 148 declarations, dominated by 6px (×62), 2px (×31),
10px (×20), 3px (×19) and 5px (×14) — hairline offsets and optical nudges that
predate the scale rather than deliberate exceptions to it.

**The rule, stated once and applied without exception:** nearest scale value; an
exact tie rounds *up*. The tie rule is a product decision rather than arithmetic
— the audit's verdict on this product was density — so 6px, equidistant from 4
and 8, became 8. Values with a token are written as the token, so the next change
to the rhythm is one edit instead of 148.

**It would have been much easier to extend the scale.** Adding 2px and 6px rungs
absorbs 93 of the 166 at a stroke, and the counter falls to 73 without one pixel
moving on screen. That is a gate rewritten to match the code, and it is the thing
this file's own header exists to prevent.

### The ratchet graduates, and its canary earns its keep twice

Spacing is now a **ban**, the third to graduate after `tracking` (S2) and
element-level `type-scale` (S5).

Two things surfaced while making it one:

1. **The pinned 166 included a value that was never a declaration.** A comment at
   `globals.css:245` records that "tabs measured 19.5px tall with py-2.5 in the
   DOM"; the scanner ran from a `padding:` inside that comment to the next
   semicolon and swallowed it. One in 166 is not a large error, but a counter
   that reads prose cannot be driven to zero. Comments are stripped now.

2. **A mangled word boundary left the scanner matching nothing.** For one run the
   regex contained a literal backspace byte, the declaration count was **0**, and
   the ban passed — because zero off-scale values out of zero declarations
   scanned looks exactly like a clean file. The `is still scanning real
   declarations` canary failed instead, which is the entire reason it exists.

## CTAs

Nothing to do, and that is the finding. `primaryCtas` is 1 on nine routes and 0
on `/mock-draft`, which is what D4 licenses: **at most** one, never invented. The
CLAUDE.md amendment landed in `2305657`.

---

## Evidence

| gate | result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 problems |
| `npm run build` | compiled successfully |
| `npm run test` | 1,507 passed / 39 skipped / 0 failed |
| `npm run audit:ui` | **7 findings → 0** across 10 routes |
| `npx playwright test` | 429 passed, exit 0 |
| horizontal overflow, 9 routes × 3 viewports | **0px everywhere** |
| screenshots | mobile 390 / tablet 834 / desktop 1440, all 9 routes |

## Remaining risk

- The product is visibly roomier and its tables visibly larger. That is the
  intended change and it is a change: an owner should look at the screenshots.
- `/analytics` lands at exactly **0.600** against a 0.600 limit. It passes, and
  it has no margin. That route carries four model panels across nine tabs and is
  the densest surface in the product; if it regresses it will regress here first.
- The route-level hierarchy check remains a ratchet rather than a ban. Nine of
  ten routes are now at zero, so the baseline should tighten — deferred to S9
  with the rest of the gate re-verification, because tightening it needs the
  two-viewport e2e sweep rather than the desktop script.
