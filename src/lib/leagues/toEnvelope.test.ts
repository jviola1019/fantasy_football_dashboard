import { describe, expect, it } from "vitest";
import { buildLiveEnvelope } from "./toEnvelope";
import type { LiveLeagueSnapshot } from "./fetchLive";
import type { PlayerMarketRecord, SourceMeta } from "../governance";
import type { FpEcrData } from "../fantasypros/types";

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
