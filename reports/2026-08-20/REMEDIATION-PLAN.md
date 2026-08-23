# Remediation plan — audit-agent findings

**Created** 2026-08-22 · **Status** LIVE (updated as items land)

Five audit agents were dispatched across distinct areas. Four returned; the
design audit failed on a session limit and was re-dispatched. This plan tracks
every finding to a decision: **fix**, **defer with reason**, or **reject as a
non-issue**. Nothing is silently dropped.

## Triage principle

Ordered by *who is harmed and how invisibly*, not by reported severity:

1. **Users shown wrong data with no signal it is wrong** — highest. A visible
   error is self-correcting; a plausible wrong number is not.
2. **Machinery that cannot fail** — a guard, gate or test that passes without
   checking. This audit has now found five of these, so the class is assumed
   present until disproven rather than the reverse.
3. **Our own validation being unreliable** — a corrupt backtest misleads only
   the people reading it, but it is how every other decision gets made.
4. **Robustness and hygiene** — real, but nobody is currently harmed.

---

## P0 — fabricated data reaching users

| # | finding | status |
|---|---|---|
| P0-1 | DEF grade was a constant "B+" for every live user; `fragility` never declared missing so every guard was dead code | **FIXED** `97c6774` |
| P0-2 | Every ESPN trade graded "balanced, fairness 1.0" from an empty value map; half-priced trades graded "lopsided" | **FIXED** `97c6774` |
| P0-3 | `myRoster` silently falls back to **another manager's team** when identity resolution fails, stamped `validation: "valid"` | **NEXT** |
| P0-4 | Season-sim "confidence bands" measure Monte-Carlo replication noise but are labelled a confidence interval — **and one of the two displayed intervals did not contain its own point estimate** | **FIXED** — see §P0-4 below |
| P0-5 | Stale opportunity snapshot presented as current; `fetchedAt` dropped so age is never checked, and `opportunity` is removed from `missingFields` regardless | **PLANNED** |

P0-3 is the worst remaining item. A Sleeper user who omits `sleeperUsername`
(it is optional) or renames themselves gets **roster_id 0's players** — every
panel, simulation, trade grade and keeper price computed against a stranger's
team, with no banner and no degradation.

## P1 — silent wrongness and non-determinism

| # | finding | status |
|---|---|---|
| P1-1 | `listLeagues` has no `ORDER BY`; `leagues[0]` is the default active league. Stable on SQLite, arbitrary on Postgres, and an UPDATE relocates the row | **FIXED** |
| P1-2 | `/api/leagues/[id]/refresh` returns **HTTP 200** with `teamCount: 0` when the fetch failed; docs tell callers to check `res.ok` | **FIXED** |
| P1-3 | `normalizePpr` maps any reception value outside {0, 0.5, 1} to standard — a 0.25/0.75/1.5 PPR league is silently mis-scored throughout | **FIXED** |
| P1-4 | Three-team trades collapsed into two sides; C's haul attributed to B | **FIXED** |
| P1-5 | `news-refresh` writes an empty snapshot as success, resetting the freshness clock while the feature is dark | **FIXED** (+ 2 more crons with the same shape) |
| P1-6 | `createLeague` writes two rows with no transaction; a credential failure permanently bricks the league with a misleading error | **FIXED** |

## P2 — our own validation is unreliable

These do not touch users. They are how *we* decide what is true, which is why
they matter more than their user impact suggests.

| # | finding | status |
|---|---|---|
| P2-1 | Brier backtest CSV path derives the forecast from the outcome it scores — AUC 1.0 by construction, written under the same headings as the legitimate path | **FIXED** |
| P2-2 | `fitLogisticCV` returns 0.5 for every row with one fold; caller reports the result as "the projections' TRUE calibration error" | **FIXED** |
| P2-3 | PAR curve pools season points across leagues with **different scoring formats** — positionally asymmetric distortion, the exact error `pointsCurve` was built to fix | **FIXED** |
| P2-4 | `spearman` has no tie handling; degenerate zero-variance buckets inject an arbitrary rank ordering instead of being inert | **FIXED** |
| P2-5 | Backtests fetch live data with no snapshot or input hash — "seeded and deterministic" is false across days | **MITIGATED** — fingerprinted, not snapshotted |
| P2-6 | `betweenTeamSigma` includes within-team sampling variance, over-dispersing the simulated field — **measured +8.4%**, not ~14% | **FIXED** |
| P2-7 | Leave-one-week-out is not leakage-free at player level; docstring claims it is | **DISCLOSED** — a protocol change, not a code fix |

## P3 — coverage gaps

Highest-value untested surfaces, from the coverage audit:

- `auth.ts` — NextAuth wiring; `auth.config.test.ts` tests a *different file*
- `requireUser.ts` — the single authorization choke point
- `timingSafe.ts` — constant-time compare used by all 7 cron routes + init-db
- `redact.ts` — strips secrets from error text; zero tests
- The shared cron-secret gate — **one parameterised test covers 7 routes**
- `toEnvelope.ts` — largest untested lib file, assembles the whole dashboard

