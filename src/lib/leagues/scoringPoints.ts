import { z } from "zod";
import type { ScoringFormat } from "../trade/format";

/**
 * A player-week projection carrying ALL THREE scoring variants, plus the
 * position that decides whether substituting one for another is dimensionally
 * legal.
 *
 * - `ppr` — Sleeper `stats.pts_ppr`; null when the row did not carry it.
 * - `halfPpr` — Sleeper `stats.pts_half_ppr`.
 * - `standard` — Sleeper `stats.pts_std`.
 * - `position` — Sleeper position, deciding substitution legality (see
 *   {@link RECEPTION_NEUTRAL_POSITIONS}). Unknown/absent is treated as
 *   reception-scoring, which is the conservative side.
 *
 * Audit 2026-08-20 §7. The predecessor of this type was a bare
 * `Record<string, number>` collapsed to one scoring format at envelope-build
 * time, which crossed the simulation boundary with no unit attached. Nothing in
 * the type system then stopped a PPR number being compared against a
 * standard-scoring opponent field. The three variants now travel together and
 * the numeric is chosen at the ONE place that also chooses the opponent field's
 * baseline, so the two sides of the comparison cannot disagree.
 *
 * Schema-first so the envelope contract and the TypeScript type cannot drift.
 */
export const WeeklyProjectionByFormatSchema = z.object({
  ppr: z.number().nullable(),
  halfPpr: z.number().nullable(),
  standard: z.number().nullable(),
  position: z.string().nullable()
});
export type WeeklyProjectionByFormat = z.infer<typeof WeeklyProjectionByFormatSchema>;

/**
 * Positions whose projection is IDENTICAL in all three scoring formats, because
 * reception scoring is the only difference between the formats and these
 * positions are not credited with receptions.
 *
 * This is measured, not assumed. Sleeper projections for 2025 week 8:
 *
 * | position | rows | ppr == std | mean |ppr − std| | max |ppr − std| |
 * |----------|------|------------|------------------|-----------------|
 * | QB       |   26 | 26 / 26    | 0.00             | 0.00            |
 * | K        |   25 | 25 / 25    | 0.00             | 0.00            |
 * | DEF      |   26 | 26 / 26    | 0.00             | 0.00            |
 * | RB       |   78 |  0 / 78    | 1.47             | 6.20            |
 * | WR       |  124 |  0 / 124   | 2.21             | 6.38            |
 * | TE       |   73 |  0 / 73    | 1.89             | 5.04            |
 *
 * Reproduce with `npm run check:projection-units`.
 *
 * So for QB/K/DEF a cross-format read is the SAME number and substituting is
 * lossless; for RB/WR/TE it silently changes the unit by 1.5-2.2 points on
 * average and must not happen.
 */
export const RECEPTION_NEUTRAL_POSITIONS: readonly string[] = ["QB", "K", "DEF", "DST", "D/ST"];

/** Which Sleeper stat field a selected projection actually came from. */
export type ProjectionField = "pts_ppr" | "pts_half_ppr" | "pts_std";

export interface SelectedProjection {
  /** The projection in the league's OWN scoring unit. */
  points: number;
  /** The Sleeper field the number came from — provenance, never inferred. */
  field: ProjectionField;
  /**
   * True when `field` does not correspond to the requested format. Only ever
   * true for a {@link RECEPTION_NEUTRAL_POSITIONS} position, where the formats
   * are provably identical, so the unit is still the league's own.
   */
  substituted: boolean;
}

const FIELD_FOR: Record<ScoringFormat, ProjectionField> = {
  PPR: "pts_ppr",
  HALF: "pts_half_ppr",
  STD: "pts_std"
};

function valueFor(p: WeeklyProjectionByFormat, scoring: ScoringFormat): number | null {
  if (scoring === "PPR") return p.ppr;
  if (scoring === "HALF") return p.halfPpr;
  return p.standard;
}

/**
 * Select the projection for `scoring`, in `scoring`'s own unit.
 *
 * Returns `null` — meaning "this player has no live projection in this league's
 * unit" — rather than substituting a differently-scaled number. The caller then
 * falls back to the structural trueValue path, which IS already scaled to the
 * league format (see `avgStarterPtsFor`), so the fallback stays dimensionally
 * consistent instead of quietly importing PPR points into a standard league.
 *
 * The one permitted substitution is a reception-neutral position (QB/K/DEF),
 * where the three fields are the same number by construction.
 */
export function selectProjectionForFormat(
  p: WeeklyProjectionByFormat,
  scoring: ScoringFormat
): SelectedProjection | null {
  const exact = valueFor(p, scoring);
  if (exact != null) return { points: exact, field: FIELD_FOR[scoring], substituted: false };

  // No same-unit value. Substitution is legal only where the formats coincide.
  const neutral = p.position != null && RECEPTION_NEUTRAL_POSITIONS.includes(p.position);
  if (!neutral) return null;

  const order: ReadonlyArray<[ScoringFormat, ProjectionField]> = [
    ["PPR", "pts_ppr"],
    ["HALF", "pts_half_ppr"],
    ["STD", "pts_std"]
  ];
  for (const [fmt, field] of order) {
    if (fmt === scoring) continue;
    const v = valueFor(p, fmt);
    if (v != null) return { points: v, field, substituted: true };
  }
  return null;
}
