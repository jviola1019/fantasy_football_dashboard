import { describe, expect, it } from "vitest";
import {
  getNflState,
  getLeague,
  getRosters,
  getLeagueUsers,
  fetchSleeperPlayersMap,
  getTrendingPlayers
} from "../sleeper";
import { buildTrendingMap, trendingMomentumFromProxy } from "../sleeper/trendingProxy";
import { detectSleeperDraftState, detectEspnDraftState } from "./draftState";
import { resolveSleeperSeasonMirror, resolveEspnSeasonMirror } from "./mirrorLeague";
import { resolveSleeperRosterId } from "./fetchLive";
import type { PlayerMarketRecord } from "../governance";

/**
 * LIVE integration round-trip against a real Sleeper league. Skipped unless
 * RAE_LIVE_TESTS=1 (so CI never hits the network). Verifies the exact pieces
 * the homepage pipeline relies on: league fetch, roster integration, the
 * draft-state detector, the season mirror, and ID→name continuity — with no
 * duplication or API-integration errors.
 *
 * Defaults to the owner's real completed-2025 league; override with
 * RAE_LIVE_SLEEPER_LEAGUE_ID / RAE_LIVE_SLEEPER_USERNAME.
 */
const RUN = process.env.RAE_LIVE_TESTS === "1";
const d = RUN ? describe : describe.skip;

// jviola1019's "Creamy Les Coot 4.0" — a completed 2025 league (post-draft).
const LEAGUE_ID = process.env.RAE_LIVE_SLEEPER_LEAGUE_ID ?? "1265735061127311360";
const USERNAME = process.env.RAE_LIVE_SLEEPER_USERNAME ?? "jviola1019";

