# Session 2 — token hygiene

The design system had a real, well-guarded type scale and, underneath it, a token
layer with a live rendering bug, two colours that disagreed with each other, and
twenty declarations nothing referenced. This session fixed the layer the redesign
is about to build on.

---

## The sidebar had no background at all

`@theme` declares eight `--color-sidebar*` tokens as real hex values
(`globals.css:52-59`). A second `@theme inline` block redeclared all eight as
`var(--sidebar…)`, and those were defined only inside `.dark {}` — a class applied
**nowhere** in the app. No `className="dark"`, no `next-themes`, no toggle. The
later declaration won, so every sidebar colour resolved to nothing.

Measured before touching it, rather than assumed:

| quantity | before | after |
|---|---|---|
| `--color-sidebar` | `(EMPTY)` | `#090e1a` |
| `--color-sidebar-border` | `(EMPTY)` | `#4a8db71a` |
| computed sidebar background | **transparent** | `rgb(9, 14, 26)` |

The sidebar carries `bg-sidebar` and was painting fully transparent — leaning on
the page behind it for its entire appearance. Both dead blocks removed.

Restoring a real light/dark mechanism means defining both palettes and applying
the class. That is a product decision, not a token cleanup, and is not in scope.

## Tailwind and legacy borders were different colours

`--color-border` was `rgba(90, 159, 196, 0.12)` against `--line` at
`rgba(74, 141, 183, 0.12)`. Every shadcn-shelled surface drew a slightly different
hairline from every hand-rolled one. The legacy token is the documented source of
truth, so Tailwind adopted its value. Both now compute to `#4a8db71f`.

## Twenty dead tokens, not seventeen

Measured across `var()` uses in CSS **and** every `.ts`/`.tsx`, excluding the
Tailwind utility namespaces that are consumed as classes rather than `var()`.

Removed (16): `--accent-warm`, the three `--glow-*`, `--page-max`, `--shadow`,
`--sidebar-w`, the eight `--state-*` aliases, and `--ease-out` — whose only
occurrence in the entire stylesheet was its own declaration.

**Kept: `--space-8`.** It is a rung of the spacing scale with no current use.
A scale rung nothing has needed yet is headroom, not dead code — the same
argument that keeps `--text-3xl`, which session 4 will use.

## Two dead keyframes, not three

`panel-slide-in` and `tab-body-fade` are referenced by rules whose selectors
(`.panel-enter`, `[data-tab-fade]`) appear in **zero** `.tsx` files. Both removed.

`live-dot` was reported dead and **is not**. It has no `animation:` declaration in
CSS, which is what a naive grep looks for, but `ModeBanner.tsx:41` uses it through
a Tailwind arbitrary utility — `animate-[live-dot_2.5s_ease-in-out_infinite]`.
Deleting it would have stopped the live-status pulse. This is why the claims got
re-measured rather than actioned.

## The motion tokens now do something — and the tokens moved, not the CSS

`--motion-fast/base/slow` and `--ease-out` were declared in August and referenced
zero times, while 27 rules hard-coded a duration.

The obvious fix — rewrite the CSS onto the authored numbers — would have slowed
**eleven** hover transitions from 150ms to 200ms. That is a real change in how the
product feels, made for tidiness. The used values are the ground truth for
behaviour, so the tokens adopted them instead:

| token | was | now | why |
|---|---|---|---|
| `--motion-fast` | 120ms | 120ms | 4 uses already at 120 |
| `--motion-base` | 200ms | **150ms** | 11 uses at 150 made that the real base |
| `--motion-slow` | 320ms | **280ms** | the 260 / 280 / 300 cluster |
| `--ease-emphasized` | — | `cubic-bezier(0.22, 1, 0.36, 1)` | new; the curve the reveals already used |

27 durations and 2 easings wired. The three ambient infinite loops (1.4s, 2s, 18s)
keep their literals deliberately — the scale is for interaction motion.

## Fifty-one faux bolds

IBM Plex Sans loaded `300, 400, 500, 600`. The stylesheet declared `font-weight:
700` **30 times** and `800` **10 times**, and components added `font-bold` ×8 and
`font-extrabold` ×3. Every one was **synthesised** by the browser — a smeared
approximation of bold that differs by platform.

A real 700 is loaded now. 800 collapses into it rather than loading a fourth
weight: 700-against-600 is a distinction a reader can see, 800-against-700 is not,
and each extra weight costs two files here because italic is loaded too.

Weights in the stylesheet are now 400 / 600 / 700 — all faces that exist.

## Tracking graduated from a ratchet to a ban

All 14 unitless `letterSpacing:` values became em strings. They were **not broken**
— React appends `px`, so `letterSpacing: 0.4` is 0.4px, close to the `.04em` the
stylesheet uses at these sizes. The defect is that they were *fixed* where the CSS
is *relative*: 0.4px stays 0.4px as type scales up, so the two systems drift apart
precisely on the headings session 4 will move.

At zero, the ratchet becomes a ban, per the policy written in session 1.

## One colour outside the design system

`RadarChart.tsx:88` drew its data polygon in `#4dd9c0` — a mint in neither `THEME`
nor `globals.css`. `theme.test.ts` guards the tokens against the stylesheet and
cannot see a literal typed into a component, which is how it survived.

Now `THEME.teal` (`#2fb6c4`) via a new `withAlpha(hex, alpha)` helper, so a
translucent fill cannot drift from its solid. That helper is what lets charts stop
writing their own `rgba()` literals, and the chart kit in session 3 needs it.
A deliberate small visual change: the polygon moves from mint to the system teal.

---

## Deliberately not done: spacing

166 off-scale values across 303 declarations, unchanged. They are mostly 6px
(×62), 2px (×31), 10px (×20), 3px (×19) and 5px (×14) — hairline offsets and
optical nudges that predate the scale.

Snapping them changes padding on nearly every surface in the product. Doing that
without looking at the result is how a "cleanup" ships a visual regression, so it
lands with session 4, where the density work puts the same surfaces under review
anyway. The ratchet holds the number at 166 meanwhile, and a test asserts it is
*exactly* 166 so the deferral stays visible instead of becoming drift.

## A process note

Midway through, a measurement said `--line` and `--color-border` had both gone
empty — which would have meant the stylesheet was broken. The braces balanced, so
the CSS was fine: I was measuring a **stale server** left running from an earlier
step, with zero `BUILD_ID` matches against the local build.

The repository already has a guard for exactly this — `e2e/globalSetup.ts` refuses
a suite whose server is not serving the local build, and it had fired on me once
already this week. Checking `BUILD_ID` is now part of every ad-hoc measurement in
these sessions, not only the gated ones.

---

## Evidence

typecheck 0 · lint 0 · build clean · vitest **1,246 passed / 39 skipped**
(1,241 → 1,246: the `withAlpha` tests) · `typeScale`, `designTokens`, `theme` and
`fonts` gates all green.

Zero-use non-Tailwind tokens: **20 → 1** (`--space-8`, held as scale headroom).

| ratchet | session 1 | session 2 | status |
|---|---|---|---|
| spacing | 166 | 166 | deferred to session 4, pinned exactly |
| tracking | 14 | **0** | graduated to a ban |
| colour literals | 86 | 84 | ratchet |
