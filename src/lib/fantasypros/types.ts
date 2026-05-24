import { z } from "zod";

// FantasyPros embeds a `window.ecrData = {...};` JSON blob in the consensus
// cheatsheet HTML. The shape below is a subset of fields that we actually
// consume — extra keys are permitted and dropped silently by `.passthrough()`.

export const FpPositionSchema = z.enum(["QB", "RB", "WR", "TE", "K", "DST", "FLEX", "OP"]);
export type FpPosition = z.infer<typeof FpPositionSchema>;

export const FpScoringSchema = z.enum(["STD", "PPR", "HALF"]);
export type FpScoring = z.infer<typeof FpScoringSchema>;

// Each player row in the ecrData JSON. Rank fields are strings in the
// upstream payload (FantasyPros serializes numerics as strings for some
// reason) — coerce to numbers so callers don't have to.
export const FpPlayerSchema = z
  .object({
    // Internal FantasyPros id — stable across snapshots, useful as a cache key.
    player_id: z.number().int(),
    player_name: z.string().min(1),
    player_team_id: z.string().nullable().optional(),
    // The position the player is eligible at, e.g. "RB" or "WR".
    player_position_id: FpPositionSchema,
    // Some players are multi-eligible — typically the same as position_id.
    player_positions: z.string().optional(),
    player_short_name: z.string().optional(),
    player_bye_week: z.string().nullable().optional(),
    // Percentage of leagues this player is rostered in (Yahoo + ESPN average).
    // 0-100. Null pre-season for rookies who haven't been drafted anywhere.
    player_owned_avg: z.number().min(0).max(100).nullable().optional(),
    // Consensus rank, lower is better. 1 = top player overall.
    rank_ecr: z.number().int().min(1),
    // String-encoded rank statistics from the expert pool.
    rank_min: z.coerce.number().int().min(1),
    rank_max: z.coerce.number().int().min(1),
    rank_ave: z.coerce.number().min(0),
    rank_std: z.coerce.number().min(0),
    // Positional rank label, e.g. "RB3", "WR12".
    pos_rank: z.string().optional(),
    // FantasyPros' tier number — players within a tier are considered roughly
    // interchangeable. Lower = better tier.
    tier: z.number().int().min(1).nullable().optional()
  })
  .passthrough();
export type FpPlayer = z.infer<typeof FpPlayerSchema>;

export const FpEcrDataSchema = z
  .object({
    sport: z.literal("NFL"),
    type: z.string(),
    year: z.coerce.number().int(),
    week: z.coerce.number().int(),
    position_id: z.string(),
    scoring: FpScoringSchema,
    count: z.number().int(),
    total_experts: z.number().int(),
    last_updated: z.string(),
    players: z.array(FpPlayerSchema).min(1)
  })
  .passthrough();
export type FpEcrData = z.infer<typeof FpEcrDataSchema>;

// Stored snapshot returned by snapshot.ts — the JSON-decoded payload plus
// the DB row metadata. Distinct from FpEcrData so callers don't accidentally
// rely on DB internals.
export interface FpRankingsSnapshot {
  id: string;
  scoring: FpScoring;
  fetchedAt: Date;
  sizeBytes: number;
  data: FpEcrData;
}
