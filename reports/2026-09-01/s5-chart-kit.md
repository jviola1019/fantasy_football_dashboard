# Session 5 — the chart kit, and a contrast failure the checker could not see

Three of RAE's five charts set their type in SVG user units. A `viewBox` scales
those with the container, so labels that read as "10px" in the source reached the
screen at 7.1px on a desktop panel and 4.4px on a phone. Nothing in CSS could
reach them: SVG presentation attributes cannot resolve a `var()`, which is
exactly why `typeScale.test.ts` exempts SVG `fontSize` from its ban. The
exemption is honest about the constraint and does nothing about the consequence.

Fixing it exposed a WCAG failure that had been live for months and was invisible
to the tool meant to catch it.

---

## The measurement, first

The handoff carried "76 sub-floor SVG labels on /analytics". Re-measured at the
start of this session: **11**, of which 10 were element-level and 1 was the
route-level hierarchy finding.

The 76 was taken on a machine with a populated snapshot cache and never
rechecked. That matters beyond tidiness, because 76 was also the CI **ratchet
ceiling** — so `/analytics` could have regained 65 sub-floor labels and the gate
would have reported success. A ratchet sitting 65 above reality is not a ratchet.

The fix is not a re-baseline. It is zero, because zero is the same number in
both environments.

| route | element-level type findings, before | after |
|---|---|---|
| `/analytics` (desktop) | 10 | **0** |
| `/analytics` (mobile) | 6 more, unseen by the desktop script | **0** |
| every other route | 0 | 0 |

Total audit findings across ten routes: **17 → 7**, and all seven survivors are
the route-level hierarchy finding that S6 owns.

## What moved, and why each one moved

**`BarChart` → HTML.** It was a `<svg viewBox="0 0 280 H" width="100%">` with
`fontSize="10"`. Inside the `mini-panel` on `/analytics` — about 198px against a
280-unit viewBox — every label rendered at 7.1px. All ten were the entire
element-level type debt in the product. As HTML the text is on the type scale,
scales with user font settings, and reflows instead of shrinking. It needs no
accessible summary, because every label and value is now real DOM text; adding
one would make a screen reader read the numbers twice.

**`Heatmap2D` → a real `<table>`.** The type problem was the same. The semantic
problem was larger: a heatmap *is* a table, and rendering it as `role="img"` with
one long `aria-label` meant a screen-reader user got a sentence listing the axis
labels and **none of the values**. The `<title>` on every cell was unreachable,
because `role="img"` makes the subtree presentational. With `<th scope="col">`
and `<th scope="row">`, every cell is addressable and announced with its row and
column, and the colour becomes what it should always have been — a redundant
encoding of a number that is also written in the cell.

**`ReliabilityDiagram` → a data-derived summary.** Its `aria-label` was the
constant string *"Reliability diagram: observed frequency vs mean forecast
probability"* — a description of the **axes**, identical whether the forecaster
was perfectly calibrated, wildly over-confident, or had no data at all. It
carried zero bits about the thing the chart exists to show. `describeReliability`
now states the n-weighted mean absolute gap, the direction of the error in
words, and every bin's own numbers. The sign convention is stated once in the
source, because it is easy to get backwards: **gap = observed − forecast**,
positive is under-confident.

**The Nexus fan chart and the Price Discovery scatter.** The audit of 2026-08-23
had already moved this fan chart's *outcome* labels to HTML for precisely this
reason — and left `NOW` (14 units) and `No player data` (18 units) behind. That
is how a fix correct in principle leaves a remainder nobody looks for again. The
scatter's six labels were only ever visible at mobile width, which the
desktop-only script run never saw and the mobile Playwright project did.

`NOW` was not re-sized. Three letters inside a node explained the chart only to
someone who already understood it, so it became a sentence that says what the fan
shows. The scatter's point labels are now HTML positioned as a percentage of the
same scales the circles use, so a name stays attached to its dot while being real
text at a real size.

## `ChartFigure`: why `role="img"` had to go

The remaining genuinely-graphical charts sit in a `<figure>` with a real
`<figcaption>` instead of carrying an `aria-label`. Two reasons:

1. `role="img"` makes the subtree presentational. `ReliabilityDiagram` gave every
   point a `<title>` reporting its forecast, observed frequency and n, and no
   assistive technology could read any of them.
2. An `aria-label` is one flat string. It cannot carry structure, some screen
   readers truncate around 250 characters, and it exists **only** in the
   accessibility tree — invisible to a DOM dump, a test, or a copy-paste.

