// Sleeper undocumented per-week projections endpoint.
//
// The shape was empirically captured 2026-05-27 against:
//   GET https://api.sleeper.app/projections/nfl/{season}/{week}
//       ?season_type=regular&position[]=QB&position[]=RB&...
// The endpoint has been stable since 2021 and is consumed by the Sleeper
// mobile app. No auth, no rate limit observed.
//
// Per-player payload (example fields, schema permissive — extras ignored):
//   {
//     "player_id": "3294",
//     "week": 1,
//     "season": "2025",
//     "season_type": "regular",
//     "team": "DAL",
//     "opponent": "PHI",
//     "game_id": "202510126",
//     "category": "proj",
//     "company": "rotowire",
//     "last_modified": 1759765502229,
//     "stats": {
//       "pts_ppr": 20.6,
//       "pts_half_ppr": 20.6,
//       "pts_std": 20.6,
//       "pass_yd": 253.84,
//       "pass_td": 1.8,
//       ...
//     },
//     "player": { "first_name": "Dak", "last_name": "Prescott", "position": "QB", ... }
//   }
//
// The cron asks for one position at a time so a single failure (network,
// schema drift) only loses that position rather than the whole week.

import { z } from "zod";
import type { WeeklyProjectionByFormat } from "../leagues/scoringPoints";

export const SleeperProjectionPositionSchema = z.enum([
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DEF"
]);
export type SleeperProjectionPosition = z.infer<typeof SleeperProjectionPositionSchema>;

export const PROJECTION_POSITIONS: readonly SleeperProjectionPosition[] = [
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DEF"
] as const;

const StatsSchema = z
  .object({
    // The three scoring formats we care about. All optional because Sleeper
    // omits keys for positions that don't generate the stat (K won't have
    // pts_ppr on DEF schemas, etc.).
    pts_ppr: z.number().optional(),
    pts_half_ppr: z.number().optional(),
    pts_std: z.number().optional()
  })
  .passthrough();

export const SleeperProjectionSchema = z
  .object({
    player_id: z.string(),
    week: z.number().int().min(1).max(18),
    season: z.string(),
    season_type: z.string(),
    team: z.string().nullable().optional(),
    opponent: z.string().nullable().optional(),
    category: z.string(),
    company: z.string().optional(),
    last_modified: z.number().int().optional(),
    stats: StatsSchema
  })
  .passthrough();
export type SleeperProjection = z.infer<typeof SleeperProjectionSchema>;

export const SleeperProjectionListSchema = z.array(SleeperProjectionSchema);

// What the snapshot payload looks like once we've fetched + filtered + de-
// duplicated across the position list. Keyed by sleeper player_id for O(1)
// lookup in the simulator.
export const ProjectionsSnapshotPayloadSchema = z.object({
  season: z.string(),
  week: z.number().int().min(1).max(18),
  // Map: sleeperPlayerId -> { pts_ppr, pts_half_ppr, pts_std, position }.
  // Stored as a plain object so JSONB serialises cleanly.
  projections: z.record(
    z.string(),
    z.object({
      pts_ppr: z.number().nullable(),
      pts_half_ppr: z.number().nullable(),
      pts_std: z.number().nullable(),
      position: SleeperProjectionPositionSchema,
      team: z.string().nullable(),
      opponent: z.string().nullable()
    })
  )
});
export type ProjectionsSnapshotPayload = z.infer<typeof ProjectionsSnapshotPayloadSchema>;

export interface ProjectionsSnapshot {
  id: string;
  source: string; // "{season}-{week}"
  fetchedAt: Date;
  sizeBytes: number;
  data: ProjectionsSnapshotPayload;
}

/**
 * Build the snapshot source key — `{season}-{week}`. Used as the `source`
 * column so the same season can hold a row per week.
 */
export function snapshotSourceKey(season: string, week: number): string {
  return `${season}-${week}`;
}

interface FetchOptions {
  season: string;
  week: number;
  positions?: readonly SleeperProjectionPosition[];
  fetcher?: typeof fetch;
}

