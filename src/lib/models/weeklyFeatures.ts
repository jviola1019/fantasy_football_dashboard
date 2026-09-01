/**
 * Causal features for the weekly start/sit model — protocol 7, §3.
 *
 * THE ONE RULE. A row for week *w* may use weeks 1…*w*−1 and nothing else. A
 * "rolling" feature computed over the whole season is the single easiest way to
 * manufacture a result, and it produces a model that looks excellent and cannot
 * be used, because at decision time week *w*'s outcomes do not exist yet.
 *
 * The rule is enforced structurally rather than by care: history is accumulated
 * as the builder walks weeks in ascending order, and a week's outcomes are
 * folded in only AFTER its rows have been emitted. There is no code path that
 * can see the current week's result, so the leakage test is checking a shape,
 * not a habit.
 *
 * Same-week PROJECTIONS are fair game — rank and z-score within (position,
 * week) use only other players' pre-game projections, which are available when
 * the decision is made.
 */

export interface WeeklyRow {
  player_id: string;
  position: string;
  week: number;
  proj_pts_ppr: number;
  actual_pts_ppr: number;
  played?: boolean;
}

/** Feature names, in the order `buildFeatures` emits them. Protocol 7 §3. */
export const FEATURE_NAMES = [
  "proj_pts_ppr",
  "proj_rank_in_week",
  "proj_z_in_week",
  "prior_mean_actual",
  "prior_sd_actual",
  "prior_hit_rate",
  "prior_mean_proj_error",
  "prior_sd_proj_error",
  "prior_games",
  "prior_dnp",
  "week"
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

export interface BuiltFeatures {
  X: number[][];
  y: (0 | 1)[];
  /** Fold key — the week each row belongs to. */
  fold: number[];
  /** Cluster key for the bootstrap — rows from one player are not independent. */
  cluster: string[];
  rows: WeeklyRow[];
}

interface History {
  actuals: number[];
  errors: number[];
  hits: number;
  games: number;
  dnp: number;
}

const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/** Population sd, matching `inSeasonScore`'s convention so the two agree. */
const sd = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / xs.length);
};

/**
 * Build the protocol-7 feature matrix for one position.
 *
 * Week 1 has no history, so features 4–10 are filled with the POSITION-LEVEL
 * prior mean and flagged by `prior_games = 0`. They are not dropped: dropping
 * week 1 would change the evaluation set between arms and make the comparison
 * between them invalid, which is a worse problem than a few imputed rows.
 *
 * The imputation value is computed from the same expanding history, so it too
 * only ever sees earlier weeks.
 */
export function buildFeatures(rows: readonly WeeklyRow[], threshold: number): BuiltFeatures {
  const weeks = [...new Set(rows.map((r) => r.week))].sort((a, b) => a - b);
  const history = new Map<string, History>();

  // Running position-level pools, used to impute a player's missing history.
  const seenActuals: number[] = [];
  const seenErrors: number[] = [];
  let seenHits = 0;
  let seenRows = 0;

  const X: number[][] = [];
  const y: (0 | 1)[] = [];
  const fold: number[] = [];
  const cluster: string[] = [];
  const emitted: WeeklyRow[] = [];

  for (const week of weeks) {
    const weekRows = rows.filter((r) => r.week === week);

    // Same-week projection context: rank (1 = highest) and z-score. Pre-game.
    const projections = weekRows.map((r) => r.proj_pts_ppr);
    const pm = mean(projections);
    const ps = sd(projections);
    const ranked = [...weekRows].sort((a, b) => b.proj_pts_ppr - a.proj_pts_ppr);
    const rankOf = new Map<string, number>();
    ranked.forEach((r, i) => rankOf.set(r.player_id, i + 1));

    const poolMeanActual = seenActuals.length > 0 ? mean(seenActuals) : 0;
    const poolSdActual = seenActuals.length > 0 ? sd(seenActuals) : 0;
    const poolHitRate = seenRows > 0 ? seenHits / seenRows : 0.5;
    const poolMeanError = seenErrors.length > 0 ? mean(seenErrors) : 0;
    const poolSdError = seenErrors.length > 0 ? sd(seenErrors) : 0;

    for (const r of weekRows) {
      const h = history.get(r.player_id);
      const hasHistory = h != null && h.games > 0;

      X.push([
        r.proj_pts_ppr,
        rankOf.get(r.player_id) ?? weekRows.length,
        ps === 0 ? 0 : (r.proj_pts_ppr - pm) / ps,
        hasHistory ? mean(h!.actuals) : poolMeanActual,
        hasHistory ? sd(h!.actuals) : poolSdActual,
        hasHistory ? h!.hits / h!.games : poolHitRate,
        hasHistory ? mean(h!.errors) : poolMeanError,
        hasHistory ? sd(h!.errors) : poolSdError,
        h?.games ?? 0,
        h?.dnp ?? 0,
        r.week
      ]);
      y.push(r.actual_pts_ppr >= threshold ? 1 : 0);
      fold.push(r.week);
      cluster.push(r.player_id);
      emitted.push(r);
    }

    // Only NOW does this week's outcome become history. Folding it in before the
    // emit loop above would leak the answer into its own features.
    for (const r of weekRows) {
      const h = history.get(r.player_id) ?? { actuals: [], errors: [], hits: 0, games: 0, dnp: 0 };
      h.actuals.push(r.actual_pts_ppr);
      h.errors.push(r.actual_pts_ppr - r.proj_pts_ppr);
      h.games += 1;
      if (r.actual_pts_ppr >= threshold) h.hits += 1;
      if (r.played === false) h.dnp += 1;
      history.set(r.player_id, h);

      seenActuals.push(r.actual_pts_ppr);
      seenErrors.push(r.actual_pts_ppr - r.proj_pts_ppr);
      seenRows += 1;
      if (r.actual_pts_ppr >= threshold) seenHits += 1;
    }
  }

  return { X, y, fold, cluster, rows: emitted };
}

/** Just the projection, as arm A uses it — so both arms read the same rows. */
export function projectionOnly(built: BuiltFeatures): number[][] {
  return built.X.map((row) => [row[0]!]);
}
