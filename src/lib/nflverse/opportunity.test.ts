import { describe, expect, it } from "vitest";
import {
  normalizeOppName,
  parseSnapCounts,
  computeOpportunityScores,
  OpportunityMapSchema
} from "./opportunity";

const CSV = [
  "season,game_type,week,player,position,team,opponent,offense_snaps,offense_pct,defense_snaps,defense_pct,st_snaps,st_pct",
  "2025,REG,1,Bijan Robinson,RB,ATL,CAR,55,0.80,0,0,2,0.1",
  "2025,REG,2,Bijan Robinson,RB,ATL,PHI,60,0.90,0,0,2,0.1",
  "2025,REG,1,Deep Backup,RB,ATL,CAR,5,0.08,0,0,1,0.05",
  "2025,REG,1,A.J. Brown Jr.,WR,PHI,GB,60,0.95,0,0,0,0",
  "2025,POST,1,Bijan Robinson,RB,ATL,XXX,60,1.0,0,0,0,0", // postseason — ignored
  "2025,REG,1,Some Lineman,T,NO,ARI,75,1,0,0,5,0.19" // non-fantasy position — ignored
].join("\n");

describe("normalizeOppName", () => {
  it("lowercases, strips suffixes + punctuation for cross-source joins", () => {
    expect(normalizeOppName("A.J. Brown Jr.")).toBe("ajbrown");
    expect(normalizeOppName("Patrick Mahomes II")).toBe("patrickmahomes");
    expect(normalizeOppName("D'Andre Swift")).toBe("dandreswift");
  });
});

describe("parseSnapCounts", () => {
  it("keeps only regular-season, fantasy-position rows", () => {
    const rows = parseSnapCounts(CSV);
    // Bijan x2 (REG), Deep Backup x1, A.J. Brown x1 = 4; POST + T dropped.
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => ["QB", "RB", "WR", "TE"].includes(r.position))).toBe(true);
    expect(rows.some((r) => r.player.includes("Lineman"))).toBe(false);
  });

  it("returns [] on empty or headerless input", () => {
    expect(parseSnapCounts("")).toEqual([]);
    expect(parseSnapCounts("only,a,header,row")).toEqual([]);
  });
});

describe("computeOpportunityScores", () => {
  it("recency-weights snap share into a 0-100 score and validates as a map", () => {
    const scores = computeOpportunityScores(parseSnapCounts(CSV));
    const bijan = scores[normalizeOppName("Bijan Robinson")]!;
    // weeks 1 (0.80) & 2 (0.90), recency-weighted: (1*0.8 + 2*0.9)/(1+2) = 0.867 → 87
    expect(bijan.score).toBe(87);
    expect(bijan.games).toBe(2);
    expect(bijan.position).toBe("RB");
    // A deep backup scores low; a feature WR scores high.
    expect(scores[normalizeOppName("Deep Backup")]!.score).toBe(8);
    expect(scores[normalizeOppName("A.J. Brown")]!.score).toBe(95);
    // The whole map satisfies the persisted schema.
    expect(() => OpportunityMapSchema.parse(scores)).not.toThrow();
  });

  it("is empty for empty input", () => {
    expect(computeOpportunityScores([])).toEqual({});
  });
});
