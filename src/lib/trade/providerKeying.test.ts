import { describe, expect, it } from "vitest";
import {
  keyValuesBySleeperId,
  parseDynastyProcessCsv,
  type IdentifiablePlayer,
  type PlayerValue
} from "./values";
import { indexByEspnId, normalizeSleeperTrades } from "./transactions";
import type { LeagueFormat } from "./format";

/**
 * The value map's KEY has to be the thing the consumer looks up by.
 *
 * Audit 2026-08-24. `values.ts` has three valuation providers and had two keying
 * schemes: FantasyCalc carries Sleeper ids and is keyed by them; KeepTradeCut
 * and DynastyProcess publish names only and were keyed `position-name` with
 * `sleeperId`/`espnId` null.
 *
 * `normalizeSleeperTrades` looks up by SLEEPER id and `indexByEspnId` re-keys by
 * `espnId`, so on either fallback provider every lookup missed and every league
 * trade graded as though both sides were empty. Not a wrong number — an absent
 * one. `loadLeagueTrades` guards on `values.size === 0` and the map was not
 * empty, so the guard passed and grading proceeded on nothing.
 *
 * It survived because every test in `transactions.test.ts` builds the value map
 * by hand with Sleeper-id keys: correct for testing that consumer in isolation,
 * and it meant the provider→consumer boundary was never crossed by a test.
 * These tests cross it.
 */
const FORMAT_1QB = {
  scoringFormat: "PPR",
  numTeams: 12,
  numQbs: 1,
  leagueType: "redraft"
} as unknown as LeagueFormat;

const CHASE_SLEEPER_ID = "6794";

const catalog: IdentifiablePlayer[] = [
  { sleeperId: CHASE_SLEEPER_ID, espnId: "4362628", name: "Ja'Marr Chase", position: "WR", team: "CIN" },
  { sleeperId: "6790", espnId: "4047646", name: "A.J. Brown", position: "WR", team: "PHI" },
  { sleeperId: "8155", espnId: "4430807", name: "Kenneth Walker III", position: "RB", team: "SEA" }
];

const csvOf = (rows: string[]) =>
  ["player,pos,team,value_1qb,value_2qb", ...rows].join("\n");

const sleeperTrade = (playerId: string) =>
  [
    {
      type: "trade",
      status: "complete",
      created: 1_700_000_000_000,
      roster_ids: [1, 2],
      adds: { [playerId]: 1 },
      drops: {}
    }
  ] as never;

