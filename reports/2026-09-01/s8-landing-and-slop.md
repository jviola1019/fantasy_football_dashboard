# Session 8 — the landing page, and the generated-app tells underneath it

Two pieces of the same problem. The landing page was six equal cards; the
product around it had accumulated the specific ornaments that a tool reaches for
when nobody overrides the default.

---

## The landing page

**What was there:** a hero, then six cards in a 2×3 grid, each a title and two
lines of prose. The copy was accurate. The problem was that six boxes of
identical weight rank nothing, so a reader had to read all six to find out which
claim the product could stand behind — the same defect the type audit found
*inside* the app, in a different medium.

**What replaced it:** the argument this product can make and its competitors
cannot. A ledger of what has been tested, ordered by verdict:

| # | verdict | subject | measurement |
|---|---|---|---|
| 01 | Validated out of sample | Weekly start/sit probability | 21.2% Brier skill · 3.3% calibration error (RB) |
| 02 | Validated out of sample | In-season usage ranking | +0.0137 and +0.0195 Spearman · usage weighted 0.7613 |
| 03 | Reproducible, not validated | Season Monte Carlo | Not validated out of sample |
| 04 | **Tested and withdrawn** | The thesis this product was named after | Worse than chance within a position |

Row 04 is the point. A landing page that ends with the claim the product gave up
— after a frozen holdout on 115 real drafts refuted it — is not a page anyone
would generate.

**Every figure is read from the model that produces it.** `evidenceLedger.ts`
imports `WEEKLY_PROB_MODELS`, `WEEKLY_PROB_PROVENANCE`, `OPPORTUNITY_WEIGHT` and
`IN_SEASON_DISCLOSURE`; nothing is typed. A hand-written "18.5% Brier skill" on a
page whose whole argument is that the product does not make up numbers would be
the exact failure it advertises against, and it would go on looking right for
precisely as long as it took someone to refit the model. Eleven tests pin this,
including one that fails if a figure is retyped rather than read.

Two details worth recording:

- **The strongest position is named, not averaged.** Averaging four Brier skill
  scores yields a number describing no position and hides that QB (+3.7%) is far
  weaker than the rest — the distinction the panel itself exists to preserve. The
  copy names RB and names QB as the weak case (risk R5).
- **The old product name is deliberately not written out.** It contains a stem
  `e2e/20` bans across this route, and the ban is right: a marketing surface must
  not assert an exploitable edge, and the guard allows no negation, because "we
  do not claim X" and "X" read the same to someone skimming. The withdrawn
  *claim* survives being stated without the slogan.

`--text-3xl` finally has a non-Tailwind use — a landing headline is what a
display size is for.

**No React Bits component was adopted.** The plan allowed the Tailwind and Motion
variants (§4). Every candidate was decoration on a page whose problem was
ranking, and a page arguing that the product does not dress things up should not
be dressed up.

### Two layout defects found by measuring, not by looking

- At 1440px the single 62ch column left the right **half** of the page empty and
  wrapped the 44px display face onto five lines. The hero is a two-column grid
  above 1040px now: headline left, explanation and actions right.
- Splitting the ledger row into head/detail added a third child to a two-column
  grid, and the detail block wrapped into the narrow index column and pushed the
  document **70px wide at 390px**. Both blocks now get an explicit column.

---

## The generated-app tells

CLAUDE.md already says RAE must not feel like "a generic Tailwind template" or
"a Claude-generated card grid", and must not overuse "neon glow" or "decorative
cards". Nothing enforced it. What had accumulated:

