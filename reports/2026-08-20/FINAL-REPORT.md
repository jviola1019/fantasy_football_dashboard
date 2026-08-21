# Final report — audit 2026-08-20 remediation

## 1-7. Identity

| | |
|---|---|
| Repository | `jviola1019/fantasy_football_dashboard` |
| Source branch | `fix/2026-08-06-forensic-remediation` |
| New fix branch | `fix/2026-08-20-audit-remediation` |
| Audited SHA | `69634d33a1347486a1d61eec33bde4a10cad4a2d` |
| Base SHA (merge-base with `main`) | `efb124bd7f5bf867f3fb29040d5cb1d680a6f7b3` |
| Final SHA | `880d53e` and later — see `git rev-parse HEAD` on the branch |
| PR integration SHA | PR **#26** (draft) head; PR **#21** (draft) remains at `69634d3` |

**Source SHA verified unmoved** at the start of work and again before this
report: `origin/fix/2026-08-06-forensic-remediation` = `69634d33a134…`.

## 8. Capability inventory

Full table in [`AUDIT-LEDGER.md`](./AUDIT-LEDGER.md). Determined by execution.

`AVAILABLE`: local repo, git, terminal, GitHub, Actions + logs, browser,
Playwright, SQLite, **isolated real PostgreSQL 17.11**, Sleeper, nflverse,
FantasyPros, FantasyCalc, KTC/DynastyProcess, **MyFantasyLeague (new)**.

`BLOCKED`: Vercel, production database, production deployment, secret manager.

`UNKNOWN`: ESPN (needs credentials), Fleaflicker (no discovery endpoint).

## 9. Executive verdict

Four of the five P1 findings are **fixed with executable evidence**, and a fifth
P1 that appeared in no brief was found and fixed: **the live weekly-projection
path had never matched a single player**, so every simulation silently used the
off-season path while the UI announced "Live week-N projections".

Two items are **not closed**:

- **§11 `DB_INIT_TOKEN`** — `BLOCKED` on operator secret-manager access. A
  runbook is supplied; scanner success was never substituted for proof.
- **§19 untouched holdout** — **EXECUTED**, at a smaller sample than targeted.
  160 team-seasons across 13 MyFantasyLeague leagues the model had never seen.
  Both pre-declared success criteria **NOT MET**: AUC 0.5569 [0.4630, 0.6300]
  and Brier skill -0.1738 [-0.2550, -0.0910]. It also **refuted** a claim this
  audit trail had been treating as established — the "significantly inverted"
  ranking did not replicate — so the user-facing disclosure was rewritten to stop
  asserting it.

The most consequential *process* finding: **CI ran nothing at all on a stacked
PR**. `pull_request: branches: [main]` meant a remediation PR based on another
fix branch fired no workflow — no typecheck, no tests, no CodeQL, no secret scan
— and rendered clean because nothing had run to contradict it. Fixed. The very
first real CodeQL run afterwards failed the PR with 7 new alerts (3 high) in the
audit's own new scripts, all genuine, all fixed rather than suppressed.

## 10. Finding-by-finding ledger

See [`AUDIT-LEDGER.md`](./AUDIT-LEDGER.md).

## 12. Model architecture changes

- **Production valuation: unchanged.** Still rank-ratio, with its failure
  declared. The PAR candidate is **still not shipped**, and §5 strengthened that
  call rather than weakening it.
- **Unit handling**: `WeeklyProjectionByFormat` carries all three scoring
  variants to the simulation boundary; the numeric is selected inside
  `deriveSeasonInputs` from the same `scoringFormat` that sets the opponent
  baseline, so the two sides of the comparison cannot disagree.
- **Curve fitting**: `buildPointsCurve` gained a `CurveAggregation` mode,
  defaulting to `cluster-weighted` on a-priori statistical grounds.
- **Presentation**: playoff/championship output is a qualitative band in
  log-odds distance from the structural baseline, not a percentage.

## 13. Data / provenance changes

- Composite `SourceMeta` for Sleeper roster records: bounded by the **oldest**
  decision-relevant input.
- `InjuryEvidence` threaded from fetch → lifecycle.
- Projection key namespace corrected (§7b).
- Eight-way epistemic classification + licensing/retention added to
  `docs/data-source-map.md`.

