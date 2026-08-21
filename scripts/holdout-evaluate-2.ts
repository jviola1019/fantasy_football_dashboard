/**
 * Execute FROZEN PROTOCOL 2 exactly once (audit §19 follow-up).
 *
 * Protocol: reports/2026-08-20/holdout-protocol-2.md, committed 77fb562 BEFORE
 * this sample was scored.
 *
 * Three confirmatory hypotheses, Holm-Bonferroni corrected TOGETHER. Success
 * requires all three. Diagnostics are reported but cannot adjudicate.
 *
 *   npm run holdout:evaluate2              # the single permitted run
 *   npm run holdout:evaluate2 -- --self-test   # arithmetic check, no verdict
 *   npm run holdout:evaluate2 -- --dry-run     # sample shape only, no metrics
 */
import { writeFileSync } from "node:fs";
import { buildHoldoutRows, type Row } from "./holdout-evaluate";

const OUT = "reports/2026-08-20/holdout-result-2.md";
const BOOT = 5000;
const PERM = 20000;
const SEED = 20260821;
const ALPHA = 0.05;
/** Protocol 2 §2: do not run below this many leagues unless acquisition ended. */
const MIN_LEAGUES = 150;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (xs: number[]) => (xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length);

function groupByLeague(rows: Row[]): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const b = m.get(r.leagueKey);
    if (b) b.push(r);
    else m.set(r.leagueKey, [r]);
  }
  return m;
}

// ── statistics ─────────────────────────────────────────────────────────────

function auc(rows: Row[], f: (r: Row) => number = (r) => r.forecast): number {
  const pos = rows.filter((r) => r.actual === 1).map(f);
  const neg = rows.filter((r) => r.actual === 0).map(f);
  if (pos.length === 0 || neg.length === 0) return 0.5;
  let s = 0;
  for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

const brier = (rows: Row[], f: (r: Row) => number) =>
  mean(rows.map((r) => (f(r) - r.actual) ** 2));

const brierSkill = (rows: Row[]) => {
  const c = brier(rows, (r) => r.climatology);
  return c > 0 ? 1 - brier(rows, (r) => r.forecast) / c : Number.NaN;
};

/**
 * Murphy decomposition: Brier = reliability − resolution + uncertainty.
 *
 * Computed over equal-width forecast bins, the standard practical estimator.
 * `resolution − reliability > 0` is the literature's "useful forecast"
 * criterion and is hypothesis H3.
 */
function murphy(
  rows: Row[],
  bins = 10
): { reliability: number; resolution: number; uncertainty: number; usefulness: number } {
  const n = rows.length;
  const base = mean(rows.map((r) => r.actual));
  let reliability = 0;
  let resolution = 0;
  for (let b = 0; b < bins; b += 1) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const inBin = rows.filter((r) => {
      const p = r.forecast;
      return b === bins - 1 ? p >= lo && p <= hi : p >= lo && p < hi;
    });
    if (inBin.length === 0) continue;
    const fk = mean(inBin.map((r) => r.forecast));
    const ok = mean(inBin.map((r) => r.actual));
    reliability += (inBin.length / n) * (fk - ok) ** 2;
    resolution += (inBin.length / n) * (ok - base) ** 2;
  }
  const uncertainty = base * (1 - base);
  return { reliability, resolution, uncertainty, usefulness: resolution - reliability };
}

