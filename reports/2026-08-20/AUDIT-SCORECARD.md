# RAE audit scorecard

**Compiled** 2026-08-23 · **Head** `main` after PR #34

## What a 10 means here, and what it does not

A **10/10** on a line below means: *every finding raised against that area is
closed, and the closure is backed by a command anyone can re-run.*

It does **not** mean certified, and it does not mean perfect. No body certifies
this application. `VALIDATION-DOSSIER.md` says so directly, and the one area
where the evidence is negative is scored on the honesty of the disclosure rather
than on the result — because **the result is a finding, not a gap to be closed
by further testing.**

Two lines below are deliberately not 10. Marking them 10 would be the same
overstatement this audit spent 23 sections removing.

---

## Scorecard

| # | area | score | evidence |
|---|---|---|---|
| 1 | **Data integrity — nothing fabricated reaches a user** | **10 / 10** | 5 P0 + 6 P1 closed. Every fabrication path removed and pinned: DEF grade, trade verdict, roster identity, replication range, stale usage, PPR classification, multi-team trades, empty snapshots. |
| 2 | **Model governance & disclosure** | **10 / 10** | Source, freshness, confidence, assumptions, validation state and fixture/live mode on every model output. Three refuted models disclosed *in-product*, on first paint, not behind a tab. |
| 3 | **Statistical process** | **10 / 10** | 6 frozen protocols, each committed **before** its harness existed, each executed once. Protocol 6 retracted its own hypothesis under a pre-declared rule. |
| 4 | **Model performance** | **one validated model, shipped** | Protocols 1–3 remain refuted and disclosed. The one signal that survived (protocols 4+5) is now **built, shipped and proven identical to what was validated**. See below. |
| 5 | **Reproducibility** | **10 / 10** | Protocols 4, 5 and 6 reproduce byte-identically from committed archives; the Brier backtest now replays a committed input snapshot (verified by diffing two runs). |
| 6 | **Security** | **9 / 10** | All CI security gates green: gitleaks full-history (299 commits), OSV, dependency review, tracked-file scan, lockfile floors. **−1: six CodeQL alerts accepted with written justification rather than eliminated.** |
| 7 | **Accessibility** | **10 / 10** | axe 0 serious/critical on every route, Lighthouse a11y 100, plus guards for what axe cannot see: skip link, live regions, tab↔tabpanel wiring, colour-plus-word signals. |
| 8 | **Design & hierarchy** | **10 / 10** | All 9 design findings closed. Type scale enforced by test; `/analytics` 28 → 10 boxed regions; palette pinned against drift by `theme.test.ts`. |
| 9 | **Test coverage** | **9 / 10** | 1,130 unit + 383 e2e. All six named coverage gaps closed, two of which required extracting the code before a test could exist at all. **−1: on 2026-08-23 a total sign-in UX failure passed through every one of them** — the specs asserted redirects and protected-route access, and the bug was a state that looked wrong while being right underneath. Closed, but the miss is the point. |
| 10 | **Draft & free agency** | **10 / 10** | 18 browser assertions on the draft state machine; bye week on the board with a stacking warning; pool-selection rules pinned (`pools.test.ts`). |
| 11 | **Performance** | **measured properly now** | Was a single Lighthouse run of a ±12-point metric. Now **five runs, median assertion**, and every CI run prints its own per-run spread. See below. |
| 12 | **Authentication & sign-in availability** | **9 / 10** | Sign-in now reaches the UI and not only the cookie; 14 browser assertions on what a person actually sees, including that the login redirect stays on the origin you asked for and that an unknown account and a wrong password produce the identical error. `seed:account` provisions or resets an account from the environment. A missing `DATABASE_URL` on Vercel now fails the request loudly rather than falling back to an ephemeral file. **−1: the per-account lock is keyed on the typed email, so eight failed attempts from anywhere lock that account for fifteen minutes — a disclosed denial-of-service tradeoff, not a fixed one.** |

---

## The lines that changed, and why

### Model performance — the validated half is now shipped

