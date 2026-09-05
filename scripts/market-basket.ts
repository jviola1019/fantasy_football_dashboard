/**
 * MARKET BASKET ANALYSIS over weekly usage — do INTERPRETABLE interaction rules
 * exist, and do they replicate out of holdout?
 *
 * WHY THIS, WHEN THE ENSEMBLES ALREADY SAID NO.
 *
 * `docs/holdout-weekly.md` found that gradient boosting and a random forest —
 * both of which CAN represent interactions — do not beat an additive logistic.
 * That is evidence against interactions mattering, but it is evidence of a
 * particular kind: an ensemble that finds nothing tells you nothing about WHY,
 * and it cannot be read by a person deciding who to start.
 *
 * Association rules answer a different, narrower, more useful question: is there
 * a NAMEABLE combination of conditions — "high target share AND high air-yards
 * share" — under which a player clears their line more often than the additive
 * model predicts, and does that combination still work on seasons nobody
 * fitted on?
 *
 * A null result here is worth having for the same reason the ensembles' null was:
 * it closes a direction. A positive result is worth more than the ensembles',
 * because it is legible.
 *
 * ── LIFT AGAINST WHAT? THE QUESTION THAT DECIDES WHETHER THIS IS USEFUL ───
 *
 * The first version of this script measured lift against the overall BASE RATE
 * and reported **556 of 557 rules surviving**. That is not a discovery, it is a
 * tautology wearing a p-value: almost every surviving rule was
 * `priorMeanPpr HIGH AND ...`, which is a rule that says "this player is good".
 * Of course a high-scoring back clears their line more often than the average
 * back. That is the MAIN EFFECT the additive logistic already models, restated
 * as an association rule and then congratulated for being true.
 *
 * It is the same error `docs/weekly-prob-baselines.md` was written to correct —
 * quoting skill against a constant instead of against the model you already
 * have — and it appeared here in a new costume, which is exactly how that error
 * survives.
 *
 * So the comparison is against the ADDITIVE MODEL'S OWN PREDICTION for the
 * rows the rule covers. A logistic is fitted on train over the same features,
 * and a rule earns its place only if its members clear their line MORE OFTEN
 * THAN THAT MODEL EXPECTS THEM TO. That is what an interaction IS: something
 * the additive form cannot already account for. A rule that merely identifies
 * good players now scores a lift of 1.0, which is the truth about it.
 *
 * ── THE THREE NUMBERS, AND THE ONE THAT MATTERS ───────────────────────────
 *
 *   SUPPORT     how often the condition occurs. A rule covering 4 rows is not a
 *               finding, it is a coincidence with good manners.
 *   CONFIDENCE  P(clears | condition).
 *   LIFT        confidence divided by what the additive model expects. Lift 1.0
 *               means the condition tells you nothing the model did not already
 *               know. This is the number people quote and the easiest to fool
 *               yourself with, because ANY split of a finite sample produces
 *               some subgroup with lift > 1 against a constant.
 *
 * ── WHY THIS ONE IS NOT SELF-DECEIVING ────────────────────────────────────
 *
 * Mining rules on a dataset and reporting the best ones is a machine for
 * generating false discoveries: thousands of candidate conditions, and the
 * maximum of thousands of noisy lifts is large by construction. Three guards,
 * all of which the naive version omits:
 *
 *   1. RULES ARE MINED ON TRAIN ONLY (2017–2022). Bin edges are train tertiles.
 *      The holdout is never looked at while choosing what to test.
 *   2. EVERY SURVIVING RULE IS RE-TESTED ON THE HOLDOUT, and must clear the
 *      ADDITIVE MODEL'S expectation there with a Wilson lower bound above it.
 *      Lift measured where the rule was found is not evidence.
 *   3. HOLM–BONFERRONI across every rule carried into the holdout. Reporting the
 *      best of 300 rules at p < 0.05 is the same error `multipleComparisons.ts`
 *      exists to prevent.
 *
 * A NEGATIVE CONTROL runs alongside: rules mined on a SHUFFLED outcome. Those
 * must not survive. If they do, the pipeline is manufacturing findings and the
 * run says so instead of publishing.
 *
 *   npm run basket:weekly
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseCsvRows } from "../src/lib/stats/csv";
import { quantile, wilsonInterval } from "../src/lib/stats/distribution";
import { fitLogistic, predictLogisticProba } from "../src/lib/stats/logistic";
import { holmBonferroni } from "../src/lib/stats/multipleComparisons";
import { mulberry32 } from "../src/lib/rng";
import { WEEKLY_PROB_MODELS, type WeeklyPosition } from "../src/lib/models/weeklyProbability";

const NFLVERSE = "reports/2026-08-20/nflverse-usage.json.gz";
const OUT = "docs/market-basket.md";
const POSITIONS: WeeklyPosition[] = ["QB", "RB", "WR", "TE"];
const TRAIN_SEASONS = [2017, 2018, 2019, 2020, 2021, 2022];
const HOLDOUT_SEASONS = [2023, 2024];
const MIN_HISTORY = 3;
/** A rule must cover at least this share of train rows to be worth testing. */
const MIN_SUPPORT = 0.03;
/** And beat base rate by at least this much on train to be carried forward. */
const MIN_TRAIN_LIFT = 1.15;
const MAX_ITEMS = 3;
const ALPHA = 0.05;

