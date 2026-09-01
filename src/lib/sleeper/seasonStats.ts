import { z } from "zod";
import { SLEEPER_BASE } from "./players";

/**
 * Season-to-date ACTUAL scoring from Sleeper, keyed by `player_id`.
 *
 * WHY THIS EXISTS.
 *
 * Protocols 4 and 5 established the one signal in this product that survived
 * out-of-sample testing: **in-season usage predicts rest-of-season scoring
 * beyond what points already scored predict** (+0.0137 and +0.0195 Spearman,
 * both replicated on data neither test was tuned on).
 *
 * Shipping it needs BOTH halves. RAE had usage — `opportunity`, from the
 * nflverse snap-share cron — and had no points-to-date at all, anywhere. The
 * validation dossier recorded the consequence honestly: *"the opportunity
 * weight is validated for a model RAE has not built."* This module is the half
 * that was missing.
 *
 * `pts_ppr` is the league-agnostic PPR total. RAE re-scores per league format
 * elsewhere; this is the raw season aggregate, stored as fetched.
 */

/** One player's season aggregate. Sleeper returns many more fields; these are read. */
export const SeasonStatLineSchema = z.object({
  /** Season-to-date PPR points. */
  pts_ppr: z.number(),
  /** Games played. Needed for per-game normalisation — protocols 4/5 both use per-game. */
  gp: z.number().int().nonnegative().optional(),
  /** Receptions and carries, so touches can be derived without a second source. */
  rec: z.number().optional(),
  rush_att: z.number().optional()
});
export type SeasonStatLine = z.infer<typeof SeasonStatLineSchema>;

export const SeasonStatsMapSchema = z.record(z.string(), SeasonStatLineSchema);
export type SeasonStatsMap = z.infer<typeof SeasonStatsMapSchema>;

/**
 * Keep only entries that carry a usable `pts_ppr`.
 *
 * Sleeper returns a row for every player it knows about — 8,244 in 2024, of
 * which 1,362 have points. Storing the other 6,882 would be storing the absence
 * of information at ~5x the size, and every consumer would then have to
 * re-derive "does this player have points" for itself.
 *
 * Kickers and defenses are retained: they score, and a league that starts them
 * needs them ranked.
 */
export function keepScoringPlayers(raw: Record<string, unknown>): SeasonStatsMap {
  const out: SeasonStatsMap = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const parsed = SeasonStatLineSchema.safeParse(value);
    if (!parsed.success) continue;
    // 0 is a real score (a player who played and scored nothing); undefined is
    // not. `safeParse` already rejected the second, so this only drops rows
    // where Sleeper carries the key with a non-numeric value.
    if (!Number.isFinite(parsed.data.pts_ppr)) continue;
    out[id] = parsed.data;
  }
  return out;
}

export interface SeasonStatsFetch {
  stats: SeasonStatsMap | null;
  source: string;
  error: string | null;
}

/**
 * Fetch one season's aggregate stats.
 *
 * Returns `stats: null` on any failure rather than throwing, so the cron can
 * report a 502 and — critically — **not overwrite a good snapshot with
 * nothing**. That is the P1-5 rule: an empty snapshot resets the freshness
 * clock while the feature goes dark.
 */
export async function fetchSeasonStats(
  season: string,
  fetcher: typeof fetch = fetch
): Promise<SeasonStatsFetch> {
  const url = `${SLEEPER_BASE}/v1/stats/nfl/regular/${encodeURIComponent(season)}`;
  try {
    const res = await fetcher(url);
    if (!res.ok) return { stats: null, source: url, error: `HTTP ${res.status}` };
    const body: unknown = await res.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { stats: null, source: url, error: "unexpected payload shape" };
    }
    const stats = keepScoringPlayers(body as Record<string, unknown>);
    if (Object.keys(stats).length === 0) {
      return { stats: null, source: url, error: "no player carried a usable pts_ppr" };
    }
    return { stats, source: url, error: null };
  } catch (err) {
    return { stats: null, source: url, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Points and touches PER GAME, matching how protocols 4 and 5 defined them.
 *
 * Per game, not per season: a player who missed six weeks has a smaller season
 * total for a reason that says nothing about their rate. Both frozen protocols
 * normalised this way, so the shipped feature has to as well or it is not the
 * thing that was validated.
 *
 * Returns null when `gp` is absent or zero — an unknown rate, never zero.
 */
export function perGame(line: SeasonStatLine): { points: number; touches: number } | null {
  const gp = line.gp ?? 0;
  if (!Number.isFinite(gp) || gp <= 0) return null;
  const touches = (line.rec ?? 0) + (line.rush_att ?? 0);
  return { points: line.pts_ppr / gp, touches: touches / gp };
}
