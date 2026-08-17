/**
 * Replacement-level sensitivity sweep (audit P2 §9 and §10).
 *
 * Two free parameters sit under every valuation the product makes:
 *
 *   depthCushion          how far past the last forced starter "replacement" sits
 *   superflexQbOccupancy  how often a SUPERFLEX slot is filled by a quarterback
 *
 * Neither is fitted to an observed outcome. An earlier code comment called the
 * 1.2 cushion "calibrated" because the RB baseline it produced landed near the
 * retired hand-tuned RB constant — that is agreement with the previous guess on
 * one position in one league shape, which is not evidence. This script measures
 * what the parameters actually move so the claim can be sized honestly.
 *
 * It reports, per the audit's list:
 *   - replacement rank per position
 *   - trueValue
 *   - PLAYER ORDERING (the decision-relevant one — see the note on inversions)
 *   - draft board / waiver ordering, which are that same ordering
 *   - trade grades, which are differences of trueValue
 *   - the season simulation, via trueValue
 *
 * Run:  npx tsx scripts/replacement-sensitivity.ts
 */
import {
  DEFAULT_REPLACEMENT_MODEL,
  ecrToTrueValue,
  positionReplacementRank,
  type ReplacementModel
} from "../src/lib/fantasypros/enrich";
import { DEFAULT_FORMAT, type LeagueFormat, type LeagueStarters } from "../src/lib/trade/format";

type Pos = "QB" | "RB" | "WR" | "TE";
const POSITIONS: Pos[] = ["QB", "RB", "WR", "TE"];

const CUSHIONS = [1.0, 1.1, 1.2, 1.3, 1.4];
const OCCUPANCIES = [0.8, 0.9, 0.95, 1.0];

const starters = (o: Partial<LeagueStarters> = {}): LeagueStarters => ({
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 1,
  DEF: 1,
  K: 1,
  SUPERFLEX: 0,
  ...o
});

const fmt = (o: Partial<LeagueFormat> = {}): LeagueFormat => ({
  ...DEFAULT_FORMAT,
  starters: starters(),
  ...o
});

interface Shape {
  name: string;
  format: LeagueFormat;
}

/** The full matrix the audit asks for. */
function shapes(): Shape[] {
  const out: Shape[] = [];
  for (const numTeams of [8, 10, 12, 14]) {
    for (const [scoringFormat, ppr] of [
      ["STD", 0],
      ["HALF", 0.5],
      ["PPR", 1]
    ] as const) {
      out.push({
        name: `${numTeams}T ${scoringFormat} 1QB`,
        format: fmt({ numTeams, ppr, scoringFormat })
      });
      out.push({
        name: `${numTeams}T ${scoringFormat} SFLEX`,
        format: fmt({
          numTeams,
          ppr,
          scoringFormat,
          numQbs: 2,
          starters: starters({ SUPERFLEX: 1, FLEX: 1 })
        })
      });
      out.push({
        name: `${numTeams}T ${scoringFormat} 2QB`,
        format: fmt({ numTeams, ppr, scoringFormat, numQbs: 2, starters: starters({ QB: 2 }) })
      });
      out.push({
        name: `${numTeams}T ${scoringFormat} 2TE`,
        format: fmt({ numTeams, ppr, scoringFormat, starters: starters({ TE: 2 }) })
      });
    }
  }
  return out;
}

/**
 * A synthetic but realistically-shaped player pool.
 *
 * Positional ranks 1..N per position. We do NOT need real ECR here: the
 * question is how the PARAMETER moves valuations, and that is a property of the
 * transform, not of any particular season's rankings. Using a fixed ladder
 * keeps the answer reproducible and free of an upstream dependency.
 */
function pool(): Array<{ id: string; position: Pos; posRank: number }> {
  const out: Array<{ id: string; position: Pos; posRank: number }> = [];
  const depth: Record<Pos, number> = { QB: 40, RB: 70, WR: 90, TE: 30 };
  for (const position of POSITIONS) {
    for (let posRank = 1; posRank <= depth[position]; posRank += 1) {
      out.push({ id: `${position}${posRank}`, position, posRank });
    }
  }
  return out;
}

