/**
 * Audit 2026-08-20 §7 — PPR / HALF / STD unit consistency, end to end.
 *
 * The invariant under test:
 *
 *   the user's starters and the opponent field ALWAYS use the same point unit.
 *
 * These exercise the real production path — a governed `RAEEnvelope` through
 * `deriveAppData` into `runNexusSimulation` — not a hand-built `SimulationParams`.
 * A test that constructed params directly would not have caught the original
 * defect, because the defect lived in the layer that chose the numeric.
 */
import { describe, expect, it } from "vitest";
import { RAEEnvelopeSchema, type PlayerMarketRecord, type RAEEnvelope } from "./governance";
import { fixtureEnvelope } from "./fixtures";
import { deriveAppData } from "./envelope/derive";
import { avgStarterPtsFor, deriveSeasonInputs } from "./simulation";
import { DEFAULT_FORMAT, type LeagueFormat, type ScoringFormat } from "./trade/format";
import type { WeeklyProjectionByFormat } from "./leagues/scoringPoints";

// The player the audit specifies: 22 in PPR, 16 in half, 10 in standard. The
// spread is deliberately larger than any real reception gap so a wrong-unit read
// is unmistakable rather than plausible.
const TARGET_ID = "sleeper:unit-probe";
const PPR = 22;
const HALF = 16;
const STD = 10;

function record(over: Partial<PlayerMarketRecord> = {}): PlayerMarketRecord {
  const base = fixtureEnvelope().records[0]!;
  return { ...base, ...over };
}

/**
 * The probe player plus filler. Filler trueValue is held BELOW the probe so the
 * probe is always the top key driver and its weeklyMean is directly readable
 * from the simulation result.
 */
function roster(position: PlayerMarketRecord["position"] = "WR"): PlayerMarketRecord[] {
  const probe = record({ id: TARGET_ID, name: "Unit Probe", position, trueValue: 99 });
  const filler = Array.from({ length: 8 }, (_, i) =>
    record({ id: `sleeper:filler-${i}`, name: `Filler ${i}`, trueValue: 40 })
  );
  return [probe, ...filler];
}

function format(scoringFormat: ScoringFormat, over: Partial<LeagueFormat> = {}): LeagueFormat {
  return { ...DEFAULT_FORMAT, scoringFormat, numTeams: 12, playoffTeams: 6, ...over };
}

function envelope(
  scoringFormat: ScoringFormat,
  projections: Record<string, WeeklyProjectionByFormat> | null,
  players = roster()
): RAEEnvelope {
  // Parsed through the real schema so a shape the app could not actually produce
  // cannot pass this test.
  return RAEEnvelopeSchema.parse({
    ...fixtureEnvelope(),
    mode: "live",
    records: players,
    leagueFormat: format(scoringFormat),
    weeklyProjections: projections,
    weeklyProjectionsMeta: projections
      ? { season: "2025", week: 8, fetchedAt: "2026-08-20T00:00:00.000Z" }
      : null
  });
}

const allFormats: WeeklyProjectionByFormat = {
  ppr: PPR,
  halfPpr: HALF,
  standard: STD,
  position: "WR"
};

/** The probe's simulated weekly mean, read off the real production path. */
function probeWeeklyMean(env: RAEEnvelope): number {
  const app = deriveAppData(env);
  const driver = app.sim.keyDrivers.find((d) => d.id === TARGET_ID);
  expect(driver, "probe player must appear in keyDrivers").toBeDefined();
  return driver!.contribution;
}

