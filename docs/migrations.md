# Migrations and rollback

RAE has **no `drizzle/` migration folder**. `drizzle-kit` is installed but never
invoked; schema application is hand-rolled and idempotent:

| Driver | How schema is applied | Entry point |
|---|---|---|
| SQLite (local, Playwright) | Automatically on every process boot | `applySqliteSchemaIfNeeded()` in [src/db/index.ts](../src/db/index.ts) |
| Postgres (production) | Explicitly, once, via an authenticated request | `POST /api/admin/init-db` executing `INIT_SQL` from [src/db/schema-pg.ts](../src/db/schema-pg.ts) |

Because there is no migration runner, **every schema change must be edited in
five places** and all five are enforced by drift guards
([schemaDrift.test.ts](../src/db/schemaDrift.test.ts), [schemaPg.test.ts](../src/db/schemaPg.test.ts)):

1. `src/db/schema.ts` — Drizzle SQLite table (the object all query call sites use)
2. `src/db/schema-pg.ts` — Drizzle Postgres table
3. `src/db/index.ts` → `applySqliteSchemaIfNeeded()` — prod/dev SQLite DDL
4. `src/db/index.ts` → `applyTestSchema()` — in-memory test DDL
5. `src/db/schema-pg.ts` → `INIT_SQL` — Postgres DDL

`INIT_SQL` is split on `;` by the init route, so **no statement may contain a
semicolon inside a string literal or function body**.

---

## Timestamps: never pass a JS `Date`

The app uses the **SQLite** schema objects for every query, on both drivers. That
is fine for text and integer columns but **not** for timestamps: the SQLite
column is `timestamp_ms`, so Drizzle maps a `Date` to epoch-milliseconds, and
postgres.js then rejects that number for a `TIMESTAMP` parameter:

```
TypeError: The "string" argument must be of type string or an instance of
Buffer or ArrayBuffer. Received type number (1786674616432)
```

Verified against PostgreSQL 17.11. Use `nowSql(db)` from
[src/db/index.ts](../src/db/index.ts), which emits `now()` on Postgres and
`(unixepoch() * 1000)` on SQLite. There is no portable literal — SQLite's
`CURRENT_TIMESTAMP` returns TEXT, which would not round-trip through an INTEGER
ms column.

---

## 2026-08-06 — notifications deduplication (audit F-003)

### What changed

Added to `notifications`: `dedupKey` (NOT NULL), `status`, `occurrences`,
`season`, `week`, `updatedAt` (NOT NULL), `resolvedAt`; a **unique** index
`notifications_user_dedup (userId, dedupKey)`; and a non-unique
`notifications_user_created (userId, createdAt)` (SQLite previously had **no**
index on this table at all).

### Ordering (important)

The unique index cannot be created before the backfill: pre-migration rows all
carry the `''` default and would collide. The migration therefore runs
`ADD COLUMN` → `UPDATE` backfill → `CREATE UNIQUE INDEX`, in that order, on both
drivers.

Legacy rows are keyed `legacy:<id>`, which preserves history verbatim, guarantees
uniqueness, and can never be mistaken for a live dedup key. Their status is
derived from `dismissedAt`.

### Applying

- **SQLite** — automatic on next boot. No action.
- **Postgres** — `POST /api/admin/init-db` with the `x-init-token` header. The
  statements are all `IF NOT EXISTS` / idempotent `UPDATE`s, so re-running is
  safe and is covered by a test.

### Rollback

Rolling back **loses deduplication but not history** — no rows are deleted.

```sql
-- Postgres
DROP INDEX IF EXISTS notifications_user_dedup;
ALTER TABLE notifications DROP COLUMN IF EXISTS "dedupKey";
ALTER TABLE notifications DROP COLUMN IF EXISTS status;
ALTER TABLE notifications DROP COLUMN IF EXISTS occurrences;
ALTER TABLE notifications DROP COLUMN IF EXISTS season;
ALTER TABLE notifications DROP COLUMN IF EXISTS week;
ALTER TABLE notifications DROP COLUMN IF EXISTS "updatedAt";
ALTER TABLE notifications DROP COLUMN IF EXISTS "resolvedAt";
```

```sql
-- SQLite (3.35+ supports DROP COLUMN; the index must go first)
DROP INDEX IF EXISTS notifications_user_dedup;
ALTER TABLE notifications DROP COLUMN dedupKey;
ALTER TABLE notifications DROP COLUMN status;
ALTER TABLE notifications DROP COLUMN occurrences;
ALTER TABLE notifications DROP COLUMN season;
ALTER TABLE notifications DROP COLUMN week;
ALTER TABLE notifications DROP COLUMN updatedAt;
ALTER TABLE notifications DROP COLUMN resolvedAt;
```

You must also revert the application code — `upsertNotification` requires
`dedupKey`. Rolling back the schema alone will fail at insert time.

Re-applying after a rollback is supported and tested.

### Interrupted migration

Every step is independently idempotent, so a migration killed part-way is
recovered by simply re-running it. The only ordering hazard is the unique index,
and it is created last: if the process dies before it exists, the backfill is
still correct and the next run creates it. If the process dies *during* the
backfill, some rows keep `dedupKey = ''`; the next run's `WHERE "dedupKey" = ''`
clause finishes the job before the index is attempted.

### Verification

Both drivers are covered by executed tests, not inspection:

- SQLite — [src/lib/lifecycle/notifications.test.ts](../src/lib/lifecycle/notifications.test.ts)
- **Real PostgreSQL** — [src/db/postgres.integration.test.ts](../src/db/postgres.integration.test.ts),
  gated on `RAE_PG_TEST_URL`. Covers column types, the unique index, migration
  idempotency, DB-level rejection of duplicates, concurrent upserts, timestamp
  round-tripping, the legacy-backfill upgrade path, and rollback + re-apply.

```bash
# Local, against a throwaway database
createdb rae_test
RAE_PG_TEST_URL=postgres://postgres:postgres@127.0.0.1:5432/rae_test \
  npx vitest run src/db/postgres.integration.test.ts
```

The suite drops and recreates the `public` schema. **Point it only at a
disposable database.**
