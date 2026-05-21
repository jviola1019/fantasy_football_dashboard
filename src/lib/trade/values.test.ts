import { describe, it, expect } from "vitest";
import { parseFantasyCalc, buildFantasyCalcUrl, parseDynastyProcessCsv } from "./values";

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
    const url = buildFantasyCalcUrl({ ppr: 0.5, numQbs: 2, numTeams: 10 });
    expect(url).toBe(
      "https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=2&numTeams=10&ppr=0.5"
    );
  });
});

describe("parseFantasyCalc", () => {
  it("maps entries into a sleeperId-keyed PlayerValue map", () => {
    const map = parseFantasyCalc(SAMPLE);
    const gibbs = map.get("9493");
    expect(gibbs?.value).toBe(10399);
    expect(gibbs?.position).toBe("RB");
    expect(map.get("11560")?.value).toBe(3100);
  });

  it("throws on a malformed payload", () => {
    expect(() => parseFantasyCalc([{ player: {} }])).toThrow();
  });
});

describe("parseDynastyProcessCsv", () => {
  const CSV = [
    "player,pos,team,age,ecr_1qb,ecr_2qb,ecr_pos,value_1qb,value_2qb,fp_id,scrape_date",
    "Jahmyr Gibbs,RB,DET,23,2,4,1,9800,9200,24189,2026-05-19",
    "Caleb Williams,QB,CHI,24,80,30,15,1200,4800,23090,2026-05-19"
  ].join("\n");

  it("selects value_1qb for a 1QB format", () => {
    const map = parseDynastyProcessCsv(CSV, { ppr: 1, numQbs: 1, numTeams: 12 });
    expect(map.get("rb-jahmyr gibbs")?.value).toBe(9800);
  });

  it("selects value_2qb for a superflex format", () => {
    const map = parseDynastyProcessCsv(CSV, { ppr: 1, numQbs: 2, numTeams: 12 });
    expect(map.get("qb-caleb williams")?.value).toBe(4800);
  });
});
