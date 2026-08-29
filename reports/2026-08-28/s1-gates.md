# Session 1 — gates before the redesign

Redesign plan session 1. **No visual change.** The point is that the checks
capable of catching a bad redesign exist and are proven live *before* any
redesign commit, because the failure mode that matters is not a test going red —
it is a check quietly measuring nothing while the page changes underneath it.

---

## What was added

| gate | where | status |
|---|---|---|
| Every scan counter floored, not just two | `e2e/27-ui-audit.spec.ts` | blocking |
| Rendered-font-size floor, viewBox-aware | `uiAudit.ts` → `type-scale` | ratcheted |
| Type hierarchy distribution | `uiAudit.ts` → `type-scale` | ratcheted |
| At most one primary CTA per route | `uiAudit.ts` → `cta` | **blocking at zero** |
| Spacing / tracking / colour ratchets | `src/app/designTokens.test.ts` | blocking on growth |
| `prefers-reduced-motion` honoured | `e2e/29-reduced-motion.spec.ts` | blocking |
| Wording guard covers hyphenated forms | `e2e/20-model-failure-disclosure.spec.ts` | blocking |
| Lighthouse baseline | `reports/2026-08-28/lighthouse-baseline.md` | recorded |

Every check ships with a canary that proves it fires. Four of the five new checks
were demonstrated failing on today's code before being allowed to pass.

---

## What the new checks found

### Sub-floor SVG text — invisible to every existing gate

`font-size` on an SVG element is in **user units**, and a viewBox scales it.
`fontSize="8"` inside a 560-unit viewBox laid out at ~360 CSS px renders at
**6.9px**; the key-driver rows render at **7.1px**. `getComputedStyle` reports 8
either way, so nothing in the repo could see it: `typeScale.test.ts` bans raw
`font-size` in CSS and numeric `fontSize:` in style objects, and an SVG
presentation attribute is neither.

**76 instances on `/analytics`** — heatmap cell percentages and Key Drivers
labels. `NexusSimulator.tsx:236-247` already hit this exact defect and fixed it by
moving labels into HTML; nothing stopped it returning elsewhere.

### The hierarchy is more collapsed at runtime than in the stylesheet

The CSS is 77% bottom-two-rungs. What a reader actually gets, measured across both
viewport projects with every tab state opened:

| route | share on 9px/11px |
|---|---|
| `/mock-draft` | **94%** |
| `/waivers` | 87% |
| `/draft` | 84% |
| `/reports` | 70% |
| `/players` | 70% |
| `/dashboard` | 63% |
| `/analytics` | 58% |
| `/trades` | 48% desktop, >60% on mobile once the second tab opens |
| `/` | 50% |

The ladder is fine and fully adhered to — `offScaleTextElements` is **0** on every
route. Only the distribution is wrong, which is session 4's work.

### The CTA rule already holds

Every route renders exactly one solid-amber CTA; `/mock-draft` renders none. Zero
findings, so this check blocks from the start rather than being ratcheted.

Worth recording because the plan's premise was wrong: the audit brief said "7 of 8
routes have zero primary CTA" as a defect. `RouteHeader.tsx:34-42` shows it is a
deliberate decision — *"inventing a button for a route with no distinct action
would be fabricating an affordance"* — and the gate was written to enforce **at
most** one, never exactly one, so it cannot push anyone to invent them.

---

## Defects found in my own checks, before trusting their output

Three, all caught by measuring rather than assuming:

1. **The CTA check accused the skip link.** It is solid amber and is the first tab
   stop on every route by design, so a naive count reported "2 competing CTAs" on
   all ten routes — an accusation aimed at an accessibility feature. Now excluded
   by geometry (off-screen until focused), not by class name, so the rule survives
   a rename.
2. **SVG text was counted twice.** `<svg><text>` matches both `body *` and the
   explicit SVG query. `/analytics` measured 90 findings; the real number is
   **76**. The histogram and the bottom-heavy share were inflated too.
3. **The route-level finding never deduped.** It embedded the measured histogram
   in its message, so each tab state produced a different string and one problem
   was counted four to six times. The detail is constant now; the measurement
   ships as `scanned.bottomHeavyShare`, which the multi-pass merger maxes.

A fourth was caught by an existing guard: the build-identity check in
`e2e/globalSetup.ts` refused a run where a manually-started server was serving a
stale build. That is the guard doing exactly what it was built for.

## A pre-existing flake the full-suite run exposed

Running the whole suite — rather than the audit spec alone — surfaced an
intermittent **opacity** finding on `/trades`:

```
opacity: div.section-label — opacity 0.00 composites rgb(216, 222, 206)
to 1.00:1, needs 4.5:1 (11px) - text: "TRADE BUILDER — 12-team · 1QB · 1 PPR"
```