| what | where | why it goes |
|---|---|---|
| Circular **blue → purple gradient** avatar | `UserMenu.tsx` | The single most recognisable mark of a generated app. `--purple` exists in this palette for one data encoding (the volatility legend); this was its only decorative use. |
| Animated **"aurora"** gradient | `.no-league-aurora` | Two radial gradients and a blue→purple→green linear, drifting on an 18s loop behind the empty state — the one screen whose entire message is "there is nothing here yet". |
| Gradient panel + 32px drop shadow | `PanelCard.tsx` | The gradient made a panel a different colour top-left than bottom-right, so the contrast of anything drawn on it depended on *where* it sat. The shadow implied a depth the layout does not have: these panels tile, they do not float. |
| **Glowing** pill nav indicator | `MobileBottomNav.tsx` | A coloured box-shadow doing the job the bar already does. |
| Hover **lift + glow** on every panel, card and draft row | `globals.css` | A 2px jump under the cursor makes a dense list feel unstable to read, and the shadow was tinted with the accent colour — a glow wearing a shadow's name. |
| `--panel-shadow`, an accent-tinted shadow | `globals.css` | A shadow that is not grey is not modelling light. |
| Two frosted `backdrop-blur-xl` bars | `TopCommandBar`, `MobileBottomNav` | Glassmorphism costs a compositor layer per scroll frame and makes a bar's legibility a function of whatever scrolls behind it. |
| `backdrop-filter: blur(4px)` on the **governance banner** | `globals.css` | The worst of them: frosted glass on the one element whose entire job is that trust-critical text stays legible. Composited to `#14161c` once; `--gov-text` measures **12.9:1** on it. |
| `rounded-full` badge and nav pill | `badge.tsx`, `UserMenu.tsx` | Every other chip in the product is 3px. The pill made the one shadcn-sourced badge look like it came from a different design system, which it did. |
| Gradient-filled value bars | `.vub-bar-*`, `.report-outcome-fill` | A bar encodes a length, and a fill fading toward its own end makes the end harder to locate — decoration working against the mark's only job. |

### A blinking badge that was also an accessibility defect

`.live-badge` blinked on a 1.4s loop under a green glow pulsing on a 2s loop, and
the comment above it said the point was that "a quick glance visually
distinguishes live from demo **by motion**".

Distinguishing state by motion excludes anyone with `prefers-reduced-motion` set
— for whom the two badges become identical except for hue — and WCAG 2.2.2 asks
that blinking content stop within five seconds; this ran forever. Both badges are
static now, told apart by colour *and* by the word.

### The motion, against the product's own stated philosophy

The README says *"motion is restrained and **data-encoded**"*. Three entrance
animations encoded nothing, and all three are the default:

- **`card-fade-in`** — `opacity 0→1 + translateY(4px)` on every `.kpi-card`,
  delayed in sequence by a `--stagger` property. The staggered fade-up of a
  generated dashboard. A stagger encodes nothing: the third KPI is not later
  than the first, it is just drawn later, and a reader who came for four numbers
  waits for them to arrive in order.
- **`label-reveal`** — every section label interpolating `letter-spacing` from
  .04em to .1em. It encodes nothing *and* `letter-spacing` is a layout property,
  so every label on the page reflowed on each frame of its own reveal. The
  editor's own performance hint flags exactly this.
- **`data-unavailable-reveal`** — a slow fade on the empty state. That block
  explains why a number is missing; fading it in makes the explanation arrive
  after the absence it explains.

What stays: the live dot's slow pulse (a live indicator, and the state is also
carried by the word beside it), Radix's dropdown and sheet transitions, and the
skeleton pulse. `WAIT_FOR_ANIMATIONS` in `uiAudit.ts` stays too, and its long
comment about `card-fade-in` and `label-reveal` is now marked as a record of what
happened rather than a description of the stylesheet — the helper still earns its
keep, and the next entrance animation somebody adds will hit exactly it.

### What was examined and kept

- `.legend-dot` at `border-radius: 50%` — a legend swatch. A dot is a circle.
- The 1px graph-paper grid and the `DataUnavailable` dot hatch — textures that
  mean "measurement surface" and "no data". Subject-appropriate, not ornament.
