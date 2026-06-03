import { describe, it, expect } from "vitest";
import { surname, slug, fmt, fmtPct, gradeFromScore, trendingLabel } from "./utils";

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
