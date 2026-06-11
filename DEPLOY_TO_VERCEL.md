# Deploy RAE to Vercel

Step-by-step. Follow in order.

## 1. Push the current branch to GitHub

```bash
git add -A
git commit -m "Vercel deploy prep: dual SQLite/Postgres driver, vercel.ts, dynamic homepage"
git push
```

## 2. Import the repo in Vercel

1. Go to <https://vercel.com/new>.
2. Pick the `fantasy_football_dashboard` repo.
3. Framework should auto-detect as **Next.js**. Leave defaults.
4. **Do not click Deploy yet.** Click **Environment Variables** first.

## 3. Add a Neon Postgres database (Marketplace)

Before deploying, attach a database so `DATABASE_URL` is provisioned:

1. In the project's Vercel dashboard → **Storage** → **Create Database** → **Marketplace** → **Neon**.
2. Pick a region close to your function region (default `iad1` is fine).
3. Connect to your project. Vercel automatically writes `DATABASE_URL` into all three environments (Production, Preview, Development).

## 4. Set the four required environment variables

In **Project Settings → Environment Variables**, add the following to all three environments (Production / Preview / Development):

| Variable | Value |
| --- | --- |
| `AUTH_SECRET` | _Generate (below); set in Vercel only — never commit._ |
| `CREDENTIAL_ENCRYPTION_KEY` | _Generate (below); set in Vercel only — never commit._ |
| `DB_INIT_TOKEN` | _Generate (below); set in Vercel only — never commit._ |
| `DATABASE_URL` | already set by the Neon integration in step 3 |

Generate each value locally and paste it straight into Vercel (never into a file or chat):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # CREDENTIAL_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"      # DB_INIT_TOKEN
```

> These are real secrets. If one ever lands in a file or chat, rotate it immediately in
> Vercel (and clear `leagueCredentials` when rotating `CREDENTIAL_ENCRYPTION_KEY`).

## 5. Deploy

Click **Deploy**. First build should take ~90s. You'll get a `*.vercel.app` URL.

## 6. One-time Postgres schema bootstrap

The Postgres database is empty until you initialize the schema. Run this once against the deployed URL:

```bash
DB_INIT_TOKEN=…   # the value you set in Vercel
curl -X POST https://<your-project>.vercel.app/api/admin/init-db \
  -H "x-init-token: $DB_INIT_TOKEN"
```

Expected response: `{"ok":true,"driver":"postgres","applied":true}`.

If you ever rotate `CREDENTIAL_ENCRYPTION_KEY`, you must clear `leagueCredentials` first — old payloads can't be decrypted with a new key.

## 7. Verify

- Visit `/` — the dashboard renders the fixture envelope (six WebGL panels).
- Visit `/login`, register an account.
- Visit `/settings/leagues`, add a Sleeper or ESPN league.
- `POST /api/leagues/<id>/refresh` should return a fresh envelope.

## What was changed for Vercel readiness

1. **`src/db/index.ts`** — dual driver. URL starting with `postgres://` selects the `postgres-js` Drizzle adapter; everything else uses local SQLite. `better-sqlite3` is only required at runtime when needed, so Vercel's serverless functions never load the native binary.
2. **`src/db/schema-pg.ts`** — Postgres mirror of the SQLite schema with the same column names and JS types, plus an `INIT_SQL` string used by the bootstrap route.
3. **`src/app/api/admin/init-db/route.ts`** — token-protected one-shot endpoint that runs `CREATE TABLE IF NOT EXISTS ...` for all six tables.
4. **`src/app/page.tsx`** — now `dynamic = "force-dynamic"` and serves the fixture envelope by default. The old static build downloaded the 19 MB Sleeper player catalog at build time and triggered Vercel's 2 MB data-cache cap.
5. **`vercel.ts`** — typed config (`@vercel/config/v1`). Sets framework, install/build commands, per-function memory + maxDuration for the league-refresh and auth routes, and a no-cache header rule for `/api/*`.

## What is intentionally not wired up

- Cron-driven daily Sleeper players-catalog snapshot to Vercel Blob — planned PR 6.
- OAuth providers (Google) — Credentials only for now.
- Email magic-link — would need an SMTP provider; skipped this pass.

## Local development still works

```bash
cp .env.example .env.local
# Fill in AUTH_SECRET and CREDENTIAL_ENCRYPTION_KEY; leave DATABASE_URL blank to use SQLite.
npm install
npm run dev
```

Without `DATABASE_URL`, the app uses `file:.data/rae.sqlite` automatically. No Postgres required for local dev.