**The refutation stands and is not being re-litigated.** Protocols 1–3 refuted
the season simulation (AUC 0.5569, Brier skill −0.1738) and the reputation edge
(inverted within position). Re-testing a refuted model until it passes is the
malpractice the frozen protocols exist to prevent, and none of that was retried.

What changed is the other half. Protocols 4 and 5 validated in-season usage
twice, on data neither was tuned on — and it **could not be shipped**, because
RAE had usage and no points-to-date anywhere. The dossier said so in its own
words: *"validated for a model RAE has not built."*

It is built now:

| piece | what it is |
|---|---|
| `season_stats_snapshots` | new table, both drivers, via the shared snapshot DDL |
| `/api/cron/stats-refresh` | season-to-date actuals; refuses to write an empty snapshot (P1-5), resolves the season from Sleeper state |
| `inSeasonScore.ts` | `z(points/g) + 0.7613 · z(touches/g)`, standardised **within position** |
| `InSeasonBoard` | `/waivers`, above the refuted edge table and kept separate from it |
| `verify:inseason` | **CI gate** proving the shipped code reproduces protocol 5's statistic |

**The fidelity gate earned its place on its first run.** It failed: 0.0204
against the published 0.0195. Two causes, and the distinction is the point —
one was a real defect in the shipped model (sample sd where the validated
harness used a population sd, which changes the pooled ranking across cohorts of
different sizes), and one was a defect in the check itself. The tolerance was
never widened. Now 0.0195 against 0.0195, difference 0.000006.

Without that gate, RAE would have shipped a model that *resembled* the validated
one. That gap — between validated and shipped — is where "validated" quietly
stops being true.

**What is still not claimed:** the gain is small (+0.0137 / +0.0195 Spearman),
in-season only, a ranking rather than a forecast, and the weight's *magnitude*
did not generalise even though its direction did. All four ship in the UI beside
the number, and an e2e test fails if any of them goes missing.

### Performance — the estimator was the problem

`lighthouserc.json` collected **`numberOfRuns: 1`**. A single sample of a metric
whose local spread was 90 / 82 / 78 is not a measurement, it is a draw — and no
amount of optimising can make a one-sample estimate of a noisy metric
trustworthy.

Now five runs with a **median** assertion, and a `lighthouse-variance` step that
prints each run, the median and the spread on every CI run, flagging any
category whose spread reaches 5 points. Reports upload as an artifact.

**Optimisation deliberately comes second.** Tuning against a number you cannot
measure is how you end up chasing noise, which is the failure this audit has
catalogued nine times over. The measurement is fixed first; what the medians
then say is a separate question, and the CI artifact is how it gets answered.

### Security — six accepted CodeQL alerts

Unchanged, and still 9/10. The nflverse archive is rebuilt from parsed cells
rather than written from the response body — a real improvement that did **not**
clear the alert, because dataflow through a parser is still dataflow. All six
dismissed with written justification in
`docs/security/codeql-adjudications.md`, including the failed prediction. An
accepted alert is not an absent one, and the score says so.

### Authentication — the sign-in that worked and said it hadn't

Added 2026-08-23, after the eleven rows above were already scored.

Authentication **succeeded**. The cookie was set, `/api/auth/session` returned
the user, and the protected route rendered — and the topbar still offered a
**"Sign in" button**. The one piece of chrome a person checks to confirm they
are signed in was telling them they were not, and most people read that as "it
did not work" and try again.

The cause was `redirectTo` on the server action: Auth.js throws `NEXT_REDIRECT`,
Next performs a **client-side** navigation, the React tree survives it, and
`SessionProvider` keeps the unauthenticated session it fetched on first mount.
`redirect: false` lets the action return normally so the client can do a full
document navigation instead.

Two fixes were tried before that one and **measured not to work** — which is how
the real cause surfaced. Both lived in the form's success branch, and the form's
own comment said that branch was unreachable. They were dead code.

**Every existing auth spec passed throughout**, and 349 e2e assertions did too.
That is why row 9 above is no longer a 10. The specs asserted redirects and
protected-route access; this was a state that looked wrong while being right
underneath, and nothing was looking at what the page said.

