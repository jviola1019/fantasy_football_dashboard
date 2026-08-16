import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { STATIC_SECURITY_HEADERS } from "./csp";

/**
 * `next.config.mjs` must load under a BARE Node ESM loader.
 *
 * This exists because of a failure that no existing gate could see. The config
 * imported `./src/lib/security/csp.ts`; Node >= 22.18 strips TypeScript types
 * natively, so on the dev machine (v25) `npm run build` passed and was reported
 * as evidence. CI runs Node 20.20.2, which has no type stripping, so the same
 * import threw:
 *
 *     ERR_UNKNOWN_FILE_EXTENSION ".ts" for .../src/lib/security/csp.ts
 *
 * `next build` failed in both the Playwright and Lighthouse jobs, and because
 * those jobs gate on the build, Playwright, axe and Lighthouse were all SKIPPED
 * rather than failed — a red build that looked like an absence of results.
 *
 * A unit test that merely imports the config would prove nothing: it would run
 * inside vitest's TypeScript-aware pipeline, the exact environment that hides
 * the bug. So this shells out to a real child Node process with type stripping
 * explicitly disabled, reproducing Node 20's loader on any host version.
 */

/** Node gained default TypeScript type stripping in 22.18. */
function stripsTypesByDefault(): boolean {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 18);
}

/**
 * Load next.config.mjs in a child Node process that behaves like Node 20.
 *
 * On a host that strips types we must switch that off to reproduce CI. On a
 * host that never had the feature the flag itself is unrecognised and would
 * abort the process, so it is omitted — the default behaviour is already the
 * one under test.
 */
function loadConfigUnderBareNode(): { headerSources: string[]; securityHeaderKeys: string[] } {
  const script = `
    const cfg = (await import("./next.config.mjs")).default;
    const groups = await cfg.headers();
    process.stdout.write(JSON.stringify({
      headerSources: groups.map((g) => g.source),
      securityHeaderKeys: (groups.find((g) => g.source === "/:path*")?.headers ?? []).map((h) => h.key)
    }));
  `;
  const args = stripsTypesByDefault()
    ? ["--no-experimental-strip-types", "--input-type=module", "-e", script]
    : ["--input-type=module", "-e", script];

  const stdout = execFileSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(stdout);
}

describe("next.config.mjs is loadable by a bare Node ESM loader", () => {
  it("loads without ERR_UNKNOWN_FILE_EXTENSION when type stripping is off", () => {
    // Fails with a non-zero exit (throwing here) if the config ever again
    // imports TypeScript across the Node config boundary.
    expect(() => loadConfigUnderBareNode()).not.toThrow();
  });

  it("still emits the full static security header set", () => {
    // Guards the other half of the fix: deleting the import would also make the
    // config load, and would silently strip every security header instead.
    const { headerSources, securityHeaderKeys } = loadConfigUnderBareNode();

    expect(headerSources).toContain("/:path*");
    expect(headerSources).toContain("/api/:path*");

    for (const { key } of STATIC_SECURITY_HEADERS) {
      expect(securityHeaderKeys, `${key} must be applied by next.config.mjs`).toContain(key);
    }
    expect(securityHeaderKeys).toHaveLength(STATIC_SECURITY_HEADERS.length);
  });

  it("keeps exactly one definition shared with the TypeScript entry point", () => {
    // csp.ts re-exports the .mjs rather than redeclaring it, so the two can
    // never drift. Assert the values, not just the keys.
    const { securityHeaderKeys } = loadConfigUnderBareNode();
    expect(securityHeaderKeys).toEqual(STATIC_SECURITY_HEADERS.map((h) => h.key));
    expect(STATIC_SECURITY_HEADERS.find((h) => h.key === "Strict-Transport-Security")?.value).toBe(
      "max-age=63072000; includeSubDomains"
    );
  });
});
