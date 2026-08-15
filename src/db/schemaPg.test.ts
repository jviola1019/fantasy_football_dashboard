import { describe, expect, it } from "vitest";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as pg from "./schema-pg";
import { INIT_SQL } from "./schema-pg";

/**
 * Enumerated from the module, NOT hand-listed.
 *
 * Audit 2026-08-06: this was a hardcoded array, so the guard only checked the
 * tables someone remembered to add to it. It was already missing
 * opportunitySnapshots — the very gap an earlier audit found in the hand-written
 * DDL — which means the guard silently passed while the bug it exists to catch
 * was present. A guard you have to maintain by hand is not a guard.
 */
const ALL_PG_TABLES: PgTable[] = Object.values(pg).filter((v) => is(v, PgTable)) as PgTable[];

describe("INIT_SQL coverage (M4 guard)", () => {
  it("creates every pgTable defined in schema-pg", () => {
    for (const table of ALL_PG_TABLES) {
      const name = getTableName(table);
      // INIT_SQL quotes mixed-case identifiers; accept quoted or unquoted.
      const re = new RegExp(`CREATE TABLE IF NOT EXISTS "?${name}"?`);
      expect(INIT_SQL, `INIT_SQL is missing CREATE TABLE for ${name}`).toMatch(re);
    }
  });

  it("creates the source/fetchedAt index for every snapshot table", () => {
    for (const table of ALL_PG_TABLES) {
      const name = getTableName(table);
      if (!name.endsWith("_snapshots")) continue;
      const re = new RegExp(`CREATE INDEX IF NOT EXISTS ${name}_source_fetched`);
      expect(INIT_SQL, `INIT_SQL is missing the index for ${name}`).toMatch(re);
    }
  });
});
