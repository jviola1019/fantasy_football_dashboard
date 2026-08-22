# Operator runbook — verify and rotate `DB_INIT_TOKEN`

**Audit** §11 · **Status** **ROTATED — operator-attested 2026-08-22** · **Written** 2026-08-20

> **Update 2026-08-22.** The repository owner reports rotating **`DB_INIT_TOKEN`**
> in Vercel. That closes the operator action this runbook was blocked on.
>
> Scope, stated precisely because "the secrets were rotated" would overstate it:
> `DB_INIT_TOKEN` **only**. `CREDENTIAL_ENCRYPTION_KEY` was deliberately **NOT**
> rotated, which is the correct call — it would have destroyed every stored ESPN
> credential. `AUTH_SECRET` and `CRON_SECRET` are not reported as rotated and
> should be treated as unrotated.
>
> This session did **not** independently verify it and does not claim to: verifying
> a rotation requires authenticated access to the secret store, which remains
> `BLOCKED` here. The status above is therefore **attested**, not **verified** —
> a distinction this runbook exists to preserve.
>
> The evidence that would upgrade it to verified is one command, runnable by the
> owner, who is the only party holding the previous values:
>
> ```bash
> RAE_VERIFY_BASE_URL=https://<your-app>.vercel.app \
>   OLD_DB_INIT_TOKEN=... OLD_CRON_SECRET=... npm run verify:rotation
> ```
>
> It asserts the PREVIOUS values are now rejected (403), which is the only direct
> proof a rotation took effect. Confirming the new value works proves only that it
> was accepted.

## Why this exists

A real `DB_INIT_TOKEN` value was previously present in this repository's git
history. Gitleaks currently passes, but **that is not evidence the credential is
dead** — the history policy passes by reviewed exact fingerprints, which means
the scanner has been told the finding is known, not that the secret was
invalidated.

Nothing in this audit could verify invalidation, because verification requires
authenticated access to the secret store:

| capability | state | why |
|---|---|---|
| Vercel CLI | `BLOCKED` | not installed |
| Vercel MCP | `BLOCKED` | unauthorized; a non-interactive session cannot run the OAuth flow |
| Secret manager | `BLOCKED` | no authorized access |
| Production deployment | `BLOCKED` | requires human approval; not attempted |

So §11 is reported as **BLOCKED**, not as passed. Scanner success was not
substituted for proof.

## What `DB_INIT_TOKEN` protects

`/api/admin/init-db` — the endpoint that bootstraps the schema. An attacker
holding a live token can reach a privileged database-initialisation route.
Treat a still-valid historical token as a live production credential exposure.

---

## Step 1 — generate a replacement

Generate it **yourself**, so it never passes through a chat transcript, a log, or
an AI session:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

That is 256 bits of entropy, URL-safe, no padding.

> A candidate value was generated during the audit session at your request and
> handed over in-session only. It was written to **no file and no commit** — but
> it does exist in that session's transcript. Prefer the command above. If you
> use the session value, treat the transcript as sensitive.

## Step 2 — record the CURRENT token's fingerprint, without exposing it

Never print the value. Compare hashes:

```bash
# Local .env
node -e "
const v = require('fs').readFileSync('.env','utf8')
  .split(/\r?\n/).find(l => l.startsWith('DB_INIT_TOKEN='));
if (!v) { console.log('DB_INIT_TOKEN not set locally'); process.exit(0); }
const secret = v.slice('DB_INIT_TOKEN='.length).trim();
console.log('sha256:', require('crypto').createHash('sha256').update(secret).digest('hex').slice(0,16));
console.log('length:', secret.length);
"
```

For Vercel, pull into a scratch file, fingerprint, then destroy it:

```bash
npm i -g vercel && vercel login && vercel link

for env in production preview development; do
  vercel env pull ".env.$env.scratch" --environment "$env" --yes
  node -e "
    const fs=require('fs');
    const f='.env.$env.scratch';
    const line=fs.readFileSync(f,'utf8').split(/\r?\n/).find(l=>l.startsWith('DB_INIT_TOKEN='));
    if(!line){console.log('$env: NOT SET');process.exit(0);}
    let s=line.slice('DB_INIT_TOKEN='.length).trim().replace(/^\"|\"$/g,'');
    console.log('$env sha256:', require('crypto').createHash('sha256').update(s).digest('hex').slice(0,16));
  "
  shred -u ".env.$env.scratch" 2>/dev/null || rm -f ".env.$env.scratch"
done
```

`vercel env ls` alone shows names and timestamps but **not** values, so it cannot
answer this question — it can only tell you *when* a variable was last updated,
which is a useful corroborating signal but not proof.

## Step 3 — confirm the current token differs from the exposed one

Recover the historical value from git history **into memory only**:

```bash
git log --all -p -S 'DB_INIT_TOKEN' -- . | grep -n 'DB_INIT_TOKEN' | head
```

Fingerprint the historical value with the same sha256-first-16 recipe and
compare. **If any environment's fingerprint matches the historical one, the
credential was never rotated** — treat it as an active exposure and go straight
to Step 5.

## Step 4 — prove the old token no longer authenticates

The decisive test. Against a **non-production** deployment first:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST "https://<preview-deployment>/api/admin/init-db" \
  -H "Authorization: Bearer <HISTORICAL_TOKEN>"
```

- `401` / `403` → the old token is dead. **This is the evidence §11 asks for.**
- `200` / `2xx` → **the old token is live.** Rotate immediately (Step 5) and
  treat it as an incident: the endpoint has been reachable with a public
  credential for as long as it has been in history.

Record the status code, the deployment URL, and the UTC timestamp. Do not run
this against production until you have rotated, and never with a token you are
not deliberately testing.

## Step 5 — rotate (requires human approval; NOT performed by the audit)

```bash
for env in production preview development; do
  vercel env rm  DB_INIT_TOKEN "$env" --yes
  vercel env add DB_INIT_TOKEN "$env"   # paste the Step 1 value at the prompt
done
vercel redeploy <production-deployment-url>   # env changes need a redeploy
```

Then re-run **Step 4** against production with the OLD token and confirm a
`401`/`403`.

## Step 6 — record the outcome

Append to `reports/2026-08-20/AUDIT-LEDGER.md`:

- rotation timestamp (UTC);
- environments rotated (production / preview / development);
- the Step 4 status code for the old token, per environment;
- first 16 hex of the sha256 of the new token, per environment, so a future audit
  can confirm it has not silently reverted;
- who performed it.

Never record the plaintext value.

---

## Hardening worth doing at the same time

1. **Make the endpoint unreachable when it is not needed.** A bootstrap route
   only has to work once. Gate it on an env flag that is off by default, so a
   leaked token is inert.
2. **Scope the token to non-production.** Schema bootstrap in production should
   go through a migration job, not an HTTP endpoint.
3. **Add rate limiting** to `/api/admin/init-db` — the auth-throttle machinery
   already in the codebase applies.
4. **Purge the value from history.** Rotation makes the exposed value useless,
   which is the important part; a history rewrite (`git filter-repo`) is a
   separate decision with its own risks and needs explicit approval. Do not do it
   as a side effect of rotation.