## P4 — removal candidates ("remove any useless")

Verified dead, safe to delete:

- `SESSION_VERSION_CLAIM` (`auth/session.ts:39`) — declared, never referenced
- `espnRosterEntryToRecord` (`normalize.ts:45`) — sibling is used, this is not
- `src/lib/espn/index.ts` — barrel nothing imports; all consumers go direct
- 8 Sleeper API wrappers with no caller (`getLeagueDrafts`, `getUserDrafts`,
  `getDraftTradedPicks`, `getUserByName`, `getUserLeagues`, `getMatchups`,
  `getTradedPicks`, `getWinnersBracket`)

**Not deleted, deliberately:** ~21 over-exported internals (drop the `export`,
keep the function) and ~55 test-only exports. Several of the latter look like
research helpers staged for backtests — deleting them would be removing
scaffolding someone intended to use. `revokeAllSessions` in particular reads as
a security feature staged but not yet wired.

## Rejected / verified NOT defects

Recorded so they are not re-investigated:

- JSONB double-decode — guarded in both `snapshotStore.parsePayload` and
  `parseSettings`; correct on both drivers
- `bytea` vs `blob`, timestamp coercion, `RETURNING`, identifier case,
  `ON CONFLICT` — all verified dual-driver safe
- `Math.random` — zero occurrences reaching the UI; everything displayed uses
  seeded `mulberry32` with the seed surfaced to the user
- `new Date()` as a displayed timestamp — every instance is a real event time or
  an injectable comparison operand
- TODO/FIXME/HACK/XXX — **zero** in the codebase
- Fixture data, weather stadium table, chart axis coordinates — correctly
  classified as labelled demo data, reference data, and SVG geometry

## Method note

Every P0 was **reproduced before being fixed** — the DEF grade by executing
`derivePositionGrades`, the trade verdict by executing `evaluateTrade`. Agent
reports are treated as leads, not findings. Two claims in the reports have
already been narrowed on inspection, and any that fail verification will be
moved to the rejected section with the reason.

---

## Design audit (re-dispatched after the first attempt hit a session limit)

### Fixed — `a40e1d7`

| # | finding | why it mattered |
|---|---|---|
| D-1 | **`.btn-primary` was undefined** — used at `LeagueSettingsForm.tsx:181`, defined nowhere | With the global `button` reset (`background:none; border:none; padding:0`), the Save action for every connected league rendered as **bare inline text**. A functional break, not a style issue. Defined from tokens matching `.login-submit`. |
| D-2 | **Four concurrent live regions** on `/dashboard` | `GovernanceBanner` was `role="status"` on a paragraph mounted on every route whose content changes on every navigation — a screen reader read the **entire governance paragraph** aloud on each route change. `ModeBanner` was permanently mounted with `aria-live` and a per-request freshness string (and triple-labelled). `SeasonNotice` had `role="status"` on a static explainer. All standing context, not events. |
| D-3 | **Two colour-only signals** (WCAG 1.4.1) | `DraftIntelligence` tier-collapse Intensity showed a bare `62%` with severe/moderate/mild carried by red/amber/green alone. `LeagueHealth` "League Advantage" flipped pos/neg at 50 with a static "vs League Median" sub-label — so above/below was colour-only **and the threshold was never stated**. |
| D-4 | **No skip link** | axe passes without one (landmarks satisfy its `bypass` rule), but keyboard users traversed the sidebar trigger, a 9-item route sidebar, the league switcher and the user menu before reaching content, on every route. Added with a real `<main id="rae-main">`; verified it is the **first tab stop**. |

Every one of these was **green under axe throughout**. An automated scan bounds
the problem; it does not close it. Three e2e tests now cover what axe cannot.

### Deferred — larger refactors, tracked not dropped

| # | finding | why deferred |
|---|---|---|
| D-5 | **Systematic token drift** — ~40 off-token colour literals across 12 files. A full *pre-repaint* palette survives in `rgba()` form (`#77d7b0` for green, `#d9866f` for red, `#f5c566`/`#eaa53d` for amber, `#4a8cf7` for blue), plus two undeclared text colours (`#d8dece` ×5, `#e8d9b0` ×3) and a chart series palette in `NexusSimulator.tsx:181-185` where only 1 of 5 colours is a current token | A mechanical but wide sweep touching every chart. Needs its own visual-diff pass — a colour regression is invisible to every gate we have. |
| D-6 | **No type scale exists.** `@theme` defines `--space-1..8` and `--radius-*` but **no `--text-*`**. Four unreconciled systems in use: 154 CSS `font-size` declarations across 12 px values, 43 Tailwind defaults, 14 arbitrary `text-[Npx]`, 53 inline `fontSize`. **76% of CSS type is ≤11px** | Defining the scale is easy; migrating 264 sites is not, and doing it badly would regress legibility that currently passes AA. |
| D-7 | **`/analytics` renders ~21 boxed regions** at first paint (4 cards + ~12 bordered sub-panels + 5 KPI tiles) — the "dense spreadsheet with neon panels" silhouette CLAUDE.md rules out | A layout redesign, not a fix. Needs a product decision about what to demote. |
| D-8 | **7 of 8 app routes have ZERO primary CTA**, while the loudest amber object on `/dashboard` is a **non-interactive season chip** (`LeagueSwitcher.tsx:102-114`). UX question 2 ("what should I do next?") is answerable only if you already know where to look | Needs a product decision about what the primary action on each route *is*. Not something to invent unilaterally. |
| D-9 | `role="tab"` with **no `role="tabpanel"` and no `aria-controls`** anywhere — a screen-reader user activates a tab, hears the selection change, then tabs into unlabelled content with no relationship to the control | Mechanical, but touches every tabbed panel; worth doing as one deliberate change with its own test. |