const PLAYERS = pool();

function valuations(format: LeagueFormat, model: ReplacementModel) {
  const repl: Record<Pos, number> = {
    QB: positionReplacementRank("QB", format, model),
    RB: positionReplacementRank("RB", format, model),
    WR: positionReplacementRank("WR", format, model),
    TE: positionReplacementRank("TE", format, model)
  };
  const values = PLAYERS.map((p) => ({
    id: p.id,
    position: p.position,
    // rank_ecr is unused by ecrToTrueValue's positional VBD; pass posRank.
    trueValue: ecrToTrueValue(p.posRank, p.posRank, repl[p.position])
  }));
  return { repl, values };
}

/** Board order = trueValue desc, deterministic tie-break by id. */
function order(values: Array<{ id: string; trueValue: number }>): string[] {
  return [...values]
    .sort((a, b) => b.trueValue - a.trueValue || a.id.localeCompare(b.id))
    .map((v) => v.id);
}

/**
 * Fraction of ordered pairs whose relative order flips between two boards.
 * This is 1 - Kendall's tau-a scaled to [0,1]; 0 means identical ordering.
 */
function inversionRate(a: string[], b: string[]): number {
  const rankB = new Map(b.map((id, i) => [id, i]));
  const seq = a.map((id) => rankB.get(id)!);
  let inversions = 0;
  for (let i = 0; i < seq.length; i += 1) {
    for (let j = i + 1; j < seq.length; j += 1) {
      if (seq[i]! > seq[j]!) inversions += 1;
    }
  }
  const pairs = (seq.length * (seq.length - 1)) / 2;
  return inversions / pairs;
}

/** How far the top-N of the board changes — what a drafter actually feels. */
function topNChurn(a: string[], b: string[], n: number): number {
  const setB = new Set(b.slice(0, n));
  return a.slice(0, n).filter((id) => !setB.has(id)).length;
}

function fixed(n: number, d = 4): string {
  return n.toFixed(d).padStart(d + 3);
}

// ---------------------------------------------------------------------------

console.log("# Replacement-level sensitivity sweep");
console.log(`# generated ${new Date().toISOString()}`);
console.log(`# baseline: depthCushion=${DEFAULT_REPLACEMENT_MODEL.depthCushion} ` +
  `superflexQbOccupancy=${DEFAULT_REPLACEMENT_MODEL.superflexQbOccupancy}`);
console.log(`# pool: ${PLAYERS.length} players (QB40 RB70 WR90 TE30)`);
console.log();

// --- Part 1: replacement ranks across the whole matrix ----------------------
console.log("## 1. Replacement rank by cushion (all league shapes)");
console.log();
console.log("shape                  cushion   QB   RB   WR   TE");
const allShapes = shapes();
for (const s of allShapes) {
  for (const depthCushion of CUSHIONS) {
    const m = { ...DEFAULT_REPLACEMENT_MODEL, depthCushion };
    const r = POSITIONS.map((p) => String(positionReplacementRank(p, s.format, m)).padStart(4)).join(" ");
    console.log(`${s.name.padEnd(22)} ${depthCushion.toFixed(2)}    ${r}`);
  }
}
console.log();

