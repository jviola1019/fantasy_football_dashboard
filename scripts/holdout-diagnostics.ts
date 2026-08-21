/**
 * POST-HOC DIAGNOSTICS on the executed holdout (audit §19 follow-up).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THESE CANNOT CHANGE THE VERDICT.
 *
 * The success criterion was declared in `holdout-protocol.md` §9 BEFORE the data
 * was scored, and it failed. Nothing here is a new criterion. Running additional
 * tests until one returns p < 0.05 and then treating that as validation is
 * exactly the failure mode this audit exists to prevent, so every test below is
 * labeled as characterisation, not adjudication.
 *
 * What they legitimately add: WHERE the model breaks, and whether it breaks
 * differently by league shape.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * All p-values come from CLUSTER PERMUTATION — outcome labels are shuffled
 * WITHIN each league, never across. Shuffling across leagues would destroy the
 * dependence structure and manufacture significance, because within one league
 * exactly P of N teams qualify by construction.
 *
 *   npx tsx scripts/holdout-diagnostics.ts
 */
import { writeFileSync } from "node:fs";
import { buildHoldoutRows, type Row as HoldoutRow } from "./holdout-evaluate";

const OUT = "reports/2026-08-20/holdout-diagnostics.md";
const PERMUTATIONS = 20000;
const PERM_SEED = 987654321;

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

