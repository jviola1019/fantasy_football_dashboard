# Session 4 — the two feeds that were fetched and thrown away

RAE fetched ESPN's NFL news every morning and showed the reader none of it. It
extracted every team's waiver budget on every request, alerted on it from a
cron, and told the user on `/waivers` that budgets were "not connected".

Both are now surfaced. Fixing the second one exposed a third defect that would
have turned the fix into a fabrication.

---

## News: the articles were reduced to a number and dropped

`news-refresh` has written ESPN's feed to `news_snapshots` daily since May.
`load.ts` opened the snapshot, computed one momentum score per player, and let
the articles fall out of scope in the same `if` block. `/players` then displayed
a **Trending** figure derived from real, attributable, timestamped reporting,
with no way to see what it was derived from — a black-box recommendation built
on top of a perfectly good citation.

Headlines now render on the player profile, each with its own publication time
and its own ESPN link, under a provenance line stating how many articles the
snapshot holds, how many matched a player, and how old it is.

**The link needed no re-fetch and no migration.** `EspnNewsArticleSchema` is
`.passthrough()`, so `links.web.href` survived parsing and was already in every
stored snapshot — it was simply never declared, and therefore unreadable without
an `as any`. Declaring it made existing rows yield links immediately.

Measured live, 2026-09-01:

| quantity | value |
|---|---|
| articles returned | 50 |
| with `links.web.href` | **50** |
| with a `published` timestamp | **50** |
| distinct athletes referenced | 77 |

### Two deliberate asymmetries, both documented in the code

**Display keeps articles the momentum window drops.** Weighting excludes
anything older than 72h, because stale attention is not momentum. A headline is
still news at 80 hours, and hiding it would leave a reader unable to see *why* a
player they are researching has gone quiet.

**The index is keyed `sleeper:<id>`, its sibling weight map is keyed bare.**
That is the direct lesson of finding D-A, where the weight map keyed bare, its
one consumer looked up by record id, and the lookup missed on every player in
the catalog for months while the UI announced an ESPN provenance for a Sleeper
number. This index is read by components holding a record, so it is keyed the
way they will ask; `newsForPlayer` tolerates either form for anything else. A
canary test asserts the key form, and **neutralising it back to bare keys fails
9 tests**.

### Ages are stated against the envelope, not the clock

`relativeAge(iso, nowIso)` takes both ends explicitly. The obvious one-argument
version calling `Date.now()` internally would produce a different string on the
server than on the client milliseconds later, and React would report a hydration
mismatch on an otherwise deterministic page. Callers pass
`envelope.generatedAt`, which is a single declared render instant already
visible in the governance banner.

## FAAB: the panel was describing the app's own state incorrectly

`/waivers` rendered *"Free-agent acquisition budgets not connected … no real
budget data is integrated yet"* (`WaiverWire.tsx:153` at `5e29342`) while
`fetchLive` extracted `myFaabRemainingRatio` for **both** platforms and
`lifecycle-check` fired `faab-depleted` alerts on it.

This is the failure mode a "never hide unavailable data" rule is least likely to
catch, because it errs conservative: the product under-claimed, so nothing looked
wrong. It is still a false statement about the product's own capability, and the
data it hid is decision-relevant on the exact screen where a bid is decided.

Changes:

- **One object, two consumers.** The extractors return `{ total, remaining,
  ratio }` instead of a bare ratio; the panel draws the dollars and the cron
  reads `.ratio` off the same object. Nobody bids 0.63.
- **League-wide, richest first.** A budget only means something against the
  field: $40 is strong when the next-richest rival holds $12 and weak when three
  teams still hold $100. Both platforms return every team's spend in the payload
  already fetched, so this costs no additional call.
- **Unresolved identity marks nobody.** `resolveSleeperRosterId`'s result is
  passed rather than the roster-0 fallback, so an unidentified user gets a board
  with no "you" row instead of a stranger's budget labelled as theirs — the D-D
  failure, not repeated.

### The defect underneath: `waiver_budget` does not mean FAAB

The inherited extractor decided a league used FAAB by checking that
`settings.waiver_budget` was present. Measured against both of this account's
real leagues on 2026-08-31:

| league | id | `waiver_type` | `waiver_budget` |
|---|---|---|---|
| Offline | `1395917841022074880` | **0** — rolling waivers | 100 |
| Creamy Les Coot 4.0 | `1389332513259790336` | **0** — rolling waivers | 100 |

