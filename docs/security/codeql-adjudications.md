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
