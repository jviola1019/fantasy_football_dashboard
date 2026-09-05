import { describe, expect, it } from "vitest";
import { isMissingRelation, readOrUninitialised } from "./missingRelation";
import { resetDbForTests } from "./index";
import { sql } from "drizzle-orm";

describe("isMissingRelation recognises only a missing table", () => {
  it("matches the Postgres error code", () => {
    expect(isMissingRelation(Object.assign(new Error("boom"), { code: "42P01" }))).toBe(true);
  });

  it("matches the Postgres and SQLite messages", () => {
    expect(isMissingRelation(new Error('relation "accountCredentials" does not exist'))).toBe(true);
    expect(isMissingRelation(new Error("SQLITE_ERROR: no such table: accountCredentials"))).toBe(true);
  });

  it("matches through a WRAPPED driver error — found by schemaProbe", () => {
    // Drizzle wraps driver errors in its own error whose message is generic;
    // the real text is on `.cause`. Checking only the top level returned false
    // for a genuinely missing table on the `db.run` path while returning true
    // on `db.all` — a guard that worked in one test and would not have worked
    // in production.
    const inner = Object.assign(new Error("no such table: accountCredentials"), {
      code: "SQLITE_ERROR"
    });
    const wrapped = new Error("Failed query: select 1", { cause: inner });
    expect(isMissingRelation(wrapped)).toBe(true);
    // Two levels deep, and a Postgres code carried on the cause.
    expect(
      isMissingRelation(new Error("outer", { cause: new Error("mid", { cause: inner }) }))
    ).toBe(true);
    expect(
      isMissingRelation(
        new Error("wrapper", { cause: Object.assign(new Error("x"), { code: "42P01" }) })
      )
    ).toBe(true);
  });

  it("does not loop forever on a self-referential cause", () => {
    const a = new Error("connection refused") as Error & { cause?: unknown };
    a.cause = a;
    expect(isMissingRelation(a)).toBe(false);
  });

  it("does NOT match any other database failure", () => {
    // The whole safety of this helper rests on this list. A connection refusal
    // read as "not initialised yet" would render a calm, false "nothing saved".
    for (const message of [
      "connection refused",
      "password authentication failed for user",
      "permission denied for table accountCredentials",
      'duplicate key value violates unique constraint "accountCredentials_pkey"',
      "column iv does not exist",
      "canceling statement due to statement timeout"
    ]) {
      expect(isMissingRelation(new Error(message)), message).toBe(false);
    }
    expect(isMissingRelation(Object.assign(new Error("x"), { code: "42501" }))).toBe(false);
    expect(isMissingRelation(null)).toBe(false);
    expect(isMissingRelation("42P01")).toBe(false);
  });
});

describe("readOrUninitialised", () => {
  it("returns the fallback when the table is missing", async () => {
    const out = await readOrUninitialised(async () => {
      throw new Error("no such table: accountCredentials");
    }, "fallback");
    expect(out).toBe("fallback");
  });

  it("rethrows anything else, stack intact", async () => {
    const original = new Error("connection refused");
    await expect(
      readOrUninitialised(async () => {
        throw original;
      }, "fallback")
    ).rejects.toBe(original);
  });

  it("passes a successful read straight through", async () => {
    expect(await readOrUninitialised(async () => 42, 0)).toBe(42);
  });

  it("recognises what the REAL driver throws for a dropped table", async () => {
    // The canary. Hand-written message fixtures prove only that the regex
    // matches what I imagined the driver says. This drops a table that really
    // exists and reads it, so the assertion is against a genuine driver error.
    const db = resetDbForTests();
    await db.run(sql`DROP TABLE "accountCredentials"`);
    let caught: unknown = null;
    try {
      await db.all(sql`SELECT * FROM "accountCredentials"`);
    } catch (err) {
      caught = err;
    }
    expect(caught, "expected the dropped table to make the driver throw").not.toBeNull();
    expect(isMissingRelation(caught)).toBe(true);
  });
});
