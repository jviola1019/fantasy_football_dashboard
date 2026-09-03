import { describe, expect, it } from "vitest";
import { formatCredentialAge } from "./credentialAge";

const NOW = new Date("2026-09-02T20:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatCredentialAge", () => {
  it("returns null when nothing is stored, so the caller renders the empty state", () => {
    expect(formatCredentialAge(null, NOW)).toBeNull();
  });

  it("counts up through the units", () => {
    expect(formatCredentialAge(ago(30 * 1000), NOW)).toBe("just now");
    expect(formatCredentialAge(ago(1 * MINUTE), NOW)).toBe("1 minute ago");
    expect(formatCredentialAge(ago(5 * MINUTE), NOW)).toBe("5 minutes ago");
    expect(formatCredentialAge(ago(1 * HOUR), NOW)).toBe("1 hour ago");
    expect(formatCredentialAge(ago(23 * HOUR), NOW)).toBe("23 hours ago");
    expect(formatCredentialAge(ago(1 * DAY), NOW)).toBe("1 day ago");
    expect(formatCredentialAge(ago(94 * DAY), NOW)).toBe("94 days ago");
  });

  it("does not report a negative age when the clock skews", () => {
    // The app server and the database do not share a clock. A row written
    // "two seconds from now" must read as recent, not as "in -1 minutes".
    expect(formatCredentialAge(new Date(NOW.getTime() + 2000), NOW)).toBe("just now");
    expect(formatCredentialAge(new Date(NOW.getTime() + 5 * MINUTE), NOW)).toBe("just now");
  });

  it("does not round an hour down into minutes at the boundary", () => {
    expect(formatCredentialAge(ago(59 * MINUTE), NOW)).toBe("59 minutes ago");
    expect(formatCredentialAge(ago(60 * MINUTE), NOW)).toBe("1 hour ago");
    expect(formatCredentialAge(ago(24 * HOUR - 1), NOW)).toBe("23 hours ago");
    expect(formatCredentialAge(ago(24 * HOUR), NOW)).toBe("1 day ago");
  });

  it("is a pure function of its arguments", () => {
    // The guard that keeps a later edit from reading the clock inside: the same
    // inputs must give the same answer, which is what makes this testable at all.
    const fixed = ago(3 * DAY);
    expect(formatCredentialAge(fixed, NOW)).toBe(formatCredentialAge(fixed, NOW));
    expect(formatCredentialAge(fixed, new Date(NOW.getTime() + DAY))).toBe("4 days ago");
  });
});
