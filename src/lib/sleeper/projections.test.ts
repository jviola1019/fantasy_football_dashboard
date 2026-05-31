import { describe, it, expect, vi } from "vitest";
import {
  SleeperProjectionSchema,
  SleeperProjectionListSchema,
  ProjectionsSnapshotPayloadSchema,
  buildSnapshotPayload,
  fetchSleeperWeeklyProjections,
  snapshotSourceKey,
  PROJECTION_POSITIONS,
  type SleeperProjection,
  type SleeperProjectionPosition
} from "./projections";

// Minimal valid projection fixture — mirrors the empirically-captured shape.
const qbProjection: SleeperProjection = {
  player_id: "3294",
  week: 1,
  season: "2025",
  season_type: "regular",
  team: "DAL",
  opponent: "PHI",
  category: "proj",
  company: "rotowire",
  stats: { pts_ppr: 20.6, pts_half_ppr: 20.6, pts_std: 20.6 }
};

const rbProjection: SleeperProjection = {
  player_id: "7564",
  week: 1,
  season: "2025",
  season_type: "regular",
  team: "DAL",
  opponent: "PHI",
  category: "proj",
  stats: { pts_ppr: 14.2, pts_half_ppr: 12.7, pts_std: 11.3 }
};

// Kicker — only pts_std populated, no pts_ppr/pts_half_ppr on some schemas.
const kickerProjection: SleeperProjection = {
  player_id: "9999",
  week: 1,
  season: "2025",
  season_type: "regular",
  team: "LAR",
  opponent: "SEA",
  category: "proj",
  stats: { pts_std: 7.0 }
};

describe("SleeperProjectionSchema", () => {
  it("parses a complete QB projection", () => {
    const result = SleeperProjectionSchema.safeParse(qbProjection);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player_id).toBe("3294");
      expect(result.data.stats.pts_ppr).toBe(20.6);
    }
  });

  it("accepts missing pts_ppr on kicker-like payloads", () => {
    const result = SleeperProjectionSchema.safeParse(kickerProjection);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stats.pts_ppr).toBeUndefined();
      expect(result.data.stats.pts_std).toBe(7.0);
    }
  });

  it("passes through unknown fields (schema is permissive)", () => {
    const withExtra = { ...qbProjection, game_id: "202510126", last_modified: 1759765502229 };
    const result = SleeperProjectionSchema.safeParse(withExtra);
    expect(result.success).toBe(true);
  });

  it("rejects a record missing player_id", () => {
    const bad: Record<string, unknown> = { ...qbProjection };
    delete bad.player_id;
    const result = SleeperProjectionSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects week > 18", () => {
    const result = SleeperProjectionSchema.safeParse({ ...qbProjection, week: 19 });
    expect(result.success).toBe(false);
  });
});

