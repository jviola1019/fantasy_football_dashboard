import { describe, expect, it } from "vitest";
import { buildLiveEnvelope } from "./toEnvelope";
import type { LiveLeagueSnapshot } from "./fetchLive";
import type { PlayerMarketRecord, SourceMeta } from "../governance";
import type { FpEcrData } from "../fantasypros/types";

/**
 * Regression guard for P0-5 (audit 2026-08-22): a stale opportunity snapshot
 * presented as current usage.
 *
 * WHAT WENT WRONG
 *
 * `load.ts` read the nflverse snapshot and passed only `snapshot.scores` to
 * `buildLiveEnvelope`, dropping `fetchedAt` at the boundary. With no age
 * available, the envelope activated opportunity on PRESENCE alone:
 *
 *   - every record got a snap-share number stamped onto it,
 *   - `opportunity` was REMOVED from `missingFields`, which is the one channel
 *     panels use to render "—" instead of a figure, and
 *   - the assumption string claimed the number came "from the latest season's
 *     games".
 *
 * If the daily cron had been dead for two months, all three statements were
 * still made, confidently, with nothing anywhere in the product contradicting
 * them. The health endpoint knew — it evaluates this exact snapshot against a
 * declared contract — but the operator surface and the user surface did not
 * share the contract, so what the operator could see the user could not.
 *
 * The thresholds here are NOT new: they are `SNAPSHOT_CONTRACT.nflverseOpportunity`,
 * the same numbers `/api/health` already reported against (warn at 2 days,
 * expire at 15).
 */
const src = (over: Partial<SourceMeta> = {}): SourceMeta => ({
  source: "sleeper",
  fetchedAt: new Date().toISOString(),
  ttlSeconds: 3600,
  freshness: "fresh",
  confidence: 0.8,
  validation: "valid",
  missingFields: ["opportunity"],
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

const snapshot = (): LiveLeagueSnapshot =>
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
    draftStatus: null
  }) as unknown as LiveLeagueSnapshot;

const rankingsSource = (): SourceMeta => src({ source: "fantasypros-ppr", missingFields: ["opportunity"] });

/** Keys are `normalizeOppName` output (lowercase, suffix-stripped, letters only),
 *  which is how the real nflverse map is built. */
/** Minimal but REAL ECR payload — the envelope falls back to an identity-only
 *  degraded mode when rankings are absent, which would exercise a different
 *  branch than the one this test is about. */
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
    last_updated: new Date().toISOString(),
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

const build = (fetchedAt: Date | null) =>
  buildLiveEnvelope({
    snapshot: snapshot(),
    rankings: rankings(),
    rankingsSource: rankingsSource(),
    opportunityScores: { bijanrobinson: { score: 88, position: "RB", team: "AAA", games: 12 } },
    opportunityFetchedAt: fetchedAt
  });

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe("opportunity is only presented as current when it IS current", () => {
  it("activates a fresh snapshot and drops opportunity from missingFields", () => {
    const env = build(daysAgo(0));
    expect(env.sourceState.missingFields).not.toContain("opportunity");
    expect(env.sourceState.source).toContain("nflverse snaps");
  });

  it("WITHHOLDS an expired snapshot — missingFields keeps opportunity", () => {
    // 20 days > the 15-day expire threshold. Before this fix the envelope
    // reported exactly the same thing as the fresh case.
    const env = build(daysAgo(20));
    expect(env.sourceState.missingFields).toContain("opportunity");
    expect(env.sourceState.source).not.toContain("nflverse snaps");
  });

  it("does not stamp an expired snapshot onto the records", () => {
    // The disclosure and the DATA have to agree. Declaring the field missing
    // while still writing 88 onto the record would just move the lie.
    const stale = build(daysAgo(20));
    expect(stale.records.every((r) => r.opportunity === 0)).toBe(true);

    const fresh = build(daysAgo(0));
    expect(fresh.records.some((r) => r.opportunity === 88)).toBe(true);
  });

  it("states the snapshot's age in the assumptions whenever it is used", () => {
    // "From the latest season's games" is a claim about recency. A claim about
    // recency must carry the date it rests on.
    const env = build(daysAgo(3));
    const text = env.sourceState.assumptions.join(" ");
    expect(text).toMatch(/3 days old/);
  });

  it("marks a snapshot past its refresh window as indicative, not current", () => {
    // 3 days > the 2-day warn threshold but < the 15-day expire threshold:
    // still usable, no longer current, and the difference must be visible.
    const env = build(daysAgo(3));
    expect(env.sourceState.assumptions.join(" ")).toMatch(/indicative, not current/i);
    // …while a same-day snapshot carries no such caveat.
    expect(build(daysAgo(0)).sourceState.assumptions.join(" ")).not.toMatch(/indicative, not current/i);
  });

  it("says WHY it withheld the data, not merely that something is missing", () => {
    const env = build(daysAgo(20));
    expect(env.sourceState.assumptions.join(" ")).toMatch(/WITHHELD/);
  });

  it("treats a missing fetchedAt as unusable rather than as fresh", () => {
    // The failure mode that caused this bug was an ABSENT timestamp. The safe
    // reading of "I don't know how old this is" is not "it is new".
    const env = build(null);
    expect(env.sourceState.missingFields).toContain("opportunity");
  });
});