describe("§7 live projection unit follows the league scoring format", () => {
  it.each([
    ["PPR", PPR],
    ["HALF", HALF],
    ["STD", STD]
  ] as const)("%s league reads exactly %d", (scoring, expected) => {
    expect(probeWeeklyMean(envelope(scoring, { [TARGET_ID]: allFormats }))).toBe(expected);
  });

  it("the SAME underlying player changes unit when only the format changes", () => {
    const proj = { [TARGET_ID]: allFormats };
    const seen = (["PPR", "HALF", "STD"] as const).map((f) => probeWeeklyMean(envelope(f, proj)));
    expect(seen).toEqual([PPR, HALF, STD]);
    // Three distinct values: proof the format is actually consulted rather than
    // one variant being read three times.
    expect(new Set(seen).size).toBe(3);
  });

  it.each(["QB", "RB", "WR", "TE"] as const)(
    "holds for position %s",
    (position) => {
      const proj = { [TARGET_ID]: { ...allFormats, position } };
      for (const [scoring, expected] of [
        ["PPR", PPR],
        ["HALF", HALF],
        ["STD", STD]
      ] as const) {
        expect(probeWeeklyMean(envelope(scoring, proj, roster(position)))).toBe(expected);
      }
    }
  );
});

describe("§7 negative cases — a missing variant must never import another unit", () => {
  it("reception-scoring position, variant absent → structural fallback, NOT the PPR number", () => {
    // STD absent for a WR. The old behavior substituted pts_ppr (22) into a
    // standard-scoring team measured against a 9.5-point standard field.
    const proj = {
      [TARGET_ID]: { ppr: PPR, halfPpr: HALF, standard: null, position: "WR" }
    };
    const mean = probeWeeklyMean(envelope("STD", proj));
    expect(mean).not.toBe(PPR);
    expect(mean).not.toBe(HALF);
    // It is the structural path, in STD units.
    const structural = avgStarterPtsFor("STD") + (99 - 79.2) * 0.18;
    expect(mean).toBeCloseTo(structural, 0);
    // And it is far below the PPR projection — the bias direction the audit named.
    expect(mean).toBeLessThan(PPR);
  });

  it("reception-neutral position, variant absent → substitution allowed (formats coincide)", () => {
    // Measured: QB/K/DEF pts_ppr == pts_std in every live Sleeper row.
    const proj = {
      [TARGET_ID]: { ppr: 21, halfPpr: null, standard: 21, position: "QB" }
    };
    expect(probeWeeklyMean(envelope("HALF", proj, roster("QB")))).toBe(21);
  });

  it("all live projections absent → structural path in the league's own unit", () => {
    for (const scoring of ["PPR", "HALF", "STD"] as const) {
      const mean = probeWeeklyMean(envelope(scoring, null));
      expect(mean).toBeCloseTo(avgStarterPtsFor(scoring) + (99 - 79.2) * 0.18, 0);
    }
  });

  it("an all-null projection row is not treated as a live projection", () => {
    const proj = {
      [TARGET_ID]: { ppr: null, halfPpr: null, standard: null, position: "WR" }
    };
    const withRow = probeWeeklyMean(envelope("PPR", proj));
    const withoutRow = probeWeeklyMean(envelope("PPR", null));
    expect(withRow).toBe(withoutRow);
  });
});

describe("§7 the invariant itself — team and field share one unit", () => {
  it.each(["PPR", "HALF", "STD"] as const)(
    "%s: field mean is exactly starters x avgStarterPtsFor(format)",
    (scoring) => {
      const players = roster();
      const { field, starters } = deriveSeasonInputs(players, {
        seed: 1,
        iterations: 10,
        rosterSlots: 9,
        riskTolerance: 0.5,
        scoringFormat: scoring,
        weeklyProjections: new Map([[TARGET_ID, allFormats]])
      });
      expect(field.meanWeekly).toBeCloseTo(starters.length * avgStarterPtsFor(scoring), 6);
    }
  );

  it("a wrong-unit read would have been visible as a field-relative jump", () => {
    // Documents the magnitude of the defect this test exists to prevent: reading
    // the PPR value in a standard league inflates the probe by 12 points against
    // a field baseline that moved DOWN by 2.
    const proj = { [TARGET_ID]: allFormats };
    const std = probeWeeklyMean(envelope("STD", proj));
    expect(PPR - std).toBe(12);
    expect(avgStarterPtsFor("PPR") - avgStarterPtsFor("STD")).toBe(2);
  });
});
