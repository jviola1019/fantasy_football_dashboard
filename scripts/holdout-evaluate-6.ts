/**
 * EXECUTE protocol 6 — is leave-one-week-out optimistic?
 *
 * The protocol is frozen at reports/2026-08-20/holdout-protocol-6.md, committed
 * before this file existed. Everything here follows it: k, the seed, the bin
 * count, the metric, the inference and the decision rule were all fixed in
 * advance. Nothing in this harness may be tuned against its own output.
 *
 *   npm run holdout:evaluate6
 *   npm run holdout:evaluate6 -- --self-test
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fitLogistic, fitLogisticCV, predictLogisticProba } from "../src/lib/stats/logistic";
import { brierScore, expectedCalibrationError } from "../src/lib/stats/distribution";
import type { BrierForecast } from "../src/lib/stats/distribution";
import { mulberry32 } from "../src/lib/rng";

const SNAPSHOT = "reports/2026-08-20/brier-prospective.json.gz";
const OUT = "reports/2026-08-20/holdout-result-6.md";

/** Frozen in protocol 6 §4 and §5. Not adjustable. */
const K = 5;
const FOLD_SEED = 20260823;
const BINS = 10;
const BOOTSTRAP_RESAMPLES = 5000;
const BOOTSTRAP_SEED = 6061;
const MATERIALITY = 0.01;
const L2 = 1.0;

/** Same thresholds the shipped backtest uses. */
const THRESHOLDS: Record<string, number> = { QB: 18, RB: 10, WR: 8, TE: 6 };
const POSITIONS = ["QB", "RB", "WR", "TE"] as const;

interface Row {
  player_id: string;
  position: string;
  week: number;
  proj_pts_ppr: number;
  actual_pts_ppr: number;
}

interface Scored {
  playerId: string;
  position: string;
  prob: number;
  outcome: 0 | 1;
}

function loadRows(): { rows: Row[]; capturedAt: string } {
  const snap = JSON.parse(gunzipSync(readFileSync(SNAPSHOT)).toString("utf8")) as {
    capturedAt: string;
    rows: Row[];
  };
  return { rows: snap.rows, capturedAt: snap.capturedAt };
}

/**
 * Assign each DISTINCT player to one of K folds, seeded.
 *
 * By player, not by row: the entire point is that a player's weeks may not be
 * split across the train/test boundary.
 */
function playerFolds(rows: Row[]): Map<string, number> {
  const players = [...new Set(rows.map((r) => r.player_id))].sort();
  const rng = mulberry32(FOLD_SEED);
  const assign = new Map<string, number>();
  for (const p of players) assign.set(p, Math.floor(rng() * K) % K);
  return assign;
}

const ece = (f: Scored[]) =>
  expectedCalibrationError(f.map((s) => ({ prob: s.prob, outcome: s.outcome })) as BrierForecast[], BINS).ece;
const brier = (f: Scored[]) =>
  brierScore(f.map((s) => ({ prob: s.prob, outcome: s.outcome })) as BrierForecast[]).score;

/**
 * Scheme A and B differ ONLY in the fold vector handed to `fitLogisticCV`, so
 * they share this function. Fitting is per position, exactly as the shipped
 * `buildLogisticCalibration` does; the out-of-fold forecasts are then pooled
 * across positions for one ECE (protocol 6 §5).
 */
function scoreByFoldVector(rows: Row[], foldOf: (r: Row) => number): Scored[] {
  const out: Scored[] = [];
  for (const pos of POSITIONS) {
    const posRows = rows.filter((r) => r.position === pos);
    if (posRows.length < 20) continue;
    const folds = new Set(posRows.map(foldOf));
    if (folds.size < 2) continue;
    const X = posRows.map((r) => [r.proj_pts_ppr]);
    const y = posRows.map((r) => (r.actual_pts_ppr >= THRESHOLDS[pos]! ? 1 : 0));
    const oof = fitLogisticCV(X, y, posRows.map(foldOf), { l2: L2 });
    for (let i = 0; i < posRows.length; i += 1) {
      out.push({
        playerId: posRows[i]!.player_id,
        position: pos,
        prob: oof[i]!,
        outcome: y[i]! as 0 | 1
      });
    }
  }
  return out;
}

/**
 * Scheme C: a test fold shares neither a week nor a player with its training
 * set. `fitLogisticCV` cannot express this — it trains on "everything not in
 * this fold" — so the loop is written out.
 *
 * Reported as a DIAGNOSTIC only. Excluding every row that shares a week with
 * the test fold removes a large share of the training data, so a worse score
 * here confounds "leakage removed" with "less data". That confound is why B is
 * primary.
 */
