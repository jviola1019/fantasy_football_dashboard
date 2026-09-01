import { describe, it, expect } from "vitest";
import { surname, slug, fmt, fmtPct, gradeFromScore, trendingLabel, relativeAge } from "./utils";

describe("surname", () => {
  it("returns the family name, never a generational suffix", () => {
    expect(surname("Marvin Harrison Jr.")).toBe("Harrison");
    expect(surname("Michael Pittman Jr.")).toBe("Pittman");
    expect(surname("Kenneth Walker III")).toBe("Walker");
    expect(surname("Odell Beckham Jr")).toBe("Beckham");
    expect(surname("Robert Griffin III")).toBe("Griffin");
    expect(surname("A.J. Brown")).toBe("Brown");
  });

  it("handles plain two-token and single-token names", () => {
    expect(surname("Justin Jefferson")).toBe("Jefferson");
    expect(surname("Ja'Marr Chase")).toBe("Chase");
    expect(surname("CeeDee")).toBe("CeeDee");
  });

  it("is suffix-case-insensitive and tolerates extra whitespace", () => {
    expect(surname("Cam Akers  SR")).toBe("Akers");
    expect(surname("  Travis  Kelce  ")).toBe("Kelce");
  });

  it("falls back to the input when every token is a suffix", () => {
    expect(surname("Jr.")).toBe("Jr.");
  });
});

describe("formatting helpers", () => {
  it("slug lowercases and hyphenates", () => {
    expect(slug("Market Intelligence")).toBe("market-intelligence");
  });

  it("fmt and fmtPct guard non-finite values with an em dash", () => {
    expect(fmt(3.14159, 2)).toBe("3.14");
    expect(fmt(Number.NaN)).toBe("—");
    expect(fmtPct(12.34)).toBe("12.3%");
    expect(fmtPct(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("gradeFromScore and trendingLabel bucket as documented", () => {
    expect(gradeFromScore(20)).toBe("A+");
    expect(gradeFromScore(0)).toBe("B");
    expect(gradeFromScore(-20)).toBe("D");
    expect(trendingLabel(60)).toBe("Very Positive");
    expect(trendingLabel(0)).toBe("Neutral");
    expect(trendingLabel(-60)).toBe("Very Negative");
  });
});

// ---------------------------------------------------------------------------
// relativeAge (S4) — the age of an ESPN headline, stated against the envelope
// ---------------------------------------------------------------------------

describe("relativeAge", () => {
  const now = "2026-09-01T12:00:00.000Z";
  const ago = (ms: number) => new Date(Date.parse(now) - ms).toISOString();

  it("counts minutes, hours and days", () => {
    expect(relativeAge(ago(5 * 60_000), now)).toBe("5m ago");
    expect(relativeAge(ago(59 * 60_000), now)).toBe("59m ago");
    expect(relativeAge(ago(3 * 3_600_000), now)).toBe("3h ago");
    expect(relativeAge(ago(23 * 3_600_000), now)).toBe("23h ago");
    expect(relativeAge(ago(2 * 86_400_000), now)).toBe("2d ago");
  });

  it("crosses each boundary in the right direction", () => {
    // 60 minutes is an hour, not "60m ago"; 24 hours is a day.
    expect(relativeAge(ago(60 * 60_000), now)).toBe("1h ago");
    expect(relativeAge(ago(24 * 3_600_000), now)).toBe("1d ago");
  });

  it("treats a future timestamp as just now, not as news from the future", () => {
    // A few minutes of clock skew between ESPN and this host is normal.
    expect(relativeAge(ago(-90_000), now)).toBe("just now");
    expect(relativeAge(now, now)).toBe("just now");
  });

  it("returns null rather than 'NaN ago' for an unparseable input", () => {
    expect(relativeAge("not-a-date", now)).toBeNull();
    expect(relativeAge(now, "not-a-date")).toBeNull();
  });

  it("takes BOTH ends explicitly, so a render is deterministic", () => {
    // The whole point of the second argument: a one-argument version calling
    // Date.now() internally yields a different string on the server than on the
    // client milliseconds later, and React reports a hydration mismatch.
    const a = relativeAge(ago(3 * 3_600_000), now);
    const b = relativeAge(ago(3 * 3_600_000), now);
    expect(a).toBe(b);
  });
});