d("Sleeper live integration — completed league (post-draft)", () => {
  it("fetches league + rosters + users and integrates the owner's roster cleanly", async () => {
    const [state, league, rosters, users, playersRes] = await Promise.all([
      getNflState(),
      getLeague(LEAGUE_ID),
      getRosters(LEAGUE_ID),
      getLeagueUsers(LEAGUE_ID),
      fetchSleeperPlayersMap()
    ]);

    // ── NFL state is live and self-consistent.
    expect(state.data?.season).toBeTruthy();

    // ── League fetched with a real status/season.
    const info = league.data;
    expect(info?.league_id).toBe(LEAGUE_ID);
    expect(info?.status).toBeTruthy();
    const status = info!.status as string;
    const season = String(info!.season);

    // ── Rosters integrated: a completed league has filled rosters.
    const rosterRows = rosters.data ?? [];
    expect(rosterRows.length).toBeGreaterThan(0);
    expect(rosterRows.some((r) => (r.players ?? []).length > 0)).toBe(true);

    // ── Draft state + season mirror match a completed league.
    //
    // THE OVERRIDE HAS A PRECONDITION, AND IT IS ASSERTED HERE.
    // `RAE_LIVE_SLEEPER_LEAGUE_ID` reads like a general "point this at any
    // league" switch, and the mirror assertions below only hold for a league
    // whose status is `complete`: `resolveSleeperSeasonMirror` returns
    // `{completed: season, upcoming: season+1}` for `complete`, and
    // `{completed: null, upcoming: season}` for `in_season`
    // (`mirrorLeague.ts:32-41`). Pointed at an in-season league on 2026-09-01
    // this failed on `mirror.completed` with no hint that the league was simply
    // the wrong kind. Fail on the precondition instead, and say so.
    expect(
      status,
      `this suite asserts the COMPLETED-league season mirror; league ${LEAGUE_ID} is "${status}". ` +
        `Point RAE_LIVE_SLEEPER_LEAGUE_ID at a finished league, or drop the override.`
    ).toBe("complete");
    const draftState = detectSleeperDraftState(status, null, true);
    expect(draftState).toBe("post");
    const mirror = resolveSleeperSeasonMirror(status, season, info!.previous_league_id ?? null, "2026");
    expect(mirror.completed).toBe(season); // completed = the league's own season
    expect(Number(mirror.upcoming)).toBe(Number(season) + 1);

    // ── The owner's roster resolves via username and is non-empty (integrated).
    const myRosterId = resolveSleeperRosterId(users.data ?? [], rosterRows, USERNAME);
    expect(myRosterId, "owner roster should resolve by username").not.toBeNull();
    const mine = rosterRows.find((r) => r.roster_id === myRosterId);
    const myPlayers = mine?.players ?? [];
    expect(myPlayers.length).toBeGreaterThan(0);

    // ── No duplication: a roster never lists the same player twice.
    expect(new Set(myPlayers).size).toBe(myPlayers.length);

    // ── Continuity / API integration: every rostered id resolves to a real
    //    named player in the live players map (no orphan ids, no fabrication).
    const playersMap = playersRes.players;
    expect(playersMap, "players map should load").not.toBeNull();
    const unresolved = myPlayers.filter((id) => !playersMap![id]?.full_name && !playersMap![id]?.last_name);
    expect(unresolved, `unresolved player ids: ${unresolved.join(",")}`).toHaveLength(0);

    // ── League-wide: no roster_id collisions across teams.
    const ids = rosterRows.map((r) => r.roster_id);
    expect(new Set(ids).size).toBe(ids.length);
  }, 60_000);

  it("the hype axis actually MOVES across the market (adds up, drops down)", async () => {
    // The Narrative Engine's hype comes from Sleeper trending adds/drops applied
    // to the MARKET pool (universe/free agents) — not the user's set roster,
    // which never trends. Verify the live signal produces real up AND down
    // movement so the panel isn't flat.
    const [addsRes, dropsRes] = await Promise.all([
      getTrendingPlayers("add", 24, 100),
      getTrendingPlayers("drop", 24, 100)
    ]);
    const adds = buildTrendingMap(addsRes.data ?? []);
    const drops = buildTrendingMap(dropsRes.data ?? []);
    expect(adds.size, "live trending adds should be non-empty").toBeGreaterThan(10);
    expect(drops.size, "live trending drops should be non-empty").toBeGreaterThan(5);

    const addsMax = Math.max(1, ...adds.values());
    const dropsMax = Math.max(1, ...drops.values());

    // The most-added player is clearly "rising"; the most-dropped clearly "falling".
    const topAddId = [...adds.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const topDropId = [...drops.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const riser = trendingMomentumFromProxy({ id: `sleeper:${topAddId}` }, adds, drops, addsMax, dropsMax);
    const faller = trendingMomentumFromProxy({ id: `sleeper:${topDropId}` }, adds, drops, addsMax, dropsMax);

    // These used to assert `riser > 20` and `faller < -20`. The second was
    // ARITHMETICALLY IMPOSSIBLE on some real days, and this test caught it:
    // `trendingMomentumFromProxy` divides by a SINGLE global denominator
    // (max of both sides) so the sign stays meaningful, which means the top
    // dropper's score is capped at -(dropsMax / globalMax) * 100. Measured
    // 2026-08-22, live: addsMax 54,901 vs dropsMax 10,104, a ratio of 0.184 —
    // so the most-dropped player in the NFL could not score below -18, and
    // `< -20` could never pass no matter how healthy the axis was.
    //
    // A magnitude threshold here tests the market's daily add/drop ratio, not
    // RAE. So assert the INVARIANTS instead, which is both scale-free and
    // stricter: each extreme must reach exactly the floor/ceiling the
    // normalisation allows. A bug that crushed the axis toward zero — the
    // "hype reads flat" failure this test exists for — still fails.
    const globalMax = Math.max(addsMax, dropsMax, 1);
    expect(riser, "top-added player must reach the normalisation ceiling").toBe(
      Math.round((adds.get(topAddId)! - (drops.get(topAddId) ?? 0)) / globalMax * 100)
    );
    expect(faller, "top-dropped player must reach the normalisation floor").toBe(
      Math.round(((adds.get(topDropId) ?? 0) - drops.get(topDropId)!) / globalMax * 100)
    );
    // Direction, which is the claim the panel actually makes.
    expect(riser, "the top-added player must read as rising").toBeGreaterThan(0);
    expect(faller, "the top-dropped player must read as falling").toBeLessThan(0);
    // And the axis must be genuinely two-sided, not a rounding artifact.
    expect(riser - faller, "the hype axis must span a usable range").toBeGreaterThan(25);

    // Across the trending pool there is genuine two-sided movement.
    const pool = new Set([...adds.keys(), ...drops.keys()]);
    let up = 0;
    let down = 0;
    for (const id of pool) {
      const m = trendingMomentumFromProxy({ id: `sleeper:${id}` }, adds, drops, addsMax, dropsMax);
      if (m > 5) up++;
      else if (m < -5) down++;
    }
    expect(up).toBeGreaterThan(5);
    expect(down).toBeGreaterThan(3);
  }, 30_000);
});

describe("draft-state transition contract (pure — always runs)", () => {
  it("classifies pre-draft vs post-draft, and clears the season mirror correctly", () => {
    // Pre-draft: status drives "pre" even if a stray roster has carryover players.
    expect(detectSleeperDraftState("pre_draft", null, true)).toBe("pre");
    expect(detectSleeperDraftState("drafting", null, false)).toBe("pre");
    // Post-draft / in-season / complete → "post".
    expect(detectSleeperDraftState("in_season", null, true)).toBe("post");
    expect(detectSleeperDraftState("complete", null, true)).toBe("post");
    // No status string → infer from roster fill (empty ⇒ undrafted ⇒ pre).
    expect(detectSleeperDraftState(null, null, false)).toBe("pre");
    expect(detectSleeperDraftState(null, null, true)).toBe("post");

    // A brand-new pre-draft league (no predecessor) has no completed history.
    expect(resolveSleeperSeasonMirror("pre_draft", "2026", null, "2026")).toEqual({
      completed: null,
      upcoming: "2026"
    });
    // A renewed pre-draft league (predecessor chain) → completed = season − 1.
    expect(resolveSleeperSeasonMirror("pre_draft", "2026", "prev123", "2026")).toEqual({
      completed: "2025",
      upcoming: "2026"
    });
    // A completed league → completed = its season, upcoming = next.
    expect(resolveSleeperSeasonMirror("complete", "2025", null, "2026")).toEqual({
      completed: "2025",
      upcoming: "2026"
    });
  });
});

describe("ESPN draft-state transition contract (pure — always runs)", () => {
  // ESPN exposes no draft-status string, so pre/post is inferred from roster
  // fill. This is the "team clears pre-draft, integrates post-draft" guarantee
  // for ESPN — the same behaviour the daily refresh relies on once a real ESPN
  // league drafts. (A live ESPN round-trip needs a public/sample league id.)
  const team = (n: number): PlayerMarketRecord[] =>
    Array.from({ length: n }, () => ({}) as PlayerMarketRecord);

  it("clears pre-draft (empty teams) and integrates post-draft (filled teams)", () => {
    const teams = 10;
    const expected = 16;
    const preDraft = Array.from({ length: teams }, () => team(0)); // empty rosters
    const postDraft = Array.from({ length: teams }, () => team(expected)); // filled
    expect(detectEspnDraftState(preDraft, expected)).toBe("pre");
    expect(detectEspnDraftState(postDraft, expected)).toBe("post");
    // One stray empty team must NOT flip a clearly-drafted league back to pre.
    const mostlyFilled = [team(0), ...Array.from({ length: teams - 1 }, () => team(expected))];
    expect(detectEspnDraftState(mostlyFilled, expected)).toBe("post");

    // Season mirror: a drafted (post) season is completed → next is upcoming;
    // a pre-draft season has no completed history.
    expect(resolveEspnSeasonMirror(2025, "post")).toEqual({ completed: "2025", upcoming: "2026" });
    expect(resolveEspnSeasonMirror(2026, "pre")).toEqual({ completed: null, upcoming: "2026" });
  });
});