## 14. Migration changes

**None.** No schema change was made; no migration was written or run. The
PostgreSQL work was test/CI infrastructure only.

## 15-18. Command results, CI state, SQLite and PostgreSQL evidence

See the "Executed command results" and "CI evidence" tables in
[`AUDIT-LEDGER.md`](./AUDIT-LEDGER.md), and
[`postgres-integration.txt`](./postgres-integration.txt).

## 19-22. Scoring-format, injury-freshness, lifecycle, auth evidence

- Scoring format: `src/lib/simulation.scoringUnits.test.ts` (16), plus
  `npm run check:projection-units` re-measuring the position policy against live
  data.
- Injury freshness: `src/lib/leagues/injuryEvidence.test.ts` (15) and the
  composite-provenance block in `fetchLive.test.ts`.
- Lifecycle: `notifications.test.ts` §9 matrix + two new PostgreSQL-level tests.
- Auth/session: located and executed, not rewritten — see the §14 table in the
  ledger.

## 23. Secret-rotation status

`BLOCKED`. Runbook: [`docs/runbooks/db-init-token-rotation.md`](../../docs/runbooks/db-init-token-rotation.md).
A 256-bit replacement was generated at the operator's request and handed over
in-session only — written to no file and no commit.

## 24-26. PAR development results, holdout, sample counts

Development results and the dependence analysis:
[`par-dependence-analysis.md`](./par-dependence-analysis.md).

Holdout: [`holdout-protocol.md`](./holdout-protocol.md) (frozen `7688d14`,
Amendment 1 recorded pre-execution) and [`holdout-result.md`](./holdout-result.md).
160 team-seasons, 13 clusters, both criteria NOT MET, nothing tuned.

## 27. Accessibility evidence

- axe: green on all 11 routes, chromium + mobile-chrome.
- Lighthouse: **accessibility 100 on every route**, CLS 0.
- Screenshots at 320 / 390 / 768 / 1440 in [`screens/`](./screens/).
- One serious contrast violation was **introduced and fixed** during this work;
  measured tokens documented in `docs/model-presentation-decision.md`.

## 28. Residual risks

1. `DB_INIT_TOKEN` may still be live. Unknown until the runbook is executed.
2. The holdout ran at 13 clusters, not the 200 targeted; intervals are wide and
   the sample covers two seasons on one platform, with PPR assumed throughout.
3. `/analytics` overflows horizontally at 320px — pre-existing, measured.
4. Isotonic curve leading-gap defect — latent, recorded.
5. MFL generalisation: a future holdout result is evidence about MFL redraft
   leagues, not about Sleeper/ESPN populations.
6. `GHSA-9wv6-86v2-598j` expires 2026-11-11.

## 29. Rollback plan

Every change is on `fix/2026-08-20-audit-remediation`, which nothing depends on.

- **Whole branch**: close PR #26 and delete the branch. `main` and the forensic
  branch are untouched.
- **Per segment**: `git revert` any of the segment commits; they are
  independently revertable (units/provenance, model-UX + CI, docs, hardening).
- **CI trigger only**: revert the one-line `branches:` change.
- **Nothing to roll back operationally** — no deploy, no migration, no data
  mutation.

## 30. Human approvals still required

1. Execute the `DB_INIT_TOKEN` runbook (§11).
2. (Optional) Acquire more MFL leagues and re-evaluate under a **separately
   frozen** protocol — never presented as replacing this one (§19).
3. Merge either PR.
4. Any deployment.

## 31. Draft PR state

- **PR #21** — OPEN, **draft**, body updated (stale counts pinned to a SHA,
  follow-up section added).
- **PR #26** — OPEN, **draft**, targets the forensic branch so its diff is only
  this remediation.

Both remain draft: **§11 is BLOCKED**, and the holdout returned a failure the
operator should read before merging.

## 32. Explicit confirmation

**No unauthorized merge, deployment, credential rotation, history rewrite, or
production database mutation occurred.** No destructive external write occurred.
The only external writes were HTTP GETs to public read-only APIs. The only
database created was a throwaway local PostgreSQL cluster in a temp directory;
the operator's own PostgreSQL service on port 5432 was never authenticated to and
never touched.
