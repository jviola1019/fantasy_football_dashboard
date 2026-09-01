import { describe, it, expect } from "vitest";
import {
  resolveSleeperRosterId,
  resolveEspnTeam,
  materializeSleeperRoster
} from "./fetchLive";
// FAAB extraction moved to ./faab in S4; its tests moved to faab.test.ts.
import { classifyInjuryEvidence } from "./injuryEvidence";

// ---------------------------------------------------------------------------
// resolveSleeperRosterId
// ---------------------------------------------------------------------------

const USERS = [
  { user_id: "u1", username: "alice", display_name: "Alice" },
  { user_id: "u2", username: "bob", display_name: "Bob" },
  { user_id: "u3", username: "charlie", display_name: null }
] as const;

const ROSTERS = [
  { roster_id: 1, owner_id: "u1" },
  { roster_id: 2, owner_id: "u2" },
  { roster_id: 3, owner_id: "u3" }
] as const;

describe("resolveSleeperRosterId", () => {
  it("resolves by exact username match", () => {
    expect(resolveSleeperRosterId(USERS, ROSTERS, "alice")).toBe(1);
    expect(resolveSleeperRosterId(USERS, ROSTERS, "bob")).toBe(2);
  });

  it("resolves by display_name when username does not match", () => {
    expect(resolveSleeperRosterId(USERS, ROSTERS, "Alice")).toBe(1);
  });

  it("is case-insensitive", () => {
    expect(resolveSleeperRosterId(USERS, ROSTERS, "ALICE")).toBe(1);
    expect(resolveSleeperRosterId(USERS, ROSTERS, "BOB")).toBe(2);
  });

  it("returns null when username is null", () => {
    expect(resolveSleeperRosterId(USERS, ROSTERS, null)).toBeNull();
  });

  it("returns null when username is empty string", () => {
    expect(resolveSleeperRosterId(USERS, ROSTERS, "")).toBeNull();
  });

  it("returns null when no user matches", () => {
    expect(resolveSleeperRosterId(USERS, ROSTERS, "dave")).toBeNull();
  });

  it("returns null when user has no roster (orphaned user_id)", () => {
    const usersWithExtra = [...USERS, { user_id: "u99", username: "orphan", display_name: "Orphan" }];
    expect(resolveSleeperRosterId(usersWithExtra, ROSTERS, "orphan")).toBeNull();
  });

  it("handles empty users array", () => {
    expect(resolveSleeperRosterId([], ROSTERS, "alice")).toBeNull();
  });

  it("handles empty rosters array", () => {
    expect(resolveSleeperRosterId(USERS, [], "alice")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveEspnTeam
// ---------------------------------------------------------------------------

type EspnTeamStub = {
  id: number;
  primaryOwner?: string | null;
  owners?: string[] | null;
};

const TEAMS: EspnTeamStub[] = [
  { id: 1, primaryOwner: "{AAA-0001}", owners: ["{AAA-0001}"] },
  { id: 2, primaryOwner: "{BBB-0002}", owners: ["{BBB-0002}"] },
  { id: 3, primaryOwner: null, owners: ["{CCC-0003}", "{DDD-0004}"] }
];

describe("resolveEspnTeam", () => {
  it("matches a braced SWID via primaryOwner", () => {
    const team = resolveEspnTeam(TEAMS, "{AAA-0001}");
    expect(team?.id).toBe(1);
  });

  it("matches a bare SWID (normalises to braced form)", () => {
    const team = resolveEspnTeam(TEAMS, "BBB-0002");
    expect(team?.id).toBe(2);
  });

  it("matches when SWID is in owners array but not primaryOwner", () => {
    const team = resolveEspnTeam(TEAMS, "{CCC-0003}");
    expect(team?.id).toBe(3);
  });

  it("matches secondary owner in owners array", () => {
    const team = resolveEspnTeam(TEAMS, "DDD-0004");
    expect(team?.id).toBe(3);
  });

  it("is case-insensitive (lowercase input vs uppercase stored)", () => {
    const team = resolveEspnTeam(TEAMS, "{aaa-0001}");
    expect(team?.id).toBe(1);
  });

  it("returns null when SWID is null", () => {
    expect(resolveEspnTeam(TEAMS, null)).toBeNull();
  });

  it("returns null when SWID does not match any team", () => {
    expect(resolveEspnTeam(TEAMS, "{ZZZ-9999}")).toBeNull();
  });

  it("returns null when teams array is empty", () => {
    expect(resolveEspnTeam([], "{AAA-0001}")).toBeNull();
  });

  it("handles teams with no owner fields gracefully", () => {
    const sparse: EspnTeamStub[] = [{ id: 9 }];
    expect(resolveEspnTeam(sparse, "{AAA-0001}")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// materializeSleeperRoster — composite provenance (audit 2026-08-20 §8)
// ---------------------------------------------------------------------------

const NOW = new Date("2026-08-20T12:00:00.000Z");
const hoursBefore = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000);

const LEAGUE = {
  id: "lg1",
  externalLeagueId: "999",
  platform: "sleeper",
  season: 2025,
  label: "Test",
  sleeperUsername: "alice"
} as unknown as Parameters<typeof materializeSleeperRoster>[2];

const PLAYERS_MAP = {
  "4046": {
    player_id: "4046",
    first_name: "Injured",
    last_name: "Starter",
    position: "WR",
    team: "DAL",
    injury_status: "Out",
    active: true
  }
} as unknown as Parameters<typeof materializeSleeperRoster>[1];

const ROSTER = { roster_id: 1, owner_id: "u1", players: ["4046"] } as unknown as Parameters<
  typeof materializeSleeperRoster
>[0];

function materialize(snapshotAgeHours: number | null) {
  const snapshotAt = snapshotAgeHours == null ? null : hoursBefore(snapshotAgeHours);
  return materializeSleeperRoster(ROSTER, PLAYERS_MAP, LEAGUE, {
    rosterFetchedAt: NOW,
    playersSnapshotFetchedAt: snapshotAt,
    injuryEvidence: classifyInjuryEvidence(snapshotAt, NOW)
  });
}

describe("materializeSleeperRoster composite provenance", () => {
  it("current roster + current players snapshot → fresh decision source", () => {
    const [rec] = materialize(1);
    expect(rec).toBeDefined();
    const composite = rec!.sources[0]!;
    expect(composite.freshness).toBe("fresh");
    expect(composite.validation).toBe("valid");
    expect(composite.missingFields).not.toContain("status");
  });

  it("current roster + 48h-old players snapshot → decision source is STALE, not fresh", () => {
    // The defect: this record used to be stamped fetchedAt=now, ttl=120,
    // freshness="fresh" while its injury_status was two days old.
    const [rec] = materialize(48);
    const composite = rec!.sources[0]!;
    expect(composite.freshness).toBe("stale");
    // ...and the timestamp is the OLDER input's, never the roster's.
    expect(composite.fetchedAt).toBe(hoursBefore(48).toISOString());
    expect(composite.fetchedAt).not.toBe(NOW.toISOString());
  });

  it("the composite is never fresher than its oldest important input", () => {
    for (const ageHours of [0.5, 5, 23, 25, 36, 48, 200]) {
      const [rec] = materialize(ageHours);
      const composite = rec!.sources[0]!;
      const stampedAt = new Date(composite.fetchedAt!).getTime();
      expect(stampedAt).toBeLessThanOrEqual(hoursBefore(ageHours).getTime());
      // TTL cannot claim a 2-minute contract for a day-scale input either.
      expect(composite.ttlSeconds).toBeLessThanOrEqual(24 * 3600);
    }
  });

  it("missing snapshot → composite carries NO timestamp and declares status missing", () => {
    const [rec] = materialize(null);
    const composite = rec!.sources[0]!;
    expect(composite.fetchedAt).toBeNull();
    expect(composite.freshness).toBe("missing");
    expect(composite.missingFields).toContain("status");
    expect(composite.validation).toBe("not-run");
    expect(composite.failure).toMatch(/not verifiable/);
  });

  it("keeps each input's own timestamp so composition loses nothing", () => {
    const [rec] = materialize(36);
    const sources = rec!.sources;
    const membership = sources.find((s) => s.source.includes("(membership)"));
    const metadata = sources.find((s) => s.source.includes("players snapshot (identity"));
    expect(membership?.fetchedAt).toBe(NOW.toISOString());
    expect(membership?.freshness).toBe("fresh");
    expect(metadata?.fetchedAt).toBe(hoursBefore(36).toISOString());
    expect(metadata?.freshness).toBe("stale");
  });

  it("the stale case still says so in the assumptions a panel would render", () => {
    const [rec] = materialize(36);
    const text = rec!.sources[0]!.assumptions.join(" ");
    expect(text).toMatch(/bounded by the older one/);
    expect(text).toMatch(/36\.0h old/);
  });

  it("a stale positive injury is still carried as a status", () => {
    // Positive signals survive staleness; only RESOLUTION is gated (§9).
    const [rec] = materialize(48);
    expect(rec!.status).toBe("out");
  });

  it("drops roster ids absent from the players map rather than inventing a record", () => {
    const recs = materializeSleeperRoster(
      { roster_id: 1, owner_id: "u1", players: ["4046", "does-not-exist"] } as never,
      PLAYERS_MAP,
      LEAGUE,
      {
        rosterFetchedAt: NOW,
        playersSnapshotFetchedAt: NOW,
        injuryEvidence: classifyInjuryEvidence(NOW, NOW)
      }
    );
    expect(recs).toHaveLength(1);
  });
});
