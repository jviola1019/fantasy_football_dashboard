import { describe, expect, it } from "vitest";
import { TEAM_ABBR_ALIASES, normalizeTeamAbbr } from "./teamAbbr";

describe("normalizeTeamAbbr", () => {
  it("maps the relocation that actually broke a join", () => {
    // 2017 Raiders: `stats_team_week` says LV, `games.csv` says OAK. Joining
    // raw dropped ~48 team-weeks across 2017–2019.
    expect(normalizeTeamAbbr("OAK")).toBe("LV");
  });

  it("maps the other relocations", () => {
    expect(normalizeTeamAbbr("SD")).toBe("LAC");
    expect(normalizeTeamAbbr("STL")).toBe("LAR");
    expect(normalizeTeamAbbr("WSH")).toBe("WAS");
  });

  it("leaves a current abbreviation alone", () => {
    for (const abbr of ["KC", "BUF", "LV", "LAC", "LAR", "WAS", "SF", "NE"]) {
      expect(normalizeTeamAbbr(abbr)).toBe(abbr);
    }
  });

  it("is idempotent, so double-normalising cannot corrupt a key", () => {
    for (const abbr of [...Object.keys(TEAM_ABBR_ALIASES), "KC", "NYG"]) {
      const once = normalizeTeamAbbr(abbr);
      expect(normalizeTeamAbbr(once)).toBe(once);
    }
  });

  it("upper-cases and trims, so whitespace cannot fail a join silently", () => {
    expect(normalizeTeamAbbr(" oak ")).toBe("LV");
    expect(normalizeTeamAbbr("kc")).toBe("KC");
  });

  it("returns empty string for missing input rather than throwing", () => {
    expect(normalizeTeamAbbr(undefined)).toBe("");
    expect(normalizeTeamAbbr(null)).toBe("");
    expect(normalizeTeamAbbr("")).toBe("");
  });

  it("never maps two distinct current teams onto one another", () => {
    // The hazard of an over-eager alias table: merging franchises that were
    // never the same. Every target must be a real current abbreviation, and no
    // current abbreviation may be a KEY.
    const targets = new Set(Object.values(TEAM_ABBR_ALIASES));
    for (const key of Object.keys(TEAM_ABBR_ALIASES)) {
      expect(targets.has(key), `${key} is both an alias and a target`).toBe(false);
    }
  });
});
