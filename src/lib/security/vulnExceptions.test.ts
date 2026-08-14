import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  activeExceptionIds,
  validateExceptions,
  type ExceptionsFile,
  type VulnException
} from "./vulnExceptions";

const NOW = new Date("2026-08-13T00:00:00.000Z");

function entry(overrides: Partial<VulnException> = {}): VulnException {
  return {
    advisory: "GHSA-aaaa-bbbb-cccc",
    package: "left-pad",
    severity: "high",
    scope: "development",
    justification: "A sufficiently long justification explaining exactly why this is tolerable here.",
    compensatingControl: "Input is never user-controlled.",
    owner: "someone",
    opened: "2026-08-01",
    expires: "2026-09-01",
    ...overrides
  };
}

function file(exceptions: VulnException[]): ExceptionsFile {
  return {
    policy: { failOn: ["critical", "high", "moderate"], failOnDev: [], maxDurationDays: 90 },
    exceptions
  };
}

describe("validateExceptions", () => {
  it("accepts a well-formed, unexpired entry", () => {
    expect(validateExceptions(file([entry()]), NOW)).toEqual([]);
  });

  it("FAILS an expired entry — the core mechanism", () => {
    const problems = validateExceptions(file([entry({ expires: "2026-08-12" })]), NOW);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.problem).toContain("EXPIRED");
  });

  it("treats an entry expiring exactly now as expired", () => {
    const problems = validateExceptions(file([entry({ expires: "2026-08-13" })]), NOW);
    expect(problems.some((p) => p.problem.includes("EXPIRED"))).toBe(true);
  });

  it("rejects an exception dated further out than the policy maximum", () => {
    const problems = validateExceptions(
      file([entry({ opened: "2026-08-01", expires: "2027-08-01" })]),
      NOW
    );
    expect(problems.some((p) => p.problem.includes("exceeds policy maximum"))).toBe(true);
  });

  it("requires a real justification and compensating control", () => {
    const problems = validateExceptions(
      file([entry({ justification: "nah", compensatingControl: "none" })]),
      NOW
    );
    expect(problems.some((p) => p.problem.includes("justification is too short"))).toBe(true);
    expect(problems.some((p) => p.problem.includes("compensatingControl is too short"))).toBe(true);
  });

  it("requires owner, package and a GHSA-shaped id", () => {
    const problems = validateExceptions(
      file([entry({ owner: "", package: "", advisory: "CVE-2026-1234" })]),
      NOW
    );
    expect(problems.some((p) => p.problem.includes("owner"))).toBe(true);
    expect(problems.some((p) => p.problem.includes("package"))).toBe(true);
    expect(problems.some((p) => p.problem.includes("GHSA"))).toBe(true);
  });

  it("rejects a bad scope and malformed dates", () => {
    const problems = validateExceptions(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      file([entry({ scope: "whenever" as any, expires: "soon", opened: "01/08/2026" })]),
      NOW
    );
    expect(problems.some((p) => p.problem.includes("scope"))).toBe(true);
    expect(problems.some((p) => p.problem.includes("expires must be an ISO date"))).toBe(true);
    expect(problems.some((p) => p.problem.includes("opened must be an ISO date"))).toBe(true);
  });

  it("rejects duplicate entries for the same advisory", () => {
    const problems = validateExceptions(file([entry(), entry()]), NOW);
    expect(problems.some((p) => p.problem === "duplicate exception entry")).toBe(true);
  });
});

describe("activeExceptionIds", () => {
  it("includes unexpired and excludes expired", () => {
    const ids = activeExceptionIds(
      file([
        entry({ advisory: "GHSA-aaaa-bbbb-cccc", expires: "2026-09-01" }),
        entry({ advisory: "GHSA-dddd-eeee-ffff", expires: "2026-01-01" })
      ]),
      NOW
    );
    expect([...ids]).toEqual(["GHSA-aaaa-bbbb-cccc"]);
  });
});

describe("the committed security/exceptions.json", () => {
  const real = JSON.parse(
    readFileSync(new URL("../../../security/exceptions.json", import.meta.url), "utf8")
  ) as ExceptionsFile;

  it("is well-formed and has no expired entry as of now", () => {
    const problems = validateExceptions(real, new Date());
    expect(problems.map((p) => `${p.advisory}: ${p.problem}`)).toEqual([]);
  });

  it("keeps the production failure policy strict", () => {
    // Guards against someone quietly relaxing the gate instead of fixing a CVE.
    expect(real.policy.failOn).toContain("critical");
    expect(real.policy.failOn).toContain("high");
    expect(real.policy.maxDurationDays).toBeLessThanOrEqual(90);
  });

  it("has no production-scope exceptions", () => {
    // A production-runtime exception should be a deliberate, loud decision. If
    // this ever needs to change, change it consciously — do not delete the test.
    expect(real.exceptions.filter((e) => e.scope === "production")).toEqual([]);
  });
});
