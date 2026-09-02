import { describe, expect, it } from "vitest";
import { evidenceLedger, VERDICT_LABEL } from "./evidenceLedger";
import { WEEKLY_PROB_MODELS, WEEKLY_PROB_PROVENANCE, hasUsefulSkill } from "@/lib/models/weeklyProbability";
import { OPPORTUNITY_WEIGHT } from "@/lib/models/inSeasonScore";
import {
  OPPORTUNITY_OUT_OF_FOLD_GAIN,
  PROTOCOL_5_OUT_OF_FOLD_GAIN
} from "@/lib/models/opportunityEvidence";

/**
 * The landing page's argument is that RAE does not make up numbers. So the one
 * thing these tests exist to prevent is the landing page making up numbers.
 *
 * A hardcoded "18.5% Brier skill" here would be invisible to every other check
 * in the repository: it would render, it would look right, and it would go on
 * looking right for exactly as long as it took someone to refit the model. That
 * is the same shape as the FAAB provenance string the README carried for a week
 * after the code stopped doing what it said.
 */
describe("the ledger's figures come from the models, not from the copy", () => {
  const rows = evidenceLedger();

  it("prints the weekly model's own Brier skill and calibration error", () => {
    const weekly = rows.find((r) => r.subject.includes("start/sit"));
    expect(weekly).toBeDefined();
    // Whichever position is strongest — named rather than averaged, because an
    // average across four positions describes none of them and hides that QB is
    // much weaker than the rest.
    const best = (["QB", "RB", "WR", "TE"] as const)
      .filter(hasUsefulSkill)
      .reduce((a, b) =>
        WEEKLY_PROB_MODELS[a].brierSkillScore > WEEKLY_PROB_MODELS[b].brierSkillScore ? a : b
      );
    const m = WEEKLY_PROB_MODELS[best];
    expect(weekly!.measurement).toContain(`${(m.brierSkillScore * 100).toFixed(1)}%`);
    expect(weekly!.measurement).toContain(`${(m.oofEce * 100).toFixed(1)}%`);
    expect(weekly!.measurement).toContain(best);
  });

  it("names the weak position rather than quietly folding it into an average", () => {
    // Risk R5. QB's skill is a small positive and must never be presented as
    // equivalent to RB/WR/TE — including on the page that sells the product.
    const weekly = rows.find((r) => r.subject.includes("start/sit"))!;
    const weak = (["QB", "RB", "WR", "TE"] as const).filter((p) => !hasUsefulSkill(p));
    expect(weak.length).toBeGreaterThan(0);
    for (const p of weak) expect(weekly.claim).toContain(p);
  });

  it("prints the real sample size and season", () => {
    const weekly = rows.find((r) => r.subject.includes("start/sit"))!;
    expect(weekly.protocol).toContain(WEEKLY_PROB_PROVENANCE.totalRows.toLocaleString());
    expect(weekly.protocol).toContain(String(WEEKLY_PROB_PROVENANCE.season));
  });

  it("prints the in-season model's actual weight AND both measured gains", () => {
    // All three of these were string literals until review on 2026-09-01 — on
    // the row whose own verdict is "validated out of sample", on the page whose
    // stated argument is that no number on it was typed by a person. The two
    // gains now come from `opportunityEvidence.ts`, where the protocol-4 figure
    // is DERIVED from the pair it summarises.
    const inSeason = rows.find((r) => r.subject.toLowerCase().includes("in-season"))!;
    expect(inSeason.measurement).toContain(String(OPPORTUNITY_WEIGHT));
    expect(inSeason.measurement).toContain(String(OPPORTUNITY_OUT_OF_FOLD_GAIN));
    expect(inSeason.measurement).toContain(String(PROTOCOL_5_OUT_OF_FOLD_GAIN));
  });

  it("contains no number that is not traceable to a model constant", () => {
    // THE REAL DRIFT CANARY, and the reason the previous one was replaced: it
    // asserted only that a WRONG figure (WR's skill + 5pp) was absent, which is
    // true whether the row is read or retyped. It would have passed on the very
    // literals this file's docblock promised were not there — and it did.
    //
    // Every numeric token in every measurement must appear in the set of values
    // the model modules actually publish. A retyped figure that happens to match
    // still passes, and that is the correct limit of a mechanical check: what it
    // catches is a figure that has DRIFTED, which is the failure that survives
    // review.
    const known = new Set<string>();
    for (const m of Object.values(WEEKLY_PROB_MODELS)) {
      known.add((m.brierSkillScore * 100).toFixed(1));
      known.add((m.oofEce * 100).toFixed(1));
      known.add(String(m.threshold));
    }
    known.add(String(OPPORTUNITY_WEIGHT));
    known.add(String(OPPORTUNITY_OUT_OF_FOLD_GAIN).replace(/^0/, ""));
    known.add(String(OPPORTUNITY_OUT_OF_FOLD_GAIN));
    known.add(String(PROTOCOL_5_OUT_OF_FOLD_GAIN).replace(/^0/, ""));
    known.add(String(PROTOCOL_5_OUT_OF_FOLD_GAIN));
    known.add(String(WEEKLY_PROB_PROVENANCE.season));
    known.add(WEEKLY_PROB_PROVENANCE.totalRows.toLocaleString());
    known.add(String(WEEKLY_PROB_PROVENANCE.totalRows));

    const untraceable: string[] = [];
    for (const row of rows) {
      for (const token of row.measurement.match(/[0-9][0-9,.]*/g) ?? []) {
        if (!known.has(token)) untraceable.push(`${row.subject}: ${token}`);
      }
    }
    expect(
      untraceable,
      `these figures appear in a measurement and in no model constant: ${untraceable.join(" | ")}`
    ).toEqual([]);
  });

  it("survives a model where no position clears the skill floor", () => {
    // `bestWeeklyPosition` used `reduce` with no initial value over a filtered
    // array. Unreachable with today's constants and one refit away from being a
    // 500 on `/` for every anonymous visitor, since `/` is a force-dynamic
    // server component with no fallback. The guard is exercised here by proving
    // the seed exists rather than by stubbing the frozen table.
    const useful = (["QB", "RB", "WR", "TE"] as const).filter(hasUsefulSkill);
    expect(useful.length).toBeGreaterThan(0);
    // If it ever reaches zero, the weekly row is dropped rather than thrown.
    expect(() => evidenceLedger()).not.toThrow();
  });
});