/** Cluster bootstrap: resample whole leagues with replacement. */
function clusterBootstrap(
  byLeague: Map<string, Row[]>,
  stat: (rs: Row[]) => number,
  seed: number
): { lo: number; hi: number; distinct: number; clusters: number; pGreaterThanZero: number } {
  const keys = [...byLeague.keys()];
  const rand = rng(seed);
  const samples: number[] = [];
  for (let i = 0; i < BOOT; i += 1) {
    const rows: Row[] = [];
    for (let k = 0; k < keys.length; k += 1) {
      rows.push(...byLeague.get(keys[Math.floor(rand() * keys.length)]!)!);
    }
    const v = stat(rows);
    if (Number.isFinite(v)) samples.push(v);
  }
  samples.sort((a, b) => a - b);
  const below = samples.filter((v) => v <= 0).length;
  return {
    lo: samples[Math.floor(0.025 * samples.length)] ?? Number.NaN,
    hi: samples[Math.floor(0.975 * samples.length)] ?? Number.NaN,
    distinct: new Set(samples.map((v) => v.toFixed(6))).size,
    clusters: keys.length,
    // One-sided bootstrap p for "statistic > 0".
    pGreaterThanZero: (below + 1) / (samples.length + 1)
  };
}

/** Cluster permutation: shuffle outcome labels WITHIN each league. */
function clusterPermutationP(rows: Row[], stat: (rs: Row[]) => number, observed: number, seed: number) {
  const rand = rng(seed);
  const byLeague = groupByLeague(rows);
  let atLeast = 0;
  const nulls: number[] = [];
  for (let i = 0; i < PERM; i += 1) {
    const permuted: Row[] = [];
    for (const group of byLeague.values()) {
      const labels = group.map((g) => g.actual);
      for (let j = labels.length - 1; j > 0; j -= 1) {
        const k = Math.floor(rand() * (j + 1));
        [labels[j], labels[k]] = [labels[k]!, labels[j]!];
      }
      group.forEach((g, idx) => permuted.push({ ...g, actual: labels[idx]! }));
    }
    const v = stat(permuted);
    nulls.push(v);
    if (v >= observed - 1e-12) atLeast += 1;
  }
  return { p: (atLeast + 1) / (PERM + 1), nullMean: mean(nulls) };
}

/** Holm-Bonferroni. Returns each hypothesis's adjusted threshold and verdict. */
function holm(tests: Array<{ id: string; p: number }>): Array<{ id: string; p: number; threshold: number; reject: boolean }> {
  const ordered = [...tests].sort((a, b) => a.p - b.p);
  const m = ordered.length;
  const out: Array<{ id: string; p: number; threshold: number; reject: boolean }> = [];
  let stillRejecting = true;
  ordered.forEach((t, i) => {
    const threshold = ALPHA / (m - i);
    // Holm stops at the first failure; everything after inherits the failure.
    const reject = stillRejecting && t.p <= threshold;
    if (!reject) stillRejecting = false;
    out.push({ ...t, threshold, reject });
  });
  return out;
}

// ── diagnostics ────────────────────────────────────────────────────────────

