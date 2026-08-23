import type { PlayerMarketRecord } from "../governance";
import type { LeagueFormat } from "../trade/format";
import {
  DEFAULT_REPLACEMENT_MODEL,
  perTeamDemand,
  type ReplacementModel
} from "../league/lineupDemand";

/**
 * Roster targets and lineup fit, derived from the league's ACTUAL starting
 * lineup instead of a constant.
 *
 * Audit 2026-08-06 F-010. The draft recommender used a hardcoded
 * `DEFAULT_TARGETS = { QB:1, RB:4, WR:5, TE:1, K:1, DEF:1 }` and the only caller
 * never passed the override, so every league got the same advice. Verified in
 * the running UI: the draft board reports "fills WR need (have 0, target 5)"
 * and "target 1" for QB regardless of settings — so a superflex league was told
 * to draft one quarterback, and a 2-TE league one tight end, while the same
 * page claimed it reads your roster slots.
 *
 * Everything here is a function of `format.starters`, which already carries
 * FLEX and SUPERFLEX counts from both Sleeper and ESPN ingestion.
 */

export type Position = PlayerMarketRecord["position"];

export const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

export type PositionTargets = Record<Position, number>;

/** Positions eligible for a standard FLEX slot. */
const FLEX_ELIGIBLE: readonly Position[] = ["RB", "WR", "TE"];
/** Positions eligible for a SUPERFLEX slot (FLEX plus quarterbacks). */
const SUPERFLEX_ELIGIBLE: readonly Position[] = ["QB", "RB", "WR", "TE"];