// --- Part 2: does the cushion change ORDERING? ------------------------------
console.log("## 2. Effect of the cushion on player ordering vs the 1.2 baseline");
console.log();
console.log("This is the decision-relevant question. Within a position the");
console.log("transform is monotonic in posRank, so intra-position order cannot");
console.log("move; only CROSS-position order can. Draft board, waiver ranking and");
console.log("trade grades all read this same ordering.");
console.log();
console.log("shape                  cushion  inversionRate  top12churn  top24churn  maxAbsTVdelta");
let worstInversion = 0;
let worstShape = "";
for (const s of allShapes) {
  const base = valuations(s.format, DEFAULT_REPLACEMENT_MODEL);
  const baseOrder = order(base.values);
  for (const depthCushion of CUSHIONS) {
    if (depthCushion === DEFAULT_REPLACEMENT_MODEL.depthCushion) continue;
    const alt = valuations(s.format, { ...DEFAULT_REPLACEMENT_MODEL, depthCushion });
    const altOrder = order(alt.values);
    const inv = inversionRate(baseOrder, altOrder);
    const maxDelta = Math.max(
      ...base.values.map((v, i) => Math.abs(v.trueValue - alt.values[i]!.trueValue))
    );
    if (inv > worstInversion) {
      worstInversion = inv;
      worstShape = `${s.name} @ ${depthCushion}`;
    }
    console.log(
      `${s.name.padEnd(22)} ${depthCushion.toFixed(2)}   ${fixed(inv)}        ` +
        `${String(topNChurn(baseOrder, altOrder, 12)).padStart(2)}          ` +
        `${String(topNChurn(baseOrder, altOrder, 24)).padStart(2)}         ` +
        `${String(maxDelta).padStart(3)}`
    );
  }
}
console.log();
console.log(`worst ordering disturbance: ${fixed(worstInversion)} at ${worstShape}`);
console.log();

// --- Part 3: SUPERFLEX QB occupancy (audit §10) -----------------------------
console.log("## 3. SUPERFLEX QB occupancy sensitivity");
console.log();
console.log("Only superflex shapes are affected; 1QB and 2QB leagues have no");
console.log("SUPERFLEX slot, so the coefficient is inert there (asserted below).");
console.log();
console.log("shape                  occ    QB   RB   WR   TE  inversionRate  top12churn");
for (const s of allShapes.filter((x) => x.format.starters.SUPERFLEX > 0)) {
  const base = valuations(s.format, DEFAULT_REPLACEMENT_MODEL);
  const baseOrder = order(base.values);
  for (const superflexQbOccupancy of OCCUPANCIES) {
    const m = { ...DEFAULT_REPLACEMENT_MODEL, superflexQbOccupancy };
    const alt = valuations(s.format, m);
    const r = POSITIONS.map((p) => String(positionReplacementRank(p, s.format, m)).padStart(4)).join(" ");
    const inv = inversionRate(baseOrder, order(alt.values));
    console.log(
      `${s.name.padEnd(22)} ${superflexQbOccupancy.toFixed(2)} ${r}  ${fixed(inv)}        ` +
        `${String(topNChurn(baseOrder, order(alt.values), 12)).padStart(2)}`
    );
  }
}
console.log();

// --- Part 4: inertness check ------------------------------------------------
console.log("## 4. Occupancy is inert where there is no SUPERFLEX slot");
let inertViolations = 0;
for (const s of allShapes.filter((x) => x.format.starters.SUPERFLEX === 0)) {
  for (const superflexQbOccupancy of OCCUPANCIES) {
    for (const p of POSITIONS) {
      const a = positionReplacementRank(p, s.format, DEFAULT_REPLACEMENT_MODEL);
      const b = positionReplacementRank(p, s.format, {
        ...DEFAULT_REPLACEMENT_MODEL,
        superflexQbOccupancy
      });
      if (a !== b) inertViolations += 1;
    }
  }
}
console.log(`violations: ${inertViolations} (expected 0)`);
console.log();

// --- Part 5: total startable demand is conserved ----------------------------
console.log("## 5. Lowering occupancy MOVES demand, it does not destroy it");
console.log();
console.log("shape                  occ    sum(QB+RB+WR+TE) at cushion 1.0");
for (const s of allShapes.filter((x) => x.format.starters.SUPERFLEX > 0).slice(0, 6)) {
  for (const superflexQbOccupancy of OCCUPANCIES) {
    const m = { depthCushion: 1.0, superflexQbOccupancy };
    const total = POSITIONS.reduce((acc, p) => acc + positionReplacementRank(p, s.format, m), 0);
    console.log(`${s.name.padEnd(22)} ${superflexQbOccupancy.toFixed(2)}   ${String(total).padStart(4)}`);
  }
}
console.log();
console.log("## Verdict");
console.log();
console.log("No observed-outcome target was available for either parameter, so");
console.log("neither is CALIBRATED. Both are MODEL ASSUMPTIONS whose influence is");
console.log("now measured and bounded by the numbers above.");