describe("keyValuesBySleeperId closes the provider/consumer gap", () => {
  it("lets a DynastyProcess value map grade a real Sleeper trade", () => {
    // The end-to-end assertion. Before this existed, sideA was empty.
    const parsed = parseDynastyProcessCsv(csvOf(["Ja'Marr Chase,WR,CIN,9000,9500"]), FORMAT_1QB);
    expect(parsed.size, "the provider parsed a player").toBe(1);

    const values = keyValuesBySleeperId(parsed, catalog);
    const graded = normalizeSleeperTrades(sleeperTrade(CHASE_SLEEPER_ID), values);

    expect(graded).toHaveLength(1);
    expect(graded[0]!.sideA).toHaveLength(1);
    expect(graded[0]!.sideA[0]!.value).toBe(9000);
  });

  it("populates the ids both consumers depend on", () => {
    const values = keyValuesBySleeperId(
      parseDynastyProcessCsv(csvOf(["Ja'Marr Chase,WR,CIN,9000,9500"]), FORMAT_1QB),
      catalog
    );
    const pv = values.get(CHASE_SLEEPER_ID) as PlayerValue;
    expect(pv.sleeperId).toBe(CHASE_SLEEPER_ID);
    expect(pv.espnId).toBe("4362628");
    expect(indexByEspnId(values).size, "the ESPN path re-keys by espnId").toBeGreaterThan(0);
  });

  it("matches across spelling differences between the two sources", () => {
    // 59 of 527 players in a cached FantasyPros snapshot (11.2%) have a name
    // whose normalised form differs from raw lowercase. Two sources spelling the
    // same player differently is the normal case, not the edge case.
    const values = keyValuesBySleeperId(
      parseDynastyProcessCsv(
        csvOf(["AJ Brown,WR,PHI,6000,6200", "Kenneth Walker,RB,SEA,4000,4100"]),
        FORMAT_1QB
      ),
      catalog
    );
    expect(values.get("6790")?.name, "AJ Brown ↔ A.J. Brown").toBe("AJ Brown");
    expect(values.get("8155")?.name, "Kenneth Walker ↔ Kenneth Walker III").toBe("Kenneth Walker");
  });

  it("matches on name+position when the team disagrees, but prefers the team hit", () => {
    // Teams change mid-season and the two sources update at different times.
    const values = keyValuesBySleeperId(
      parseDynastyProcessCsv(csvOf(["Ja'Marr Chase,WR,FA,9000,9500"]), FORMAT_1QB),
      catalog
    );
    expect(values.get(CHASE_SLEEPER_ID)?.value).toBe(9000);
  });

  it("keeps unmatched entries under their original key instead of dropping them", () => {
    // The trade pool is rendered by iterating .values(). Dropping unmatched
    // players would shrink a list that was working in order to fix a lookup that
    // was not.
    const parsed = parseDynastyProcessCsv(
      csvOf(["Ja'Marr Chase,WR,CIN,9000,9500", "Some Deep Bench Guy,WR,NYJ,12,13"]),
      FORMAT_1QB
    );
    const values = keyValuesBySleeperId(parsed, catalog);
    expect(values.size, "no player is lost").toBe(parsed.size);
    expect([...values.values()].some((p) => p.name === "Some Deep Bench Guy")).toBe(true);
  });

  it("never lets two catalog entries consume the same provider row", () => {
    // Two players who normalise identically would otherwise both claim the same
    // value, silently double-counting it across a trade.
    const twins: IdentifiablePlayer[] = [
      { sleeperId: "a1", name: "Mike Williams", position: "WR", team: "NYJ" },
      { sleeperId: "a2", name: "Mike Williams", position: "WR", team: "LAC" }
    ];
    const values = keyValuesBySleeperId(
      parseDynastyProcessCsv(csvOf(["Mike Williams,WR,LAC,3000,3100"]), FORMAT_1QB),
      twins
    );
    const withValue = [...values.values()].filter((p) => p.value === 3000);
    expect(withValue).toHaveLength(1);
  });

  it("matches defenses across DST / DEF spellings", () => {
    // KTC and FantasyPros write "DST"; Sleeper writes "DEF". Comparing raw
    // strings drops every defense to the name-only tier, where "Ravens" and
    // "Baltimore Ravens" may never meet. Found by reading ktc/match.ts — which
    // carries this exact mapping and was never wired up.
    const defense: IdentifiablePlayer[] = [
      { sleeperId: "BAL", name: "Baltimore Ravens", position: "DEF", team: "BAL" }
    ];
    const values = keyValuesBySleeperId(
      parseDynastyProcessCsv(csvOf(["Baltimore Ravens,DST,BAL,300,300"]), FORMAT_1QB),
      defense
    );
    expect(values.get("BAL")?.value).toBe(300);
  });

  it("matches kickers across K / PK spellings", () => {
    const kicker: IdentifiablePlayer[] = [
      { sleeperId: "k1", name: "Justin Tucker", position: "K", team: "BAL" }
    ];
    const values = keyValuesBySleeperId(
      parseDynastyProcessCsv(csvOf(["Justin Tucker,PK,BAL,150,150"]), FORMAT_1QB),
      kicker
    );
    expect(values.get("k1")?.value).toBe(150);
  });

  it("is a no-op on a map that already carries Sleeper ids", () => {
    // FantasyCalc is already correct; re-keying must not disturb it.
    const already = new Map<string, PlayerValue>([
      [
        CHASE_SLEEPER_ID,
        {
          sleeperId: CHASE_SLEEPER_ID,
          espnId: "4362628",
          name: "Ja'Marr Chase",
          position: "WR",
          team: "CIN",
          value: 9000,
          overallRank: 1,
          positionRank: 1,
          trend30Day: 0
        }
      ]
    ]);
    const values = keyValuesBySleeperId(already, catalog);
    expect(values.size).toBe(1);
    expect(values.get(CHASE_SLEEPER_ID)?.value).toBe(9000);
  });

  it("returns the input unchanged when the catalog is empty", () => {
    // No catalog snapshot yet is a real state. It must degrade to the previous
    // behaviour rather than emptying the pool.
    const parsed = parseDynastyProcessCsv(csvOf(["Ja'Marr Chase,WR,CIN,9000,9500"]), FORMAT_1QB);
    const values = keyValuesBySleeperId(parsed, []);
    expect(values.size).toBe(parsed.size);
  });
});
