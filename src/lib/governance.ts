import { z } from "zod";
import { LeagueFormatSchema } from "./trade/format";

export const FreshnessStateSchema = z.enum(["fresh", "stale", "missing", "unavailable", "fixture"]);
export type FreshnessState = z.infer<typeof FreshnessStateSchema>;

export const SourceMetaSchema = z.object({
  source: z.string().min(1),
  fetchedAt: z.string().datetime().nullable(),
  ttlSeconds: z.number().int().positive(),
  freshness: FreshnessStateSchema,
  confidence: z.number().min(0).max(1),
  validation: z.enum(["valid", "invalid", "not-run"]),
  missingFields: z.array(z.string()),
  assumptions: z.array(z.string()),
  failure: z.string().nullable()
});
export type SourceMeta = z.infer<typeof SourceMetaSchema>;

export const PlayerMarketRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.enum(["QB", "RB", "WR", "TE", "K", "DEF"]),
  team: z.string().nullable(),
  perceivedValue: z.number().min(0).max(100),
  trueValue: z.number().min(0).max(100),
  ownershipLeverage: z.number().min(-100).max(100),
  fragility: z.number().min(0).max(100),
  trendingMomentum: z.number().min(-100).max(100),
  volatility: z.number().min(0).max(100),
  opportunity: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  sources: z.array(SourceMetaSchema),
  rosterSlot: z.string(),
  status: z.enum(["active", "questionable", "out", "ir", "bye", "unknown"]),
  imageUrl: z.string().url(),
  imageSource: z.string()
});
export type PlayerMarketRecord = z.infer<typeof PlayerMarketRecordSchema>;

export const RAEEnvelopeSchema = z.object({
  mode: z.enum(["live", "fixture", "unavailable"]),
  generatedAt: z.string().datetime(),
  records: z.array(PlayerMarketRecordSchema),
  sourceState: SourceMetaSchema,
  // The signed-in user's league-format settings (Sleeper roster_positions
  // + Sleeper settings, or ESPN mSettings) when a real league drives the
  // envelope. null for fixture/unavailable envelopes and for live envelopes
  // where the user hasn't connected a league yet. Optional in the schema so
  // existing fixture payloads still parse without modification.
  leagueFormat: LeagueFormatSchema.nullable().optional(),
  // Per-player weekly projections (sleeperId → pts_ppr) from the Sleeper
  // undocumented projections endpoint (via cron). Only populated during the
  // regular season when the projections-refresh cron has fired. Optional so
  // fixture + off-season envelopes parse without modification.
  weeklyProjections: z.record(z.string(), z.number()).nullable().optional(),
  // Metadata about the weekly projection snapshot used above.
  weeklyProjectionsMeta: z
    .object({
      season: z.string(),
      week: z.number().int(),
      fetchedAt: z.string().datetime()
    })
    .nullable()
    .optional(),
  // Full draftable player pool (all FantasyPros-ranked players as records), used
  // by the Draft Intelligence / mock-draft view so you can draft ANY player —
  // not just the ~15 on your current roster. Null when no rankings are cached;
  // the draft panel then falls back to `records`. Optional so older payloads parse.
  draftPool: z.array(PlayerMarketRecordSchema).nullable().optional()
});
export type RAEEnvelope = z.infer<typeof RAEEnvelopeSchema>;

export function evaluateFreshness(fetchedAt: string | null, ttlSeconds: number, now = new Date()): FreshnessState {
  if (!fetchedAt) return "missing";
  const fetched = Date.parse(fetchedAt);
  if (Number.isNaN(fetched)) return "unavailable";
  const ageSeconds = (now.getTime() - fetched) / 1000;
  return ageSeconds <= ttlSeconds ? "fresh" : "stale";
}

export function unavailableSource(source: string, failure: string): SourceMeta {
  return {
    source,
    fetchedAt: null,
    ttlSeconds: 900,
    freshness: "unavailable",
    confidence: 0,
    validation: "not-run",
    missingFields: ["records"],
    assumptions: ["No production values are fabricated when the adapter cannot provide data."],
    failure
  };
}

export function boundedCacheKey(namespace: string, params: Record<string, string | number | boolean | null>): string {
  const normalized = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value ?? "null"}`)
    .join("|");
  return `${namespace}:${normalized}`;
}