- `PanelGrid`'s `grid-cols-3` — the rows are 1 / 1.25fr+1fr / 3-col, a composed
  layout rather than a uniform card grid.
- `framer-motion` — a dependency, not a page-builder fingerprint.
- The typeface stack was already Bricolage Grotesque / IBM Plex Sans / IBM Plex
  Mono, with comments explicitly recording that Inter and Roboto were avoided.

### The gate

`slopScan.test.ts` — 38 tests over comment-stripped source, in two halves:

- **Visual defaults**: Inter/Roboto/Arial in a font stack, Tailwind blue-600 and
  its indigo/violet/purple neighbours, gradient utilities, `rounded-2xl|3xl`,
  pill radii, frosted bars, `shadow-xl|2xl`, accent-tinted shadows, hover lift,
  animated background gradients, page-builder fingerprints.
- **Copy markers**: 19 phrases with exactly one provenance — "unlock the power
  of", "in today's fast-paced …", "delve", "tapestry", "realm of",
  "game-changer", "seamless", "synergy", "paradigm", "might potentially", and so
  on. Deliberately short and specific: banning "important" would be censorship of
  ordinary English.

Three canaries: every rule must match its own sample, no rule may fire on
legitimate code (`box-shadow: inset 3px 0 0 var(--blue)`, `#5a9fc4`, a 3px
radius), and every allowance must still name a file that still matches. Proven to
fail by reintroducing `bg-gradient-to-br … shadow-2xl rounded-2xl` on `PanelCard`.

**Comments are stripped first, and that is load-bearing** — the comments
recording each removal name the thing removed, and a raw scan would read those as
the offence.

The gate reports the *line* of each finding, which needed care: replacing a block
comment with a single space shifts every line after it, and the first run pointed
at `globals.css:178` for a `backdrop-filter` that lives at 288.

`ownershipLeverage` and "validated harness" are pinned as legitimate domain
vocabulary, so nobody later "completes" the marker list and breaks the product's
own words.

---

## A gate the whole test suite could not replace

Removing two dead `@keyframes` blocks with a regex left two orphan `}` in
`globals.css`. **`typecheck`, `lint` and all 1,563 unit tests passed** — every one
of them reads that file as text — and the only thing that noticed was `next
build`, two minutes later, with a PostCSS stack trace.

`designTokens.test.ts` now counts braces on the comment-stripped stylesheet.
It is not a CSS parser and does not pretend to be; it catches the one failure
mode a stylesheet edited by script actually has, in milliseconds, while the
person who made the edit is still looking. Proven by appending a `}`.

---

## What the code review caught, and it was the important half

A review pass over the diff found nine issues. Two were the kind that make the
whole exercise worth doing.

**The landing page retyped two figures on the page whose argument is that it
does not.** The in-season row read `+0.0137 and +0.0195 Spearman`, as string
literals, three lines under a docblock stating "there is nothing here a person
typed in, which is the only version of this page that could survive the rule
against fabricated data". Worse: `0.0137` already existed as a **derived**
constant — `OPPORTUNITY_OUT_OF_FOLD_GAIN`, computed from the pair it summarises
and commented "Derived so it cannot drift from the pair" — and the ledger
bypassed it.

And the test I wrote to prevent exactly this did not. The canary named "would
fail if a figure were retyped instead of read" asserted only that WR's skill
plus five points was *absent*, which is true whether the row is read or retyped.
It passed on the literals it was written to catch.

Both are fixed: `PROTOCOL_5_OUT_OF_FOLD_GAIN` now has one home beside its
sibling, `IN_SEASON_DISCLOSURE` reads it too (it was the third copy), and the
canary is replaced by one that walks every numeric token in every measurement
and requires it to appear among the values the model modules publish. Shown to
fail by changing 0.0137 to 0.0140.

