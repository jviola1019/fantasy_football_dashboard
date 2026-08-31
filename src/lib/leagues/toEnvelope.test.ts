import { describe, expect, it } from "vitest";
import { buildLiveEnvelope } from "./toEnvelope";
import type { LiveLeagueSnapshot } from "./fetchLive";
import type { PlayerMarketRecord, SourceMeta } from "../governance";
import type { FpEcrData } from "../fantasypros/types";
import { rankInSeason } from "../models/inSeasonScore";

/**
 * `toEnvelope.ts` assembles the object every panel on every route reads, and it
 * was the largest untested lib file in the repository (audit 2026-08-22, P3).
 *
 * Its governance fields are not decoration. `missingFields` is the ONLY channel
 * that makes a panel render an em dash instead of a number; `freshness` and
 * `confidence` are what the trust strip reports; `failure` is how a silent
 * degradation reaches a human. Every one of those was uncovered.
 *
 * Opportunity staleness has its own file (`opportunityStaleness.test.ts`).
 * These cover the composition rules around it.
 */
const src = (over: Partial<SourceMeta> = {}): SourceMeta => ({
  source: "sleeper",
  fetchedAt: "2026-08-01T00:00:00.000Z",
  ttlSeconds: 3600,
  freshness: "fresh",
  confidence: 0.9,
  validation: "valid",
  missingFields: [],
  assumptions: [],
  failure: null,
  ...over
});

const player = (name: string): PlayerMarketRecord =>
  ({
    id: `p-${name}`,
    name,
    position: "RB",
    team: "AAA",
    perceivedValue: 50,
    trueValue: 50,
    ownershipLeverage: 0,
    fragility: 0,
    trendingMomentum: 0,
    volatility: 0,
    opportunity: 0,
    confidence: 0.5,
    rosterSlot: "RB",
    status: "active",
    sources: []
  }) as unknown as PlayerMarketRecord;

const snapshot = (over: Partial<LiveLeagueSnapshot> = {}): LiveLeagueSnapshot =>
  ({
    league: { id: "L1", platform: "sleeper", season: "2025", name: "Test" },
    allRosters: [[player("Bijan Robinson")]],
    myRoster: [player("Bijan Robinson")],
    identityResolved: true,
    identityNote: null,
    source: src(),
    failure: null,
    format: null,
    myFaabRemainingRatio: null,
    leagueRawData: { status: "complete", season: "2025" },
    draftStatus: null,
    ...over
  }) as unknown as LiveLeagueSnapshot;

const rankings = (): FpEcrData =>
  ({
    sport: "NFL",
    type: "ros",
    year: 2025,
    week: 0,
    position_id: "ALL",
    scoring: "PPR",
    count: 1,
    total_experts: 10,
    last_updated: "2026-08-01T00:00:00.000Z",
    players: [
      {
        player_id: 1,
        player_name: "Bijan Robinson",
        player_team_id: "AAA",
        player_position_id: "RB",
        player_owned_avg: 90,
        rank_ecr: 1,
        rank_min: 1,
        rank_max: 3,
        rank_ave: 1.5,
        rank_std: 0.5,
        pos_rank: "RB1",
        tier: 1
      }
    ]
  }) as unknown as FpEcrData;

describe("the envelope composes its two sources honestly", () => {
  it("takes the WORSE freshness of the two upstreams, not the better one", () => {
    // A fresh roster with month-old rankings is not a fresh envelope. Reporting
    // the better of the two would let a stale valuation ride on a live roster.
    const env = buildLiveEnvelope({
      snapshot: snapshot({ source: src({ freshness: "fresh" }) }),
      rankings: rankings(),
      rankingsSource: src({ source: "fantasypros-ppr", freshness: "stale" })
    });
    expect(env.sourceState.freshness).toBe("stale");
  });

  it("takes the LOWER confidence of the two upstreams", () => {
    const env = buildLiveEnvelope({
      snapshot: snapshot({ source: src({ confidence: 0.9 }) }),
      rankings: rankings(),
      rankingsSource: src({ source: "fantasypros-ppr", confidence: 0.4 })
    });
    expect(env.sourceState.confidence).toBe(0.4);
  });

  it("unions missingFields across both sources", () => {
    // A field missing from EITHER upstream is missing from the envelope. An
    // intersection would let one source vouch for a field the other never had.
    const env = buildLiveEnvelope({
      snapshot: snapshot({ source: src({ missingFields: ["fragility"] }) }),
      rankings: rankings(),
      rankingsSource: src({ source: "fantasypros-ppr", missingFields: ["opportunity"] })
    });
    expect(env.sourceState.missingFields).toContain("fragility");
    expect(env.sourceState.missingFields).toContain("opportunity");
  });

  it("names both sources so a reader can trace either one", () => {
    const env = buildLiveEnvelope({
      snapshot: snapshot(),
      rankings: rankings(),
      rankingsSource: src({ source: "fantasypros-ppr" })
    });
    expect(env.sourceState.source).toContain("sleeper");
    expect(env.sourceState.source).toContain("fantasypros-ppr");
  });
});