/** Fisher-Yates using the supplied rng. */
function shuffled<T>(xs: readonly T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Permute outcome labels WITHIN each league.
 *
 * This preserves each league's qualification count (exactly P of N), which is a
 * hard structural fact, and destroys only the association between forecast and
 * outcome — which is precisely the null being tested.
 */
function permuteWithinClusters(rows: HoldoutRow[], rand: () => number): HoldoutRow[] {
  const byLeague = new Map<string, HoldoutRow[]>();
  for (const r of rows) {
    const b = byLeague.get(r.leagueKey);
    if (b) b.push(r);
    else byLeague.set(r.leagueKey, [r]);
  }
  const out: HoldoutRow[] = [];
  for (const group of byLeague.values()) {
    const labels = shuffled(group.map((g) => g.actual), rand);
    group.forEach((g, i) => out.push({ ...g, actual: labels[i]! }));
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function auc(rows: HoldoutRow[]): number {
  const pos = rows.filter((r) => r.actual === 1).map((r) => r.forecast);
  const neg = rows.filter((r) => r.actual === 0).map((r) => r.forecast);
  if (pos.length === 0 || neg.length === 0) return 0.5;
  let s = 0;
  for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

/**
 * One-way ANOVA F statistic for `forecast` grouped by outcome.
 *
 * With two groups this is algebraically the square of the two-sample t
 * statistic; it is reported as F because that is what was asked for, and the
 * p-value is permutation-derived either way.
 */
function anovaF(rows: HoldoutRow[], value: (r: HoldoutRow) => number): number {
  const groups = [rows.filter((r) => r.actual === 0), rows.filter((r) => r.actual === 1)];
  if (groups.some((g) => g.length < 2)) return 0;
  const all = rows.map(value);
  const grand = mean(all);
  let ssBetween = 0;
  let ssWithin = 0;
  for (const g of groups) {
    const vs = g.map(value);
    const m = mean(vs);
    ssBetween += g.length * (m - grand) ** 2;
    for (const v of vs) ssWithin += (v - m) ** 2;
  }
  const dfB = groups.length - 1;
  const dfW = rows.length - groups.length;
  if (ssWithin <= 0 || dfW <= 0) return 0;
  return ssBetween / dfB / (ssWithin / dfW);
}

/** Hosmer-Lemeshow style statistic over deciles of the forecast. */
function hosmerLemeshow(rows: HoldoutRow[], groups = 10): { stat: number; bins: number } {
  const sorted = [...rows].sort((a, b) => a.forecast - b.forecast);
  const size = Math.floor(sorted.length / groups);
  if (size < 2) return { stat: Number.NaN, bins: 0 };
  let stat = 0;
  let bins = 0;
  for (let g = 0; g < groups; g += 1) {
    const slice = g === groups - 1 ? sorted.slice(g * size) : sorted.slice(g * size, (g + 1) * size);
    if (slice.length === 0) continue;
    const observed = slice.reduce((a, r) => a + r.actual, 0);
    const expected = slice.reduce((a, r) => a + r.forecast, 0);
    const denom = expected * (1 - expected / slice.length);
    if (denom <= 1e-9) continue;
    stat += (observed - expected) ** 2 / denom;
    bins += 1;
  }
  return { stat, bins };
}

/** Intra-cluster correlation of the OUTCOME, one-way random effects. */
function icc(rows: HoldoutRow[]): number {
  const byLeague = new Map<string, number[]>();
  for (const r of rows) {
    const b = byLeague.get(r.leagueKey);
    if (b) b.push(r.actual);
    else byLeague.set(r.leagueKey, [r.actual]);
  }
  const groups = [...byLeague.values()].filter((g) => g.length > 1);
  if (groups.length < 2) return Number.NaN;
  const all = groups.flat();
  const grand = mean(all);
  const k = mean(groups.map((g) => g.length));
  let msBetween = 0;
  let msWithin = 0;
  let dfW = 0;
  for (const g of groups) {
    const m = mean(g);
    msBetween += g.length * (m - grand) ** 2;
    for (const v of g) msWithin += (v - m) ** 2;
    dfW += g.length - 1;
  }
  msBetween /= groups.length - 1;
  msWithin /= dfW;
  const denom = msBetween + (k - 1) * msWithin;
  return denom === 0 ? Number.NaN : (msBetween - msWithin) / denom;
}

/**
 * PARAMETRIC BOOTSTRAP calibration test.
 *
 * The right null for "is this model calibrated?" is: outcomes are generated BY
 * the model's own forecasts. Simulate that world many times, recompute
 * Hosmer-Lemeshow, and see how extreme the observed statistic is.
 *
 * Label permutation cannot answer this. Under a permutation null the
 * association is destroyed, so the permuted data is ALSO badly calibrated and
 * the observed statistic looks unremarkable beside it — which is why the first
 * version of this diagnostic reported "not distinguishable from chance" while
 * the pre-declared Brier-skill interval showed significant miscalibration. The
 * two were answering different questions; this one answers the intended one.
 *
 * Cluster structure is respected by resampling each league's outcomes
 * independently and then rescaling to preserve that league's berth count, since
 * exactly P of N teams qualify.
 */
function calibrationTest(rows: HoldoutRow[]): { stat: number; p: number; nullMean: number } {
  const observed = hosmerLemeshow(rows).stat;
  const rand = rng(PERM_SEED + 7);

  const byLeague = new Map<string, HoldoutRow[]>();
  for (const r of rows) {
    const b = byLeague.get(r.leagueKey);
    if (b) b.push(r);
    else byLeague.set(r.leagueKey, [r]);
  }

  const nulls: number[] = [];
  let atLeast = 0;
  for (let i = 0; i < PERMUTATIONS; i += 1) {
    const sim: HoldoutRow[] = [];
    for (const group of byLeague.values()) {
      // Draw each team independently from its own forecast, then take the top-K
      // by draw so the league still seats exactly its real number of qualifiers.
      const berths = group.reduce((a, g) => a + g.actual, 0);
      const scored = group
        .map((g) => ({ g, u: rand() < g.forecast ? 1 : 0, tie: rand() }))
        .sort((a, b) => b.u - a.u || b.tie - a.tie);
      scored.forEach((x, idx) => sim.push({ ...x.g, actual: idx < berths ? 1 : 0 }));
    }
    const v = hosmerLemeshow(sim).stat;
    if (Number.isFinite(v)) {
      nulls.push(v);
      if (v >= observed - 1e-12) atLeast += 1;
    }
  }
  return {
    stat: observed,
    p: (atLeast + 1) / (nulls.length + 1),
    nullMean: nulls.length > 0 ? mean(nulls) : Number.NaN
  };
}

/** One-sided permutation p-value: P(statistic under null >= observed). */
function permutationP(
  rows: HoldoutRow[],
  statistic: (rs: HoldoutRow[]) => number,
  observed: number
): { p: number; nullMean: number; nullSd: number } {
  const rand = rng(PERM_SEED);
  const nulls: number[] = [];
  let atLeast = 0;
  for (let i = 0; i < PERMUTATIONS; i += 1) {
    const v = statistic(permuteWithinClusters(rows, rand));
    nulls.push(v);
    if (v >= observed - 1e-12) atLeast += 1;
  }
  const m = mean(nulls);
  const sd = Math.sqrt(mean(nulls.map((v) => (v - m) ** 2)));
  // +1 / +1 keeps the p-value from ever being exactly 0, which a finite
  // permutation set cannot justify.
  return { p: (atLeast + 1) / (PERMUTATIONS + 1), nullMean: m, nullSd: sd };
}

function main(): void {
  const out: string[] = [];
  const say = (s = "") => {
    out.push(s);
    console.log(s);
  };

  const { rows, leagues } = buildHoldoutRows();
  if (rows.length === 0) {
    say("No holdout rows — run `npm run holdout:acquire` first.");
    writeFileSync(OUT, out.join("\n"));
    return;
  }

  say("# Holdout post-hoc diagnostics");
  say();
  say(`**Executed** ${new Date().toISOString()} · ${rows.length} team-seasons, ${leagues.length} leagues`);
  say();
  say(
    "> **These tests cannot change the verdict.** The success criterion was fixed " +
      "in [`holdout-protocol.md`](./holdout-protocol.md) §9 before the data was scored, " +
      "and it failed. Nothing below is a new criterion — running tests until one " +
      "returns p < 0.05 and calling that validation is the exact failure mode this " +
      "audit exists to prevent. What follows characterises WHERE the model breaks."
  );
  say();
  say(
    `All p-values are **cluster permutation** (${PERMUTATIONS.toLocaleString()} permutations, ` +
      "seed " + PERM_SEED + "): outcome labels are shuffled WITHIN each league, never across. " +
      "Within a league exactly P of N teams qualify by construction, so shuffling " +
      "across leagues would break that structure and manufacture significance."
  );
  say();

  // ── 1. discrimination: ANOVA + AUC ────────────────────────────────────────
  const fObs = anovaF(rows, (r) => r.forecast);
  const fTest = permutationP(rows, (rs) => anovaF(rs, (r) => r.forecast), fObs);
  const aucObs = auc(rows);
  const aucTest = permutationP(rows, auc, aucObs);

  say("## 1. Discrimination — does the forecast differ between qualifiers and non-qualifiers?");
  say();
  say("One-way ANOVA of the forecast, grouped by actual playoff qualification.");
  say();
  say("| test | statistic | null mean | null sd | permutation p | significant at 0.05? |");
  say("|---|---|---|---|---|---|");
  say(
    `| ANOVA F (forecast ~ outcome) | ${fObs.toFixed(4)} | ${fTest.nullMean.toFixed(4)} | ${fTest.nullSd.toFixed(4)} | **${fTest.p.toFixed(4)}** | ${fTest.p < 0.05 ? "**YES**" : "no"} |`
  );
  say(
    `| AUC (one-sided, > 0.5) | ${aucObs.toFixed(4)} | ${aucTest.nullMean.toFixed(4)} | ${aucTest.nullSd.toFixed(4)} | **${aucTest.p.toFixed(4)}** | ${aucTest.p < 0.05 ? "**YES**" : "no"} |`
  );
  say();

  // ── 2. calibration ────────────────────────────────────────────────────────
  const hl = hosmerLemeshow(rows);
  const hlTest = calibrationTest(rows);
  const brier = mean(rows.map((r) => (r.forecast - r.actual) ** 2));
  const climBrier = mean(rows.map((r) => (r.climatology - r.actual) ** 2));

  say("## 2. Calibration — do the numbers mean what they say?");
  say();
  say(
    "Hosmer-Lemeshow over forecast deciles, against a **parametric bootstrap** " +
      "null in which outcomes are generated BY the model's own forecasts (berth " +
      "counts preserved per league). A LARGE statistic means poor calibration, so " +
      "a **small p-value is bad news for the model** — the opposite direction from " +
      "test 1."
  );
  say();
  say(
    "> The first version of this diagnostic used label permutation here and " +
      "reported \"not distinguishable from chance\". That was the wrong null: " +
      "permuting labels destroys calibration too, so the null statistic was just " +
      "as large as the observed one and the test had no power. Corrected before " +
      "the result was reported."
  );
  say();
  say("| test | statistic | null mean | permutation p | reading |");
  say("|---|---|---|---|---|");
  say(
    `| Hosmer-Lemeshow (${hl.bins} bins) | ${hl.stat.toFixed(4)} | ${hlTest.nullMean.toFixed(4)} | **${hlTest.p.toFixed(4)}** | ${hlTest.p < 0.05 ? "**miscalibrated beyond what the model itself would produce**" : "not distinguishable from the model's own noise"} |`
  );
  say();
  say(`Brier ${brier.toFixed(4)} vs structural climatology ${climBrier.toFixed(4)}.`);
  say();

  // ── 3. "basket" / stratified testing by league shape ──────────────────────
  say("## 3. Stratified (bucket) testing — does it break differently by league shape?");
  say();
  say(
    "Per-stratum AUC and Brier. **Each stratum has few clusters, so no per-stratum " +
      "p-value is quoted** — with 2-6 leagues per bucket a permutation test there " +
      "would be the 9-distinct-values problem all over again."
  );
  say();
  say("| stratum | leagues | rows | qualification rate | AUC | Brier | climatology Brier |");
  say("|---|---|---|---|---|---|---|");

  const strata = new Map<string, HoldoutRow[]>();
  const leagueSize = new Map<string, number>();
  for (const l of leagues) leagueSize.set(l.key, l.format.numTeams);
  for (const r of rows) {
    const size = leagueSize.get(r.leagueKey) ?? 0;
    const key = `${size}-team`;
    const b = strata.get(key);
    if (b) b.push(r);
    else strata.set(key, [r]);
  }
  for (const [name, rs] of [...strata].sort()) {
    const nLeagues = new Set(rs.map((r) => r.leagueKey)).size;
    say(
      `| ${name} | ${nLeagues} | ${rs.length} | ${mean(rs.map((r) => r.actual)).toFixed(3)} | ` +
        `${auc(rs).toFixed(4)} | ${mean(rs.map((r) => (r.forecast - r.actual) ** 2)).toFixed(4)} | ` +
        `${mean(rs.map((r) => (r.climatology - r.actual) ** 2)).toFixed(4)} |`
    );
  }
  say();

  // ── 4. dependence ─────────────────────────────────────────────────────────
  const iccObs = icc(rows);
  say("## 4. Dependence — how much is a league-level effect?");
  say();
  say(
    `Intra-cluster correlation of the OUTCOME: **${Number.isNaN(iccObs) ? "n/a" : iccObs.toFixed(4)}**. ` +
      "A negative ICC is expected here and is not an error: within a league, one " +
      "team qualifying makes another's qualification LESS likely, because exactly P " +
      "of N berths exist. That is competitive exclusion, and it is why every " +
      "interval in this audit uses a cluster bootstrap rather than treating rows as " +
      "independent."
  );
  say();

  // ── verdict ───────────────────────────────────────────────────────────────
  say("## What this changes");
  say();
  const discriminates = fTest.p < 0.05 && aucTest.p < 0.05;
  const calibrated = hlTest.p >= 0.05;
  if (discriminates) {
    say(
      "Discrimination reaches nominal significance in this post-hoc test. That is " +
        "**not** validation: the pre-declared criterion was an AUC 95% CI entirely " +
        "above 0.5, which was not met, and a post-hoc test cannot be substituted for " +
        "a criterion fixed in advance."
    );
  } else {
    say(
      "**Discrimination is not significant.** The forecast does not separate " +
        "qualifiers from non-qualifiers beyond what within-league label shuffling " +
        "produces by chance. This agrees with the pre-declared AUC interval, which " +
        "straddled 0.5."
    );
  }
  say();
  if (!calibrated) {
    say(
      "**Calibration is significantly poor.** The forecasts are further from the " +
        "observed rates than chance allows. This agrees with the pre-declared Brier " +
        "skill interval, which lay entirely below zero."
    );
  } else {
    say("Calibration is not distinguishable from chance by Hosmer-Lemeshow at this sample size.");
  }
  say();
  say(
    "**Verdict unchanged: the model is not validated.** Nothing here licenses " +
      "shipping it as a forecast, changing a parameter, or merging on the strength " +
      "of a statistical result."
  );

  writeFileSync(OUT, out.join("\n"));
  console.log(`\nWrote ${OUT}`);
}

main();
