# RAE — UI/UX, design and content review (2026-08-14)

Method: the production build (`next build` + `next start`) driven through a real Chromium
via Playwright MCP at 1440×900 and 390×844. Every claim below is a **measurement or a
screenshot**, not an impression. Findings are graded against `CLAUDE.md`'s own product
rules, WCAG 2.2 AA, and the "does not feel AI-generated" bar the brief sets.

Status key: **FIXED** in this branch · **OPEN** (evidence recorded, not yet changed).

---

## What is genuinely good (and should not be "improved" away)

These are strengths worth protecting, not filler:

- **Governance is visible without being nagging.** Every route carries a `DEMO DATA` banner,
  a `Source state: … freshness fixture · confidence 42% · validation valid` line, and an
  expandable *Assumptions & data gaps (2)*. The dashboard answers all five UX questions
  from `CLAUDE.md` within about two seconds.
- **Honest model language.** "Composite indexes … combine real inputs with fixed hand-tuned
  weights — **not yet fitted to observed outcomes (QNT-01)**" and "Derived from real injury
  status … **not fabricated**". This is the opposite of a black box, and it is rare.
- **The numbered route rail** (1–9, `9 ROUTES`) is a distinctive, non-generic navigation
  idiom that reads as a command center rather than a template sidebar.
- **Zero console errors or warnings** across every route exercised.
- **No horizontal overflow at 390px** on any route.

---

## 1. The landing page is the one screen that reads as AI-generated — OPEN

`CLAUDE.md` explicitly forbids "a Claude-generated card grid". The hero is followed by
exactly that: **six equal-weight cards in a 3×2 grid, uniform styling, ALL-CAPS titles, one
line of copy each** (`REPUTATION EDGE`, `SEASON SIMULATION`, `DRAFT & WAIVERS`, `HYPE VS.
VALUE`, `ROSTER AVAILABILITY`, `GOVERNED BY DESIGN`). It is the single most recognisable
LLM-landing-page pattern in the file.

Two compounding problems:

- **The product is never shown.** A "sports-quant command center" markets itself with zero
  data visualisation — all telling, no showing. The dashboard behind it is genuinely
  impressive and completely invisible to a prospective user.
- **Column widths disagree.** Hero copy wraps at ~900px while the card grid runs to
  ~1210px, so nothing shares an edge and the hero looks accidentally narrow.

**Recommendation (not yet applied — it is a design change, not a defect fix):** replace the
6-card grid with one real screenshot or a live miniature of the League Health / Top Insights
panel, and demote three of the six claims to a single line of supporting text. Deliberately
left OPEN rather than done unilaterally: it is a marketing-surface redesign, and
non-negotiable #4 of the audit brief says avoid broad aesthetic rewrites.

## 2. Panels stretched to their row height, leaving measured dead space — PARTLY FIXED

Panels in a grid row stretch to the tallest sibling, but the shorter panel's content does not
redistribute. Measured on `/dashboard` at 1440×900:

| Panel | Body height | Unused | Unused % of body |
|---|---|---|---|
| LEAGUE HEALTH | 372px | **140px** | **38%** |
| NEXT BEST ACTIONS | 263px | **110px** | **42%** |
| LEAGUE PULSE | 372px | 16px | 4% |
| TOP INSIGHTS | 263px | 16px | 6% |

On `/draft`, **TEAM CONSTRUCTION used ~19% of its panel width** — one narrow card floating in
a full-width panel — and it *duplicated* the position grades already rendered by PRE-DRAFT
AUDIT immediately above it (identical QB B / RB C / WR B+ / TE A / FLEX B / DEF B).

**FIXED for `/draft`:** Team Construction now also carries **Lineup Fit**, which answers a
different question from the grades (see §5). Re-measured after the change: **width
utilisation 19% → 99%**, unused height 16px (padding only).

**OPEN for `/dashboard`:** LEAGUE HEALTH and NEXT BEST ACTIONS still carry 140px / 110px of
dead space. The 5-KPI grid inside LEAGUE HEALTH is also awkward — four tiles on row one and
`CHAOS EXPOSURE` orphaned alone on row two with three empty cells.

## 3. WCAG 2.2 AA target-size failures that axe cannot see — FIXED

The existing axe sweep passes on all 12 routes, and it always would have: **axe-core has no
target-size rule**. Measured directly at 390×844, three controls failed SC 2.5.8 (24×24):

| Control | Measured | Verdict |
|---|---|---|
| Demo-banner dismiss `×` | **19×18** | FAIL — worst on the page |
| Next-best-action pills (`Trades →`, `Waivers →`) | **65×23 / 71×23** | FAIL by 1px |
| `Mock draft (no account) →` hero CTA | **171×20** | FAIL |
| "Add a league →" (85×15) | inline-in-sentence | **exempt** — correctly left alone |
| Toggle Sidebar (28×28), Sign in (68×32) | ≥24 | pass |