describe("the envelope degrades without hiding the degradation", () => {
  const degraded = (over: Partial<SourceMeta> = {}) =>
    buildLiveEnvelope({
      snapshot: snapshot(),
      rankings: null,
      rankingsSource: src({ source: "fantasypros-ppr", ...over })
    });

  it("still emits live mode when the rankings cache is empty", () => {
    // The roster is real even when the valuation is not. Falling back to
    // fixtures here would replace a real team with demo data.
    const env = degraded();
    expect(env.mode).toBe("live");
    expect(env.records).toHaveLength(1);
  });

  it("declares every valuation field missing when rankings are absent", () => {
    // These are exactly the fields a panel must render as unavailable rather
    // than as zero. Without them the dashboard shows a 0.0 edge, which reads as
    // a real neutral verdict instead of as absent data.
    const env = degraded();
    for (const field of ["market_value", "true_value", "ownership"]) {
      expect(env.sourceState.missingFields).toContain(field);
    }
  });

  it("says the rankings cache is empty in the source string", () => {
    expect(degraded().sourceState.source).toMatch(/rankings cache empty/i);
  });

  it("surfaces the rankings failure rather than the identity source's null", () => {
    expect(degraded({ failure: "scrape returned 403" }).sourceState.failure).toBe(
      "scrape returned 403"
    );
  });

  it("exposes no league universe when there is nothing to value it with", () => {
    const env = degraded();
    expect(env.leagueUniverse).toBeNull();
    expect(env.freeAgents).toBeNull();
    // ...but the real roster structure survives, because it is real.
    expect(env.allRosters).toHaveLength(1);
  });
});

describe("a roster substitution reaches the envelope (P0-3)", () => {
  const build = (over: Partial<LiveLeagueSnapshot>) =>
    buildLiveEnvelope({
      snapshot: snapshot(over),
      rankings: rankings(),
      rankingsSource: src({ source: "fantasypros-ppr" })
    });

  const disclosure = (env: ReturnType<typeof build>) =>
    [env.sourceState.failure ?? "", ...env.sourceState.assumptions].join(" ");

  it("carries identityNote into the disclosure channel", () => {
    // Both platform paths fall back to team index 0 when identity cannot be
    // resolved. Every panel, simulation, trade grade and keeper price then
    // computes against another manager's roster. That may never be silent.
    const env = build({
      identityResolved: false,
      identityNote: "Showing Team 1 roster: no Sleeper username on file."
    });
    expect(disclosure(env)).toMatch(/Team 1/);
  });

  it("says nothing about rosters when identity resolved normally", () => {
    expect(disclosure(build({ identityResolved: true, identityNote: null }))).not.toMatch(
      /Showing Team/i
    );
  });
});

/**
 * Season rates have to reach the pool the in-season board is actually given.
 *
 * Audit 2026-08-31 (D-B). `withSeasonRates` was applied at exactly two call
 * sites, both setting `records` — the user's own roster. But `InSeasonBoard` is
 * mounted inside `WaiverWire` (`WaiverWire.tsx:96`) and receives
 * `players={d.marketPool}` (`RouteView.tsx:95`), and post-draft `marketPool` is
 * `freeAgents` (`derive.ts:139`).
 *
 * So `pointsPerGame` / `touchesPerGame` were null for every free agent,
 * `rankCohort` dropped all of them, and the ONE model in this product with a
 * positive out-of-sample result (protocols 4 and 5) rendered "unavailable" for
 * the whole season on every real league. It worked only in the anonymous demo,
 * where `draftState` is absent so `marketPool` falls back to the hand-authored
 * fixture rows.
 */