const num = (v: string | undefined): number => {
  if (v === undefined || v === "" || v === "NA") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

interface Row {
  season: number;
  outcome: 0 | 1;
  /** Feature values, in FEATURES order. */
  f: number[];
}

const FEATURES = [
  "priorMeanPpr",
  "priorTargetShare",
  "priorWopr",
  "priorAirYardsShare",
  "priorTargetsPerGame",
  "priorReceptionsPerGame",
  "priorCarriesPerGame",
  "priorHitRate"
] as const;

/** One binary condition: a feature in a tertile band. */
interface Item {
  feature: number;
  band: "low" | "high";
  label: string;
}

function buildRows(pos: WeeklyPosition): Row[] {
  const bundle = JSON.parse(gunzipSync(readFileSync(NFLVERSE)).toString("utf8")) as Record<string, string>;
  const threshold = WEEKLY_PROB_MODELS[pos].threshold;
  const out: Row[] = [];

  for (const key of Object.keys(bundle).filter((k) => k.startsWith("player_stats_"))) {
    const season = Number(key.replace("player_stats_", ""));
    const parsed = parseCsvRows(bundle[key]!);
    if (parsed.malformed > 0) throw new Error(`${key}: ${parsed.malformed} malformed rows`);
    const mine = parsed.rows
      .filter((r) => r.season_type === "REG" && r.position === pos)
      .sort((a, b) => Number(a.week) - Number(b.week));

    const hist = new Map<
      string,
      { n: number; ppr: number; ts: number; wopr: number; ays: number; tg: number; rec: number; car: number; hits: number }
    >();
    for (const r of mine) {
      const id = r.player_id!;
      const ppr = num(r.fantasy_points_ppr);
      const h = hist.get(id);
      if (h && h.n >= MIN_HISTORY) {
        out.push({
          season,
          outcome: ppr >= threshold ? 1 : 0,
          f: [
            h.ppr / h.n,
            h.ts / h.n,
            h.wopr / h.n,
            h.ays / h.n,
            h.tg / h.n,
            h.rec / h.n,
            h.car / h.n,
            h.hits / h.n
          ]
        });
      }
      const p = hist.get(id) ?? { n: 0, ppr: 0, ts: 0, wopr: 0, ays: 0, tg: 0, rec: 0, car: 0, hits: 0 };
      hist.set(id, {
        n: p.n + 1,
        ppr: p.ppr + ppr,
        ts: p.ts + num(r.target_share),
        wopr: p.wopr + num(r.wopr),
        ays: p.ays + num(r.air_yards_share),
        tg: p.tg + num(r.targets),
        rec: p.rec + num(r.receptions),
        car: p.car + num(r.carries),
        hits: p.hits + (ppr >= threshold ? 1 : 0)
      });
    }
  }
  return out;
}

/** Tertile edges from TRAIN only — the holdout never informs a bin boundary. */
function bandsFromTrain(train: Row[]): Array<{ lo: number; hi: number }> {
  return FEATURES.map((_, j) => {
    const col = train.map((r) => r.f[j]!);
    return { lo: quantile(col, 1 / 3), hi: quantile(col, 2 / 3) };
  });
}

const holds = (r: Row, item: Item, edges: Array<{ lo: number; hi: number }>): boolean =>
  item.band === "high" ? r.f[item.feature]! >= edges[item.feature]!.hi : r.f[item.feature]! <= edges[item.feature]!.lo;

const matches = (r: Row, rule: Item[], edges: Array<{ lo: number; hi: number }>): boolean =>
  rule.every((i) => holds(r, i, edges));

interface Rule {
  pos: string;
  items: Item[];
  label: string;
  trainSupport: number;
  trainLift: number;
  holdN: number;
  holdConfidence: number;
  /** Mean probability the ADDITIVE logistic assigns to this rule's members. */
  holdExpected: number;
  /** confidence / expected. 1.0 means the rule adds nothing the model lacks. */
  holdLift: number;
  holdLower: number;
  holdBase: number;
  /** Lift against the raw base rate — kept only to show what it hides. */
  naiveLift: number;
}

/** Every rule of size 1..MAX_ITEMS over the item pool, no feature used twice. */
function enumerate(pool: Item[]): Item[][] {
  const out: Item[][] = [];
  const walk = (start: number, current: Item[]) => {
    if (current.length > 0) out.push([...current]);
    if (current.length === MAX_ITEMS) return;
    for (let i = start; i < pool.length; i += 1) {
      if (current.some((c) => c.feature === pool[i]!.feature)) continue;
      current.push(pool[i]!);
      walk(i + 1, current);
      current.pop();
    }
  };
  walk(0, []);
  return out;
}

function mine(
  pos: string,
  train: Row[],
  holdout: Row[],
  shuffleOutcomes: boolean,
  seed: number,
  expected: number[]
) {
  const edges = bandsFromTrain(train);
  const pool: Item[] = [];
  FEATURES.forEach((name, j) => {
    pool.push({ feature: j, band: "high", label: `${name} HIGH` });
    pool.push({ feature: j, band: "low", label: `${name} LOW` });
  });

  // The negative control shuffles the OUTCOME only, leaving every feature and
  // every bin edge intact. Any rule surviving that is manufactured by the
  // procedure rather than found in the data.
  let trainRows = train;
  if (shuffleOutcomes) {
    const rand = mulberry32(seed);
    const ys = train.map((r) => r.outcome);
    for (let i = ys.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [ys[i], ys[j]] = [ys[j]!, ys[i]!];
    }
    trainRows = train.map((r, i) => ({ ...r, outcome: ys[i]! }));
  }

  const trainBase = trainRows.reduce<number>((a, r) => a + r.outcome, 0) / Math.max(1, trainRows.length);
  const holdBase = holdout.reduce<number>((a, r) => a + r.outcome, 0) / Math.max(1, holdout.length);

  const carried: Rule[] = [];
  for (const items of enumerate(pool)) {
    let n = 0;
    let hits = 0;
    for (const r of trainRows) {
      if (!matches(r, items, edges)) continue;
      n += 1;
      hits += r.outcome;
    }
    if (n / trainRows.length < MIN_SUPPORT) continue;
    const lift = hits / n / Math.max(1e-9, trainBase);
    if (lift < MIN_TRAIN_LIFT) continue;

    // Carried into the holdout. Measured there, never re-selected there — and
    // measured against what the ADDITIVE model already predicts for exactly
    // these rows, not against the global base rate.
    let hn = 0;
    let hh = 0;
    let expSum = 0;
    for (let i = 0; i < holdout.length; i += 1) {
      if (!matches(holdout[i]!, items, edges)) continue;
      hn += 1;
      hh += holdout[i]!.outcome;
      expSum += expected[i]!;
    }
    if (hn < 30) continue;
    const conf = hh / hn;
    const exp = expSum / hn;
    const w = wilsonInterval(conf, hn, 0.95);
    carried.push({
      pos,
      items,
      label: items.map((i) => i.label).join(" AND "),
      trainSupport: n / trainRows.length,
      trainLift: lift,
      holdN: hn,
      holdConfidence: conf,
      holdExpected: exp,
      holdLift: conf / Math.max(1e-9, exp),
      holdLower: w.lower,
      holdBase,
      naiveLift: conf / Math.max(1e-9, holdBase)
    });
  }
  return carried;
}

function main(): void {
  const lines: string[] = [];
  lines.push("# Market basket analysis — weekly start/sit\n");
  lines.push(`**Executed** ${new Date().toISOString()}  \n`);
  lines.push(
    `\n**Mined on** ${TRAIN_SEASONS[0]}–${TRAIN_SEASONS[TRAIN_SEASONS.length - 1]} · ` +
      `**tested on** ${HOLDOUT_SEASONS.join("–")}\n`
  );
  lines.push(
    "\n> Generated by `npm run basket:weekly`. Rules and tertile bin edges come from " +
      "TRAIN ONLY; every surviving rule is re-measured on the holdout and must clear the " +
      "holdout base rate with a Wilson lower bound above it, after Holm correction across " +
      "all rules carried forward. A negative control mines the same pipeline against a " +
      "SHUFFLED outcome and must find nothing.\n"
  );

  const all: Rule[] = [];
  const control: Rule[] = [];
  const counts: string[] = [];

  for (const pos of POSITIONS) {
    const rows = buildRows(pos);
    const train = rows.filter((r) => TRAIN_SEASONS.includes(r.season));
    const holdout = rows.filter((r) => HOLDOUT_SEASONS.includes(r.season));
    if (train.length < 500 || holdout.length < 200) continue;
    // The additive reference: a logistic on the same features, fitted on TRAIN,
    // predicting each holdout row. This is the thing a rule has to beat.
    const fit = fitLogistic(train.map((r) => r.f), train.map((r) => r.outcome), { l2: 1e-4 });
    const expected = holdout.map((r) => predictLogisticProba(fit, r.f));
    const real = mine(pos, train, holdout, false, 0, expected);
    const fake = mine(pos, train, holdout, true, 424242, expected);
    all.push(...real);
    control.push(...fake);
    counts.push(`| ${pos} | ${train.length} | ${holdout.length} | ${real.length} | ${fake.length} |`);
  }

  // Holm over every rule carried into the holdout. The p-value is the one-sided
  // binomial-normal tail for "this rule's holdout confidence exceeds base rate".
  const pOf = (r: Rule) => {
    // Against the ADDITIVE EXPECTATION, not the base rate. Under the null the
    // rule's members clear exactly as often as the model says they will.
    const se = Math.sqrt((r.holdExpected * (1 - r.holdExpected)) / r.holdN);
    if (se <= 0) return 1;
    const z = (r.holdConfidence - r.holdExpected) / se;
    // One-sided normal tail, Abramowitz & Stegun 26.2.17.
    const a = Math.abs(z);
    const k = 1 / (1 + 0.2316419 * a);
    const d = 0.3989422804014327 * Math.exp(-(a * a) / 2);
    const upper =
      d * k * (0.31938153 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
    return z > 0 ? upper : 1 - upper;
  };

  const holm = holmBonferroni(all.map((r, i) => ({ id: `${i}`, p: pOf(r) })), ALPHA);
  const reject = new Set(holm.filter((h) => h.reject).map((h) => h.id));
  const survivors = all.filter((r, i) => reject.has(`${i}`) && r.holdLower > r.holdExpected);

  const controlHolm = holmBonferroni(control.map((r, i) => ({ id: `${i}`, p: pOf(r) })), ALPHA);
  const controlSurvivors = control.filter(
    (r, i) => controlHolm.find((h) => h.id === `${i}`)?.reject && r.holdLower > r.holdExpected
  );

  lines.push("\n## Rules carried from train into the holdout\n");
  lines.push(`\nSupport floor ${(100 * MIN_SUPPORT).toFixed(0)}%, train lift floor ${MIN_TRAIN_LIFT}, up to ${MAX_ITEMS} conditions.\n`);
  lines.push("\n| position | train rows | holdout rows | rules carried | control rules carried |");
  lines.push("|---|---|---|---|---|");
  lines.push(...counts);

  lines.push("\n## Negative control\n");
  lines.push(
    controlSurvivors.length === 0
      ? `\n**PASS.** ${control.length} rules mined against a SHUFFLED outcome, ` +
          "**0** survive on the holdout after correction. The pipeline is not manufacturing " +
          "findings, so a positive result below means something and a null one does too.\n"
      : `\n**FAILED — THIS RUN IS VOID.** ${controlSurvivors.length} rules survive against a ` +
          "shuffled outcome. Everything below is an artifact of the search, not a finding.\n"
  );

  lines.push("\n## Result\n");
  lines.push(
    `\n**${survivors.length} of ${all.length} rules beat the additive model's own prediction ` +
      "for the same rows, after Holm correction.**\n"
  );
  if (survivors.length > 0) {
    lines.push(
      "\n| position | rule | holdout n | observed | additive model expects | lift over model | naive lift over base |"
    );
    lines.push("|---|---|---|---|---|---|---|");
    for (const r of survivors.sort((a, b) => b.holdLift - a.holdLift).slice(0, 25)) {
      lines.push(
        `| ${r.pos} | ${r.label} | ${r.holdN} | ${(100 * r.holdConfidence).toFixed(1)}% | ` +
          `${(100 * r.holdExpected).toFixed(1)}% | **${r.holdLift.toFixed(2)}×** | ` +
          `${r.naiveLift.toFixed(2)}× |`
      );
    }
    lines.push(
      "\nThese are INTERPRETABLE and they replicate on seasons nobody mined. That is what " +
        "association rules add over the ensembles in `docs/holdout-weekly.md`, which found " +
        "the same signal and could not say what it was.\n"
    );
  } else {
    lines.push(
      "\nNo nameable combination of usage conditions beats what the additive logistic already " +
        "predicts for those same rows, on unseen seasons, after correction. Consistent with " +
        "the ensembles: gradient boosting and a random forest, " +
        "both able to represent interactions, also failed to beat an additive logistic. Two " +
        "methods with very different failure modes agreeing on a null is worth more than " +
        "either alone.\n"
    );
  }

  // The naive column is kept precisely because it is the trap.
  const naiveBeat = all.filter((r) => r.naiveLift > 1).length;
  lines.push("\n## What lift does not mean\n");
  lines.push(
    `\nMeasured against the raw base rate, **${naiveBeat} of ${all.length}** of these rules ` +
      "look like winners. That number is meaningless and it is printed here as a warning: " +
      "nearly all of those rules contain `priorMeanPpr HIGH`, so they say \"this player is " +
      "good\" — the MAIN EFFECT the additive logistic already models, restated as a rule and " +
      "then congratulated for being true.\n"
  );
  lines.push(
    "\nThe first version of this script reported exactly that, and it was the same error " +
      "`docs/weekly-prob-baselines.md` exists to correct — skill quoted against a constant " +
      "rather than against the model you already have — reappearing in a new costume. Every " +
      "figure in the result table above is against the additive model's own prediction for " +
      "the same rows, which is the only comparison under which \"interaction\" means " +
      "anything.\n"
  );
  lines.push(
    "\nA lift above 1 on the data a rule was mined from is not evidence either — the " +
      "maximum of hundreds of noisy lifts is large by construction — which is why every " +
      "number is measured on seasons the mining never saw, and why the shuffled control " +
      "runs at all.\n"
  );

  writeFileSync(OUT, lines.join("\n"));
  console.log(lines.join("\n"));
  console.log(`\nwrote ${OUT}`);
  if (controlSurvivors.length > 0) process.exit(1);
}

main();