function scoreWeekAndPlayerDisjoint(rows: Row[], assign: Map<string, number>): Scored[] {
  const out: Scored[] = [];
  for (const pos of POSITIONS) {
    const posRows = rows.filter((r) => r.position === pos);
    if (posRows.length < 20) continue;
    const threshold = THRESHOLDS[pos]!;

    for (let fold = 0; fold < K; fold += 1) {
      const test = posRows.filter((r) => assign.get(r.player_id) === fold);
      if (test.length === 0) continue;
      const testWeeks = new Set(test.map((r) => r.week));
      const train = posRows.filter(
        (r) => assign.get(r.player_id) !== fold && !testWeeks.has(r.week)
      );
      // With 17 weeks and players spread across all of them, a fold's week set
      // can cover the season. Nothing to train on means nothing to report --
      // emitting the 0.5 prior here would score the prior, not the model.
      if (train.length < 20) continue;
      const trainY = train.map((r) => (r.actual_pts_ppr >= threshold ? 1 : 0));
      if (new Set(trainY).size < 2) continue;
      const model = fitLogistic(train.map((r) => [r.proj_pts_ppr]), trainY, { l2: L2 });
      for (const r of test) {
        out.push({
          playerId: r.player_id,
          position: pos,
          prob: predictLogisticProba(model, [r.proj_pts_ppr]),
          outcome: (r.actual_pts_ppr >= threshold ? 1 : 0) as 0 | 1
        });
      }
    }
  }
  return out;
}

/**
 * Cluster bootstrap on player_id, PAIRED within each resample.
 *
 * Both schemes are scored on the identical resampled rows, so the difference is
 * not contaminated by which players a resample happened to draw.
 */
function pairedBootstrap(a: Scored[], b: Scored[]): { point: number; lo: number; hi: number } {
  const byPlayerA = new Map<string, Scored[]>();
  const byPlayerB = new Map<string, Scored[]>();
  for (const s of a) byPlayerA.set(s.playerId, [...(byPlayerA.get(s.playerId) ?? []), s]);
  for (const s of b) byPlayerB.set(s.playerId, [...(byPlayerB.get(s.playerId) ?? []), s]);
  const players = [...byPlayerA.keys()].filter((p) => byPlayerB.has(p)).sort();

  const point = ece(players.flatMap((p) => byPlayerB.get(p)!)) - ece(players.flatMap((p) => byPlayerA.get(p)!));

  const rng = mulberry32(BOOTSTRAP_SEED);
  const diffs: number[] = [];
  for (let i = 0; i < BOOTSTRAP_RESAMPLES; i += 1) {
    const drawA: Scored[] = [];
    const drawB: Scored[] = [];
    for (let j = 0; j < players.length; j += 1) {
      const p = players[Math.floor(rng() * players.length)]!;
      drawA.push(...byPlayerA.get(p)!);
      drawB.push(...byPlayerB.get(p)!);
    }
    diffs.push(ece(drawB) - ece(drawA));
  }
  diffs.sort((x, y) => x - y);
  return {
    point,
    lo: diffs[Math.floor(0.025 * diffs.length)]!,
    hi: diffs[Math.min(diffs.length - 1, Math.floor(0.975 * diffs.length))]!
  };
}

/**
 * Arithmetic self-test. Verifies the harness on data with a KNOWN answer before
 * it is pointed at the real thing, and never touches the snapshot.
 */
function selfTest(): void {
  const fails: string[] = [];
  const ck = (name: string, cond: boolean, detail = "") => {
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
    if (!cond) fails.push(name);
  };

  // A perfectly calibrated forecast has ECE 0.
  const perfect: Scored[] = [];
  for (let i = 0; i < 100; i += 1) {
    perfect.push({ playerId: `p${i}`, position: "RB", prob: 1, outcome: 1 });
    perfect.push({ playerId: `q${i}`, position: "RB", prob: 0, outcome: 0 });
  }
  ck("ECE of a perfect forecast is 0", Math.abs(ece(perfect)) < 1e-9, ece(perfect).toFixed(6));

  // A confidently wrong forecast has ECE 1.
  const wrong = perfect.map((s) => ({ ...s, prob: 1 - s.prob }));
  ck("ECE of a fully wrong forecast is 1", Math.abs(ece(wrong) - 1) < 1e-9, ece(wrong).toFixed(6));

  // Player folds keep every row of a player together — the property the whole
  // protocol rests on. A harness that split players would silently measure
  // nothing.
  const rows: Row[] = [];
  for (let p = 0; p < 40; p += 1) {
    for (let w = 1; w <= 5; w += 1) {
      rows.push({ player_id: `pl${p}`, position: "RB", week: w, proj_pts_ppr: 10, actual_pts_ppr: 11 });
    }
  }
  const assign = playerFolds(rows);
  const perPlayerFolds = new Map<string, Set<number>>();
  for (const r of rows) {
    perPlayerFolds.set(r.player_id, new Set([...(perPlayerFolds.get(r.player_id) ?? []), assign.get(r.player_id)!]));
  }
  ck(
    "every player lands in exactly one fold",
    [...perPlayerFolds.values()].every((f) => f.size === 1)
  );
  ck("folds are seeded and reproducible", JSON.stringify([...playerFolds(rows)]) === JSON.stringify([...assign]));
  ck("the split actually uses more than one fold", new Set(assign.values()).size > 1, `${new Set(assign.values()).size} folds`);

  console.log(fails.length === 0 ? "\nself-test: PASS" : `\nself-test: ${fails.length} FAILED`);
  if (fails.length) process.exitCode = 1;
}