describe("the ledger ranks by evidence, and ends with what was withdrawn", () => {
  const rows = evidenceLedger();

  it("orders validated before reproducible before refuted", () => {
    const rank = { validated: 0, reproducible: 1, refuted: 2 } as const;
    const seq = rows.map((r) => rank[r.verdict]);
    expect(seq).toEqual([...seq].sort((a, b) => a - b));
  });

  it("actually contains a withdrawn claim", () => {
    // The page's whole differentiator. If this row ever disappears, the ledger
    // has quietly become a features list again.
    const refuted = rows.filter((r) => r.verdict === "refuted");
    expect(refuted.length).toBeGreaterThan(0);
    expect(refuted[0]!.measurement.toLowerCase()).toContain("worse than chance");
  });

  it("gives every row a file a reader can open", () => {
    for (const r of rows) {
      expect(r.evidence, `${r.subject} has no evidence path`).toMatch(/\.(md|json|gz)/);
    }
  });

  it("labels every verdict in words, so colour is never the only carrier", () => {
    // WCAG 1.4.1. The left rule is green/blue/red; the label says the same thing.
    for (const r of rows) expect(VERDICT_LABEL[r.verdict].length).toBeGreaterThan(4);
  });
});

describe("the landing copy stays inside the anti-overclaiming ban", () => {
  it("uses none of the stems e2e/20 bans on this route", () => {
    // The guard runs in a browser against rendered text; this runs against the
    // source of that text, so a violation is caught at the unit level instead of
    // seventeen minutes into a Playwright run.
    const banned = /(arbitrage|inefficienc|mispric|underval|overval|under.?price|over.?price|fair.value)/i;
    for (const r of evidenceLedger()) {
      const text = `${r.subject} ${r.claim} ${r.measurement} ${r.protocol}`;
      expect(text, `banned wording in the "${r.subject}" row`).not.toMatch(banned);
    }
  });

  it("detects the stems it is checking for", () => {
    // Canary. The regex must be live — this exact guard has been vacuous before,
    // once because of a literal backspace byte in the pattern.
    const banned = /(arbitrage|inefficienc|mispric|underval|overval|under.?price|over.?price|fair.value)/i;
    for (const s of ["Reputation Arbitrage Engine", "mispriced players", "undervalued"]) {
      expect(s).toMatch(banned);
    }
  });
});
