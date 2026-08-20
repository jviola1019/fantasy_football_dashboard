import { describe, it, expect, vi } from "vitest";
import {
  SleeperProjectionSchema,
  SleeperProjectionListSchema,
  ProjectionsSnapshotPayloadSchema,
  buildSnapshotPayload,
  fetchSleeperWeeklyProjections,
  snapshotSourceKey,
  snapshotToWeeklyProjections,
  PROJECTION_POSITIONS,
  type ProjectionsSnapshotPayload,
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

// ── Audit 2026-08-20 §7 / §7b ────────────────────────────────────────────────
describe("snapshotToWeeklyProjections", () => {
  const payload = (
    projections: ProjectionsSnapshotPayload["projections"]
  ): ProjectionsSnapshotPayload => ({ season: "2025", week: 8, projections });

  const row = (over: Record<string, unknown> = {}) => ({
    pts_ppr: 22,
    pts_half_ppr: 16,
    pts_std: 10,
    position: "WR" as const,
    team: "DAL",
    opponent: "PHI",
    ...over
  });

  it("namespaces every key to match PlayerMarketRecord.id (§7b regression)", () => {
    // The defect: the snapshot key is Sleeper's bare player_id, but every record
    // id is `sleeper:{player_id}`. The simulator looked up by record id, so the
    // live projection path never matched a single player.
    const out = snapshotToWeeklyProjections(payload({ "3294": row() }));
    expect(Object.keys(out)).toEqual(["sleeper:3294"]);
    expect(out["3294"]).toBeUndefined();
  });

  it("carries all three scoring variants plus the position, uncollapsed (§7)", () => {
    const out = snapshotToWeeklyProjections(payload({ "3294": row() }));
    expect(out["sleeper:3294"]).toEqual({
      ppr: 22,
      halfPpr: 16,
      standard: 10,
      position: "WR"
    });
  });

  it("preserves nulls rather than substituting a different variant", () => {
    const out = snapshotToWeeklyProjections(
      payload({ "1": row({ pts_std: null, pts_half_ppr: null }) })
    );
    expect(out["sleeper:1"]).toEqual({
      ppr: 22,
      halfPpr: null,
      standard: null,
      position: "WR"
    });
  });

  it("drops a row with no variant at all, so it cannot pose as a live projection", () => {
    const out = snapshotToWeeklyProjections(
      payload({
        "1": row({ pts_ppr: null, pts_half_ppr: null, pts_std: null }),
        "2": row()
      })
    );
    expect(Object.keys(out)).toEqual(["sleeper:2"]);
  });

  it("keeps a legitimate zero", () => {
    const out = snapshotToWeeklyProjections(
      payload({ "1": row({ pts_ppr: 0, pts_half_ppr: 0, pts_std: 0, position: "K" }) })
    );
    expect(out["sleeper:1"]).toEqual({ ppr: 0, halfPpr: 0, standard: 0, position: "K" });
  });
});