Sleeper emits `waiver_budget: 100` for every league whether or not a dollar can
be bid. The old rule therefore reports a full budget for **every Sleeper
league**. It was invisible while the only consumer was the `<10%` alert — an
unused budget sits at 100% and never trips it — and would have become a
fabricated panel the moment S4 drew it: ten teams, "$100 of $100 left", in a
league that does not bid.

Detection now requires `waiver_type === 2`, mirroring the ESPN path's existing
requirement that `isUsingAcquisitionBudget` be exactly `true`. Absence is not
confirmation.

**Expected consequence.** For these two leagues the board correctly shows the
unavailable state, naming the settings it read. S4's exit criterion — *"FAAB
shows real numbers or an honest reason"* — is met on the honest-reason branch,
and that is the right answer for these leagues rather than a shortfall.

## The first render tests in this repository

`@testing-library/react` has been a dependency with **zero** `.test.tsx` files
consuming it, and `vitest.config.ts` only included `src/**/*.test.ts`. So no
component had a render test of any kind, and the only per-panel coverage was
Playwright — which in CI runs against an **empty database** and therefore only
ever exercises the unavailable state. The populated branch of every panel has
been shipping unverified.

Rather than add jsdom (a new dependency, and a decision that is not mine to make
mid-session), the two new panels render through `react-dom/server`, which is
already present and works under the existing `node` environment. 16 tests cover
the real branches: headline text, external-link safety, an unlinked article
rendering as text rather than a dead anchor, stated ages, provenance, both empty
states, and every FAAB case including partial coverage and unresolved identity.

## A suspected bundle regression — measured, and it was not one

`PlayerNews.tsx` is pulled into the client graph by `PlayerUniverse`'s
`"use client"`, and its runtime import of `newsForPlayer` came from
`newsMatch.ts`, which now imports zod to declare the schemas the envelope
validates against. That looked like shipping the whole of zod to the browser for
a three-line string helper, so `newsForPlayer` moved to `newsLookup.ts`, which
imports **only a type** (erased at compile time).

**The measurement does not support calling that a fix.** Client chunks were
compared across builds either side of the split: zod appears in the same single
chunk, `14r9og-7b555b.js`, with the **same content hash**, before and after — 24
chunks and 1.4 MB of client JS in both. Zod therefore reaches the browser by some
other path that predates this session, and the split changed nothing measurable.
It is kept as a correctness measure — the news pipeline's schemas have no
business in a client graph — and not claimed as a regression averted.

Finding out where zod actually enters the client bundle is worth doing and is
**not** done here.

---

## Evidence

| gate | result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 problems |
| `npm run build` | compiled successfully, 14/14 static pages |
| `npm run e2e` | **429 passed / 1 skipped, 0 failed** (16.9m) |
| `npm run test` | **1,310 passed / 39 skipped, 0 failed** (1,257 → 1,310) |
| `npm run check:secrets` | 352 tracked files, no secret-shaped literals |
| `npm run audit:reachability` | **0 unreachable modules** |
| `designTokens` / `typeScale` gates | green — spacing still pinned at exactly 166, tracking still banned at 0 |

**A note on the test run.** An earlier full run reported `3 failed`, all
`Hook timed out in 10000ms` inside `resetDbForTests`, under concurrent load. The
three passed in isolation and the clean re-run is green — but the first run's
output had been piped through `tail`, which is exactly what left an unidentified
failure unexplained in S3. The re-run captured the complete log, and the totals
above come from it.

**Both new gates were shown to fail on the defect they target.** Neutralising
the news index to bare keys fails 9 tests. The e2e's retired-claims assertion
targets `"Free-agent acquisition budgets not connected"`, present verbatim at
`WaiverWire.tsx:153` in `git show HEAD`.

## Remaining risk

- The **populated** FAAB and news branches have no live end-to-end run behind
  them: this machine has no players snapshot cached, and CI has an empty
  database. They are covered by unit tests on real ESPN payloads and by render
  tests on real-shaped envelopes, which is strong but is not the same as a
  browser against a live league. The first production cron cycle after the merge
  is the real test.
- `waiver_type === 2` is the documented FAAB value and is the conservative
  choice, but it is a mapping this repository has not yet observed a `2` for. If
  a genuine FAAB league reports something else, the board will under-claim; the
  unavailable copy names the exact field so that is reportable rather than
  mysterious.
