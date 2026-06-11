import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { applySqliteSchemaIfNeeded, applyTestSchema } from "./index";
import * as sqliteSchema from "./schema";

/**
 * Drift guard for the three hand-maintained SQLite DDL copies. The prod path
 * (`applySqliteSchemaIfNeeded`) and the in-memory test path (`applyTestSchema`)
 * are kept in sync by hand; this test fails loudly the moment a table or column
 * is added to one and not the other (the exact gap that caused the Sprint-3
 * "no such table" drift on the snapshot tables).
 *
 * Compares structure (table names + per-column name/type/notnull/pk) rather than
 * raw DDL text, so formatting/whitespace differences don't cause false failures.
 */

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

function structure(db: Database.Database): Record<string, ColumnInfo[]> {
  const tables = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>
  ).map((r) => r.name);

  const out: Record<string, ColumnInfo[]> = {};
  for (const table of tables) {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>)
      .map((c) => ({ name: c.name, type: c.type.toUpperCase(), notnull: c.notnull, pk: c.pk }))
      .sort((a, b) => a.name.localeCompare(b.name));
    out[table] = cols;
  }
  return out;
}

describe("SQLite schema drift guard", () => {
  it("prod DDL (applySqliteSchemaIfNeeded) matches test DDL (applyTestSchema) table-for-table and column-for-column", () => {
    const prodDb = new Database(":memory:");
    const testDb = new Database(":memory:");
    try {
      applySqliteSchemaIfNeeded(prodDb);
      applyTestSchema(testDb);

      const prod = structure(prodDb);
      const test = structure(testDb);

      // Same set of tables.
      expect(Object.keys(test).sort()).toEqual(Object.keys(prod).sort());
      // Same columns per table.
      for (const table of Object.keys(prod)) {
        expect(test[table], `table ${table} missing in test schema`).toBeDefined();
        expect(test[table], `column drift in table ${table}`).toEqual(prod[table]);
      }
    } finally {
      prodDb.close();
      testDb.close();
    }
  });

  // SQLite mirror of the Postgres "M4 guard" (schemaPg.test.ts asserts INIT_SQL
  // covers every pgTable). The DDL-vs-DDL comparison above can't catch a table
  // missing from BOTH hand-maintained copies — which is exactly how
  // opportunity_snapshots shipped in schema.ts but never got created on SQLite.
  it("prod DDL creates every table declared in the canonical Drizzle schema", () => {
    const declared = Object.values(sqliteSchema as Record<string, unknown>)
      .filter((v): v is SQLiteTable => is(v, SQLiteTable))
      .map((t) => getTableName(t))
      .sort();
    expect(declared.length).toBeGreaterThan(0);

    const db = new Database(":memory:");
    try {
      applySqliteSchemaIfNeeded(db);
      const created = new Set(
        (
          db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            .all() as Array<{ name: string }>
        ).map((r) => r.name)
      );
      const missing = declared.filter((t) => !created.has(t));
      expect(missing, `tables declared in schema.ts but absent from the SQLite DDL: ${missing.join(", ")}`).toEqual([]);
    } finally {
      db.close();
    }
  });
});
