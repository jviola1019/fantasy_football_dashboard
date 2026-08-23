# Gated suites — executed 2026-08-22

Everything here is **non-statistical** verification: engineering gates, not
holdout protocols. These suites exist in the repository but are **skipped in CI
by design** (they need real credentials, a real database, or a browser), so
nothing in the README or HANDOFF recorded whether they actually pass.

They do now, and running them found three real things.

## Summary

| suite | gate | result |
|---|---|---|
| Live network — schedule + trade values | `RAE_LIVE_TESTS=1` | **3 passed** |
| Live network — Sleeper league integration | `+ RAE_LIVE_SLEEPER_*` | **6 passed** (1 failure found and fixed) |
| Postgres integration ×3 files | `RAE_PG_TEST_URL` | **31 passed** against real PG 17.11 |
| Lighthouse / LHCI | browser | assertions **passed**; environment flake noted |

## 1. Live network — verified against the real APIs

CI correctly skips these, so they had never been confirmed here.

- Sleeper `/v1/state/nfl` season resolution — **live**
- Fully verified bye schedule derived for the live season — **live**
- FantasyCalc non-empty value map for the default format — **live**
- Real league fetch: league + rosters + users, owner roster resolved by
  username, no duplicated players — **live**, against a real 10-team league

## 2. A live test that could never pass — found and fixed

`integration.live.test.ts` asserted the hype axis moves in both directions:

```
expect(riser).toBeGreaterThan(20);
expect(faller).toBeLessThan(-20);   // FAILED: -18
```

The failure is **arithmetic, not a bug in the axis**.
`trendingMomentumFromProxy` divides by a **single global denominator** —
`max(addsMax, dropsMax)` — deliberately, so the sign stays comparable across
players. That caps the most-dropped player at `-(dropsMax / globalMax) * 100`.

Measured live on 2026-08-22:

| quantity | value |
|---|---|
| `addsMax` | 54,901 |
| `dropsMax` | 10,104 |
| ratio | **0.184** |
| ⇒ floor for the top dropper | **−18** |

So `faller < -20` was **unreachable that day** no matter how healthy the axis
was. It could only pass when drop volume exceeds 20% of add volume — a property
of the fantasy market on a given date, not of RAE.

**Fixed by asserting the invariant instead of a magnitude**: each extreme must
reach exactly the floor/ceiling the normalisation allows, plus direction and a
usable span. That is scale-free and *stricter* — the "hype axis reads flat"
failure this test exists to catch still fails it. The threshold was **not**
loosened to obtain green.

### The asymmetry is real, and now documented

In a period where adds dwarf drops, the **downside of the hype axis is
compressed** — here to 18% of the upside scale. Ordering stays correct; only
magnitude compresses. Previously undocumented; now pinned by unit tests in
`trendingProxy.test.ts`.

### And a resolution floor, found by accident

Writing the ordering test with an unrealistic gap exposed that scores round to
whole numbers, so any player under **0.5% of the global maximum reads as exactly
0** — indistinguishable from "not trending".

Measured against the live pool to see whether that matters in practice:

| | |
|---|---|
| pool size | 158 |
| score exactly 0 | **5 (3.2%)** |
| \|score\| ≤ 2 | 15 (9.5%) |
| \|score\| > 2 | **143 (90.5%)** |
| min / median / max | −18 / −0 / +89 |

**The axis is not flat in practice.** The floor is real but affects 3% of the
pool. Pinned so a future volume regime that pushes more players under it is
visible rather than mistaken for missing data.

## 3. Postgres — 31 tests against a real PostgreSQL 17.11

Run against the isolated cluster on `127.0.0.1:55432` (db `rae_test`). The
operator's own service on 5432 was **not** touched.

Covered, and passing: migration idempotency; rollback without data loss; the
legacy-row backfill upgrade path; DB-level rejection of duplicate
`(userId, dedupKey)`; concurrent upserts collapsing to one row; timestamp
round-tripping through the shared mapper; user isolation and list caps;
lifecycle resolve/reopen/dismissal-clearing; **not** resolving a family whose
upstream failed; **not** resolving an injury alert on stale evidence and
resolving once verified (SS9); and auth-throttle concurrency — simultaneous
failure counting, independent account/IP/global dimensions, exact threshold
crossing under contention, window restart on expiry, and no lock-sliding.

These are the behaviours SQLite cannot verify, so this is the only place they
are proven.

## 4. Lighthouse — assertions pass; the score is too noisy to compare

One complete run (exit 0, all LHCI assertions passed):

| route | perf | a11y | best-practices | seo |
|---|---|---|---|---|
| `/` | 78 | **100** | 100 | 100 |
| `/dashboard` | 76 | **100** | 96 | 100 |
| `/login` | 78 | **100** | 100 | 100 |

CLS **0** on all three.

**Accessibility is the only error-level assertion** (`minScore 0.9`) and scores
**100** everywhere. Performance's threshold is a 0.70 *warn*, which 76–78 clears.

**Do not read the performance number as a regression against the 90/86 recorded
earlier.** Repeated runs of the *same route on the same code* scored **90, 82,
78** — ±12 points of pure measurement noise on a local Windows machine. At that
variance the metric cannot distinguish a real change, and comparing across
sessions is meaningless. The CI/LHCI baseline is the only meaningful comparison.

**Environment flake:** Lighthouse intermittently dies with
`EPERM` removing its own Chrome profile temp directory on Windows — twice in
three attempts, on identical code. Redirecting `TMPDIR` helped but did not
eliminate it. This is a tooling/OS issue, not a product defect, and it is why
`npm run lighthouse` is listed as "run when available" rather than as a gate.

## Still not executed, and why

| suite | blocker |
|---|---|
| `espn.live.test.ts` | needs `ESPN_S2` / `ESPN_SWID` / `ESPN_LEAGUE_ID` — private league credentials this session must not handle |

That is the only gated suite left unrun, and the reason is a deliberate
constraint rather than a gap.