/**
 * Fetch projections for the given (season, week) across the position list.
 * Each position is requested separately so a partial outage (one position
 * returning 5xx) doesn't lose the rest. Returns a position-keyed map.
 *
 * The Sleeper endpoint accepts repeated `position[]=` query params; here we
 * issue one HTTP call per position so we can log per-position failures.
 */
export async function fetchSleeperWeeklyProjections({
  season,
  week,
  positions = PROJECTION_POSITIONS,
  fetcher = fetch
}: FetchOptions): Promise<{
  byPosition: Map<SleeperProjectionPosition, SleeperProjection[]>;
  failures: Array<{ position: SleeperProjectionPosition; reason: string }>;
}> {
  const byPosition = new Map<SleeperProjectionPosition, SleeperProjection[]>();
  const failures: Array<{ position: SleeperProjectionPosition; reason: string }> = [];

  for (const position of positions) {
    const url =
      `https://api.sleeper.app/projections/nfl/${season}/${week}` +
      `?season_type=regular&position[]=${position}`;
    try {
      const res = await fetcher(url);
      if (!res.ok) {
        failures.push({ position, reason: `HTTP ${res.status}` });
        continue;
      }
      const raw = await res.json();
      const parsed = SleeperProjectionListSchema.safeParse(raw);
      if (!parsed.success) {
        failures.push({ position, reason: `schema: ${parsed.error.message.slice(0, 200)}` });
        continue;
      }
      byPosition.set(position, parsed.data);
    } catch (err) {
      failures.push({
        position,
        reason: err instanceof Error ? err.message.slice(0, 200) : "unknown"
      });
    }
  }

  return { byPosition, failures };
}

/**
 * Reduce the per-position fetched arrays into the flat payload shape that
 * gets persisted. Pulls the three scoring scalars + identity into a single
 * record per player_id. Pure — testable without HTTP.
 */
export function buildSnapshotPayload(
  season: string,
  week: number,
  byPosition: Map<SleeperProjectionPosition, SleeperProjection[]>
): ProjectionsSnapshotPayload {
  const projections: ProjectionsSnapshotPayload["projections"] = {};
  for (const [position, list] of byPosition.entries()) {
    for (const proj of list) {
      // Honestly degrade: if a stat is absent, store null rather than 0 so
      // the consumer can distinguish "didn't project" from "projected zero".
      projections[proj.player_id] = {
        pts_ppr: proj.stats.pts_ppr ?? null,
        pts_half_ppr: proj.stats.pts_half_ppr ?? null,
        pts_std: proj.stats.pts_std ?? null,
        position,
        team: proj.team ?? null,
        opponent: proj.opponent ?? null
      };
    }
  }
  return { season, week, projections };
}

/**
 * Map a persisted projections snapshot into the envelope's weekly-projection
 * record.
 *
 * Two contracts live here, and both were audit findings:
 *
 *  - **Key namespace (§7b).** The snapshot is keyed by Sleeper's bare
 *    `player_id`; every `PlayerMarketRecord.id` is `sleeper:{player_id}` (see
 *    `normalize.ts`). The simulator looks projections up by `record.id`, so a
 *    bare key matched nothing and the entire live-projection path was dead code
 *    while the UI announced "Live week-N projections". The prefix is applied
 *    HERE, once, so no consumer does string surgery and no consumer can get it
 *    wrong.
 *  - **No unit collapse (§7).** All three scoring variants are carried through.
 *    The numeric is chosen at the simulation boundary, from the same
 *    `scoringFormat` that sets the opponent field baseline.
 *
 * Rows with no variant at all are dropped, so an empty row can never
 * masquerade as a live projection.
 */
export function snapshotToWeeklyProjections(
  payload: ProjectionsSnapshotPayload
): Record<string, WeeklyProjectionByFormat> {
  const out: Record<string, WeeklyProjectionByFormat> = {};
  for (const [playerId, p] of Object.entries(payload.projections)) {
    if (p.pts_ppr == null && p.pts_half_ppr == null && p.pts_std == null) continue;
    out[`sleeper:${playerId}`] = {
      ppr: p.pts_ppr,
      halfPpr: p.pts_half_ppr,
      standard: p.pts_std,
      position: p.position
    };
  }
  return out;
}
