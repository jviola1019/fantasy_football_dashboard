import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADVISORY_FLOORS,
  compareVersions,
  findLockfileViolations,
  packageNameFromLockPath,
  type LockfileShape
} from "./lockfileAdvisories";

describe("compareVersions", () => {
  it("orders release versions numerically, not lexically", () => {
    expect(compareVersions("16.2.9", "16.2.10")).toBeLessThan(0);
    expect(compareVersions("16.3.0", "16.2.11")).toBeGreaterThan(0);
    expect(compareVersions("8.5.23", "8.5.23")).toBe(0);
  });

  it("orders prerelease tags numerically — beta.31 is BELOW beta.32", () => {
    // A plain string compare gets this wrong ("beta.31" > "beta.4"), and this is
    // precisely the comparison that decides whether the critical next-auth
    // fail-open advisory is remediated.
    expect(compareVersions("5.0.0-beta.31", "5.0.0-beta.32")).toBeLessThan(0);
    expect(compareVersions("5.0.0-beta.4", "5.0.0-beta.31")).toBeLessThan(0);
    expect(compareVersions("5.0.0-beta.32", "5.0.0-beta.32")).toBe(0);
  });

  it("treats a prerelease as lower than its own release", () => {
    expect(compareVersions("5.0.0-beta.32", "5.0.0")).toBeLessThan(0);
    expect(compareVersions("5.0.0", "5.0.0-beta.32")).toBeGreaterThan(0);
  });
});

describe("packageNameFromLockPath", () => {
  it("reads the innermost package name so nested copies are attributed correctly", () => {
    expect(packageNameFromLockPath("node_modules/next")).toBe("next");
    expect(packageNameFromLockPath("node_modules/next/node_modules/postcss")).toBe("postcss");
    expect(packageNameFromLockPath("node_modules/@auth/core")).toBe("@auth/core");
    expect(packageNameFromLockPath("")).toBeNull();
  });
});

describe("findLockfileViolations", () => {
  it("flags a version below its floor", () => {
    const lock: LockfileShape = { packages: { "node_modules/next": { version: "16.2.6" } } };
    const found = findLockfileViolations(lock);
    expect(found).toHaveLength(1);
    expect(found[0]!.name).toBe("next");
    expect(found[0]!.advisories).toContain("GHSA-m99w-x7hq-7vfj");
  });

  it("flags a NESTED vulnerable copy, not just the top-level one", () => {
    // Regression: the pre-fix tree had a patched postcss at the root and a
    // vulnerable 8.4.31 under next/. A top-level-only check reports clean.
    const lock: LockfileShape = {
      packages: {
        "node_modules/postcss": { version: "8.5.26" },
        "node_modules/next/node_modules/postcss": { version: "8.4.31" }
      }
    };
    const found = findLockfileViolations(lock);
    expect(found).toHaveLength(1);
    expect(found[0]!.path).toBe("node_modules/next/node_modules/postcss");
  });

  it("flags the critical next-auth fail-open range", () => {
    const lock: LockfileShape = {
      packages: { "node_modules/next-auth": { version: "5.0.0-beta.31" } }
    };
    const found = findLockfileViolations(lock);
    expect(found.map((v) => v.name)).toEqual(["next-auth"]);
    expect(found[0]!.advisories).toContain("GHSA-8fpg-xm3f-6cx3");
  });

  it("accepts versions at or above the floor, and ignores unlisted packages", () => {
    const lock: LockfileShape = {
      packages: {
        "node_modules/next": { version: "16.3.1" },
        "node_modules/next-auth": { version: "5.0.0-beta.32" },
        "node_modules/sharp": { version: "0.35.3" },
        "node_modules/left-pad": { version: "0.0.1" },
        "": { version: "0.1.0" }
      }
    };
    expect(findLockfileViolations(lock)).toEqual([]);
  });
});

describe("the committed package-lock.json (regression gate)", () => {
  const lock = JSON.parse(
    readFileSync(new URL("../../../package-lock.json", import.meta.url), "utf8")
  ) as LockfileShape;

  it("resolves no package below a known-advisory floor", () => {
    const violations = findLockfileViolations(lock);
    const detail = violations
      .map((v) => `${v.path}@${v.version} < ${v.minVersion} (${v.advisories.join(", ")})`)
      .join("\n");
    expect(detail).toBe("");
    expect(violations).toEqual([]);
  });

  it("actually resolves every guarded package, so the gate cannot pass vacuously", () => {
    // Without this, deleting a dependency would make the gate above trivially green.
    const resolved = new Set(
      Object.keys(lock.packages ?? {})
        .map(packageNameFromLockPath)
        .filter((n): n is string => n !== null)
    );
    for (const name of Object.keys(ADVISORY_FLOORS)) {
      expect(resolved.has(name), `${name} missing from lockfile`).toBe(true);
    }
  });
});