### The five UX questions on `/dashboard`

Scored by the audit: **1 clean pass, 4 partials.**

- ✅ **Is this live or demo?** — mode pill + full-width demo banner.
- ⚠️ **What is this?** — the only `<h1>` is `sr-only`; a sighted user gets no visible route title, and the product subtitle is `md:`-only so it is hidden on mobile.
- ⚠️ **What should I do next?** — the Next Best Action panel exists but is the bottom-right of four equal tiles with 10px ghost-pill actions (see D-8).
- ⚠️ **What data is driving this?** — route-level governance banner is thorough, but **not one of the four dashboard panels passes `source` to `PanelCard`**, so the per-panel freshness badge never renders. `/analytics` does wire it; `/dashboard` is the outlier.
- ⚠️ **Can I trust it?** — confidence, validation and assumptions are all present, and honest, but delivered as an 11px run-on sentence in a low-contrast strip.

The audit's own summary is the fair one: **the information is almost always
present — the failure is hierarchy, not honesty.** This is the opposite of the
model problem, where the numbers were wrong. Here the governance content is
good and the visual system simply does not rank it.

---

## Record-keeping note

The commit message for `a40e1d7` is **truncated** — it was passed through
`printf`, which consumed the `%` in "62%" and cut the body at that point. The
fixes themselves are complete and verified; only the message is short. It is not
being rewritten because that would require a force-push, which this audit's brief
forbids without explicit approval. This section is the complete record.

---

## P0-4 — the season-simulation "confidence bands"

**Reproduced before fixing**, per the method note. `npm run measure:bands`
(`scripts/measure-scenario-bands.ts`) prints the evidence and re-runs on demand.

### What the agent report claimed, and what is actually true

| claim | measured |
|---|---|
| bands are ~30× too narrow | **11.1×** — widest band 1.45pp vs 16.13pp measured ECE |
| measured ECE is 28–30pp | **16.13pp** (shipped chain) / 17.04pp (protocol 2) |
| labelled "confidence interval" | **true** — and the label was the smaller problem |

The agent's magnitude was overstated by nearly 2×. The finding survives; the
number did not, and it is recorded corrected rather than quietly adopted.

### The defect the report missed, which is worse

The displayed point estimate came from **one run at `SIM_BASE.iterations`**. The
band came from **20 bootstrap replicates at a smaller `BAND_ITERATIONS`**. Two
different estimators, nothing forcing them to agree — and on the fixture league
they did not:

```
Playoffs      point  69.60 IS NOT inside [68.12 - 69.57]
Championship  point   7.90 IS     inside [ 7.44 -  8.30]

1 of 2 displayed intervals EXCLUDE their own point estimate.
```

The panel rendered `Playoffs 69.6% [68.1 – 69.6]`. Whatever that interval means,
it cannot mean anything about a number that sits outside it.

**A test claimed to cover exactly this and could not fail.** `continuity.test.ts`
asserted `ci.lower ≤ ci.estimate ≤ ci.upper` — but `bootstrapCI` fills
`estimate` with the mean of *its own replicates*, so the assertion was that a
bootstrap interval contains its own bootstrap mean. True by construction. The
value on screen was never compared to the interval printed beside it. **Eighth
instance of the green-check-that-isn't-checking class.**

### What changed

| | before | after |
|---|---|---|
| name | `ConfidenceBands` / `deriveConfidenceBands` | `ReplicationRange` / `deriveReplicationRange` |
| centre | bootstrap mean of 20 short runs | **the estimate actually displayed** |
| width | bootstrap 95% interval | unchanged — 1.450pp / 0.860pp |
| degraded data | interval stretched **×1.5** | a sentence naming the missing inputs |
| unavailable data | interval stretched **×2.5** | a sentence naming the missing inputs |
| caption | "the model's measured calibration error is far larger" | "**16pp**, roughly ten times this range" |
| announcement | `role="status" aria-live="polite"` | removed — standing context |

The `widen()` helper is deleted. Multiplying a replication range does not turn
it into input uncertainty; it prints a wider number with no measurement behind
it, and 1.5 / 2.5 were chosen for legibility rather than derived from anything.
Deleting an unmeasured constant that inflates a displayed interval is the same
rule as every other P0 here: **never show a number the data does not support.**

