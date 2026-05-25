import { z } from "zod";

// KeepTradeCut embeds a `playersArray = [...]` JSON literal on both
// https://keeptradecut.com/dynasty-rankings (dynasty values) and
// https://keeptradecut.com/fantasy-rankings (redraft values). Shape is
// stable across both; the only difference is the `oneQBValues.startSitValue`
// and `superflexValues.*` scales. We keep a tight zod schema for the fields
// we actually consume — extra keys pass through silently via .passthrough().

export type KtcVariant = "dynasty" | "redraft";

export const KtcVariantSchema = z.enum(["dynasty", "redraft"]);

// Inner value object shared by oneQBValues + superflexValues.
const KtcValueBlockSchema = z
  .object({
    // The core scalar we use for trade grading. Higher = more valuable.
    // KTC normalizes startSitValue to roughly [0, 10000].
    startSitValue: z.number().int().min(0),
    // Optional trend signals (KTC publishes overall + positional flavors,
    // both daily and 7-day). We surface the 7-day so it survives single-day
    // outliers, but the per-player schema is permissive.
    overall7DayTrend: z.number().int().optional(),
    positional7DayTrend: z.number().int().optional(),
    // Crowdsourced trade-poll counts (kept / traded / cut). Useful for
    // sentiment context but not required for valuation.
    kept: z.number().int().optional(),
    traded: z.number().int().optional(),
    cut: z.number().int().optional(),
    // Positional + overall ranks come back as multiple flavors depending on
    // page (startSit vs straight). Optional to keep the schema robust.
    startSitOverallRank: z.number().int().optional(),
    startSitPositionalRank: z.number().int().optional()
  })
  .passthrough();

export const KtcPlayerSchema = z
  .object({
    // KTC's internal player id. Stable across snapshots; useful as a cache key
    // but NOT directly equivalent to sleeper_id or espn_id — match via name.
    playerID: z.number().int(),
    playerName: z.string().min(1),
    slug: z.string().optional(),
    // Position string, e.g. "RB", "WR", "PICK" (for rookie picks). We filter
    // PICK out before matching against Sleeper/ESPN rosters.
    position: z.string(),
    positionID: z.number().int().optional(),
    team: z.string().nullable().optional(),
    rookie: z.boolean().optional(),
    age: z.number().optional(),
    // The two value containers — both always present per fixture.
    oneQBValues: KtcValueBlockSchema,
    superflexValues: KtcValueBlockSchema.optional()
  })
  .passthrough();
export type KtcPlayer = z.infer<typeof KtcPlayerSchema>;

// The full parsed payload — a non-empty array of player records, plus the
// variant we asked for. variant is set by the caller (not present in the
// inline JSON itself) so the snapshot row can be keyed by variant.
export const KtcSnapshotPayloadSchema = z.object({
  variant: KtcVariantSchema,
  players: z.array(KtcPlayerSchema).min(1)
});
export type KtcSnapshotPayload = z.infer<typeof KtcSnapshotPayloadSchema>;

export interface KtcRankingsSnapshot {
  id: string;
  variant: KtcVariant;
  fetchedAt: Date;
  sizeBytes: number;
  data: KtcSnapshotPayload;
}