Where an HTML representation already existed, the SVG became `aria-hidden`
outright rather than gaining a second description: the Nexus fan chart has a full
HTML legend below it listing every outcome and probability, so an `aria-label`
was making a screen reader read the same figures twice, once as a sentence and
once as a list.

## The contrast failure axe could not see

Converting the heatmap's percentages to HTML immediately produced **392 axe
violations** on `/analytics`. They were not caused by the conversion.

The cells drew their text in `rgba(255,255,255,0.85)` over the colour ramp. **axe
does not evaluate contrast inside SVG**, so `03-a11y.spec.ts` reported
`/analytics` clean for months while the mid-band amber cells sat at **4.33:1**
against the 4.5:1 that 11px text requires. Rendering the same numbers as HTML did
not create the problem; it made the checker able to see it, and axe reported it
in the first run.

The obvious fix — choose the ink from the cell's own luminance — is necessary and
**not sufficient**. Measured across the ramp, there is a band where *neither*
foreground reaches AA:

| ramp value | composited cell | cream ink | dark ink | best available |
|---|---|---|---|---|
| 0.40 | `rgb(111,92,62)` | 5.44 | 2.94 | 5.44 ✓ |
| **0.50** | `rgb(137,111,68)` | **4.03** | **3.96** | **4.03 ✗** |
| 0.60 | `rgb(164,131,75)` | 3.01 | 5.31 | 5.31 ✓ |
| **0.80** | `rgb(156,100,89)` | **4.07** | **3.93** | **4.07 ✗** |

That is a **palette** defect. No choice of foreground rescues a background in
that band, so the ramp itself was retuned: the alpha ceilings were solved
numerically (blue ≤ 0.69, amber ≤ 0.51, coral ≤ 0.585) to keep every cell below
the luminance at which the cream ink clears AA. The worst cell on the scale now
measures **5.08:1**, verified at 101 sample points.

Two deliberate choices inside that:

- **Contrast is judged against the COMPOSITED colour.** The ramp returns `rgba`
  with alpha, so what a reader sees is the ramp blended over the panel behind it.
  Judging the raw `rgba` would be judging a colour that is never on screen — a
  22%-alpha blue would be treated as a light cell and given dark ink.
- **The ink chooser stays**, even though the tuned ramp now uses one ink
  everywhere. Both heatmap call sites pass their own `colorScale`, so it has to
  remain live for colours this ramp never produces.

Luminance is not monotone across the three hue bands; it steps down at each
change. That predates this ramp and is deliberate — ordering is carried by hue
(cool → warm → hot) and by the number printed in every cell.

## The gate, split

`type-scale` findings came in two shapes under one budget, which let each hide
the other. They are now separate:

- **Element-level** — a specific run of text below the 9px floor. **Banned at
  zero**, the second ratchet to graduate after `tracking` in S2.
- **Route-level** — the collapsed type hierarchy. Still a ratchet at 1 per
  route; S6 owns it.

The spec's existing canary, which injects sub-floor SVG text, was tightened to
assert the **element-level** detector specifically. `added("type-scale")` alone
would also have been satisfied by a route-level finding, and the element half is
the one that is now a ban — a ban whose detector has quietly stopped firing looks
exactly like a clean page.

The ban earned its keep immediately: it failed on a `"NOW"` label at 7.1px that
the script run had missed, then on six scatter labels at 4.4px that only the
mobile project could see.

---

## Evidence

| gate | result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 problems |
| `npm run build` | compiled successfully |
| `npm run test` | 1,327 passed / 39 skipped, 0 failed (before the contrast module) |
| `e2e/27-ui-audit` | **22 passed**, both viewports, element-level type findings 0 |
| `e2e/03-a11y` (axe) | **50 passed** — `/analytics` back to clean, honestly this time |
| `scripts/audit-ui.ts` | 17 findings → **7**, all route-level hierarchy |

New tests: 17 chart-kit render tests, 11 contrast tests. Both suites carry
canaries — the contrast suite keeps the **old ramp inline** and asserts it still
fails, so the fix cannot become a no-op that nobody notices.

## Remaining risk

- The retuned ramp is a visible change: the heatmap is darker and less saturated
  than before. That is a legibility constraint, not a taste preference — the
  previous saturation was incompatible with 11px text at AA — but it is a change
  the owner should look at.
- `describeReliability` computes a mean absolute gap from the bins handed to it.
  It inherits their binning and is **not** an independent estimate of
  calibration; it must not be read as validating anything. The measured results
  that do are in `docs/calibration.md`.