### Verification

```
$ npm run measure:bands
Playoffs       69.60    [68.87 - 70.33]          1.450
Championship    7.90    [ 7.47 -  8.33]          0.860
All intervals contain their point estimate.
widest band = 1.450pp · measured ECE = 16.13pp → 11.1x too narrow
```

Two new unit tests pin it: the range must bracket **`sim.playoffProbability` /
`sim.championshipProbability` by name**, and its width must stay below a third
of the measured ECE — so if anyone reintroduces a multiplier, the label
"replication range" stops being true and the suite says so.

---

## Hierarchy — the deferred design findings, executed

The design audit's own verdict was **"the information is almost always present —
the failure is hierarchy, not honesty."** Five findings were deferred for
needing product decisions or wide mechanical sweeps. They are done.

### D-6 — there was no type scale

`@theme` defined spacing and radius tokens and **nothing for type**. 264 sites
set their own size through four unreconciled systems, and **78% of the CSS
declarations sat inside the 8–11px band**. When almost everything is the same
size, size stops ranking anything.

The fix is *not* enlarging the small text — RAE is a dense quant console and its
grid labels are legitimately small. It is (a) collapsing the four near-identical
bottom sizes into two and (b) giving the scale a real **top**, so a route can
have a loudest element at all. Twelve sizes spanning 8→32px become eight
spanning 9→44px:

| token | px | role |
|---|---|---|
| `--text-micro` | 9 | dense-grid labels ONLY — uppercase, letter-spaced, inside a grid |
| `--text-xs` | 11 | metadata, captions, provenance — the floor for prose (F-05) |
| `--text-sm` | 13 | body copy and table cells |
| `--text-base` | 16 | panel titles, emphasised labels |
| `--text-lg` | 20 | section headers |
| `--text-xl` | 26 | route title — one per page |
| `--text-2xl` | 34 | hero metric numerals |
| `--text-3xl` | 44 | onboarding display |

These deliberately **override Tailwind's default ladder**, so `text-xs` and
`font-size: var(--text-xs)` mean the same thing. All 264 sites migrated: 157 CSS
declarations, 52 inline `fontSize`, 14 arbitrary `text-[Npx]`, 42 utilities.
Zero raw `px` type remains outside the scale.

`typeScale.test.ts` (7 tests) pins the ladder strictly increasing, pins the 11px
prose floor, requires the top to stay ≥1.6× body, and **fails the build** if a
raw `font-size`, a `text-[Npx]`, or a numeric inline `fontSize` reappears.
SVG `fontSize={9}` props are exempt and documented: they compile to presentation
attributes, which cannot resolve `var()`.

### D-8 — no primary CTA, and amber spent on a label

Seven of eight routes had zero primary CTA, the only `<h1>` on each was
`sr-only`, and the loudest object on `/dashboard` was a **solid-amber,
non-interactive season chip**. Amber is the product's action colour; spending it
on a label inverted the whole hierarchy.

- **`RouteHeader`** — one component in the shell, so no route can lose its
  heading: 26px visible `<h1>`, a one-sentence purpose, an optional action, and
  the route's ordinal echoing the numbered sidebar (continuous wayfinding, not
  ornament — `aria-hidden`, since the heading text already names the route).
- **The season chip is demoted** to amber-on-panel with a hairline (7.6:1, still
  clear of AA). Solid amber now means "this is the action" and nothing else.
- **In fixture mode every route's action is "Connect your league"**, because in
  demo mode it genuinely is the same action and CLAUDE.md puts onboarding first.
  In live mode the slot is filled only where a *real, distinct* action exists
  (`/draft` → open the mock draft). **Inventing a button for a route with no
  action would be fabricating an affordance** — the interface equivalent of
  fabricating a number — so the other routes show none.
- **Next Best Actions moved** from the bottom-right of four equal tiles to the
  first and widest element on `/dashboard`.

An e2e test asserts **no non-interactive element anywhere renders solid amber**.

### D-7 — /analytics was 28 boxed regions

