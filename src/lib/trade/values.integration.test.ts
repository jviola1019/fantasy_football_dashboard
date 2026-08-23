import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTradeValues } from "./values";
import { DEFAULT_FORMAT, type LeagueFormat, type LeagueType } from "./format";

/**
 * Dynasty/redraft/keeper valuation, tested through the REAL entry point.
 *
 * `parseFantasyCalc` was already unit-tested and already accepted a league
 * type — and dynasty leagues were still priced with redraft values, because the
 * production caller in `fetchTradeValues` never passed the argument and the
 * parameter carried a silent `= "redraft"` default. A unit test on the parser
 * could not see that; only a test that drives `fetchTradeValues()` can.
 *
 * The mock is URL-AWARE because the real API is. Verified live 2026-08-16:
 *
 *   isDynasty=true  -> #1 Bijan Robinson, value 11348 (redraftValue 9925)
 *   isDynasty=false -> #1 Jahmyr Gibbs,   value 10123 (redraftValue 10017)
 *
 * The endpoint decides the horizon and returns it in `value`; the leaders are
 * genuinely different players, so this is an ordering bug, not a scaling one.
 */

const fmt = (leagueType: LeagueType, over: Partial<LeagueFormat> = {}): LeagueFormat => ({
  ...DEFAULT_FORMAT,
  leagueType,
  ...over
});

/** One player, priced 90x apart on the two horizons so any mix-up is obvious. */
function payloadFor(url: string) {
  const isDynasty = new URL(url).searchParams.get("isDynasty") === "true";
  return [
    {
      player: {
        name: "Divergent Back",
        position: "RB",
        maybeTeam: "KC",
        sleeperId: "4034",
        espnId: 3
      },
      // FantasyCalc puts the horizon you ASKED for in `value`, and always
      // echoes the canonical redraft figure in `redraftValue`.
      value: isDynasty ? 9000 : 100,
      redraftValue: 100,
      overallRank: 1,
      positionRank: 1,
      trend30Day: 0
    }
  ];
}

function stubFantasyCalc(ok = true) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (!ok) return { ok: false, status: 503 } as Response;
      return { ok: true, json: async () => payloadFor(url) } as unknown as Response;
    })
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchTradeValues honours the league's valuation horizon", () => {
  it("prices a DYNASTY league with dynasty values", async () => {
    const calls = stubFantasyCalc();
    const { values, source } = await fetchTradeValues(fmt("dynasty"));

    expect(calls[0]).toContain("isDynasty=true");
    expect(values.get("4034")!.value).toBe(9000);
    expect(source.source).toBe("FantasyCalc dynasty values");
  });

  it("prices a REDRAFT league with redraft values", async () => {
    const calls = stubFantasyCalc();
    const { values, source } = await fetchTradeValues(fmt("redraft"));

    expect(calls[0]).toContain("isDynasty=false");
    expect(values.get("4034")!.value).toBe(100);
    expect(source.source).toBe("FantasyCalc redraft values");
  });

  it("prices a KEEPER league on redraft, and says so out loud", async () => {
    // Documented modelling choice, not an accident: only a small number of
    // players carry over, so the marginal player is worth what he is worth
    // THIS season. The user is told, so they can disagree with it.
    const calls = stubFantasyCalc();
    const { values, source } = await fetchTradeValues(fmt("keeper", { keeperCount: 1 }));

    expect(calls[0]).toContain("isDynasty=false");
    expect(values.get("4034")!.value).toBe(100);
    expect(source.assumptions.join(" ")).toMatch(/Keeper leagues are priced on redraft values/i);
  });
});

describe("provenance describes the number actually produced (P1 §4)", () => {
  it("never labels a dynasty valuation 'redraft'", async () => {
    stubFantasyCalc();
    const { source } = await fetchTradeValues(fmt("dynasty"));

    // The regression: the label was the hardcoded string "FantasyCalc redraft
    // values" no matter which endpoint had been queried.
    expect(source.source).not.toMatch(/redraft/i);
    expect(source.source).toMatch(/dynasty/i);
  });

  it("carries the league shape in the assumptions, not just a bare format line", async () => {
    stubFantasyCalc();
    const { source } = await fetchTradeValues(
      fmt("dynasty", { numTeams: 10, numQbs: 2, ppr: 0.5, scoringFormat: "HALF" })
    );
    const text = source.assumptions.join(" ");

    expect(text).toMatch(/10-team/);
    expect(text).toMatch(/superflex\/2QB/);
    expect(text).toMatch(/HALF/);
    expect(text).toMatch(/Valuation horizon: dynasty/);
  });

  it("declares a horizon MISMATCH when the tertiary fallback is the wrong basis", async () => {
    // FantasyCalc down and no KTC snapshot cached -> DynastyProcess, which
    // publishes dynasty values only. A redraft league must be told that the
    // number it is looking at is not priced for its horizon.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("fantasycalc")) return { ok: false, status: 503 } as Response;
        return {
          ok: true,
          text: async () =>
            [
              "player,pos,team,age,draft_year,ecr_1qb,ecr_2qb,ecr_pos,value_1qb,value_2qb,scrape_date,fp_id",
              "Divergent Back,RB,KC,24,2023,1,1,1,9000,8000,2026-08-14,1"
            ].join("\n")
        } as unknown as Response;
      })
    );

    const { source } = await fetchTradeValues(fmt("redraft"));

    expect(source.source).toMatch(/DynastyProcess dynasty values — redraft unavailable/);
    expect(source.assumptions.join(" ")).toMatch(/DEGRADED/);
    // A wrong-horizon fallback must cost more confidence than a right-horizon one.
    expect(source.confidence).toBeLessThan(0.6);
  });
});

describe("format parameters actually reach the number (F-010 regression)", () => {
  it("reads the format-scaled column, not the format-independent one", async () => {
    // Live evidence 2026-08-16: `redraftValue` is CONSTANT across formats
    // (Gibbs 10017 at numTeams 8/12/14 and at ppr 0/0.5/1) while `value` tracks
    // the query (10041/10017/10009 and 10074/10011/10017). Preferring
    // `redraftValue` silently priced every league as 12-team full-PPR — and
    // three of the operator's four ESPN leagues are neither.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          {
            player: { name: "Scaled", position: "RB", maybeTeam: "KC", sleeperId: "1", espnId: 1 },
            value: 10074, // what an 8-team standard league should see
            redraftValue: 10017, // the canonical 12-team PPR figure
            overallRank: 1,
            positionRank: 1,
            trend30Day: 0
          }
        ]
      })) as unknown as typeof fetch
    );

    const { values } = await fetchTradeValues(
      fmt("redraft", { numTeams: 8, ppr: 0, scoringFormat: "STD" })
    );
    expect(values.get("1")!.value).toBe(10074);
  });
});
