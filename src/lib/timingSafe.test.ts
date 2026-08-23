import { describe, expect, it } from "vitest";
import { safeEqual } from "./timingSafe";

/**
 * `safeEqual` guards every cron route's Bearer token and the database init
 * token. It had **zero tests** (audit 2026-08-22, P3) -- the single most
 * load-bearing comparison in the app was covered by nothing.
 *
 * These pin behaviour, not timing. A timing assertion in a JS test runner
 * measures the scheduler, not the comparison, and would be exactly the kind of
 * green check that isn't checking that this audit keeps finding. What CAN be
 * pinned is that the function is correct, that it never throws on the inputs an
 * unauthenticated caller controls, and that it is not quietly reduced to `===`.
 */
describe("safeEqual", () => {
  it("accepts identical strings", () => {
    expect(safeEqual("s3cret-token", "s3cret-token")).toBe(true);
  });

  it("rejects a value differing only in the LAST byte", () => {
    expect(safeEqual("s3cret-token", "s3cret-tokeN")).toBe(false);
  });

  it("rejects a value differing only in the FIRST byte", () => {
    // The case a short-circuiting compare leaks first.
    expect(safeEqual("s3cret-token", "S3cret-token")).toBe(false);
  });

  it("rejects a prefix and a superstring rather than throwing", () => {
    // `timingSafeEqual` THROWS on unequal-length buffers. The length guard is
    // what keeps an attacker-supplied header from turning into a 500.
    expect(safeEqual("s3cret", "s3cret-token")).toBe(false);
    expect(safeEqual("s3cret-token", "s3cret")).toBe(false);
  });

  it("handles empty strings on either side", () => {
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("", "x")).toBe(false);
    expect(safeEqual("x", "")).toBe(false);
  });

  it("compares BYTES, not code units", () => {
    // U+00E9 is two bytes in UTF-8. A length check on `.length` (code units)
    // would call these equal-length; Buffer.length does not.
    const eAcute = String.fromCharCode(0xe9);
    expect(safeEqual(eAcute, "e")).toBe(false);
    expect(safeEqual(eAcute, eAcute)).toBe(true);
  });

  it("does not throw on inputs an unauthenticated caller controls", () => {
    const loneSurrogate = String.fromCharCode(0xd800);
    const hostile = [" ", loneSurrogate, "x".repeat(10_000), "aaa"];
    for (const value of hostile) {
      expect(() => safeEqual("expected-token", value)).not.toThrow();
      expect(safeEqual("expected-token", value)).toBe(false);
    }
  });

  it("is not satisfied by a value that merely coerces equal", () => {
    // Guards against a future refactor to `==` or a loose comparison.
    expect(safeEqual("0", "")).toBe(false);
    expect(safeEqual("1", "true")).toBe(false);
  });
});