Measured, not estimated (the audit's "~21" was above-the-fold only): four
legitimate panels and **twenty-four more boxes nested inside them**. Once
everything is boxed, a box stops meaning "this is a distinct thing".

The rule now is **one border level per panel**. Inside a panel a region is marked
by a hairline rule, a wash, or a tone-carrying left edge — never a fourth side.
KPI tiles take a left edge in their own semantic tone, which also reinforces a
meaning the value colour already carries, so it is never the sole signal.

| route | before | after |
|---|---|---|
| /analytics | 28 | **10** |
| /players | 19 | **13** |
| /draft | 13 | **6** |
| /dashboard | 13 | **8** |
| /waivers | 9 | **7** |
| /trades | 7 | 7 |

The 8 remaining boxes on `/players` are the **selectable player cards**, where a
border is a real affordance and `.selected` changes it. Those keep it.

### D-9 — tabs that named nothing

Five panels declared `role="tab"` with **no `role="tabpanel"` and no
`aria-controls` anywhere**. Activating a tab announced a selection change, then
dropped the user into unlabelled content with no stated relationship to the
control they had just used. axe treats `aria-controls` as advisory, so this
passed every scan for the entire life of the component.

`PanelTabs` now generates stable ids and every consumer wraps its content in
`TabPanel`. An e2e test walks four routes, requires **every** tab to name a
region, and requires the selected tab's region to exist, to have
`role="tabpanel"`, and to point back at the tab — a dangling `aria-controls` is
worse than none.

### D-5 — token drift, partially closed

The two undeclared text colours are now tokens (`--gov-text`, `--label-text`,
both with their measured contrast recorded). The chart series palette in
`NexusSimulator` remains **open**: it needs a visual-diff pass, because a colour
regression is invisible to every gate this repo has.

### Two things this work removed rather than added

- **Six duplicate provenance badges per route.** Every panel passed
  `envelope.sourceState` to `PanelCard` — the exact value the governance strip
  directly above already stated. One route rendered the same provenance line up
  to six times. Repetition is not disclosure; it teaches the reader to skip the
  thing they most need to read. `PanelCard.source` now documents that it is for
  a lineage that genuinely **differs** from the route's.
- **"FIXTURE FIXTURE" in the command bar.** In fixture mode the freshness string
  *is* the word "fixture", so the bar printed it twice — once as an amber pill,
  once as plain text. When freshness restates the mode there is no second fact
  to show.

### The governance strip, re-ranked

It carried exactly the right information and still scored a partial on UX
question 5, because it delivered all of it as an 11px run-on sentence: to learn
the confidence you had to read a paragraph. It is now a **field row** — values at
body size above 9px mono labels, freshness and validation carrying semantic
colour **and** their own word. Nothing was removed. The e2e assertion was
strengthened at the same time: it used to pass on the word "freshness" appearing
anywhere in the banner; it now requires each labelled field and a real
percentage.

### Regression found and fixed during this work

`.route-header-num` used `--blue` at `opacity: 0.75`, which composites to
`#467c9b` on the navy ground: **4.13:1 at 11px, a serious axe failure on all
seven routes.** Opacity is a contrast change wearing a costume. Full `--blue` is
6.6:1. Caught by running the gate, not by reading the diff.

---

## P0-5 — a stale opportunity snapshot presented as current

**Reproduced by inspection at the boundary**, then pinned by test:
`src/lib/envelope/load.ts` read the nflverse snapshot and passed only
`snapshot.scores` into `buildLiveEnvelope`. `fetchedAt` was **dropped**.

With no age available, the envelope activated opportunity on **presence alone**:

- every record got a snap-share number stamped onto it,
- `opportunity` was removed from `missingFields` — the one channel panels use to
  render "—" instead of a figure, and
- the assumption read *"a real role/usage proxy from the latest season's games."*

If the daily cron had been dead for two months, all three statements were still
made, confidently, with nothing in the product contradicting them.

**The system already knew.** `/api/health` evaluates this exact snapshot against
a declared contract — warn at 2 days, expire at 15. The operator surface could
see the staleness and the user surface could not, because the two did not share
the contract. That is the shape of the defect: not a missing measurement, a
measurement that never reached the person relying on it.

### What changed

- `SNAPSHOT_CONTRACT` extracted to `src/lib/ops/snapshotContracts.ts`, consumed
  by **both** `/api/health` and the envelope. **No new thresholds were invented**
  — an invented constant is what P0-4 just finished deleting.
- `opportunityFetchedAt` travels with the scores, documented as required.
- **Expired → withheld.** `opportunity` stays in `missingFields`, the scores are
  not stamped onto records, and the source string drops "+ nflverse snaps". The
  disclosure and the data agree; declaring a field missing while still writing
  88 onto the record would only move the lie.
- **Stale (past warn, inside expire) → used, and labelled**: "Past its refresh
  window; treat as indicative, not current."
- **Age is always stated** when the data is used. "From the latest season's
  games" is a claim about recency, and a claim about recency has to carry the
  date it rests on.
- **A missing timestamp is treated as unusable, not as fresh.** The safe reading
  of "I don't know how old this is" is not "it is new" — and an absent timestamp
  is precisely what caused this bug.

`opportunityStaleness.test.ts` — 7 tests covering activation, withholding,
record stamping, the age string, the stale caveat, the stated reason, and the
null-timestamp case.

## P4 — dead code removed

Each symbol was confirmed to have **exactly one occurrence in the repository —
its own definition** before deletion.

- `SESSION_VERSION_CLAIM` (`auth/session.ts`)
- `espnRosterEntryToRecord` (`normalize.ts`)
- `src/lib/espn/index.ts` — a barrel with zero importers
- 8 uncalled Sleeper wrappers: `getLeagueDrafts`, `getUserDrafts`,
  `getDraftTradedPicks`, `getUserByName`, `getUserLeagues`, `getMatchups`,
  `getTradedPicks`, `getWinnersBracket`
- the imports and type imports those left orphaned

**Deliberately NOT deleted:** the five `z.array(...)` list schemas the wrappers
had been the only consumers of. Deleting them cascades into the element schemas,
which are 10–15 lines each of documented upstream API contract — that is
knowledge about Sleeper, not dead product code, and removing it was not part of
what the coverage audit examined. Recorded here rather than done quietly.

---

## P1 — all six, and what they had in common

None of these threw, logged, or degraded. Each produced a **confident, specific,
wrong answer** in a place a user would never think to check. That is why they
sit above the P2 backtest items despite looking smaller.

### P1-1 · `listLeagues` had no `ORDER BY`

`leagues[0]` is the **default active league** when no selection cookie is
present, so the order of this one query decides whose roster, projections, trade
prices and keeper costs a returning user sees. SQLite happened to return
insertion order. Postgres is free to return anything, and an `UPDATE`
physically relocates a row — so **editing one league's settings could change
which league the app opened on.**

Now `ORDER BY createdAt, id`. `createdAt` alone is not a total order: two
leagues added in the same millisecond tie, which would reintroduce exactly the
non-determinism this exists to remove.

**This fix broke a test, and the test was the thing that was wrong.**
`activeLeague.resolve.test.ts` created two leagues inside the same tick and
asserted insertion order — a guarantee no database ever made. With the tie
broken by a random uuid it passed or failed on a coin flip: two of four runs
failed. The helper now gives leagues distinct timestamps, as a real user adding
leagues seconds apart would, and the test additionally asserts the property that
actually matters — **that repeated reads return the same order.** Three
consecutive full runs, clean.

### P1-2 · a failed refresh returned HTTP 200

`fetchLeagueLive` degrades rather than throwing: on an upstream error it returns
a snapshot with `failure` set and **no rosters**. The route serialized that as a
normal 200 with `teamCount: 0` — indistinguishable from a league that genuinely
has no rosters yet. The failure text was in the body, which no correct client
reads on a 2xx, and `docs/account-isolation.md` tells callers to check `res.ok`.

Now **502** when `failure` is set and no rosters came back: the request was
well-formed and authorized, and the upstream platform is what failed. The full
body still ships so the client can show *why*. `identityResolved` and
`identityNote` are now in the payload too — P0-3's roster substitution has to
reach API callers, not only the UI.

### P1-3 · a 1.5 PPR league was called STANDARD

`normalizePpr` returned 0 for anything not exactly 0, 0.5 or 1. The near-misses
are bad; **1.5 PPR is the interesting case**, because it is a real and not-rare
TE-premium format and 0 is the furthest possible answer from the truth. The
settings screen reported *"STD (0 pt/reception)"* to an owner looking at a
league that pays 1.5, and FantasyCalc was queried at `ppr=0`, pricing every
receiving player low.

It now **snaps to the nearest** supported value, `pprActual` carries the real
figure, the settings screen and trade builder show the real figure, and
`valuationAssumptions` states the approximation out loud when one was made.

### P1-4 · three-team trades were graded as two-sided

The bucketing rule was *"did this item go to team A?"* — everything else was
swept into side B, **under side B's name**. In a three-team deal team C's haul
was printed as team B's, and the fairness verdict compared A against B-plus-C.

There is no pair of totals that answers "was this fair?" for three parties, so
the honest output is a refusal: a `multi-team` verdict carrying `teamCount`,
NaN fairness, a `+N more` label, and no third-team players folded into side B.
Both platform paths had the defect; Sleeper's `roster_ids` states the
participants outright, so there it did not even require inference.

### P1-5 · empty snapshots written as success

A news fetch that "succeeded" with zero articles was written and reported
`ok: true` — the worst of both worlds: the feature is dark **and** the freshness
clock has just been reset, so `/api/health` reports the source current while
nothing anywhere says there are no articles behind the signal.

Refusing to write leaves the previous snapshot in place, which is both more
useful and more honest: it ages visibly against its contract instead of being
replaced by nothing that looks new.

**The class was assumed present until disproven, per the triage principle, and
two more instances turned up:** `players-refresh` guarded `!players` but not an
empty map, and `projections-refresh` guarded "every position failed" but not
"positions responded and carried no players". `rankings-refresh` and
`ktc-refresh` are safe by construction — their zod schemas require
`players.min(1)`.

### P1-6 · `createLeague` could permanently brick a league

Two rows, no transaction. A failure between them left an ESPN league with no
credentials: it could never refresh, reported a misleading error, and the
duplicate guard then **blocked the user from re-adding it**. A transient failure
produced a permanent dead row.

A real transaction is not available here — `Db` is typed for better-sqlite3,
whose drizzle transaction callback must be synchronous, while the production
Postgres driver requires an async one. They are not reconcilable behind the
shared type, and guessing wrong fails on exactly the driver that matters. So the
window is closed from both ends instead: **encryption happens before any row is
written** (so the likely failure — a missing or malformed key — cannot leave
anything behind at all), and a failed credentials insert **deletes the league row
and rethrows**, with the error saying explicitly what to do if the compensation
itself fails.

---

## P2 — the tools we use to decide what is true

These touch no user. They are how *we* decide what is true, which is why a
defect here outlives every defect it hides.

### P2-1 · a backtest that scored itself

The CSV path sorted players by their **actual** PPR and used that rank as the
"forecast" for whether the same actual PPR cleared a threshold. The predictor is
a monotone function of the outcome, so **AUC is 1.0 by construction** and no
skill is measured at all. The docstring described it as a "lower bound", which
is exactly backwards — it is an upper bound of 1.0 on nothing.

The path has one legitimate use, so it keeps it: **a harness self-test**. If the
pipeline cannot score a perfect forecast as perfect, the pipeline is broken. So
the AUC is now **asserted** (`< 0.999` sets a non-zero exit code) rather than
reported, the report's H1 becomes *"Brier Harness SELF-TEST — not a backtest"*,
and it opens with a banner saying the page measures nothing about the model.

### P2-2 · an ECE computed from a constant

`fitLogisticCV` behaves correctly with one fold: there is no out-of-fold
training data, so it returns the max-entropy prior 0.5 rather than leaking the
held-out outcomes. The **caller** then reported the ECE of that constant as
*"the projections' TRUE calibration error"* — a number that is a property of the
base rate, with the projections not in it at all.

Now: fewer than two distinct weeks means no calibration model is reported. "We
could not measure this" should look like absence, not like a measurement.

### P2-3 · pooling points across scoring formats

`toObservations` normalised for regular-season **length** and not for **scoring
format**, and `lg.format` was sitting right there unused. A PPR league's WR1 and
a STANDARD league's WR1 differ by the receptions they caught, so pooling lifts
the WR and TE curves relative to RB and QB. That is a **positionally asymmetric
distortion** — the exact error `pointsCurve` exists to remove from rank-ratio
VBD, reintroduced one layer down.

`PointsObservation` now carries `scoringFormat` (the compiler enumerated every
construction site), and `PointsCurve` reports `scoringFormats` and
`mixedScoringFormats`. The backtest prints a warning per curve when the pool
mixes formats, and a second when a single-format curve is applied to a league of
a different format. Today's five backtest leagues are all 10-team PPR, so the
defect was **latent** — the fix stops it being silent, not currently wrong.

### P2-4 · ranks that invented an ordering

`rank()` assigned distinct sequential ranks by sort position, so `[5, 5, 5, 5]`
came back as `[1, 2, 3, 4]`. A zero-variance bucket did not produce zero
correlation; it produced an **arbitrary ordering invented from nothing**, which
`spearman` then correlated against as though it meant something. Genuine ties
anywhere in the data were broken by array order, so the same numbers in a
different order gave a different answer.

Mid-rank (average) tie handling now — which `scripts/holdout-evaluate-3.ts`
already used, for exactly this reason. The shipped implementation did not, so
the two disagreed.

### P2-5 · "seeded and deterministic" was true of the arithmetic, not the run

Every input is fetched **live** — the Sleeper projections and stats APIs, the
nflverse release CSVs — and none of it is snapshotted. The same command on two
different days scores different data, and nothing in the output said which. Two
reports could disagree and both be correct.

**Mitigated, not fixed.** The report now prints an FNV-1a **input fingerprint**
over the scored rows, and says plainly that the inputs are live and not
snapshotted. Identical fingerprints mean identical inputs; different ones mean
the numbers are not comparable. That is the difference between *unreproducible*
and *unreproducible and undetectable*. A real fix is to snapshot the inputs,
which is a data-plumbing change, and it is recorded as still open.

### P2-6 · the simulated field was over-dispersed — by 8.4%, not 14%

A team's season mean is itself estimated from W weekly games, so

```
Var(observed season means) = Var(true strength) + Var(weekly) / W
```

`buildLeagueModels` used the raw standard deviation of season means, so the
simulator drew each opponent's strength from an inflated spread **and then added
weekly noise on top** — counting within-team variance twice. An over-dispersed
field pushes playoff and championship probabilities away from the base rate,
which is the direction that makes a model look more decisive than it is.

**Measured rather than asserted.** `npm run measure:sigma` generates 4,000
leagues with a known true spread:

```
true between-team sigma      14.000
within-team sigma            25.000  (14 weeks, 12 teams)
OLD estimator (raw stdev)    15.182   bias  +8.4%
NEW estimator (components)   13.576   bias  -3.0%
```

The audit's "~14%" was again overstated. The residual −3.0% is the expected
Jensen bias from taking the square root of a floored variance.

**A second defect surfaced while fixing it:** `betweenTeamSigma || 1` coerced a
measured zero to 1. That guard was harmless when zero could only come from a
degenerate input, but the variance-components estimate makes zero a *legitimate*
result — "these teams are not detectably different" — and coercing it
substitutes a fabricated spread for a measured one. `seasonSim` only ever
multiplies by it, so zero is safe. The floor stays on `withinTeamSigma`, where a
zero really is a broken input.

### P2-7 · what leave-one-week-out actually controls

The docstring said "leave-one-week-out, so no leakage". Holding out a week does
remove temporal leakage — no outcome from the scored week is in the training
set. It does **not** make the folds independent, because the same players appear
in every other week, so the fitted projection→probability mapping is partly
learned from the very players it is then scored on.

This is dependence, not outcome leakage: the model never sees a scored outcome,
and the single feature is the projection rather than player identity, so the
effect is bounded. But the effective sample size is closer to the number of
distinct **players** than to the number of player-weeks, and the out-of-fold
error is optimistic by an unmeasured amount.

**Disclosed, not fixed.** A correct fix is grouped CV holding out players and
weeks together, which is a protocol change requiring pre-registration — the
discipline the five holdout protocols exist to enforce. Quietly swapping the CV
scheme after seeing results is precisely what those protocols forbid.

---

## P3 — the untested surfaces, closed

The coverage audit named six. All six now have tests, and two of them needed a
structural change first, because **untestable and untested are not the same
problem — the first causes the second.**

| surface | what it guards | now |
|---|---|---|
| `timingSafe.ts` | every cron Bearer token + the DB init token | 8 tests |
| `redact.ts` | the DB password not reaching a response body | 14 tests |
| `requireUser.ts` | the single authorization choke point | 8 tests |
| the cron gate | 7 routes | **extracted + 23 tests, incl. a file scan** |
| `auth.ts` credentials | the one place a password becomes a session | **extracted + 8 tests** |
| `toEnvelope.ts` | the object every panel on every route reads | 11 tests |

### The cron gate was copy-pasted seven times

Identical blocks in all seven route files, covered by a single parameterised
test over a hard-coded list. Seven copies of a security check is seven chances
for one to drift — to lose the `!expected` branch, to compare with `===` instead
of `safeEqual` — and a test that enumerates known routes cannot notice the
eighth route somebody adds without a gate at all.

`requireCronAuth` is now one function, and `cronAuth.test.ts` **scans the
filesystem**: every directory under `src/app/api/cron` must call it, and no
route may read `process.env.CRON_SECRET` itself. It also asserts it found at
least seven routes, so a wrong path cannot make the whole scan pass vacuously —
which would be the exact failure this audit is named after.

### The login path could not be imported

`auth.ts` pulls in `next-auth`, and therefore `next/server`, so a unit test
importing it dies at module load. That is why the function exchanging a password
for a session had zero coverage while `auth.config.test.ts` sat beside it
testing a **different file** — the edge-safe base config, which carries no
providers at all and never touches a password.

`authorizeCredentials` and `credentialsSchema` moved to
`src/lib/auth/credentials.ts`, which imports no next-auth. `auth.ts` now imports
them; runtime behaviour is unchanged. The tests pin the property that matters:
**every rejection returns null and looks identical from outside** — a malformed
email, an unknown account and a wrong password are indistinguishable, because
any asymmetry is an account-enumeration oracle. They also pin that hostile
`raw` input (numbers, arrays, objects with a `toString`, missing fields) returns
null rather than throwing, since a throw here is a 500 on an unauthenticated
endpoint.

### What the new tests deliberately do NOT do

`timingSafe.test.ts` makes no timing assertion. Timing in a JS test runner
measures the scheduler, not the comparison, and would be precisely the kind of
green check that isn't checking this audit keeps finding. It pins correctness,
byte-not-code-unit comparison, and that hostile input cannot throw.

---

## D-5 — the chart palette, closed

The last deferred design finding, and the one that needed a mechanism rather
than an edit.

**SVG presentation attributes cannot resolve `var()`.** `fill="var(--green)"`
does not parse, so every chart hard-coded hex — and a whole **pre-repaint
palette survived there** long after the tokens moved:

| in the charts | the actual token |
|---|---|
| `#77d7b0` | `--green` `#35c08a` |
| `#d9866f` | `--red` `#eb5f54` |
| `#8d9aa0` | `--muted` `#8898aa` |
| `#7bb7ce` | `--blue` `#5a9fc4` |
| `#eaa53d` | `--amber` `#d7a857` |

The charts were painted in the colours of a design that no longer existed, and
**nothing in this repository could detect it.** A colour regression is invisible
to typecheck, to lint, to axe and to Playwright alike — which is exactly why the
finding was deferred rather than eyeballed, and exactly why a sweep alone would
not have been a fix.

`src/lib/theme.ts` is now the JS mirror of the CSS tokens. `theme.test.ts` is
the point of the exercise: it fails the build when the JS and CSS palettes
disagree, when a new CSS colour token has no mirror (with the exceptions listed
explicitly rather than ignored), when two outcome buckets share a hue, and when
any retired hex reappears in a component. Both file scans assert they found
files at all, so a wrong path cannot make them pass vacuously.

Use `var(--token)` in CSS and in `style={{}}`. Use `THEME` **only** where a
`var()` cannot reach.