describe("SleeperProjectionListSchema", () => {
  it("parses an array of projections", () => {
    const result = SleeperProjectionListSchema.safeParse([qbProjection, rbProjection]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
    }
  });

  it("parses an empty array (off-season / no data)", () => {
    const result = SleeperProjectionListSchema.safeParse([]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });
});

describe("snapshotSourceKey", () => {
  it("produces season-week key", () => {
    expect(snapshotSourceKey("2025", 1)).toBe("2025-1");
    expect(snapshotSourceKey("2025", 17)).toBe("2025-17");
  });
});

describe("buildSnapshotPayload", () => {
  it("flattens byPosition map into per-player projection record", () => {
    const byPosition = new Map<SleeperProjectionPosition, SleeperProjection[]>([
      ["QB", [qbProjection]],
      ["RB", [rbProjection]]
    ]);

    const payload = buildSnapshotPayload("2025", 1, byPosition);

    expect(payload.season).toBe("2025");
    expect(payload.week).toBe(1);
    expect(payload.projections["3294"]).toEqual({
      pts_ppr: 20.6,
      pts_half_ppr: 20.6,
      pts_std: 20.6,
      position: "QB",
      team: "DAL",
      opponent: "PHI"
    });
    expect(payload.projections["7564"]).toEqual({
      pts_ppr: 14.2,
      pts_half_ppr: 12.7,
      pts_std: 11.3,
      position: "RB",
      team: "DAL",
      opponent: "PHI"
    });
  });

  it("stores null for absent scoring stats (kicker without pts_ppr)", () => {
    const byPosition = new Map<SleeperProjectionPosition, SleeperProjection[]>([
      ["K", [kickerProjection]]
    ]);
    const payload = buildSnapshotPayload("2025", 1, byPosition);

    expect(payload.projections["9999"].pts_ppr).toBeNull();
    expect(payload.projections["9999"].pts_half_ppr).toBeNull();
    expect(payload.projections["9999"].pts_std).toBe(7.0);
  });

  it("stores null for null team / opponent", () => {
    const noTeam: SleeperProjection = { ...qbProjection, player_id: "111", team: null, opponent: null };
    const byPosition = new Map<SleeperProjectionPosition, SleeperProjection[]>([["QB", [noTeam]]]);
    const payload = buildSnapshotPayload("2025", 1, byPosition);

    expect(payload.projections["111"].team).toBeNull();
    expect(payload.projections["111"].opponent).toBeNull();
  });

  it("returns empty projections map for empty byPosition", () => {
    const payload = buildSnapshotPayload("2025", 1, new Map());
    expect(Object.keys(payload.projections)).toHaveLength(0);
  });

  it("validates against ProjectionsSnapshotPayloadSchema", () => {
    const byPosition = new Map<SleeperProjectionPosition, SleeperProjection[]>([
      ["WR", [{ ...qbProjection, player_id: "555" }]]
    ]);
    const payload = buildSnapshotPayload("2025", 1, byPosition);
    const result = ProjectionsSnapshotPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});

describe("fetchSleeperWeeklyProjections", () => {
  it("fetches each position separately and returns combined byPosition map", async () => {
    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [qbProjection]
    });

    const { byPosition, failures } = await fetchSleeperWeeklyProjections({
      season: "2025",
      week: 1,
      positions: ["QB"],
      fetcher: mockFetcher as unknown as typeof fetch
    });

    expect(failures).toHaveLength(0);
    expect(byPosition.has("QB")).toBe(true);
    expect(byPosition.get("QB")).toHaveLength(1);
    expect(mockFetcher).toHaveBeenCalledWith(
      "https://api.sleeper.app/projections/nfl/2025/1?season_type=regular&position[]=QB"
    );
  });

  it("records a failure entry on HTTP error and continues", async () => {
    const mockFetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [rbProjection] });

    const { byPosition, failures } = await fetchSleeperWeeklyProjections({
      season: "2025",
      week: 1,
      positions: ["QB", "RB"],
      fetcher: mockFetcher as unknown as typeof fetch
    });

    expect(failures).toHaveLength(1);
    expect(failures[0].position).toBe("QB");
    expect(failures[0].reason).toMatch(/503/);
    expect(byPosition.has("RB")).toBe(true);
  });

  it("records a failure on schema mismatch and continues", async () => {
    const mockFetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ bad: "data" }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [rbProjection] });

    const { byPosition, failures } = await fetchSleeperWeeklyProjections({
      season: "2025",
      week: 1,
      positions: ["QB", "RB"],
      fetcher: mockFetcher as unknown as typeof fetch
    });

    expect(failures).toHaveLength(1);
    expect(failures[0].position).toBe("QB");
    expect(failures[0].reason).toMatch(/schema/);
    expect(byPosition.get("RB")).toHaveLength(1);
  });

  it("records a failure on network error and continues", async () => {
    const mockFetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockResolvedValueOnce({ ok: true, json: async () => [rbProjection] });

    const { byPosition, failures } = await fetchSleeperWeeklyProjections({
      season: "2025",
      week: 1,
      positions: ["QB", "RB"],
      fetcher: mockFetcher as unknown as typeof fetch
    });

    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toMatch(/network timeout/);
    expect(byPosition.has("RB")).toBe(true);
  });

  it("uses PROJECTION_POSITIONS by default", async () => {
    const mockFetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });

    await fetchSleeperWeeklyProjections({
      season: "2025",
      week: 1,
      fetcher: mockFetcher as unknown as typeof fetch
    });

    expect(mockFetcher).toHaveBeenCalledTimes(PROJECTION_POSITIONS.length);
  });
});