describe("season rates reach the free-agent pool (D-B)", () => {
  const statsFor = (ids: string[]) =>
    Object.fromEntries(
      ids.map((id) => [id, { gp: 10, pts_ppr: 150, rec: 40, rush_att: 60 }])
    ) as never;

  const withUniverse = (extra: Record<string, unknown> = {}) =>
    buildLiveEnvelope({
      snapshot: snapshot({
        // Rostered by someone else, so it lands in neither roster nor FA-by-luck.
        allRosters: [[player("Rostered Guy")]],
        myRoster: [player("Rostered Guy")]
      }),
      rankings: rankings(),
      rankingsSource: src({ source: "fantasypros-ppr" }),
      playersSnapshot: {
        "fa-1": { player_id: "fa-1", full_name: "Free Agent One", position: "RB", team: "BBB", active: true },
        "fa-2": { player_id: "fa-2", full_name: "Free Agent Two", position: "WR", team: "CCC", active: true }
      },
      ...extra
    } as never);

  it("stamps pointsPerGame onto free agents, not only the user's roster", () => {
    const env = withUniverse({ seasonStats: statsFor(["sleeper:fa-1", "sleeper:fa-2"]) });
    const fas = env.freeAgents ?? [];
    expect(fas.length, "no free agents were built — fixture problem, not the defect").toBeGreaterThan(0);
    const rated = fas.filter((p) => p.pointsPerGame != null);
    expect(
      rated.length,
      "free agents carry no season rates, so rankInSeason drops every one of them"
    ).toBeGreaterThan(0);
  });

  it("stamps them onto the league universe too", () => {
    const env = withUniverse({ seasonStats: statsFor(["sleeper:fa-1", "sleeper:fa-2"]) });
    const universe = env.leagueUniverse ?? [];
    expect(universe.length).toBeGreaterThan(0);
    expect(universe.some((p) => p.pointsPerGame != null)).toBe(true);
  });

  it("produces a NON-EMPTY in-season ranking from the post-draft pool", () => {
    // The real exit criterion. Populating the field is necessary but not
    // sufficient: rankCohort needs BOTH rates and a cohort of at least five per
    // position (inSeasonScore.ts:64), and it is the ranking, not the field, that
    // the user sees. This asserts the model the audit called unreachable is
    // reachable from the pool the panel is actually handed.
    const ids = ["fa-1", "fa-2", "fa-3", "fa-4", "fa-5", "fa-6"];
    const env = buildLiveEnvelope({
      snapshot: snapshot({
        allRosters: [[player("Rostered Guy")]],
        myRoster: [player("Rostered Guy")]
      }),
      rankings: rankings(),
      rankingsSource: src({ source: "fantasypros-ppr" }),
      playersSnapshot: Object.fromEntries(
        ids.map((id, i) => [
          id,
          { player_id: id, full_name: `Free Agent ${i}`, position: "RB", team: "BBB", active: true }
        ])
      ),
      // Distinct rates, so the cohort has spread to rank on.
      seasonStats: Object.fromEntries(
        ids.map((id, i) => [
          `sleeper:${id}`,
          { gp: 10, pts_ppr: 100 + i * 15, rec: 20 + i * 4, rush_att: 40 + i * 6 }
        ])
      ) as never
    } as never);

    // Narrowed exactly as InSeasonBoard.tsx:24-27 does, so this exercises the
    // production path rather than a friendlier one.
    const withRates = (env.freeAgents ?? []).filter(
      (p): p is PlayerMarketRecord & { pointsPerGame: number; touchesPerGame: number } =>
        p.pointsPerGame != null && p.touchesPerGame != null
    );
    expect(withRates.length, "no free agent carries both rates").toBeGreaterThanOrEqual(5);
    const ranked = rankInSeason(withRates);
    expect(
      ranked.size,
      "the validated in-season ranking is still empty for a post-draft pool"
    ).toBeGreaterThan(0);
  });

  it("leaves rates null when there are no season stats, rather than inventing them", () => {
    // Before kickoff there are no games. Null is the honest answer, and
    // rankCohort is built to drop the player rather than score half a model.
    const env = withUniverse({ seasonStats: null });
    const fas = env.freeAgents ?? [];
    expect(fas.every((p) => p.pointsPerGame == null)).toBe(true);
  });
});
