/**
 * Audit 2026-08-20 §8 / §9 — injury evidence and composite provenance.
 *
 * The rule these pin: a composite record's decision-relevant freshness can never
 * be newer than its oldest decision-relevant input, and the ABSENCE of an injury
 * signal in stale or missing data is not evidence of recovery.
 */
import { describe, expect, it } from "vitest";
import {
  canResolveInjuryAlerts,
  classifyInjuryEvidence,
  describeInjuryEvidence,
  PLAYERS_SNAPSHOT_CONTRACT,
  type InjuryEvidence
} from "./injuryEvidence";

const NOW = new Date("2026-08-20T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000);

describe("classifyInjuryEvidence", () => {
  it("a snapshot inside the contract is verified", () => {
    const e = classifyInjuryEvidence(hoursAgo(2), NOW);
    expect(e.state).toBe("verified");
    expect(e).toMatchObject({ ageSeconds: 2 * 3600 });
  });

  it("a 36h-old snapshot is stale — the audit's worked example", () => {
    // "roster fetched now + player snapshot fetched 36h ago" must NOT become
    // "injury status fresh now".
    const e = classifyInjuryEvidence(hoursAgo(36), NOW);
    expect(e.state).toBe("stale");
    expect(e).toMatchObject({ ageSeconds: 36 * 3600 });
  });

  it("a 48h-old snapshot is stale", () => {
    expect(classifyInjuryEvidence(hoursAgo(48), NOW).state).toBe("stale");
  });

  it("a missing snapshot is unavailable, not stale and not verified", () => {
    const e = classifyInjuryEvidence(null, NOW);
    expect(e.state).toBe("unavailable");
    expect(e).toMatchObject({ reason: expect.stringContaining("no Sleeper players snapshot") });
  });

  it("an unparseable timestamp is unavailable rather than silently aged", () => {
    expect(classifyInjuryEvidence("not-a-date", NOW).state).toBe("unavailable");
  });

  it("uses the same threshold the health endpoint publishes", () => {
    // One definition of "too old", not two.
    expect(PLAYERS_SNAPSHOT_CONTRACT.warnAfterSeconds).toBe(24 * 3600);
    expect(PLAYERS_SNAPSHOT_CONTRACT.expireAfterSeconds).toBe(30 * 3600);
    // Exactly at the boundary is still inside the contract.
    expect(classifyInjuryEvidence(hoursAgo(24), NOW).state).toBe("verified");
    expect(classifyInjuryEvidence(hoursAgo(24.1), NOW).state).toBe("stale");
  });

  it("never reports a negative age for a clock-skewed future timestamp", () => {
    const e = classifyInjuryEvidence(new Date(NOW.getTime() + 60_000), NOW);
    expect(e.state).toBe("verified");
    expect(e).toMatchObject({ ageSeconds: 0 });
  });
});

describe("canResolveInjuryAlerts — the asymmetry that prevents false reassurance", () => {
  const cases: Array<[string, InjuryEvidence, boolean]> = [
    [
      "fresh status may resolve an old alert",
      { state: "verified", fetchedAt: NOW.toISOString(), ageSeconds: 0 },
      true
    ],
    [
      "stale status MUST NOT resolve",
      { state: "stale", fetchedAt: hoursAgo(36).toISOString(), ageSeconds: 36 * 3600 },
      false
    ],
    [
      "missing status MUST NOT resolve",
      { state: "unavailable", reason: "no snapshot" },
      false
    ],
    [
      "unavailable source MUST NOT resolve",
      { state: "unavailable", reason: "upstream 503" },
      false
    ]
  ];

  for (const [name, evidence, expected] of cases) {
    it(name, () => {
      expect(canResolveInjuryAlerts(evidence)).toBe(expected);
    });
  }

  it("only one of the four states can ever resolve", () => {
    const resolvable = cases.filter(([, , ok]) => ok);
    expect(resolvable).toHaveLength(1);
  });
});

describe("describeInjuryEvidence never overstates what is known", () => {
  it("stale wording says explicitly that alerts will not be resolved", () => {
    const text = describeInjuryEvidence({
      state: "stale",
      fetchedAt: hoursAgo(36).toISOString(),
      ageSeconds: 36 * 3600
    });
    expect(text).toContain("36.0h old");
    expect(text).toContain("will not be resolved");
  });

  it("unavailable wording carries the reason", () => {
    expect(
      describeInjuryEvidence({ state: "unavailable", reason: "no snapshot" })
    ).toContain("no snapshot");
  });

  it("verified wording claims only 'within contract'", () => {
    const text = describeInjuryEvidence({
      state: "verified",
      fetchedAt: hoursAgo(1).toISOString(),
      ageSeconds: 3600
    });
    expect(text).toContain("within contract");
    expect(text).not.toContain("fresh now");
  });
});