/** Pool-adjacent-violators, non-DEcreasing (calibration maps rise with forecast). */
function isotonicIncreasing(xs: number[], ys: number[]): (x: number) => number {
  const order = xs.map((x, i) => i).sort((a, b) => xs[a]! - xs[b]!);
  const v: number[] = [];
  const w: number[] = [];
  const size: number[] = [];
  for (const i of order) {
    v.push(ys[i]!);
    w.push(1);
    size.push(1);
    while (v.length > 1 && v[v.length - 2]! > v[v.length - 1]!) {
      const v2 = v.pop()!, w2 = w.pop()!, s2 = size.pop()!;
      const v1 = v.pop()!, w1 = w.pop()!, s1 = size.pop()!;
      v.push((v1 * w1 + v2 * w2) / (w1 + w2));
      w.push(w1 + w2);
      size.push(s1 + s2);
    }
  }
  const fitted: number[] = [];
  for (let b = 0; b < v.length; b += 1) for (let k = 0; k < size[b]!; k += 1) fitted.push(v[b]!);
  const sortedX = order.map((i) => xs[i]!);
  return (x: number) => {
    if (sortedX.length === 0) return 0.5;
    let lo = 0;
    let hi = sortedX.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedX[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    return fitted[lo]!;
  };
}

/**
 * D2 — leave-one-league-out isotonic recalibration.
 *
 * The decisive diagnostic: if recalibrating rescues skill, the raw model has
 * signal that miscalibration was hiding. If it does not, there is nothing to
 * rescue.
 */
function looRecalibration(byLeague: Map<string, Row[]>): { rows: Row[]; brier: number; skill: number; auc: number } {
  const keys = [...byLeague.keys()];
  const out: Row[] = [];
  for (const held of keys) {
    const train = keys.filter((k) => k !== held).flatMap((k) => byLeague.get(k)!);
    if (train.length < 10) continue;
    const map = isotonicIncreasing(train.map((r) => r.forecast), train.map((r) => r.actual));
    for (const r of byLeague.get(held)!) out.push({ ...r, forecast: Math.min(1, Math.max(0, map(r.forecast))) });
  }
  return {
    rows: out,
    brier: brier(out, (r) => r.forecast),
    skill: brierSkill(out),
    auc: auc(out)
  };
}

/**
 * D4 — minimum detectable effect for AUC at 80% power, alpha 0.05 one-sided,
 * inflated by the design effect implied by cluster size.
 *
 * Hanley-McNeil variance approximation. This is the number protocol 1 lacked:
 * it says whether a null result is informative or merely underpowered.
 */
function minimumDetectableAuc(rows: Row[], byLeague: Map<string, Row[]>): { mde: number; deff: number; effectiveN: number } {
  const nPos = rows.filter((r) => r.actual === 1).length;
  const nNeg = rows.length - nPos;
  if (nPos === 0 || nNeg === 0) return { mde: Number.NaN, deff: Number.NaN, effectiveN: Number.NaN };
  const sizes = [...byLeague.values()].map((g) => g.length);
  const mBar = mean(sizes);
  // Outcome ICC within leagues is NEGATIVE here (exactly P of N qualify), which
  // would deflate the design effect. Clamping at >= 1 keeps the MDE honest by
  // refusing to claim more power than an independent sample would give.
  const deff = Math.max(1, 1 + (mBar - 1) * Math.max(0, outcomeIcc(byLeague)));
  const effectiveN = rows.length / deff;
  const ePos = (nPos / rows.length) * effectiveN;
  const eNeg = (nNeg / rows.length) * effectiveN;
  // Hanley-McNeil SE at AUC = 0.5 (the null), where Q1 = 1/3 and Q2 = 1/4.
  const a = 0.5;
  const q1 = a / (2 - a);
  const q2 = (2 * a * a) / (1 + a);
  const se = Math.sqrt(
    (a * (1 - a) + (ePos - 1) * (q1 - a * a) + (eNeg - 1) * (q2 - a * a)) / (ePos * eNeg)
  );
  // z(0.95) + z(0.80) for a one-sided test at 80% power.
  return { mde: (1.6449 + 0.8416) * se, deff, effectiveN };
}

function outcomeIcc(byLeague: Map<string, Row[]>): number {
  const groups = [...byLeague.values()].map((g) => g.map((r) => r.actual)).filter((g) => g.length > 1);
  if (groups.length < 2) return 0;
  const all = groups.flat();
  const grand = mean(all);
  const k = mean(groups.map((g) => g.length));
  let msB = 0;
  let msW = 0;
  let dfW = 0;
  for (const g of groups) {
    const m = mean(g);
    msB += g.length * (m - grand) ** 2;
    for (const v of g) msW += (v - m) ** 2;
    dfW += g.length - 1;
  }
  msB /= groups.length - 1;
  msW /= dfW;
  const denom = msB + (k - 1) * msW;
  return denom === 0 ? 0 : (msB - msW) / denom;
}

// ── self-test ──────────────────────────────────────────────────────────────

function selfTest(): void {
  const mk = (f: number, a: 0 | 1, lg = "L1"): Row => ({
    leagueKey: lg, franchise: `${lg}-${f}-${a}`, forecast: f, actual: a, climatology: 0.5, draftCapital: f
  });
  const fails: string[] = [];
  const ck = (name: string, got: number, want: number, tol = 1e-9) => {
    if (!Number.isFinite(got) || Math.abs(got - want) > tol) fails.push(`${name}: ${got} != ${want}`);
    else console.log(`  ok  ${name} = ${got.toFixed(6)}`);
  };

  ck("AUC perfect", auc([mk(0.9, 1), mk(0.1, 0)]), 1);
  ck("AUC inverted", auc([mk(0.1, 1), mk(0.9, 0)]), 0);

  // A perfectly calibrated, perfectly sharp forecast: reliability 0,
  // resolution == uncertainty, so usefulness == uncertainty.
  const sharp = [mk(1, 1), mk(1, 1), mk(0, 0), mk(0, 0)];
  const mSharp = murphy(sharp);
  ck("Murphy reliability (sharp)", mSharp.reliability, 0);
  ck("Murphy resolution (sharp)", mSharp.resolution, 0.25);
  ck("Murphy uncertainty (sharp)", mSharp.uncertainty, 0.25);
  // Identity: Brier == reliability - resolution + uncertainty.
  ck("Murphy identity (sharp)", mSharp.reliability - mSharp.resolution + mSharp.uncertainty, brier(sharp, (r) => r.forecast), 1e-9);

  // A constant forecast at the base rate: resolution 0, reliability 0.
  const flat = [mk(0.5, 1), mk(0.5, 0)];
  const mFlat = murphy(flat);
  ck("Murphy resolution (flat)", mFlat.resolution, 0);
  ck("Murphy usefulness (flat)", mFlat.usefulness, 0);

  // Holm: with three p-values, only the smallest can clear alpha/3.
  const h = holm([{ id: "A", p: 0.01 }, { id: "B", p: 0.04 }, { id: "C", p: 0.9 }]);
  const rejected = h.filter((x) => x.reject).map((x) => x.id);
  if (rejected.join(",") !== "A") fails.push(`Holm expected only A, got [${rejected.join(",")}]`);
  else console.log("  ok  Holm rejects only A (0.01 <= 0.0167; 0.04 > 0.025)");

  // Isotonic calibration map must be monotone non-decreasing.
  const map = isotonicIncreasing([0.1, 0.2, 0.3, 0.4], [0, 1, 0, 1]);
  let prev = -1;
  for (const x of [0.1, 0.2, 0.3, 0.4]) {
    const y = map(x);
    if (y < prev - 1e-9) fails.push("isotonic map is not monotone");
    prev = y;
  }
  console.log("  ok  isotonic calibration map is monotone");

  if (fails.length > 0) {
    console.error("\nSELF-TEST FAILED:");
    for (const f of fails) console.error("  - " + f);
    process.exit(1);
  }
  console.log("\nself-test PASSED — arithmetic verified, holdout untouched.");
}

// ── main ───────────────────────────────────────────────────────────────────

function main(): void {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  const out: string[] = [];
  const say = (s = "") => { out.push(s); console.log(s); };

  const { rows, leagues } = buildHoldoutRows();
  const byLeague = groupByLeague(rows);

  if (dryRun) {
    console.log(`dry run — ${leagues.length} leagues parsed, ${rows.length} rows, ${byLeague.size} clusters. NO metric computed.`);
    return;
  }
  if (byLeague.size < MIN_LEAGUES && !force) {
    console.error(
      `Protocol 2 §2 sets the execution trigger at >= ${MIN_LEAGUES} leagues; ` +
        `only ${byLeague.size} are available.\n` +
        `Either keep acquiring, or pass --force if acquisition has TERMINATED ` +
        `(the protocol permits running on whatever the frame yielded in that case).`
    );
    process.exit(2);
  }

  const nClusters = byLeague.size;
  const baseRate = mean(rows.map((r) => r.actual));

  say("# Holdout result 2 — enlarged sample, pre-registered test family");
  say();
  say(`**Executed** ${new Date().toISOString()} · **Protocol** [holdout-protocol-2.md](./holdout-protocol-2.md) (frozen \`77fb562\`)`);
  say();
  say("> **Not an independent replication.** This sample CONTAINS protocol 1's leagues. Report alongside [`holdout-result.md`](./holdout-result.md), never instead of it. If this succeeds where protocol 1 failed, the honest reading is *underpowered*, not *the earlier result was wrong*.");
  say();
  say("| quantity | value |");
  say("|---|---|");
  say(`| team-seasons | **${rows.length}** |`);
  say(`| leagues (clusters) | **${nClusters}** |`);
  say(`| seasons | ${[...new Set(leagues.map((l) => l.season))].sort().join(", ")} |`);
  say(`| league sizes | ${[...new Set(leagues.map((l) => l.format.numTeams))].sort((a, b) => a - b).join(", ")} |`);
  say(`| base rate | ${baseRate.toFixed(4)} |`);
  say();

  // --- confirmatory ---------------------------------------------------------
  const aucObs = auc(rows);
  const aucPerm = clusterPermutationP(rows, (rs) => auc(rs), aucObs, SEED);
  const skillObs = brierSkill(rows);
  const skillBoot = clusterBootstrap(byLeague, brierSkill, SEED + 1);
  const mur = murphy(rows);
  const useBoot = clusterBootstrap(byLeague, (rs) => murphy(rs).usefulness, SEED + 2);

  const family = holm([
    { id: "H1", p: aucPerm.p },
    { id: "H2", p: skillBoot.pGreaterThanZero },
    { id: "H3", p: useBoot.pGreaterThanZero }
  ]);
  const verdict = new Map(family.map((f) => [f.id, f]));

  say("## Confirmatory tests (Holm-Bonferroni across the family)");
  say();
  say("| id | hypothesis | statistic | p | Holm threshold | reject null? |");
  say("|---|---|---|---|---|---|");
  say(`| H1 | AUC > 0.5 | ${aucObs.toFixed(4)} (perm null mean ${aucPerm.nullMean.toFixed(4)}) | ${aucPerm.p.toFixed(4)} | ${verdict.get("H1")!.threshold.toFixed(4)} | ${verdict.get("H1")!.reject ? "**YES**" : "no"} |`);
  say(`| H2 | Brier skill > 0 | ${skillObs.toFixed(4)} | ${skillBoot.pGreaterThanZero.toFixed(4)} | ${verdict.get("H2")!.threshold.toFixed(4)} | ${verdict.get("H2")!.reject ? "**YES**" : "no"} |`);
  say(`| H3 | resolution − reliability > 0 | ${mur.usefulness.toFixed(4)} | ${useBoot.pGreaterThanZero.toFixed(4)} | ${verdict.get("H3")!.threshold.toFixed(4)} | ${verdict.get("H3")!.reject ? "**YES**" : "no"} |`);
  say();
  say(`Brier skill 95% CI [${skillBoot.lo.toFixed(4)}, ${skillBoot.hi.toFixed(4)}] · ${skillBoot.clusters} clusters, ${skillBoot.distinct} distinct resamples.`);
  say(`Usefulness 95% CI [${useBoot.lo.toFixed(4)}, ${useBoot.hi.toFixed(4)}].`);
  say();

  const allReject = family.every((f) => f.reject);
  say(`### Verdict: ${allReject ? "**POSITIVE EXTERNAL SKILL DEMONSTRATED**" : "**NOT VALIDATED**"}`);
  say();
  say(
    allReject
      ? "All three pre-registered hypotheses survive Holm correction. This is the criterion declared before execution, and it is met."
      : "Protocol 2 §3 requires **all three** hypotheses to survive Holm correction. They do not. No parameter is adjusted and no re-run is permitted on this sample."
  );
  say();

  // --- diagnostics ----------------------------------------------------------
  say("## Diagnostics (reported, NOT adjudicating)");
  say();
  say("### D1 — Murphy decomposition");
  say();
  say("| component | value | reading |");
  say("|---|---|---|");
  say(`| reliability (lower better) | ${mur.reliability.toFixed(4)} | miscalibration |`);
  say(`| resolution (higher better) | ${mur.resolution.toFixed(4)} | informativeness |`);
  say(`| uncertainty (fixed) | ${mur.uncertainty.toFixed(4)} | the task's own difficulty |`);
  say(`| **usefulness = res − rel** | **${mur.usefulness.toFixed(4)}** | ${mur.usefulness > 0 ? "useful in Murphy's sense" : "**not useful** — miscalibration exceeds informativeness"} |`);
  say();

  const recal = looRecalibration(byLeague);
  say("### D2 — leave-one-league-out isotonic recalibration (the decisive diagnostic)");
  say();
  say("| forecaster | Brier | skill vs climatology | AUC |");
  say("|---|---|---|---|");
  say(`| raw | ${brier(rows, (r) => r.forecast).toFixed(4)} | ${skillObs.toFixed(4)} | ${aucObs.toFixed(4)} |`);
  say(`| **recalibrated (LOLO)** | ${recal.brier.toFixed(4)} | **${recal.skill.toFixed(4)}** | ${recal.auc.toFixed(4)} |`);
  say(`| structural climatology | ${brier(rows, (r) => r.climatology).toFixed(4)} | 0 | 0.5 |`);
  say();
  say(
    recal.skill > 0
      ? "**Recalibration rescues skill.** The raw model carries signal that miscalibration was hiding — the defect is scaling, not emptiness."
      : "**Recalibration does not rescue skill.** Even with a monotone calibration map fitted out-of-fold, the forecast does not beat the league's own base rate. There is no signal being hidden by miscalibration."
  );
  say();
  say("Note AUC is invariant to any monotone recalibration, so an unchanged AUC here is expected and correct, not a bug.");
  say();

  const power = minimumDetectableAuc(rows, byLeague);
  say("### D4 — power / minimum detectable effect");
  say();
  say("| quantity | value |");
  say("|---|---|");
  say(`| rows | ${rows.length} |`);
  say(`| design effect (clamped >= 1) | ${power.deff.toFixed(4)} |`);
  say(`| effective n | ${power.effectiveN.toFixed(1)} |`);
  say(`| **minimum detectable AUC − 0.5** at 80% power | **${power.mde.toFixed(4)}** |`);
  say();
  say(
    `So this sample could detect an AUC of about **${(0.5 + power.mde).toFixed(3)}** or better. ` +
      (Math.abs(aucObs - 0.5) < power.mde
        ? "The observed effect is **smaller than that**, so a null here means *no effect large enough to matter was found* — it does not prove the effect is exactly zero."
        : "The observed effect is larger than that, so this sample was adequately powered for it.")
  );
  say();

  say("### D5 — stratified by league size (no per-stratum p-values: concordance is unstable in small clusters)");
  say();
  say("| league size | leagues | rows | AUC | Brier | climatology |");
  say("|---|---|---|---|---|---|");
  const sizeOf = new Map(leagues.map((l) => [l.key, l.format.numTeams]));
  const strata = new Map<number, Row[]>();
  for (const r of rows) {
    const k = sizeOf.get(r.leagueKey) ?? 0;
    const b = strata.get(k);
    if (b) b.push(r);
    else strata.set(k, [r]);
  }
  for (const [size, rs] of [...strata].sort((a, b) => a[0] - b[0])) {
    say(
      `| ${size}-team | ${new Set(rs.map((r) => r.leagueKey)).size} | ${rs.length} | ${auc(rs).toFixed(4)} | ` +
        `${brier(rs, (r) => r.forecast).toFixed(4)} | ${brier(rs, (r) => r.climatology).toFixed(4)} |`
    );
  }
  say();

  writeFileSync(OUT, out.join("\n"));
  console.log(`\nWrote ${OUT}`);
}

const direct = (process.argv[1] ?? "").split("\\").join("/").endsWith("holdout-evaluate-2.ts");
if (direct) {
  if (process.argv.includes("--self-test")) selfTest();
  else main();
}
