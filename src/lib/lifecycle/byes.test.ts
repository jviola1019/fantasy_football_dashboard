import { describe, expect, it } from "vitest";
import { detectByeWeekRisks, recommendByeReplacements, BYE_WEEKS_2025 } from "./byes";
import type { PlayerMarketRecord } from "../governance";

function p(id: string, position: PlayerMarketRecord["position"], team: string, trueValue = 70): PlayerMarketRecord {
  return {
    id,
    name: id,
    position,
    team,
    perceivedValue: trueValue,
    trueValue,
    ownershipLeverage: 0,
    fragility: 0,
    narrativePressure: 0,
    volatility: 0,
    opportunity: 0,
    confidence: 0.5,
    sources: [],
    rosterSlot: position,
    status: "active",
    imageUrl: "https://example.com/x.png",
    imageSource: "test"
  };
}

describe("lifecycle/byes", () => {
  it("flags a position when half or more of its players share a bye", () => {
    const roster = [
      p("rb1", "RB", "ATL"), // bye week 5
      p("rb2", "RB", "GB"),  // bye week 5
      p("rb3", "RB", "BUF")  // bye week 7
    ];
    const alerts = detectByeWeekRisks(roster);
    const week5 = alerts.find((a) => a.position === "RB" && a.week === 5);
    expect(week5).toBeDefined();
    expect(week5!.affectedPlayers).toHaveLength(2);
    expect(week5!.stacked).toBe(true);
  });

  it("does not flag a position when only one of three is on bye", () => {
    const roster = [
      p("rb1", "RB", "ATL"), // bye 5
      p("rb2", "RB", "BUF"), // bye 7
      p("rb3", "RB", "DAL")  // bye 10
    ];
    const alerts = detectByeWeekRisks(roster);
    const rbAlerts = alerts.filter((a) => a.position === "RB");
    expect(rbAlerts).toHaveLength(0);
  });

  it("emits one alert per (position, week)", () => {
    const roster = [
      p("rb1", "RB", "ATL"),
      p("rb2", "RB", "GB"),
      p("wr1", "WR", "ATL"),
      p("wr2", "WR", "GB")
    ];
    const alerts = detectByeWeekRisks(roster);
    expect(alerts).toHaveLength(2);
    const positions = new Set(alerts.map((a) => a.position));
    expect(positions.has("RB")).toBe(true);
    expect(positions.has("WR")).toBe(true);
  });

  it("recommends free agents not on bye that week, sorted by trueValue", () => {
    const alert = {
      week: 5,
      position: "RB" as const,
      affectedPlayers: [p("rb1", "RB", "ATL")],
      stacked: false
    };
    const fas = [
      p("fa1", "RB", "BUF", 65), // not on bye in wk5 → eligible
      p("fa2", "RB", "GB", 80),  // ALSO bye wk5 → ineligible
      p("fa3", "RB", "DAL", 70)  // eligible
    ];
    const recs = recommendByeReplacements(alert, fas);
    expect(recs).toHaveLength(2);
    expect(recs[0]?.id).toBe("fa3");
    expect(recs[1]?.id).toBe("fa1");
  });

  it("the bye-week table covers all 32 NFL teams", () => {
    expect(Object.keys(BYE_WEEKS_2025).length).toBe(32);
  });
});
