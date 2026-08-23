import { describe, expect, it } from "vitest";
import { redact, unwrap } from "./redact";

/**
 * `redact` is what stands between a driver error and a diagnostic response
 * body. It had **zero tests** (audit 2026-08-22, P3): the function whose entire
 * job is "do not leak the database password" was never asserted to do it.
 */
describe("redact", () => {
  it("removes a Postgres connection string, credentials and all", () => {
    const raw = "connect ECONNREFUSED postgres://rae:hunter2@db.internal:5432/rae_prod";
    const out = redact(raw);
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("db.internal");
    expect(out).toContain("postgres://[REDACTED]");
  });

  it("removes the postgresql:// spelling too", () => {
    expect(redact("postgresql://u:p@h/db")).toBe("postgres://[REDACTED]");
  });

  it("removes a bare password= pair", () => {
    expect(redact("auth failed password=s3cr3t for user rae")).not.toContain("s3cr3t");
  });

  it("is case-insensitive on both patterns", () => {
    expect(redact("POSTGRES://U:P@H/DB")).not.toContain("U:P");
    expect(redact("PASSWORD=Secret")).not.toContain("Secret");
  });

  it("redacts EVERY occurrence, not just the first", () => {
    // A replace without the /g flag would leave the second one intact.
    const out = redact("postgres://a:1@h/x and postgres://b:2@h/y");
    expect(out).not.toContain("a:1");
    expect(out).not.toContain("b:2");
  });

  it("truncates so one huge driver error cannot flood the response", () => {
    expect(redact("x".repeat(5000)).length).toBe(400);
    expect(redact("x".repeat(5000), 50).length).toBe(50);
  });

  it("redacts BEFORE truncating, so a secret cannot survive by being far along", () => {
    const raw = "pad ".repeat(50) + "postgres://rae:hunter2@db/x";
    expect(redact(raw, 10000)).not.toContain("hunter2");
  });

  it("leaves an innocuous message intact", () => {
    expect(redact("ECONNRESET reading from upstream")).toBe("ECONNRESET reading from upstream");
  });
});

describe("unwrap", () => {
  it("returns the value itself when there is no cause", () => {
    const err = new Error("boom");
    expect(unwrap(err)).toBe(err);
  });

  it("walks to the root cause", () => {
    const root = new Error("ECONNREFUSED");
    const mid = new Error("query failed", { cause: root });
    const top = new Error("request failed", { cause: mid });
    expect(unwrap(top)).toBe(root);
  });

  it("stops at five hops so a deep chain cannot stall the handler", () => {
    let err = new Error("level-0");
    for (let i = 1; i <= 10; i += 1) err = new Error("level-" + i, { cause: err });
    // From level-10, five hops reaches level-5.
    expect((unwrap(err) as Error).message).toBe("level-5");
  });

  it("survives a self-referential cause instead of looping forever", () => {
    const err = new Error("loop") as Error & { cause?: unknown };
    err.cause = err;
    expect(unwrap(err)).toBe(err);
  });

  it("survives a two-node cycle", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b") as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(() => unwrap(a)).not.toThrow();
  });

  it("handles non-Error values without throwing", () => {
    expect(unwrap("a string")).toBe("a string");
    expect(unwrap(null)).toBe(null);
    expect(unwrap(undefined)).toBe(undefined);
    expect(unwrap({ cause: { cause: "deep" } })).toBe("deep");
  });
});
