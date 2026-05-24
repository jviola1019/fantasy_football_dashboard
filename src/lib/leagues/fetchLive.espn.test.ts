import { beforeEach, describe, expect, it, vi } from "vitest";

// ESPN integration test for fetchLeagueLive. Mocks the upstream league
// query + credential decrypt and feeds a synthetic ESPN mTeam/mSettings
// payload through the production fetchEspnLive path. Verifies:
// - allRosters populated from team.roster.entries
// - myRoster resolved via SWID match against team.primaryOwner
// - format populated by parseEspnFormat (numTeams, ppr, starters, deadlines)
// - source metadata flows through with freshness "fresh"

// Stub getLeague (the ESPN-side data fetcher) BEFORE the SUT is imported.
const getLeagueMock = vi.fn();
vi.mock("../espn/league", () => ({
  getLeague: getLeagueMock,
  getRoster: vi.fn(),
  getScoreboard: vi.fn(),
  getDraft: vi.fn(),
  getTransactions: vi.fn(),
  getFreeAgents: vi.fn(),
  getNews: vi.fn()
}));

// Stub the leagues data access so fetchLeagueLive resolves a fake league
// row + decrypted credentials without touching the DB.
const getLeagueForUserMock = vi.fn();
const getLeagueCredentialsMock = vi.fn();
vi.mock("../leagues", () => ({
  getLeagueForUser: getLeagueForUserMock,
  getLeagueCredentials: getLeagueCredentialsMock
}));

// Stub getDb so importing fetchLive doesn't touch the SQLite cache.
vi.mock("../../db", () => ({
  getDb: () => ({})
}));

const SWID = "{TEST-SWID-001}";