function emptyCounts(): PositionTargets {
  return { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
}

export function countByPosition(players: readonly PlayerMarketRecord[]): PositionTargets {
  const counts = emptyCounts();
  for (const p of players) counts[p.position] += 1;
  return counts;
}

/**
 * Distribute `total` units across `weights` using largest-remainder, so the
 * result is deterministic and sums exactly to `total` (no float drift, no
 * off-by-one that would silently change a recommendation).
 */
function allocate(total: number, weights: Partial<Record<Position, number>>): PositionTargets {
  const out = emptyCounts();
  if (total <= 0) return out;
  const entries = (Object.entries(weights) as Array<[Position, number]>).filter(([, w]) => w > 0);
  const sum = entries.reduce((s, [, w]) => s + w, 0);
  if (sum <= 0) return out;

  const remainders: Array<[Position, number]> = [];
  let assigned = 0;
  for (const [pos, w] of entries) {
    const exact = (total * w) / sum;
    const floor = Math.floor(exact);
    out[pos] = floor;
    assigned += floor;
    remainders.push([pos, exact - floor]);
  }
  remainders.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (let i = 0; assigned < total && i < remainders.length; i += 1, assigned += 1) {
    out[remainders[i]![0]] += 1;
  }
  return out;
}

/**
 * How many players at each position a team should end the draft with.
 *
 * starters + a share of FLEX/SUPERFLEX + bench depth sized by the real roster
 * size. K and DEF never receive bench depth — they are near-fungible and taking
 * a second one is wasted draft capital.
 */
export function targetsFromFormat(
  format: LeagueFormat,
  model: ReplacementModel = DEFAULT_REPLACEMENT_MODEL
): PositionTargets {
  const s = format.starters;
  const targets = emptyCounts();

  targets.QB = s.QB;
  targets.RB = s.RB;
  targets.WR = s.WR;
  targets.TE = s.TE;
  targets.K = s.K;
  targets.DEF = s.DEF;

  // SUPERFLEX and FLEX allocation comes from the SHARED lineup model.
  //
  // This block used to hardcode `targets.QB += s.SUPERFLEX` (occupancy 1.0) and
  // carry its own copy of the flex-weight table, while enrich.ts had been given
  // an injectable superflexQbOccupancy against the same table. The draft board
  // and the valuation model therefore answered the same question differently.
  // Both now read lineupDemand.ts, so a change to either reaches both.
  //
  // perTeamDemand returns FRACTIONAL demand (replacement level is a depth
  // measure); a draft plan needs whole players, so the flex/superflex spillover
  // above the forced starters is rounded here with largest-remainder.
  const demand = perTeamDemand(format, model);
  const spillover: Partial<Record<Position, number>> = {};
  for (const pos of SUPERFLEX_ELIGIBLE) {
    const forced = pos === "QB" ? s.QB : pos === "RB" ? s.RB : pos === "WR" ? s.WR : s.TE;
    const extra = demand[pos] - forced;
    if (extra > 0) spillover[pos] = extra;
  }
  const spilloverTotal = Math.round(
    Object.values(spillover).reduce((a, b) => a + (b ?? 0), 0)
  );
  const alloc = allocate(spilloverTotal, spillover);
  for (const pos of SUPERFLEX_ELIGIBLE) targets[pos] += alloc[pos];

  // Bench depth: whatever the roster size allows beyond the starting lineup.
  const startingSlots =
    s.QB + s.RB + s.WR + s.TE + s.FLEX + s.SUPERFLEX + s.K + s.DEF;
  const bench = Math.max(0, format.rosterSize - startingSlots);
  if (bench > 0) {
    const benchWeights: Partial<Record<Position, number>> = {
      // RB/WR carry the injury and breakout variance, so depth lives there.
      RB: 5,
      WR: 5,
      // A backup quarterback is only worth a roster spot when two can start.
      // In a 1QB league the standard play is to stream, so bench weight is 0 —
      // this is also what makes the superflex target visibly different rather
      // than a rounding artefact.
      QB: s.SUPERFLEX > 0 ? 6 : 0,
      TE: s.TE >= 2 ? 2 : 1
    };
    const benchAlloc = allocate(bench, benchWeights);
    for (const pos of POSITIONS) targets[pos] += benchAlloc[pos];
  }

  return targets;
}

export interface LineupGap {
  position: Position;
  have: number;
  target: number;
  short: number;
}

export interface LineupSurplus {
  position: Position;
  have: number;
  target: number;
  over: number;
}

export interface LineupMesh {
  /** 0-100. Starter coverage first, then depth, minus a hoarding penalty. */
  score: number;
  grade: string;
  /** Fraction of the league's actual starting slots this roster can fill. */
  starterCoverage: number;
  startersFilled: number;
  startersRequired: number;
  gaps: LineupGap[];
  surplus: LineupSurplus[];
  notes: string[];
}

/**
 * Fill the league's real starting lineup from a roster, greedily and in the
 * order that maximises coverage: dedicated slots first, then FLEX, then
 * SUPERFLEX (which can absorb a quarterback).
 */
function fillStarters(
  counts: PositionTargets,
  format: LeagueFormat
): { filled: number; required: number; unfilled: Partial<Record<string, number>> } {
  const remaining = { ...counts };
  const s = format.starters;
  let filled = 0;
  const unfilled: Partial<Record<string, number>> = {};

  const takeDedicated = (pos: Position, slots: number) => {
    const used = Math.min(slots, remaining[pos]);
    remaining[pos] -= used;
    filled += used;
    if (slots - used > 0) unfilled[pos] = slots - used;
  };
  takeDedicated("QB", s.QB);
  takeDedicated("RB", s.RB);
  takeDedicated("WR", s.WR);
  takeDedicated("TE", s.TE);
  takeDedicated("K", s.K);
  takeDedicated("DEF", s.DEF);

  const takeFlex = (slots: number, eligible: readonly Position[], label: string) => {
    let open = slots;
    for (const pos of eligible) {
      while (open > 0 && remaining[pos] > 0) {
        remaining[pos] -= 1;
        open -= 1;
        filled += 1;
      }
    }
    if (open > 0) unfilled[label] = open;
  };
  // Spend the deepest surplus first so FLEX absorbs genuine excess.
  const byDepth = (a: Position, b: Position) => remaining[b] - remaining[a];
  takeFlex(s.FLEX, [...FLEX_ELIGIBLE].sort(byDepth), "FLEX");
  takeFlex(s.SUPERFLEX, [...SUPERFLEX_ELIGIBLE].sort(byDepth), "SUPERFLEX");

  const required = s.QB + s.RB + s.WR + s.TE + s.FLEX + s.SUPERFLEX + s.K + s.DEF;
  return { filled, required, unfilled };
}

function toGrade(score: number): string {
  if (score >= 95) return "A+";
  if (score >= 90) return "A";
  if (score >= 85) return "A-";
  if (score >= 80) return "B+";
  if (score >= 75) return "B";
  if (score >= 70) return "B-";
  if (score >= 65) return "C+";
  if (score >= 60) return "C";
  if (score >= 55) return "C-";
  if (score >= 50) return "D";
  return "F";
}

/**
 * How well a roster meshes with the league's actual lineup requirements.
 *
 * Starter coverage dominates, because an unfilled starting slot is a guaranteed
 * zero every week. Hoarding is penalised explicitly: taking a fifth running back
 * while a starting slot sits empty is the single most common draft mistake, and
 * a score that ignored it would reward exactly the behaviour we want to flag.
 */
export function lineupMeshScore(
  roster: readonly PlayerMarketRecord[],
  format: LeagueFormat
): LineupMesh {
  const counts = countByPosition(roster);
  const targets = targetsFromFormat(format);
  const { filled, required, unfilled } = fillStarters(counts, format);

  const starterCoverage = required > 0 ? filled / required : 1;

  const gaps: LineupGap[] = [];
  const surplus: LineupSurplus[] = [];
  for (const pos of POSITIONS) {
    const have = counts[pos];
    const target = targets[pos];
    if (have < target) gaps.push({ position: pos, have, target, short: target - have });
    if (have > target) surplus.push({ position: pos, have, target, over: have - target });
  }
  gaps.sort((a, b) => b.short - a.short || a.position.localeCompare(b.position));
  surplus.sort((a, b) => b.over - a.over || a.position.localeCompare(b.position));

  // Depth beyond the starting lineup, measured against the format's targets.
  const depthTarget = POSITIONS.reduce((s, p) => s + targets[p], 0);
  const depthHave = POSITIONS.reduce((s, p) => s + Math.min(counts[p], targets[p]), 0);
  const depthCoverage = depthTarget > 0 ? depthHave / depthTarget : 1;

  const overCount = surplus.reduce((s, x) => s + x.over, 0);
  const startersOpen = required - filled;
  // Hoarding is only mildly bad once the lineup is set, and severe while a
  // starting slot is still empty.
  const hoardPenalty = Math.min(25, overCount * (startersOpen > 0 ? 6 : 2));

  const raw = starterCoverage * 75 + depthCoverage * 25 - hoardPenalty;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  const notes: string[] = [];
  for (const [slot, open] of Object.entries(unfilled)) {
    if (open) notes.push(`${open} unfilled ${slot} starter slot${open > 1 ? "s" : ""}`);
  }
  for (const x of surplus.slice(0, 2)) {
    notes.push(
      startersOpen > 0
        ? `${x.have} ${x.position}s vs target ${x.target} — hoarding while starters are open`
        : `${x.have} ${x.position}s vs target ${x.target} — depth beyond need`
    );
  }
  if (format.starters.SUPERFLEX > 0) {
    notes.push(`superflex: quarterback target is ${targets.QB}, not 1`);
  }

  return {
    score,
    grade: toGrade(score),
    starterCoverage,
    startersFilled: filled,
    startersRequired: required,
    gaps,
    surplus,
    notes
  };
}