Three further things came out of chasing it:

- **No script could open a local SQLite database.** `src/db/index.ts` used a
  bare `require`, which only exists when the bundler wraps the file as CJS —
  under `tsx`, every script in `scripts/` failed with "require is not defined"
  and nothing pointing at the driver. Every DB-touching script shared it; only
  `seed:account` happened to try.
- **A missing `DATABASE_URL` on Vercel was a silent downgrade.** The fallback to
  a local SQLite file is right on a laptop and catastrophic on an ephemeral
  per-invocation filesystem: a sign-up is accepted, written, and gone by the
  next request, and the person is told their password is wrong for an account
  they just made. `/api/health` reported `degraded`, but only to an operator
  holding `CRON_SECRET`. Detectability is not disclosure. It now refuses, and
  `RAE_ALLOW_EPHEMERAL_DB=1` is how you say you meant it. Measured: the build
  still exits 0 — nothing prerendered touches the database — so the failure is
  on the first database-backed request, not the deploy.
- **A constant named `ALLOWED` held `allowed: false`.** Harmless only because
  its one caller spread it and overrode the field. A second caller writing the
  obvious `return ALLOWED` would have denied every sign-in in the product, and
  the name would have made that read as correct in review.

### Sign-in was unreachable on every preview deployment

Found by smoking the PR's own preview instead of assuming it matched production.
An anonymous visit to a protected route on a **preview** host redirected to
**production's** login page: sign in there, return to the preview, still
anonymous, because the session cookie belongs to a different host.

Two layers, and neither alone was the fix — the `authorized` callback let the
Auth.js wrapper redirect against its own base URL, and `request.nextUrl` is
itself rewritten from `AUTH_URL` by next-auth before the proxy handler runs, so
the "request origin" was never the request's origin.

**The first repair was worse than the bug.** Rebuilding the origin from
`x-forwarded-host` behind a well-formedness regex was measured to be an open
redirect — `evil.com:99999` produced `Location: http://evil.com/login`. A regex
rejects malformed hosts, not hostile ones. The header is now honoured only for
hosts the **operator** declared through Vercel's own system variables; off
Vercel the allowlist is empty and nothing changes.

The e2e spec asserting "the URL matches /login" passed throughout. It never
looked at the origin. It does now.

### The −1: account lockout is a denial-of-service surface

Not fixed, because it is a policy call rather than a defect, and changing
authentication policy quietly during a deploy is not the way to make one.

`THROTTLE_RULES.account` is keyed on the **email the caller typed**, not on who
they are: eight failures inside fifteen minutes lock that account for fifteen
minutes. Anyone who knows an address can therefore keep its owner locked out
indefinitely at eight requests per quarter hour, from any address, at no cost.

The usual remedy is to key the lock on **account × IP** and keep a much wider
account-wide cap for distributed attempts. Under the existing `ip` rule (30
failures / 15 min) a single attacker's guess budget would be unchanged, so the
cost is bounded — but it is still a deliberate loosening of an account-level
control, and it should be decided rather than slipped in.

---

## Reproducing every line

```bash
npm run typecheck && npm run lint && npm run test && npm run build
npm run e2e                       # 383 passed / 1 skipped
npm run check:secrets             # 338 tracked files
npm run holdout:evaluate4         # PASSED — 958/452
npm run holdout:evaluate5         # PASSED — w = 0.7613
npm run holdout:evaluate6         # RETRACTED its own hypothesis
npm run holdout:evaluate6 -- --self-test
npm run anova:opportunity
npm run measure:bands             # P0-4 magnitude
npm run measure:sigma             # P2-6 magnitude, 4,000 simulated leagues
npm run verify:inseason           # shipped ranker == protocol 5 (CI gate)
DATABASE_URL=... SEED_EMAIL=... SEED_PASSWORD=... npm run seed:account
npm run lighthouse:variance       # per-run Lighthouse spread
npm run smoke                     # production, 13/13
```

Every protocol reproduces from a committed archive with **no network access**.
Each harness has a `--self-test` that checks its own arithmetic before it is
pointed at anything real.