// Synthetic 12-team ESPN league. Two teams shown with rosters; the test
// only asserts shape, not full 12. team[0].primaryOwner matches the SWID
// in the credentials so resolveEspnTeam picks roster[0] as myRoster.
function makeEspnResponse() {
  return {
    teams: Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      abbrev: `T${i + 1}`,
      location: "Team",
      nickname: `${i + 1}`,
      name: `Team ${i + 1}`,
      record: { overall: { wins: 0, losses: 0, ties: 0 } },
      // First team owns the test SWID.
      primaryOwner: i === 0 ? SWID : "{OTHER-OWNER}",
      owners: i === 0 ? [SWID] : [],
      roster: {
        entries: [
          {
            playerId: 4000 + i,
            lineupSlotId: 0,
            playerPoolEntry: {
              player: {
                id: 4000 + i,
                fullName: `Player ${i}`,
                firstName: "First",
                lastName: `${i}`,
                defaultPositionId: 1, // QB
                proTeamId: 1,
                injuryStatus: null,
                active: true
              }
            }
          },
          {
            playerId: 5000 + i,
            lineupSlotId: 2,
            playerPoolEntry: {
              player: {
                id: 5000 + i,
                fullName: `Runner ${i}`,
                firstName: "Runner",
                lastName: `${i}`,
                defaultPositionId: 2, // RB
                proTeamId: 2,
                injuryStatus: null,
                active: true
              }
            }
          }
        ]
      }
    })),
    settings: {
      size: 12,
      scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] },
      rosterSettings: {
        lineupSlotCounts: {
          "0": 1, // QB
          "2": 2, // RB
          "4": 2, // WR
          "6": 1, // TE
          "7": 1, // FLEX
          "16": 1, // DST
          "17": 1, // K
          "20": 6 // bench
        }
      },
      scheduleSettings: {
        matchupPeriodCount: 14,
        playoffMatchupPeriodLength: 1,
        playoffTeamCount: 6
      },
      tradeSettings: { deadlineDate: 1763596800000 }, // late Nov 2025
      status: { firstScoringPeriod: 1756944000000 } // early Sep 2025
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchLeagueLive (ESPN) — integration with mocked fetcher", () => {
  it("returns 12 rosters, identifies myRoster via SWID, populates format", async () => {
    // Arrange: stub the league record + decrypted creds + ESPN fetch.
    getLeagueForUserMock.mockResolvedValue({
      id: "league-uuid",
      userId: "user-a",
      platform: "espn",
      externalLeagueId: "espn-12345",
      season: 2025,
      label: "Test ESPN League",
      settings: null,
      sleeperUsername: null,
      createdAt: new Date()
    });
    getLeagueCredentialsMock.mockResolvedValue({
      espnS2: "test-s2-token",
      swid: SWID
    });
    getLeagueMock.mockResolvedValue({
      data: makeEspnResponse(),
      source: {
        source: "ESPN league espn-12345 (2025)",
        fetchedAt: new Date().toISOString(),
        ttlSeconds: 300,
        freshness: "fresh",
        confidence: 0.9,
        validation: "valid",
        missingFields: [],
        assumptions: [],
        failure: null
      }
    });

    // Act
    const { fetchLeagueLive } = await import("./fetchLive");
    const snapshot = await fetchLeagueLive("user-a", "league-uuid");

    // Assert: full shape
    expect(snapshot).not.toBeNull();
    if (!snapshot) throw new Error("snapshot is null");
    expect(snapshot.allRosters).toHaveLength(12);
    // Each roster has 2 entries (QB + RB) per fixture.
    for (const roster of snapshot.allRosters) {
      expect(roster.length).toBeGreaterThan(0);
    }
    // myRoster is team[0] because its primaryOwner matches SWID.
    expect(snapshot.myRoster.length).toBe(2);
    expect(snapshot.myRoster[0]?.name).toBe("Player 0");

    // Format extracted from mSettings.
    expect(snapshot.format).not.toBeNull();
    expect(snapshot.format?.numTeams).toBe(12);
    expect(snapshot.format?.ppr).toBe(1);
    expect(snapshot.format?.scoringFormat).toBe("PPR");
    expect(snapshot.format?.starters.QB).toBe(1);
    expect(snapshot.format?.starters.RB).toBe(2);
    expect(snapshot.format?.starters.WR).toBe(2);
    expect(snapshot.format?.tradeDeadlineWeek).toBeGreaterThan(0);
    expect(snapshot.format?.playoffWeekStart).toBe(15);
    expect(snapshot.format?.playoffTeams).toBe(6);

    // No failure surfaced; source freshness preserved.
    expect(snapshot.failure).toBeNull();
    expect(snapshot.source.freshness).toBe("fresh");
  });

  it("returns null when getLeagueForUser returns null (cross-user defense)", async () => {
    getLeagueForUserMock.mockResolvedValue(null);
    const { fetchLeagueLive } = await import("./fetchLive");
    const snapshot = await fetchLeagueLive("user-b", "league-uuid");
    expect(snapshot).toBeNull();
    expect(getLeagueCredentialsMock).not.toHaveBeenCalled();
    expect(getLeagueMock).not.toHaveBeenCalled();
  });

  it("returns a credentials-missing snapshot when getLeagueCredentials returns null", async () => {
    getLeagueForUserMock.mockResolvedValue({
      id: "league-uuid",
      userId: "user-a",
      platform: "espn",
      externalLeagueId: "espn-12345",
      season: 2025,
      label: "Test ESPN League",
      settings: null,
      sleeperUsername: null,
      createdAt: new Date()
    });
    getLeagueCredentialsMock.mockResolvedValue(null);
    const { fetchLeagueLive } = await import("./fetchLive");
    const snapshot = await fetchLeagueLive("user-a", "league-uuid");
    expect(snapshot).not.toBeNull();
    expect(snapshot?.failure).toBe("missing credentials");
    expect(snapshot?.allRosters).toEqual([]);
    expect(snapshot?.format).toBeNull();
    expect(getLeagueMock).not.toHaveBeenCalled();
  });
});
