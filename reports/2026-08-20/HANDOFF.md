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

## Open item 2 — §19, the holdout

**This is the highest-value remaining work, and it is unblocked except for time.**

### What is already true

- Sleeper has no public league directory. **MyFantasyLeague does.**
  `TYPE=leagueSearch` returned **18,723** unique candidate league ids for season
  2023 alone, and ~20,400 for 2021.
- The protocol is **frozen and committed at `7688d14`**, before any scoring, with
  the success criterion declared in advance:
  [`holdout-protocol.md`](./holdout-protocol.md).
- Both harnesses exist, typecheck, lint, and are validated against real MFL
  payloads:
  - `npm run holdout:acquire` — acquisition only, computes no metric
  - `npm run holdout:evaluate` — the single frozen execution
  - `npx tsx scripts/acquire-mfl-players.ts` — per-season player database
    (already cached for 2021-2024)
- Per-season sampling frames are **cached to disk**, so the sample is pinned and
  a restart does not redraw it or spend ~5 minutes re-searching.
- Parsing is verified end to end via `--parse-only`, which computes **no metric**
  and therefore does not spend the one permitted execution.

### Where it stopped

`11` leagues archived, ~7 of them scorable. Not enough: the protocol targets ~200
clusters, and the entire point is escaping a 3-5 cluster sample.

Cause: MFL began IP-rate-limiting. **Self-inflicted** — three acquisition
processes were running concurrently after two background launches failed to die.
Diagnosed by `Get-CimInstance Win32_Process`, killed, and the limit lifted on its
own roughly 40 minutes later. The throttle is now 1500 ms and the run is
single-process.

### Exactly what to do next

```bash
# 1. Confirm the rate limit is clear (expect http=200)
curl -sL -o /dev/null -w "%{http_code}\n" \
  -A "RAE-audit/1.0" \
  "https://api.myfantasyleague.com/2021/export?TYPE=league&L=10100&JSON=1"

# 2. Confirm nothing is already running (must print 0)
powershell -c "@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*acquire-mfl*' }).Count"

# 3. ONE process. Resumable — it skips what is already archived.
npm run holdout:acquire -- --target 120

# 4. Verify parsing without spending the execution
npx tsx scripts/holdout-evaluate.ts --parse-only

# 5. THE SINGLE EXECUTION. Run once. Report whatever it says.
npm run holdout:evaluate
```

Expect roughly 25-35% of examined leagues to pass the structural gate, and ~70%
of archived leagues to survive evaluation-time parsing.

### Rules that must not be broken

- **Run `holdout:evaluate` once.** If a harness bug is found afterwards, disclose
  the fix and show **both** results. Silently re-running until it looks good is
  the exact failure the freeze exists to prevent.
- **Do not tune anything on this data.** No cushion, anchor, slope, coefficient
  or curve setting. Post-hoc tuning converts the holdout into development data
  permanently, and there is no second untouched sample behind it.
- **The five Sleeper leagues are development data forever.** They cannot serve as
  a holdout at any future point.
- **Do not add PAR to this protocol.** It needs a runtime points curve, and
  fitting one on MFL introduces unfrozen choices. `playerScores` is already
  archived so a *separately frozen* PAR protocol can use it later.

### If the result is a failure

That is a legitimate, publishable outcome and the protocol already says so.
Record it, keep production on the scenario presentation, and do not soften it.

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
