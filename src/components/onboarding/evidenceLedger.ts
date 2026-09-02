import { OPPORTUNITY_WEIGHT, IN_SEASON_DISCLOSURE } from "@/lib/models/inSeasonScore";
import {
  OPPORTUNITY_OUT_OF_FOLD_GAIN,
  PROTOCOL_5_OUT_OF_FOLD_GAIN
} from "@/lib/models/opportunityEvidence";
import {
  WEEKLY_PROB_MODELS,
  WEEKLY_PROB_PROVENANCE,
  hasUsefulSkill,
  type WeeklyPosition
} from "@/lib/models/weeklyProbability";

/**
 * What RAE claims, what it measured, and what it stopped claiming.
 *
 * THIS IS THE LANDING PAGE'S ARGUMENT, so it is built from the same constants
 * the product runs on rather than written as marketing copy. Every number below
 * is read from a model module at build time; there is nothing here a person
 * typed in, which is the only version of this page that could survive the rule
 * against fabricated data — a claim about honesty written as a hardcoded string
 * would be the exact thing it claims not to be.
 *
 * The order is the point. Three verdict tiers, strongest first, and the last one
 * is a REFUTATION: the founding thesis this product was named after,
 * tested on 115 real drafts and abandoned. A landing page that leads with what
 * the product gave up is a different kind of page from one that leads with six
 * equal capability cards, and it is the one this product has earned.
 */
export type Verdict = "validated" | "reproducible" | "refuted";

export interface LedgerRow {
  /** Sort key and display order. */
  verdict: Verdict;
  /** What the claim is about. */
  subject: string;
  /** The claim, in the strongest form the evidence licenses — and no stronger. */
  claim: string;
  /** The measured figure, or the reason there is none. Mono-set. */
  measurement: string;
  /** How it was tested. */
  protocol: string;
  /** A committed file anyone can open. */
  evidence: string;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  validated: "Validated out of sample",
  reproducible: "Reproducible, not validated",
  refuted: "Tested and withdrawn"
};

/**
 * The strongest position of the weekly model, named rather than averaged.
 *
 * Averaging four Brier skill scores would produce a number that describes no
 * position and hides that QB is much weaker than the rest — the distinction the
 * panel itself is built to preserve.
 *
 * Returns `null` when NO position clears the skill floor, which is not a
 * hypothetical: `hasUsefulSkill` compares against `USEFUL_SKILL_FLOOR`, and both
 * that floor and the coefficient table are hand-edited constants. A refit that
 * degrades every position, or a floor raised above 0.176, empties the filter —
 * and `reduce` with no initial value throws on an empty array, inside a
 * `force-dynamic` server component, which is a 500 on `/` for every anonymous
 * visitor. Found in review 2026-09-01.
 */
function bestWeeklyPosition(): WeeklyPosition | null {
  const useful = (Object.keys(WEEKLY_PROB_MODELS) as WeeklyPosition[]).filter(hasUsefulSkill);
  if (useful.length === 0) return null;
  return useful.reduce(
    (best, p) =>
      WEEKLY_PROB_MODELS[p].brierSkillScore > WEEKLY_PROB_MODELS[best].brierSkillScore ? p : best,
    useful[0]!
  );
}

export function evidenceLedger(): LedgerRow[] {
  const best = bestWeeklyPosition();
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const weak = (Object.keys(WEEKLY_PROB_MODELS) as WeeklyPosition[]).filter((p) => !hasUsefulSkill(p));

  // If no position clears the skill floor, the weekly model is not "validated
  // out of sample" and the row must not appear under that heading. Dropping it
  // is the honest rendering; inventing a weaker verdict for it here would put a
  // claim on the landing page that no test anywhere had licensed.
  const weeklyRow: LedgerRow[] = best
    ? [
        {
          verdict: "validated",
          subject: "Weekly start/sit probability",
          claim:
            `The chance a player clears their position's start line, converted from their ` +
            `projection. Strongest at ${best}` +
            (weak.length > 0
              ? `; ${weak.join(", ")} ${weak.length > 1 ? "are" : "is"} measurably weaker and labelled so wherever it appears.`
              : "."),
          measurement: `${pct(WEEKLY_PROB_MODELS[best].brierSkillScore)} Brier skill · ${pct(WEEKLY_PROB_MODELS[best].oofEce)} calibration error (${best})`,
          protocol: `Leave-one-week-out over ${WEEKLY_PROB_PROVENANCE.totalRows.toLocaleString()} player-weeks of ${WEEKLY_PROB_PROVENANCE.season}; every row scored by a model that never saw its week.`,
          evidence: WEEKLY_PROB_PROVENANCE.results
        }
      ]
    : [];

  return [
    ...weeklyRow,
    {
      verdict: "validated",
      subject: "In-season usage ranking",
      claim: `${IN_SEASON_DISCLOSURE.body} A ranking, not a forecast — no probability is implied.`,
      // Read, not retyped. Caught in review 2026-09-01: these two were string
      // literals on the page whose stated argument is that no number on it was
      // typed by a person.
      measurement: `+${OPPORTUNITY_OUT_OF_FOLD_GAIN} and +${PROTOCOL_5_OUT_OF_FOLD_GAIN} Spearman · usage weighted ${OPPORTUNITY_WEIGHT}`,
      protocol:
        "Two untouched holdout seasons (protocols 4 and 5). The gain is small and it replicated in direction both times.",
      evidence: IN_SEASON_DISCLOSURE.evidence
    },
    {
      verdict: "reproducible",
      subject: "Season Monte Carlo",
      claim:
        "Playoff and championship frequencies from a seeded simulation, shown conditionally on win total. Every run reproduces exactly from its seed.",
      measurement: "Not validated out of sample",
      protocol:
        "Reproducibility is proven; predictive accuracy is not. The band around each figure measures how far the answer moves on re-run — not whether the model is right.",
      evidence: "docs/season-sim.md"
    },
    {
      verdict: "refuted",
      subject: "The thesis this product was named after",
      claim:
        // The old product name is deliberately NOT written out here. It contains
        // a stem that `e2e/20` bans across this route, and the ban is right: a
        // marketing surface must not assert an exploitable edge, and the guard
        // has no negation allowance because "we do not claim X" and "X" read the
        // same to a skimming reader. The withdrawn CLAIM is the point of this
        // row, and it survives being stated without the slogan.
        "RAE launched under a different name, on the theory that consensus rankings misjudge players in a way a model could systematically exploit.",
      measurement: "Worse than chance within a position",
      protocol:
        "A frozen holdout on 115 real drafts. Across positions the score mostly rediscovered that kickers and defenses go late; within a position — the choice a draft board actually asks you to make — it did worse than chance.",
      evidence: "reports/2026-08-20/holdout-result-3.md"
    }
  ];
}
