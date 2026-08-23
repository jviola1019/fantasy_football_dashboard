import { describe, it, expect } from "vitest";
import { parseFantasyCalc, buildFantasyCalcUrl, parseDynastyProcessCsv } from "./values";
import { DEFAULT_FORMAT } from "./format";

const SAMPLE = [
  {
    player: { name: "Jahmyr Gibbs", position: "RB", maybeTeam: "DET", sleeperId: "9493", espnId: 4429795 },
    value: 10399, redraftValue: 10399, overallRank: 2, positionRank: 1, trend30Day: 120
  },
  {
    player: { name: "Caleb Williams", position: "QB", maybeTeam: "CHI", sleeperId: "11560", espnId: 4431611 },
    value: 3100, redraftValue: 3100, overallRank: 70, positionRank: 14, trend30Day: -40
  }
];

describe("buildFantasyCalcUrl", () => {
  it("encodes format params", () => {
    const url = buildFantasyCalcUrl({ ...DEFAULT_FORMAT, ppr: 0.5, numQbs: 2, numTeams: 10 });
    expect(url).toBe(
      "https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=2&numTeams=10&ppr=0.5"
    );
  });
});

describe("parseFantasyCalc", () => {
  it("maps entries into a sleeperId-keyed PlayerValue map", () => {
    const map = parseFantasyCalc(SAMPLE, "redraft");
    const gibbs = map.get("9493");
    expect(gibbs?.value).toBe(10399);
    expect(gibbs?.position).toBe("RB");
    expect(map.get("11560")?.value).toBe(3100);
  });

  it("throws on a malformed payload", () => {
    expect(() => parseFantasyCalc([{ player: {} }], "redraft")).toThrow();
  });

  it("skips a dynasty entry with no dynasty figure rather than substituting redraft", () => {
    // Omitting a player is honest; pricing a dynasty asset off this season
    // alone is a wrong number wearing the right label.
    const noValue = [
      {
        player: { name: "No Value", position: "WR", maybeTeam: "KC", sleeperId: "77", espnId: 1 },
        value: null,
        redraftValue: 4200,
        overallRank: 9,
        positionRank: 4,
        trend30Day: 0
      }
    ];
    expect(parseFantasyCalc(noValue, "dynasty").has("77")).toBe(false);
    // A redraft league CAN honestly fall back — same horizon, canonical format.
    expect(parseFantasyCalc(noValue, "redraft").get("77")?.value).toBe(4200);
  });
});

describe("parseDynastyProcessCsv", () => {
  const CSV = [
    "player,pos,team,age,ecr_1qb,ecr_2qb,ecr_pos,value_1qb,value_2qb,fp_id,scrape_date",
    "Jahmyr Gibbs,RB,DET,23,2,4,1,9800,9200,24189,2026-05-19",
    "Caleb Williams,QB,CHI,24,80,30,15,1200,4800,23090,2026-05-19"
  ].join("\n");

  it("selects value_1qb for a 1QB format", () => {
    const map = parseDynastyProcessCsv(CSV, { ...DEFAULT_FORMAT, ppr: 1, numQbs: 1, numTeams: 12 });
    expect(map.get("rb-jahmyr gibbs")?.value).toBe(9800);
  });

  it("selects value_2qb for a superflex format", () => {
    const map = parseDynastyProcessCsv(CSV, { ...DEFAULT_FORMAT, ppr: 1, numQbs: 2, numTeams: 12 });
    expect(map.get("qb-caleb williams")?.value).toBe(4800);
  });
});