**The glow I removed from the mobile nav was still in the same file, seven lines
below** — `shadow-[0_2px_8px_rgba(90,159,196,0.45)]` on the active badge. It
survived because **`slopScan` could not see Tailwind arbitrary shadow values at
all**: both shadow rules required either the CSS property `box-shadow:` or the
named `shadow-xl`/`shadow-2xl` utilities. A gate written to catch accent glows,
passing on an accent glow, in the file whose glow it had just removed.

The glow rule was also wrong in three more ways, all found by the review:

- `box-shadow:(?![^;]*inset)` evaluates the lookahead once, over the whole
  value, so `inset` **anywhere** exempted **every** layer — including an outer
  glow beside it.
- It only understood `rgba()` numerics, so `0 0 20px #5a9fc4` and
  `0 0 20px var(--blue)` both walked past.
- It flagged `rgba(255,255,255,0.1)` — a neutral white shadow — as accent-tinted.

It is a per-layer judgement now: skip `inset`, require a blur radius above zero
(so `0 0 0 1px var(--sidebar-border)`, a hairline border drawn as a shadow, is
correctly *not* a glow), and compare the three colour channels, which dismisses
black and white without a special case. Fixing it exposed one more: the colour
has to be stripped before the lengths are counted, because two of a shadow's
lengths are conventionally unitless (`0 0 20px rgba(…)`) and `rgba(90,159,196,0.5)`
otherwise contributes four more "numbers". A first attempt at the blur check
therefore read blur = 0 and passed the glow it was written to catch — the same
mistake twice in one function. Proven by putting the nav's glow back: the gate
now names it at `MobileBottomNav.tsx:61`.

**`Rule.allow` exempted whole files while its doc comment promised match-level
granularity.** The glow rule's single allowance — a focus ring — bought a blanket
exemption for the entire 2,500-line stylesheet, the exact file this change had
just removed four glows from. Allowances are keyed by `path → { match: reason }`
now, and the liveness test checks the *match* still exists rather than the file.

The other six, all fixed:

- `bestWeeklyPosition()` called `reduce` with no initial value on a filtered
  array. Unreachable today; one refit or one floor change from a `TypeError`
  inside a `force-dynamic` server component, i.e. a 500 on `/` for every
  anonymous visitor. It returns `null` now and the row is dropped, which is the
  honest rendering anyway — a model where nothing clears the skill floor does not
  belong under "Validated out of sample".
- The same string would have rendered "QB, TE **is** measurably weaker" with two
  weak positions.
- `NoLeagueCTA` still rendered `<div className="no-league-aurora">` — an empty
  absolutely-positioned element and a three-line comment describing an animation
  deleted one commit earlier, on the one screen the removal note names.
- `--ease-emphasized` lost its last consumer with `data-unavailable-reveal` and
  became the exact dead-token condition the comment above it condemns.
- **`.ledger-verdict` was set at 9px.** That string is validation state — one of
  the six governance fields CLAUDE.md requires — and it is the non-colour carrier
  for the green/blue/red rule (WCAG 1.4.1). The scale licenses `--text-micro` for
  "dense-grid labels ONLY … never prose" and names `--text-xs` as the floor for
  trust-critical text. Putting the 1.4.1 fallback at the smallest size in the
  system undercuts what it is there for. Raised, along with `.landing-eyebrow`.
- `.live-badge` had no user anywhere, so the note recording the removal of its
  blink described a surface that does not exist. The rule is gone too.

One suggestion adopted beyond the findings: `<ol role="list">` on the ledger.
`list-style: none` makes Safari/VoiceOver drop list semantics, and the index is
`aria-hidden` — so the ranking this page calls load-bearing would have been
conveyed by nothing at all.

## The best finding of the session: the gate was shipping what it bans

A second review pass found something neither the gate nor I could see by reading
source.

**Tailwind v4 detects sources across the whole repository** — everything not
gitignored — and it reads markdown as readily as TSX. The anti-slop gate's canary
samples were written as realistic class attributes, so that each rule could be
shown to match one. Tailwind read them as usage and compiled them.

