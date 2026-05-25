import { describe, it, expect } from "vitest";
import { buildKtcIndex, matchPmrToKtc } from "./match";
import type { KtcPlayer } from "./types";

function p(name: string, position: string, team: string | null, startSitValue: number, id = 0): KtcPlayer {
  return {
    playerName: name,
    playerID: id || Math.floor(Math.random() * 100000),
    position,
    team,
    oneQBValues: { startSitValue }
  } as KtcPlayer;
}

describe("buildKtcIndex", () => {
  it("indexes by name+pos+team, name+pos, and name; ties broken by descending startSitValue", () => {
    const players = [
      p("Justin Jefferson", "WR", "MIN", 9800),
      p("Justin Jefferson", "WR", "MIN", 9000), // lower value duplicate
      p("Test Player", "RB", "DAL", 4000)
    ];
    const idx = buildKtcIndex(players);
    // Higher-value Jefferson wins all three tiers.
    expect(idx.byNamePosTeam.get("justin jefferson|WR|MIN")?.oneQBValues.startSitValue).toBe(9800);
    expect(idx.byNamePos.get("justin jefferson|WR")?.oneQBValues.startSitValue).toBe(9800);
    expect(idx.byName.get("justin jefferson")?.oneQBValues.startSitValue).toBe(9800);
  });
});

describe("matchPmrToKtc", () => {
  const index = buildKtcIndex([
    p("Ja'Marr Chase", "WR", "CIN", 9900),
    p("Patrick Mahomes II", "QB", "KC", 9000),
    p("D.J. Moore", "WR", "CHI", 6000),
    p("Marquise Brown", "WR", "KC", 5000)
  ]);

  it("matches by name+pos+team (top tier)", () => {
    const m = matchPmrToKtc({ name: "Ja'Marr Chase", position: "WR", team: "CIN" }, index);
    expect(m?.matchedBy).toBe("name+pos+team");
    expect(m?.player.playerName).toBe("Ja'Marr Chase");
  });

  it("falls through to name+pos when team is missing", () => {
    const m = matchPmrToKtc({ name: "Ja'Marr Chase", position: "WR", team: null }, index);
    expect(m?.matchedBy).toBe("name+pos");
    expect(m?.player.playerName).toBe("Ja'Marr Chase");
  });

  it("falls through to name-only when position is missing", () => {
    const m = matchPmrToKtc({ name: "Ja'Marr Chase" }, index);
    expect(m?.matchedBy).toBe("name");
    expect(m?.player.playerName).toBe("Ja'Marr Chase");
  });

  it("normalizes suffixes (Patrick Mahomes II == Patrick Mahomes)", () => {
    const m = matchPmrToKtc({ name: "Patrick Mahomes", position: "QB", team: "KC" }, index);
    expect(m?.matchedBy).toBe("name+pos+team");
    expect(m?.player.playerName).toBe("Patrick Mahomes II");
  });

  it("normalizes punctuation (D.J. Moore matches DJ Moore)", () => {
    const m = matchPmrToKtc({ name: "DJ Moore", position: "WR", team: "CHI" }, index);
    expect(m?.matchedBy).toBe("name+pos+team");
    expect(m?.player.playerName).toBe("D.J. Moore");
  });

  it("maps PMR's DEF position to KTC's DST", () => {
    const idx = buildKtcIndex([p("Cowboys", "DST", "DAL", 1500)]);
    const m = matchPmrToKtc({ name: "Cowboys", position: "DEF", team: "DAL" }, idx);
    expect(m?.matchedBy).toBe("name+pos+team");
  });

  it("returns null when no tier hits (deep bench player)", () => {
    const m = matchPmrToKtc({ name: "Some Unknown FA", position: "WR" }, index);
    expect(m).toBeNull();
  });

  it("returns null on empty name", () => {
    const m = matchPmrToKtc({ name: "" }, index);
    expect(m).toBeNull();
  });
});