**FIXED.** The dismiss control gets a 44×44 hit area via a pseudo-element so the banner's
height and the glyph's optical position are unchanged; the pills get `min-height: 24px`; the
hero CTA becomes `inline-flex` with vertical padding. Emphasis hierarchy is untouched — only
hit areas changed.

**Guarded:** new `e2e/18-target-size.spec.ts` measures every interactive element on 7 routes
at mobile width, honours the spec's own *Inline* and *Equivalent* exceptions, and accounts
for pseudo-element hit areas. 14/14 passing.

## 4. Draft recommendations ignored league format — FIXED

Reproduced in the running UI, not inferred. The board rendered:

```
Puka Nacua      fills WR need (have 0, target 5)
Jahmyr Gibbs    fills RB need (have 0, target 4)
Josh Allen      fills QB need (have 0, target 1)
```

Those are the hardcoded `DEFAULT_TARGETS` constants — on the same page that says *"Connect a
league … to read your scoring, roster slots, trade deadline, and playoff weeks."* A superflex
league was being told to draft **one** quarterback.

**FIXED** — targets are now derived from `format.starters`. Verified against the operator's
real leagues: superflex QB target 1 → **4**; 12-team half-PPR → QB1/RB5/WR6/TE2; each league's
targets sum exactly to its own roster size.

## 5. "Team lineup meshing score" — ADDED

Requested explicitly. `lineupMeshScore()` fills the league's **actual** starting slots
(dedicated → FLEX → SUPERFLEX), then grades coverage and **penalises hoarding**: a fifth
running back taken while a starting slot sits empty is the most common draft mistake, and a
score that ignored it would reward exactly the behaviour worth flagging. Surfaced on `/draft`
with gaps, surplus, and the derived targets shown inline. With no league connected it renders
an explicit **unavailable** state rather than grading against an assumed default —
`CLAUDE.md`: *"If a metric cannot be traced, show unavailable."*

## 6. News: credible source, weak immediacy, invisible age — PARTLY OPEN

| Dimension | Finding |
|---|---|
| **Credibility** | **PASS.** ESPN's official public NFL news API, schema-validated with zod, payload documented from a real capture. First-party, not an aggregator. |
| **Recency weighting** | **PASS** — and better than expected. `newsMatch.ts` decays by age: ≤24h ×1.0, ≤48h ×0.5, ≤72h ×0.25, older excluded entirely. Stale articles genuinely fall out of `trendingMomentum`. |
| **Immediacy** | **PARTIAL.** The snapshot refreshes **once daily at 09:20 UTC**. Worst case an article sits in the full-weight bucket while being ~48h old. This is a **Vercel Hobby cron limit** (one run per day), not negligence — but it should be stated, because fantasy news matters on a minutes-to-hours horizon on Sunday mornings. |
| **Age visibility** | **OPEN.** Article age is captured (`lastModified`) and used for weighting, but **never surfaced in the UI** — zero references in any component. A user cannot tell whether a "trending" signal is 2 hours or 20 hours old. This sits against `CLAUDE.md`'s "Source freshness visible". The existing freshness badge shows *snapshot fetch* time, not *article* age. |

## 7. Smaller observations — OPEN

- **LEAGUE PULSE bar colours are positional (QB red, RB green, WR blue, TE amber), but red is
  the design system's risk colour.** Josh Allen ranks 2nd of 8 by true value and renders with
  a full red bar, which reads as danger. Worth either recolouring by value or adding a legend.
- **`REPUTATION EDGE 0.0`** as a headline KPI reads as broken/placeholder even when correct.
- **Position grades are a hardcoded slot list** (`QB, RB, WR, TE, FLEX, DEF` in
  `derivedMetrics.ts:193`) — no SUPERFLEX row and no K, so a superflex league is graded
  against slots it does not have. Same root cause as §4; not yet fixed.

---

## Evidence

- Routes exercised: `/`, `/login`, `/dashboard`, `/players`, `/analytics`, `/draft`,
  `/waivers`, `/trades`, `/reports`, `/settings/*` (307 → login, correct), `/mock-draft`.
- Console: **0 errors, 0 warnings**. Horizontal overflow at 390px: **none**.
- axe: clean on all 12 routes (and would not have caught §3 — that is the point).
- Full suite after these changes: **611 vitest**, **e2e 157 + 14 new target-size**, build 0.
- Lighthouse remains **BLOCKED locally** (Windows chrome-launcher EPERM / BFCache gatherer;
  10 environment errors, 0 assertion output). Environmental, not an application failure; CI
  runs it on ubuntu.