Measured in the production build:

```
--color-indigo-500:#625fff   --color-purple-600:#9810fa
.from-indigo-500{…}  .to-purple-600{…}  .rounded-2xl{…}  .shadow-2xl{…}
```

None of those classes appears anywhere in the product. **Every one traced to the
gate that bans them.** The waste is the small half — the real cost is that the
shipped stylesheet then *defines* them, so `className="to-purple-600"` in a
component would have rendered correctly, with only a unit test between it and
production. That is precisely the belt-and-braces posture this repository rejects
everywhere else.

It had happened before, unnoticed: an earlier build carried
`.text-\[Npx\]{color:Npx}` — an invalid declaration compiled out of the *name of
a test* in `typeScale.test.ts`.

### Three rounds to actually fix it, each one instructive

1. **Exclude tests from detection** (`@source not "../**/*.test.*"`, and the e2e
   suite). Indigo and purple went to zero. The 16px radius and the 2xl shadow did
   not.
2. **The explanatory comment recreated the bug.** Tailwind scans `globals.css`
   itself, and the note I had just written recording the fix named two of the
   classes — so it compiled them. The comment now describes them instead of
   spelling them.
3. **Prose is source too.** The last two came from `CLAUDE.md` and from *this
   report*, both of which name the classes while arguing against them.
   `@source not` now covers markdown, `reports/`, `docs/` and
   `test-results/`.

Verified after each round; all six banned tokens now read **0** in the compiled
CSS, and `bg-card`, `text-muted-foreground`, `rounded-md` and `grid-cols-3` are
all still there — the opposite failure, narrowing detection until real classes
vanish, would be much worse than the one being fixed.

### Two gates, because one of them cannot see the answer

- **`slopScan.test.ts`** pins the six `@source not` directives, and asserts that
  nothing excludes `src/app` or `src/components` — the narrowing that would
  silently strip the product of its styling.
- **`e2e/27-ui-audit`** fetches the **compiled** stylesheet from the running
  server and asserts no banned utility is defined in it, with a canary that the
  real ones are. This is the half that proves the exclusions *work* rather than
  that they are written down, and it can only live post-build.

Shown to fail: removing the markdown exclusion and rebuilding produces

```
Error: these are compiled into the shipped stylesheet: rounded-2xl.
```

## One process error worth recording

The first measurement of this build reported **3px of horizontal overflow on
`/analytics` at 390px** — a regression that did not exist. `next start` had
failed to bind port 3200 because an earlier server still held it, so the
screenshot script and the audit both ran against a **stale build** while
reporting nothing unusual.

This is the failure the handoff already warns about in bold ("check `BUILD_ID`
before believing any ad-hoc measurement"), and it caught me anyway. `audit:ui`
prints `server confirmed on local build <id>` for this reason; the screenshot
script does not, and it should. Re-measured against the correct server: **0
findings, 0px overflow everywhere.**

## Evidence

| gate | result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 problems |
| `npm run build` | compiled successfully |
| `npm run test` | **1,566 passed / 39 skipped / 0 failed** |
| `npm run audit:ui` | **0 findings** across 10 routes |
| horizontal overflow | 0px, 9 routes × 3 viewports, plus the full-page landing at 390 and 1440 |
| landing contrast | every pair on `--bg`: muted 6.38, blue 6.45, gov-text 13.43, amber 8.63, green 8.12, notice-red 6.60, cream 15.98 |

## Remaining risk

- The landing page asserts four verdicts. Three are read from code and cannot
  drift. The **fourth** — "worse than chance within a position" — is prose
  summarising `holdout-result-3.md`, and no test can check a summary against a
  report. If that protocol is ever re-run with a different outcome, this row has
  to be rewritten by hand.
- `slopScan` checks the mechanical defaults, not whether the result is any good.
  Passing it is not evidence of design quality; it only means the known defaults
  are absent.
