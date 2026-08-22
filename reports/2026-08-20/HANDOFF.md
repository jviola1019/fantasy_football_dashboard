# HANDOFF — audit 2026-08-20 remediation

**Updated** 2026-08-22 · **Branch** `fix/2026-08-20-audit-remediation` · **PR**
[#26](https://github.com/jviola1019/fantasy_football_dashboard/pull/26) (draft)

> This file was rewritten on 2026-08-22 because it had gone stale in a way that
> would have misled a resuming session: it still described protocol 2 as "frozen,
> awaiting its execution trigger" when protocols 2, 3 **and** 4 had all been
> executed and reported. A handoff that is confidently wrong is worse than none.

## Objective

Execute the 23-section forensic remediation brief against
`69634d33a1347486a1d61eec33bde4a10cad4a2d` without modifying `main`, without
weakening any gate, and without claiming completion where evidence is absent.

## State: done

- **§1–§8** identity, branch, capability inventory — all determined by execution.
- **§9–§10** five P1 findings fixed, including one in **no brief**: the live
  weekly-projection path had never matched a single player (key-namespace
  mismatch), so every simulation silently used the off-season path while the UI
  announced "Live week-N projections".
- **§11** `DB_INIT_TOKEN` — **ROTATED, operator-attested 2026-08-22**. That
  secret **only**; see below for what was deliberately not rotated.
- **Product renamed** 2026-08-22: *Reputation Arbitrage Engine* → **Roster
  Analytics Engine**, after protocol 3 refuted the claim the old name made. The
  initialism is unchanged, so no repo/URL/deploy target moved.
- **A wording guard was found dead** and repaired — see below. It had never
  matched anything since the commit that introduced it.
- **§12** sensitivity 48 → 96 league shapes.
- **§13** epistemic classification + licensing/retention.
- **§14** verified by executing the existing negative tests, not rewriting them.
- **§15** scan gates green; Node-20 action-runtime migration **planned, not
  executed** — deliberately. See below.
- **§16** README de-brittled; PR #21 metadata corrected.
- **§19** untouched holdout — **EXECUTED, four times, under four separately
  frozen protocols.** See below.
- **§22** clean-room re-verification of the final tree.
- CI trigger widened so stacked `fix/**` PRs are actually verified. The first
  real CodeQL run afterwards failed the PR with 7 alerts (3 high) in this audit's
  own new scripts — all genuine, all fixed rather than suppressed.
- Full-history secret scanning added after the existing gitleaks job was found
  passing while scanning 29 commits of 299.

## The four holdout protocols

Each was frozen and committed **before** any metric was computed. Index:
[`README.md`](./README.md).

| # | question | verdict |
|---|---|---|
| 1 | does the shipped season model hold out of sample? | **FAILED** both criteria |
| 2 | does it hold on a larger external holdout? | **FAILED**; refuted our own "inverted" claim |
| 3 | does the reputation edge find mispriced players? | **FAILED**; within position, inverted |
| 4 | does in-season opportunity add over production? | **PASSED**, all three Holm-corrected |

**Protocol 4 is the only pass**, and four limits travel with it: the out-of-fold
gain is **+0.0137** (0.7342 → 0.7479), `p < 0.0002` is the bootstrap floor rather
than a tiny number, part of the effect is mechanical because a PPR reception is
itself a point, and the scope is **in-season only**. Protocols 1–3 tested the
pre-season regime and it failed; both results stand because they concern
different regimes.

**No weight was changed on protocol 4's evidence.** §8 of that protocol forbids
tuning a weight on the data and forbids shipping on a diagnostic alone, so the D1
regression coefficients were deliberately not read into the waiver formula.

## Open items

### 1. §11 — `DB_INIT_TOKEN` rotation is ATTESTED, not VERIFIED

The owner reports rotating **`DB_INIT_TOKEN`** in Vercel on 2026-08-22. That
closes the operator action.

**Scope, precisely:** that secret only. `CREDENTIAL_ENCRYPTION_KEY` was
deliberately **not** rotated, which is correct. `AUTH_SECRET` and `CRON_SECRET`
are not reported as rotated and should be treated as unrotated.

It is recorded as **attested**, because this session has no authorized access to
the secret store and cannot observe the change. The distinction is deliberate: a
green CI run proves the *repository* is clean and says nothing about whether a
live credential was invalidated.

**To upgrade attested → verified**, the owner runs (only they hold the old
values):

```bash
RAE_VERIFY_BASE_URL=https://<your-app>.vercel.app \
  OLD_DB_INIT_TOKEN=... OLD_CRON_SECRET=... npm run verify:rotation
```

It requires a 401/403 from the **previous** credentials. Confirming the new value
works proves only that it was accepted, which is the weaker claim.

`CREDENTIAL_ENCRYPTION_KEY` remains **correctly unrotated**.
`src/lib/crypto.ts` uses a single unversioned AES-256-GCM key with no key id and
no dual-read path, so rotating it would make every stored ESPN credential
permanently undecryptable. Writing a re-encryption command is the prerequisite
for ever rotating it. See
[`docs/runbooks/secret-rotation.md`](../../docs/runbooks/secret-rotation.md).

### 2. §15 — Node-20 action runtime migration

**Planned, deliberately not executed.** Every action in use is already on a
Node-20-compatible major (`checkout@v4`, `setup-node@v4`, `upload-artifact@v4`),
so nothing is broken. The plan is one PR per action, `checkout` first and
`codeql` last, each merged only on a green run — batching makes a failure
ambiguous. Doing it inside a P1 remediation would confound the two changes.

### 3. Expiring exception

`GHSA-9wv6-86v2-598j` (`path-to-regexp`, development-only) lapses **2026-11-11**.
`npm run check:exceptions` fails the build once it does, which is the intended
forcing function.

### 4. A dead guard was found — check the others the same way

`e2e/20-model-failure-disclosure.spec.ts` contained
`/<0x08>(arbitrage play|...)/i` — a literal **backspace byte** where a
word-boundary escape was intended. The regex could never match, so the test
passed unconditionally from the commit that introduced it (`5fe271e`), whose
message was "stop claiming arbitrage the product cannot demonstrate."

Repaired, and it now asserts on itself so a future dead regex fails loudly. All
tracked `.ts`/`.tsx` files were scanned for stray control bytes: **zero found
elsewhere**. The repaired guard immediately caught a real miss — an
`/analytics` tab still labelled "Arbitrage".

**Lesson for a successor:** a passing wording guard proves nothing until you have
seen it fail. Prefer guards that assert on themselves.

### 5. Known cosmetic issue

~~`/analytics` overflows horizontally at 320px.~~ **FIXED 2026-08-22.**

Writing a test for it showed the recorded description was wrong: **every route**
overflowed by the same 52px, not just `/analytics`. It had survived because the
only overflow test covered one route (`/dashboard`) and stopped at 390px.

One element caused all of it — the command bar's right-hand cluster (league
switcher + Mock draft/Sign in + mode badge) is 248px wide, which does not fit
beside the sidebar trigger and logo at 320px. The bar now wraps below `sm`.
Nothing is hidden: hiding the live/fixture badge would have violated the
governance rules. `e2e/23` covers 12 routes at 320px and 360px.

## Next candidate work

**Protocol 5**: set the opportunity weight properly. Protocol 4 established that
opportunity belongs in the model but explicitly forbade deriving a weight from
that data. A weight needs its own pre-registered protocol with its own held-out
split, carrying the same guards: cluster on the repeated unit, standardise within
position, use a permutation null, and require the whole pre-registered family
under Holm correction.

## Standing constraints

- Never modify `main`; never force-push; never rewrite history.
- Human approval required before: production deployment, merge, credential
  rotation, production database mutation, deleting data, destructive external
  writes.
- **Never merge automatically.** PR stays **draft** while any P1 is unresolved.
- Never weaken a test, security check, accessibility gate, type rule, model
  warning, or provenance disclosure to obtain green CI.
- Return `BLOCKED` rather than claiming completion.
