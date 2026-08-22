# Operator runbook — rotate every RAE secret

**Written** 2026-08-21 · **Supersedes nothing** — extends
[`db-init-token-rotation.md`](./db-init-token-rotation.md) from one credential to
all of them.

> **No secret value appears in this file, and none ever should.** Rotation values
> are generated on demand and handed to the operator directly. Anything written
> down here would be the exact failure this runbook exists to close.

## Read this first: one rotation is not like the others

Three of these four secrets are *authenticators* — rotating one invalidates the
old value and nothing else. The fourth is an *encryption key*, and rotating it
destroys data.

| secret | what it protects | cost of rotating |
|---|---|---|
| `AUTH_SECRET` | NextAuth session signing | all users signed out |
| `DB_INIT_TOKEN` | `POST /api/admin/init-db` | none |
| `CRON_SECRET` | the `/api/cron/*` endpoints | none, once Vercel is updated |
| **`CREDENTIAL_ENCRYPTION_KEY`** | **stored ESPN cookies, AES-256-GCM** | **PERMANENT DATA LOSS — see below** |

### Why `CREDENTIAL_ENCRYPTION_KEY` is different

`src/lib/crypto.ts` seals credentials with a **single, unversioned** key. There
is no key id in the payload and no dual-read path, so a ciphertext written under
the old key cannot be read under the new one — it is not recoverable, it is
gone. Every league whose ESPN cookies are stored will fail to decrypt, and each
affected user must re-enter their `ESPN_S2` / `SWID` cookies.

**Rotate it only when it is actually warranted** — a suspected compromise, or an
operator with access to the old value leaving. Routine hygiene is not a reason to
destroy stored credentials.

If you must rotate it while preserving stored credentials, the supported order is
to **re-encrypt first**: with the old key still live, decrypt each stored payload
and re-seal it under the new key in the same transaction, then swap the env var.
RAE has no built-in re-encryption command today; writing one is the prerequisite,
not an optional extra.

## Rotation procedure

For each secret, in this order:

1. **Generate** a fresh value. 256 bits from a CSPRNG:
   - `AUTH_SECRET`, `CREDENTIAL_ENCRYPTION_KEY` — base64 of 32 random bytes.
     The encryption key **must** decode to exactly 32 bytes or `getCredentialKey`
     throws at boot.
   - `DB_INIT_TOKEN`, `CRON_SECRET` — 64 hex characters.

   ```bash
   node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64"))'  # base64 keys
   node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'     # hex tokens
   ```

   Never paste a generated value into a file, a commit message, an issue, or a
   chat log that is retained.

2. **Set it in the secret store**, not in the repository. Vercel:
   `Project → Settings → Environment Variables`. Set all environments the secret
   is used in; a value that differs between Preview and Production produces a
   failure that looks like a bug rather than a config error.

3. **Redeploy.** Vercel injects environment variables at build/boot, so an
   updated variable does nothing until a new deployment exists.

4. **Verify the new value works** before assuming the old one is dead:
   - `DB_INIT_TOKEN` — `POST /api/admin/init-db` with the new `x-init-token`
     should succeed.
   - `CRON_SECRET` — a cron route with the new `Authorization: Bearer` should
     return 200.
   - `AUTH_SECRET` — sign in.
   - `CREDENTIAL_ENCRYPTION_KEY` — a league whose credentials were re-encrypted
     still refreshes.

5. **Verify the OLD value is rejected.** This is the step that actually proves
   rotation happened; step 4 only proves the new value was accepted. Replay the
   previous token against the same endpoint and require a 401/403.

   `npm run verify:rotation` does exactly this:

   ```bash
   RAE_VERIFY_BASE_URL=https://<your-app>.vercel.app \
     OLD_DB_INIT_TOKEN=... OLD_CRON_SECRET=... npm run verify:rotation
   ```

   It reads secrets from the environment only — never argv, which lands in shell
   history and process listings — never prints them, and exits non-zero if a
   previous credential still authenticates. Supplying no `OLD_*` value exits 2
   rather than passing: an absent check is not evidence.

   The default run only sends credentials the server should reject, so it
   mutates nothing. `--check-new` additionally confirms a new value is accepted,
   and covers the cron route only — `init-db` applies DDL, and a production
   database mutation is a deliberate decision, not a side effect of verifying.

6. **Burn the old value** so it cannot be reintroduced. Append its SHA-256 to
   `BURNED_SECRET_HASHES` in `src/lib/security/docSecrets.ts`; `npm run
   check:secrets` then fails if the plaintext ever reappears in a tracked file.
   The hash is safe to commit — the plaintext is not.

   ```bash
   node -e 'const c=require("node:crypto");c.createHash("sha256").update(process.argv[1]).digest("hex")' -- "$OLD"
   ```

7. **Record the rotation** — date, which secret, who performed it — in the audit
   ledger. Not the value.

## What this repository can and cannot verify

CI proves the repository is clean. It cannot prove a credential was invalidated,
because invalidation happens in a secret store the repository has no access to.

| capability | state |
|---|---|
| Repository history is scanned in full | **YES** — `gitleaks FULL-HISTORY secret scan` in `security.yml` |
| Tracked files are scanned each run | **YES** — `check:secrets` |
| Known-burned plaintexts fail if reintroduced | **YES** — `BURNED_SECRET_HASHES` |
| A live credential was actually revoked | **NO** — requires the secret store |
| Rotation performed 2026-08-22 | **ATTESTED by the owner, not verified here** — run step 5 to upgrade it |

Do not report a rotation as complete on the strength of a green CI run. The
evidence for rotation is step 5.

## History note

Thirteen historical findings are adjudicated by exact fingerprint in
`.gitleaksignore` — eight are one real `DB_INIT_TOKEN` (rotated; see
`reports/audit-2026-07-08-fable.md` A-01) and five are synthetic detector
fixtures. History is treated as immutable because six of the seven carrying
commits are already ancestors of `main`; rewriting is an owner decision and is
out of scope here.
