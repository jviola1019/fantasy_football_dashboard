# Handoff — audit 2026-08-20 remediation

Resume point for the next session. Written to be actionable without re-reading
the whole conversation.

## Context-reset packet

**Objective.** Remediate the 2026-08-18 forensic audit of
`fix/2026-08-06-forensic-remediation` @ `69634d33a1347486a1d61eec33bde4a10cad4a2d`,
on a new branch, without weakening any gate.

**Branch state**

| | |
|---|---|
| audited source SHA | `69634d33a1347486a1d61eec33bde4a10cad4a2d` — **verified unmoved** at start and at end |
| base / merge-base | `main` / `efb124bd7f5bf867f3fb29040d5cb1d680a6f7b3` |
| working branch | `fix/2026-08-20-audit-remediation` |
| draft PR | **#26** → `fix/2026-08-06-forensic-remediation` (stacked, so its diff is only this work) |
| umbrella PR | **#21** → `main`, still **draft**, body updated |

**Done (all gates green, all committed).**

- §7 + §7b scoring-unit consistency and the dead live-projection path
- §8 injury/status composite provenance
- §9 injury-evidence gate on negative reconciliation
- §3 Strategy B model presentation
- §10 PostgreSQL in CI, with a skip-detector
- §5 pseudo-replication measured; §6 curve assumptions documented
- §12 sensitivity 48 → 96 league shapes
- §13 epistemic classification + licensing/retention
- §14 verified by executing the existing negative tests
- §15 scan gates green; Node-20 runtime migration **planned**
- §16 README de-brittled; PR #21 metadata corrected
- CI trigger widened so stacked `fix/**` PRs are actually verified

**Not done.**

1. **§11 `DB_INIT_TOKEN` — `BLOCKED`.** Needs operator secret-manager access.
2. **§19 holdout — `EXECUTED`.** Ran once on 13 clusters / 160 team-seasons.
   Both pre-declared criteria NOT MET. It also refuted the development-set
   "significantly inverted" finding, which forced a correction to the
   user-facing disclosure. See `holdout-result.md`. Optional future work:
   acquire more MFL leagues and evaluate under a **separately frozen** protocol,
   reported alongside — never instead of — this one.

## Open item 1 — §11, credential invalidation

`BLOCKED` on human action, not on work. Everything needed is in
[`docs/runbooks/db-init-token-rotation.md`](../../docs/runbooks/db-init-token-rotation.md).

The decisive step is Step 4: POST the **old** token at `/api/admin/init-db` on a
preview deployment and require `401`/`403`. Anything else — including gitleaks
passing — is not proof the credential is dead.

A replacement token was generated at the operator's request and handed over
in-session only. It is in **no file and no commit**. The runbook recommends
generating a fresh one locally so it never touches a transcript.

## Item 2 — §19, the holdout: DONE, with an optional extension

**Executed once on 2026-08-21.** Full result and interpretation:
[`holdout-result.md`](./holdout-result.md).

- Sample: **160 team-seasons, 13 MyFantasyLeague clusters**, seasons 2021/2023,
  league sizes 10/12/14/16, playoff fields 4/6/8.
- Both pre-declared criteria **NOT MET**: AUC 0.5569 [0.4630, 0.6300]; Brier
  skill -0.1738 [-0.2550, -0.0910].
- **Nothing was tuned on it.** The criterion was declared in advance and the
  failure is reported as a failure.
- It **refuted** the development-set "significantly inverted" finding
  (AUC 0.2546 there, 0.5569 here), which forced a correction to the user-facing
  disclosure on every surface. `scenarioBand.test.ts` now prevents the refuted
  phrasing returning.
- The 21-league sample is committed as `holdout-data.jsonl.gz` (0.22 MB), so
  `npm run holdout:evaluate` reproduces it from a clean checkout with no network.

### Optional extension — and the rule that governs it

Acquisition stopped at 21 archived because MFL rate-limits hard (~20
leagues/hour after correcting a self-inflicted three-process storm). More data
would narrow the intervals.

If you pursue it:

```bash
# 1. Confirm the limit is clear (expect 200)
curl -sL -o /dev/null -w "%{http_code}
" -A "RAE-audit/1.0"   "https://api.myfantasyleague.com/2021/export?TYPE=league&L=10100&JSON=1"

# 2. Confirm nothing is already running (must print 0)
powershell -c "@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*acquire-mfl*' }).Count"

# 3. ONE process. Resumable; skips what is archived.
npm run holdout:acquire -- --target 120

# 4. Rebuild the committed artifact
npx tsx scripts/acquire-mfl-holdout.ts --bundle-only

# 5. Verify parsing and arithmetic WITHOUT computing the answer
npx tsx scripts/holdout-evaluate.ts --parse-only
npx tsx scripts/holdout-evaluate.ts --self-test
```

**Then stop and freeze a NEW protocol before evaluating.** The archived sample
overlaps this one, so a larger run is *not* an independent replication. Its
result must be reported **alongside** this one, never instead of it, and the
success criterion must be fixed before the numbers are seen.

### Rules that still hold

- **Do not tune anything on holdout data.** No cushion, anchor, slope,
  coefficient or curve setting.
- **The five Sleeper leagues are development data forever.**
- **Do not add PAR to this protocol.** It needs a runtime points curve, and
  fitting one on MFL introduces unfrozen choices. `playerScores` is archived so a
  separately frozen PAR protocol can use it.
- **A failure is a publishable result.** This one is.

## Ledgers

- Findings + capability inventory + command results:
  [`AUDIT-LEDGER.md`](./AUDIT-LEDGER.md)
- Model decision + usability tradeoff:
  [`docs/model-presentation-decision.md`](../../docs/model-presentation-decision.md)
- Dependence analysis:
  [`par-dependence-analysis.md`](./par-dependence-analysis.md)
- Curve assumptions:
  [`docs/points-curve-assumptions.md`](../../docs/points-curve-assumptions.md)

## Known-open, deliberately not fixed here

- **`/analytics` horizontal overflow at 320px** (`scrollWidth` 372 vs 320).
  Measured **identical** on the pre-change tree, so it is pre-existing. Culprits
  are the top command bar's right cluster, the panel tab strip, and a data table.
- **Node-20 action runtime.** One PR per action, `checkout` first, `codeql` last,
  never batched — a batched bump makes a failure ambiguous.
- **`GHSA-9wv6-86v2-598j`** (`path-to-regexp`, dev-only) expires **2026-11-11**.
  `npm run check:exceptions` fails the build when it lapses, which is the
  intended forcing function.
- **Isotonic curve, leading-gap defect.** If positional rank 1 were ever absent,
  it would inherit `lastMean = 0` and put a spurious zero at the top of the
  curve. Has not occurred (rank 1 is always drafted); recorded rather than
  assumed away.

## Local environment notes

- Isolated PostgreSQL **17.11** cluster at `127.0.0.1:55432`, data dir
  `C:\tmp\rae-pgtest`, db `rae_test`, role `raetest`. Created for this audit;
  entirely separate from the operator's service on 5432, which is password-gated
  and was never touched. Start it with
  `pg_ctl -D C:\tmp\rae-pgtest\data start` if the machine has rebooted.
  Tests need `RAE_PG_TEST_URL=postgres://raetest:raetestpw@127.0.0.1:55432/rae_test`.
- Node 25.8.2 / npm 11.11.1 locally; CI is Node 20.

## Nothing was authorized and taken

No merge, no deployment, no credential rotation, no history rewrite, no
production database mutation, no destructive external write. Both PRs remain
**draft**.