`opacity 0.00` at exactly 1.00:1 is frame zero of `label-reveal` (opacity 0→1,
180ms). The scan was measuring text that is not painted yet and calling it a
contrast failure. Same class as the `card-fade-in` false positives the audit
already fixed once in August, resurfacing because `/trades` does a live
FantasyCalc fetch during SSR, so its content — and its entrance animations —
arrive late.

**Not caused by this session's changes**, but it fails the gate, and an
intermittent false accusation is worse than a consistent bug: it teaches people to
re-run rather than look. Fixed in two layers:

1. `WAIT_FOR_ANIMATIONS` now requires **three consecutive quiet frames**, not one.
   One frame lost the race when an animation registered after the wait resolved.
2. The opacity check **skips any element with a running animation**, per element,
   and counts them as `scanned.unsettledTextElements`. `WAIT_FOR_ANIMATIONS` and
   the scan are two separate `page.evaluate` calls with an IPC round trip between
   them; content can mount in that gap no matter how long the settle waits. An
   element still animating has no settled style to judge.

The count is exported rather than swallowed: a persistently non-zero
`unsettledTextElements` would mean the settle logic is losing the race, not that
the page is clean.

---

## Deviation from the plan

**`npm run audit:ui` was not added to CI, and should not be.** The plan called for
it because the CLI had three refusals the Playwright gate lacked. All three now
exist in the gate:

| CLI refusal | now in the gate |
|---|---|
| `spacingBoxes` / `panels` floors | `MINIMA` — plus `sizedTextElements`, which the CLI does not have |
| self-test refusal, `exitCode = 1` | the canary test, now covering all four check kinds |
| build-ID freshness gate | `e2e/globalSetup.ts`, ahead of the whole suite |

The gate is a strict superset. Adding the CLI would spend about a minute of a
25-minute CI budget (risk R4) to re-run the same module against the same routes.
One gate that is trusted beats two that overlap.

---

## The floors were calibrated in the wrong environment

CI failed the first push: `/mock-draft: the spacingBoxes check measured 2, below
its floor of 5`, on both viewport projects.

`/mock-draft` renders **two different pages**. `page.tsx:19-20` reads a cached
FantasyPros snapshot and returns an honest unavailable state when there is none.
A development machine has that snapshot, so the route renders a full draft board:
250 sized elements, 7 boxes, 1 panel. CI starts from an empty database, so it
renders the unavailable state: **7 sized elements, 2 boxes, 0 panels**.

I measured the rich version and floored against it. The floor was not wrong about
the page; it was measured in an environment the gate does not run in — the same
category of error as trusting a stale build, and one a passing local run cannot
reveal.

Reproduced locally with `DATABASE_URL=file:.data/ci-repro.sqlite` rather than
guessing from the CI log, then **every route re-measured against the empty
database**, so the fix covers the whole gate rather than the one counter that
happened to fail first. Only `/mock-draft` was miscalibrated; the other nine had
margin.

The route now carries both bounds, which is what a page with two renderings needs:
floors at the CI minimum so CI cannot false-fail, and the type-scale ratchet at
the local maximum so a development run cannot either.

## Ratchets, and why they are ratchets

`typeScale.test.ts` bans raw font sizes outright — it can, because the type system
reached zero before the ban went in. Spacing, tracking and colour have not:

- **166** off-scale px values across 303 spacing declarations (55%)
- **14** unitless `letterSpacing:` in style objects
- **86** colour literals outside `theme.ts`

An outright ban fails the build today, and "fix 266 declarations" is not a
reviewable change. So the counts are recorded and the suite fails if they grow.
Session 2 drives them down and tightens each baseline; at zero, each becomes a ban.

A ratchet is weaker than a ban and stronger than nothing. What it buys is that a
redesign touching hundreds of declarations cannot make the problem worse while
appearing to make it better.

One correction to the plan's characterisation: the unitless `letterSpacing` values
are **not broken**. React appends `px`, so `letterSpacing: 0.4` is 0.4px — close to
the `.04em` the stylesheet uses at these sizes. The defect is that they are fixed
where the CSS is relative, so they stop matching as soon as type scales up.

---

## The Lighthouse baseline, and its honest limit

Recorded from CI run `33035114690` at `08ca10d` — see
[`lighthouse-baseline.md`](lighthouse-baseline.md). Accessibility is **1.00** on
all three URLs, and it is the only error-level assertion, so it has nowhere to go
but down.

`npm run lighthouse` fails on this machine with `EPERM` in `chrome-launcher`'s temp
cleanup after the audit completes but before any report is written. The CI artifact
is the reliable source here.

**`/` performance swings 0.60 to 0.90 across five runs of identical code** — six
times the 5-point spread `lighthouse-variance.ts` calls noisy. A performance
regression on `/` smaller than ~0.30 is not measurable by this harness, so any
claim about it must compare distributions, not medians. `/dashboard` and `/login`
are stable at ±0.04.