function main(): void {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }

  const { rows, capturedAt } = loadRows();
  const assign = playerFolds(rows);

  const A = scoreByFoldVector(rows, (r) => r.week);
  const B = scoreByFoldVector(rows, (r) => assign.get(r.player_id)!);
  const C = scoreWeekAndPlayerDisjoint(rows, assign);

  const boot = pairedBootstrap(A, B);
  const players = new Set(rows.map((r) => r.player_id)).size;
  const weeksPerPlayer = rows.length / players;

  const verdict =
    boot.lo > 0 || boot.hi < 0
      ? Math.abs(boot.point) >= MATERIALITY
        ? "MATERIAL"
        : "REAL BUT IMMATERIAL"
      : "NOT DETECTABLE";

  const L: string[] = [];
  L.push("# Protocol 6 result — is leave-one-week-out optimistic?", "");
  L.push(`> **Protocol** frozen at \`reports/2026-08-20/holdout-protocol-6.md\` before this harness existed.  `);
  L.push(`> **Input** \`${SNAPSHOT}\`, captured ${capturedAt} — the committed P2-5 snapshot, replayed, never re-fetched.  `);
  L.push(`> **Rows** ${rows.length.toLocaleString()} player-weeks · **${players}** distinct players · ${weeksPerPlayer.toFixed(1)} weeks per player on average  `);
  L.push("");
  L.push("## The dependence being tested");
  L.push("");
  L.push(
    `Each player appears in **${weeksPerPlayer.toFixed(1)} rows on average**. Under leave-one-week-out ` +
      `every one of a player's other weeks is in the training set for the week being scored, so the folds ` +
      `are separated in time but not in players.`
  );
  L.push("");
  L.push("## Result");
  L.push("");
  L.push("| scheme | folds | ECE | Brier | rows scored |");
  L.push("|---|---|---|---|---|");
  L.push(`| **A** leave-one-week-out *(shipped)* | by week | **${ece(A).toFixed(4)}** | ${brier(A).toFixed(4)} | ${A.length.toLocaleString()} |`);
  L.push(`| **B** grouped by player *(primary)* | ${K}-fold | **${ece(B).toFixed(4)}** | ${brier(B).toFixed(4)} | ${B.length.toLocaleString()} |`);
  L.push(`| C week ∧ player disjoint *(diagnostic)* | ${K}-fold | ${C.length ? ece(C).toFixed(4) : "—"} | ${C.length ? brier(C).toFixed(4) : "—"} | ${C.length.toLocaleString()} |`);
  L.push("");
  L.push(
    `**ECE(B) − ECE(A) = ${boot.point >= 0 ? "+" : ""}${boot.point.toFixed(4)}** ` +
      `· 95% cluster bootstrap [${boot.lo.toFixed(4)}, ${boot.hi.toFixed(4)}] ` +
      `· ${BOOTSTRAP_RESAMPLES.toLocaleString()} resamples on ${players} player clusters, paired within resample.`
  );
  L.push("");
  L.push(`### Verdict against the pre-declared rule: **${verdict}**`);
  L.push("");
  if (verdict === "MATERIAL") {
    L.push(
      `The gap reaches the ${MATERIALITY} materiality threshold and the interval excludes zero. Per protocol §7 ` +
        `the **grouped figure becomes the reported calibration error**; the leave-one-week-out number is retained ` +
        `only as a labelled comparison.`
    );
  } else if (verdict === "REAL BUT IMMATERIAL") {
    L.push(
      `The interval excludes zero, so the optimism is real, but the gap is below the ${MATERIALITY} threshold ` +
        `declared before the run. Per protocol §7 the leave-one-week-out figure stands and the P2-7 caveat is ` +
        `replaced by the measured number.`
    );
  } else {
    L.push(
      `The interval includes zero. **There is no detectable optimism at this sample size**, and per protocol §7 ` +
        `the claim that leave-one-week-out is optimistic is RETRACTED — replaced by this interval. That is the ` +
        `outcome §2 warned was plausible: the model has one feature and player identity is not in it, so the leak ` +
        `was always bounded.`
    );
  }
  L.push("");
  // Scheme C emitting nothing is a RESULT, not a blank cell. Saying so is the
  // difference between "the diagnostic was run and found nothing" and "the
  // diagnostic could not run", which are entirely different statements.
  if (C.length === 0) {
    L.push("### Why diagnostic C is empty");
    L.push("");
    L.push(
      `Scheme C scored **zero rows**, and that is informative rather than a gap. With ${players} players ` +
        `spread across every week of the season, each player-fold's set of weeks covers essentially the whole ` +
        `schedule — so excluding every row that shares a week with the test fold leaves nothing to train on.`
    );
    L.push("");
    L.push(
      "The strict scheme is **inexpressible on this data**, and the reason is exactly the dependence protocol 6 " +
        "set out to measure: players span weeks so thoroughly that week-disjointness and player-disjointness " +
        "cannot both hold. Reporting a number here would have required weakening one of them, which the frozen " +
        "protocol forbids."
    );
    L.push("");
  }

  L.push("### Per position (diagnostic, not a criterion)");
  L.push("");
  L.push("| position | ECE A | ECE B | difference | n |");
  L.push("|---|---|---|---|---|");
  for (const pos of POSITIONS) {
    const a = A.filter((s) => s.position === pos);
    const b = B.filter((s) => s.position === pos);
    if (a.length === 0 || b.length === 0) continue;
    const d = ece(b) - ece(a);
    L.push(`| ${pos} | ${ece(a).toFixed(4)} | ${ece(b).toFixed(4)} | ${d >= 0 ? "+" : ""}${d.toFixed(4)} | ${a.length} |`);
  }
  L.push("");
  // The per-position signs and the pooled sign disagree. That has to be said out
  // loud, by the harness, not left for a reader to notice.
  {
    const signs = POSITIONS.map((pos) => {
      const a = A.filter((s) => s.position === pos);
      const b = B.filter((s) => s.position === pos);
      return a.length && b.length ? ece(b) - ece(a) : null;
    }).filter((d): d is number => d !== null);
    const allPositive = signs.length > 0 && signs.every((d) => d > 0);
    if (allPositive && boot.point <= 0) {
      L.push("");
      L.push("### A disagreement between the pooled and per-position views");
      L.push("");
      L.push(
        `Every position individually shows B worse than A (+${Math.min(...signs).toFixed(4)} to ` +
          `+${Math.max(...signs).toFixed(4)}), while the **pooled** difference is ` +
          `${boot.point.toFixed(4)}. Pooling forecasts from four positions into shared bins lets ` +
          `well-calibrated and poorly-calibrated regions offset each other, so the pooled figure is not the ` +
          `average of the per-position ones.`
      );
      L.push("");
      L.push(
        "**The verdict above is unchanged**, because the pooled statistic is what protocol 6 §5 declared as " +
          "primary and §8 forbids promoting a diagnostic to a criterion after seeing it. But the consistent " +
          "positive sign across all four positions is the kind of pattern a larger sample might resolve into a " +
          "real effect, and it would be dishonest to report the pooled null without it."
      );
      L.push("");
      L.push(
        "What this does **not** license: quoting the per-position numbers as the finding. They were declared a " +
          "diagnostic before the run, and they stay one."
      );
    }
  }

  L.push("### What is NOT claimed");
  L.push("");
  L.push(
    "- Brier is reported above and is **not** a criterion. It mixes calibration and discrimination, so a Brier " +
      "move cannot settle a calibration question."
  );
  L.push(
    "- Scheme C is a diagnostic. Excluding every row sharing a week with the test fold removes a large share of " +
      "the training data, so a worse score there confounds leakage with sample size."
  );
  L.push(
    "- This measures the CALIBRATION model's fold structure. It says nothing about whether the projections " +
      "themselves are any good, which protocols 1–3 already answered separately."
  );
  L.push("");
  L.push(`Reproduce: \`npm run holdout:evaluate6\` · arithmetic: \`npm run holdout:evaluate6 -- --self-test\``);

  const text = L.join("\n") + "\n";
  writeFileSync(OUT, text, "utf8");
  console.log(text);
  console.log(`Wrote ${OUT}`);
}

main();
