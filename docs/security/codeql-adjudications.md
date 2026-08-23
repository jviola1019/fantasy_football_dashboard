# CodeQL adjudications

Every CodeQL alert dismissed on this repository, with the reasoning that
justified it. A dismissal with no written argument is indistinguishable from
silencing an inconvenient finding, so nothing is dismissed without an entry here.

**Standing rule:** a *genuine* finding gets fixed, never dismissed. Dismissal is
reserved for cases where the rule's threat model does not apply to the code it
matched. During the 2026-08-20 audit, 8 alerts (1 high) were **fixed** in
commit `4b485cc` rather than dismissed — that is the default, and this file is
the exception list.

---

## Alert #1 — `js/insufficient-password-hash` (HIGH) — DISMISSED, false positive

**Location** `src/lib/security/docSecrets.ts:29`, in `isBurned()`
**Dismissed** 2026-08-22, reason *false positive*, with owner approval.

### What the code does

```ts
function isBurned(token: string, burned: ReadonlySet<string>): boolean {
  return burned.has(createHash("sha256").update(token).digest("hex"));
}
```

`BURNED_SECRET_HASHES` is a deny-list of SHA-256 digests of secrets that leaked
into this repository's git history and have since been rotated. `check:secrets`
hashes each high-entropy literal it finds in a tracked file and fails the build
if the digest matches. The point is to make a burned secret **permanently
uncommittable**, including via restoring an old doc revision.

### Why the rule does not apply

The rule targets **password storage**: a fast hash lets an attacker who steals
the database brute-force user passwords offline. Three things make that threat
model inapplicable here.

1. **Nothing is authenticated.** No digest here is a credential, and no code path
   compares a user-supplied password against these values to grant access. It is
   a detection mechanism, not an authentication store.

2. **A KDF would break it outright.** bcrypt, scrypt and argon2 are salted and
   deliberately slow *by design*. A salted hash produces a different digest every
   time, so set membership — the entire operation — becomes impossible. The
   correct primitive for a fingerprint deny-list is exactly an unsalted,
   deterministic hash.

3. **Brute force was never the threat.** The inputs are 32-byte high-entropy
   secrets, not human-chosen passwords, so the search space is infeasible. And
   they are already burned and rotated: recovering one buys an attacker a
   credential that no longer authenticates anything.

### Provenance

Pre-existing on `main` — introduced in `4a8fa02`, well before this audit. It
surfaced on PR #21 only because that diff was large enough for CodeQL to
re-report existing alerts, which its own output stated:

> *Alerts not introduced by this pull request might have been detected because
> the code changes were too large.*

### What would change this verdict

If `isBurned()` were ever repurposed to check a **user-supplied password** — or
if `BURNED_SECRET_HASHES` came to hold digests of low-entropy, human-chosen
values — the rule would apply and the dismissal must be revoked. Anyone changing
this function should re-read this entry first.

---

# Dependabot adjudications

Same standing rule: a genuine finding gets fixed. This section records the ones
where the *classification* was wrong, with the evidence that established it.

## `path-to-regexp` GHSA-9wv6-86v2-598j (HIGH) — dev scope, not runtime

**Adjudicated** 2026-08-23. Dependabot labels this alert `scope: runtime` on
this repository. That label is wrong here, and it is the only runtime-flagged
advisory not already at or above its patched version.

### The situation

Pushing this branch surfaced **46 open alerts on the default branch** — 3
critical, 24 high, 16 moderate, 3 low. Checking each runtime-flagged package
against what this branch actually resolves:

| package | patched at | this branch | verdict |
|---|---|---|---|
| `next-auth` | 5.0.0-beta.32 | **5.0.0-beta.32** | clear |
| `@auth/core` | 0.41.3 | **0.41.3** | clear |
| `next` | 16.2.11 | **16.3.1** | clear |
| `postcss` | 8.5.18 | **8.5.26** | clear |
| `nanoid` | 3.3.18 | **3.3.18** | clear |
| `sharp` | 0.35.0 | **0.35.3** | clear |
| `path-to-regexp` | 6.3.0 | **6.1.0** | see below |

The alerts are open against `main`, which is behind this branch. Six of the
seven are already resolved here.

### Why `path-to-regexp` is not a runtime exposure

Two independent checks, both run rather than reasoned:

```
$ npm ls path-to-regexp --omit=dev
rae-roster-analytics-engine@0.1.0
`-- (empty)
```

No production dependency reaches it. It enters the tree only through
`@vercel/config` → `@vercel/routing-utils`, and `@vercel/config` is a
**devDependency** used by `vercel.ts` at configuration time.

The one occurrence in the production build is a different copy entirely:

```
$ grep -o '.\{120\}path-to-regexp/.\{80\}' .next/server/chunks/...
… __nccwpck_require__.ab="/ROOT/node_modules/next/dist/compiled/path-to-regexp/" …
```

That is Next.js's **own vendored copy**, and Next is at 16.3.1, above its floor.

### What is NOT claimed

That the dev tree is clean. It is not, and `HANDOFF.md` has said so for some
time: the `lhci` / `puppeteer` / `drizzle-kit` chains carry findings, and the
gate is informational for dev scope by explicit policy.

### The gate's scope, stated

`npm run check:advisories` guards a **floor list of five packages**
(`next`, `next-auth`, `@auth/core`, `postcss`, `sharp`) and passed here. It is
not an advisory-database scan and must not be read as one — a green result means
"no resolved version below a declared floor", not "no known vulnerabilities".
That distinction is the same class of error this audit has been cataloguing, so
it is written down rather than assumed understood.

---

## Alerts #8, #10, #11, #15, #16 — `js/http-to-file-access` / `js/file-access-to-http` (MEDIUM) — OPEN, mitigated

**Adjudicated** 2026-08-23. **Not dismissed** — recorded as open, with the
mitigation and the reason the rule still fires.

| # | rule | location |
|---|---|---|
| 8 | `js/file-access-to-http` | `scripts/acquire-mfl-holdout.ts:133` |
| 10 | `js/http-to-file-access` | `scripts/acquire-mfl-holdout.ts:349` |
| 11 | `js/http-to-file-access` | `scripts/acquire-mfl-holdout.ts:362` |
| 15 | `js/http-to-file-access` | `scripts/acquire-nflverse-usage.ts:114` |
| 16 | `js/http-to-file-access` | `scripts/acquire-nflverse-usage.ts:120` |

### Why they are open

Both files are **offline holdout-acquisition scripts**. They exist to download
public research data (nflverse CSV releases, MyFantasyLeague public league JSON)
and archive it so a frozen protocol reproduces from a clean checkout. Downloading
remote content and writing it to disk is not incidental to them; it is their
entire purpose, so the rule will match for as long as they exist.

### What was done about them

The earlier decision on these was to **add response validation at each write
site**, not to dismiss. That was done and is still in place:

- `acquire-nflverse-usage.ts` — `isExpectedCsv()` checks the header against
  `REQUIRED_COLUMNS` before `writeFileSync`. A redirect page, an error body or a
  truncated download is rejected rather than archived.
- `acquire-mfl-holdout.ts` — the path was already constrained to validated
  numerics; `isArchivableLeague()` adds a CONTENT contract, so an error page
  cannot be written and then parsed as a league by a later protocol run. Cached
  entries are **re-validated on read**, because trusting a file because we wrote
  it once is how a validated boundary quietly becomes an unvalidated one.

CodeQL still reports the dataflow: the rule matches remote-content-reaches-file
regardless of intervening validation, because it cannot see that the validator
constrains the content.

### The point of writing this down

**The CodeQL *workflow* is green while the CodeQL *analysis* carries five open
alerts.** Those are two different things, and confusing them is instance #3 in
this audit's list of checks that pass without checking — reported green four
times before anyone looked at the alerts rather than the job. Anyone reading a
green CI badge on this repository should read this file too.

Neither dismissal nor closure is done here: dismissing a CodeQL alert is an
owner action, and these are recorded so the decision stays with the owner
instead of being made silently by whoever was passing through.

---

## Follow-up 2026-08-23 — the structural fix helped, and did NOT clear the alert

Recorded because the outcome contradicts what the change was expected to do, and
a prediction that missed is worth more written down than quietly dropped.

### What was changed

`acquire-nflverse-usage.ts` used to run `writeFileSync(dest, text)`, where `text`
is the HTTP response body. The header check validated the body and then wrote
the body, which is why the dataflow survived it.

The archive is now **rebuilt from parsed cells** — `reserialize()` parses the
CSV, keeps only the columns a harness actually reads, and re-emits them. Nothing
unvalidated is persisted, and the file is smaller.

Both frozen protocols were re-run to prove the committed archives are untouched:
protocol 4 reproduces **958 player-seasons / 452 players** with 0.2289 / 0.2259
/ 0.5749; protocol 5 reproduces **694 / 392** with w = 0.7613.

### What CodeQL did with it

**It still flags the write.** A new alert (#18) appears at the new
`writeFileSync(dest, archived)` line. Dataflow through a parser is still
dataflow: CodeQL does not treat `parseCsv` as a sanitiser, and there is no
reason it should — a parser preserves the values it reads.

So the security posture genuinely improved (only validated, needed columns reach
disk) while the alert count did not. **Those are different things, and claiming
the first as the second is exactly the kind of overstatement this audit has
spent its life removing.**

### Why these are accepted rather than chased further

The same reasoning was applied to `acquire-mfl-holdout.ts` and rejected as
disproportionate. Its archive is already an explicitly-constructed typed record
(`RawLeague`, nine named fields), and the remaining taint is inside nested MFL
sub-payloads that **protocol 3 traverses dynamically**. Re-shaping those to
satisfy a static analyser would risk a frozen protocol's reproducibility for a
medium-severity finding in a script that never runs in production.

The standing rule in this file is that a genuine finding gets fixed. The
judgement here is that the **rule's threat model does not apply**: these are
offline research scripts whose entire purpose is downloading public data and
archiving it, the paths come from frozen literal lists rather than from any
response, the bodies are content-validated before use, and cached files are
re-validated on read.

That is the documented basis for dismissal — not convenience, and not a green
badge.

