import { describe, expect, it } from "vitest";
import { coreSchemaDdl, coreSchemaSkipped } from "./ensureCoreSchema";
import { INIT_SQL } from "./schema-pg";

/**
 * The DDL/DML split is the whole safety argument for running this
 * automatically. These tests are that argument, executable.
 */
describe("coreSchemaDdl selects only structure", () => {
  it("includes the tables whose absence broke production", () => {
    const ddl = coreSchemaDdl().join("\n");
    // `accountCredentials` missing meant the ESPN sign-in could store nothing;
    // `auth_attempts` missing meant `checkThrottle` threw on every sign-in.
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS "accountCredentials"/);
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS auth_attempts/);
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS users/);
  });

  it("EXCLUDES the destructive notification backfill", () => {
    // THE LOAD-BEARING TEST. `INIT_SQL` ends with:
    //
    //   UPDATE notifications SET status = CASE ... END
    //    WHERE status IS NULL OR status = 'new'
    //
    // `'new'` is a LIVE state — schema.ts defines it as "just created, never
    // listed to the user". Replaying that on every cold start would silently
    // promote every unseen notification to 'active' and destroy the
    // distinction the lifecycle depends on. Auto-running INIT_SQL wholesale
    // would have been a data-corruption bug, not a convenience.
    expect(coreSchemaDdl().join("\n")).not.toMatch(/UPDATE notifications/i);
    // Checked on the LEADING VERB, not as a substring: `ON DELETE CASCADE` is
    // a legitimate part of a CREATE TABLE and an earlier version of this test
    // failed on exactly that. The question is what a statement DOES, not what
    // it mentions.
    const verbOf = (stmt: string) => (stmt.trim().split(/\s+/)[0] ?? "").toUpperCase();
    const verbs = new Set(coreSchemaDdl().map(verbOf));
    expect([...verbs].sort()).toEqual(["ALTER", "CREATE"]);
    for (const bad of ["UPDATE", "DELETE", "DROP", "INSERT", "TRUNCATE"]) {
      expect(verbs.has(bad), `a ${bad} statement would run on every boot`).toBe(false);
    }
  });

  it("routes those backfills to the skipped list rather than losing them", () => {
    // They are not wrong, only one-time. They stay in the manual init route.
    const skipped = coreSchemaSkipped();
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.join("\n")).toMatch(/UPDATE notifications/);
  });

  it("accounts for every statement in INIT_SQL — nothing silently vanishes", () => {
    const total = INIT_SQL.split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0).length;
    expect(coreSchemaDdl().length + coreSchemaSkipped().length).toBe(total);
  });

  it("applies only statements that are safe to repeat", () => {
    // Every selected statement must carry IF NOT EXISTS, because this runs on
    // every cold start. A CREATE without it would throw on the second boot.
    const offenders = coreSchemaDdl().filter((s) => !/IF NOT EXISTS/i.test(s));
    expect(
      offenders.map((s) => s.slice(0, 80)),
      "these run on every boot but are not conditional"
    ).toEqual([]);
  });

  it("has enough statements to be doing real work", () => {
    expect(coreSchemaDdl().length).toBeGreaterThan(8);
  });
});
