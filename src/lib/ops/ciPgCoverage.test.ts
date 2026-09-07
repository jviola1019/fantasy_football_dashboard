import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * EVERY POSTGRES INTEGRATION TEST MUST ACTUALLY RUN IN CI.
 *
 * The `postgres integration` job existed precisely to exercise the production
 * database driver — its own comment says so. It selected its work with three
 * literal file paths, repeated in two places. A fourth Postgres test was written
 * and not added to that list, so the driver went unexercised, and a `db.run(...)`
 * call that does not exist on postgres-js turned `/api/health` into a 500 in
 * production while this job reported green.
 *
 * A job that cannot see the tests it was built to run is the same defect as a
 * scanner that cannot see its own input. The list is now a pattern, and this
 * test is what stops the pattern from silently missing a file: it walks the
 * filesystem and asserts the workflow's own filters match every Postgres
 * integration test that exists.
 *
 * It reads the workflow rather than a copy of it, so it cannot drift from what
 * CI actually runs.
 */
const ROOT = join(__dirname, "..", "..", "..");
const WORKFLOW = join(ROOT, ".github", "workflows", "ci.yml");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p.slice(ROOT.length + 1).replace(/\\/g, "/"));
  }
  return out;
}

/** A Postgres integration test, identified by filename convention. */
function isPgIntegrationTest(path: string): boolean {
  return /\.pg\.integration\.test\.ts$/.test(path) || /postgres\.integration\.test\.ts$/.test(path);
}

describe("the postgres integration CI job runs every Postgres test", () => {
  const workflow = readFileSync(WORKFLOW, "utf8");
  const onDisk = walk(join(ROOT, "src")).filter(isPgIntegrationTest);

  /** The quoted vitest filters on the job's run lines. */
  const filters = [...workflow.matchAll(/npx vitest run ((?:"[^"]+"\s*)+)/g)]
    .flatMap((m) => [...m[1]!.matchAll(/"([^"]+)"/g)].map((f) => f[1]!))
    .filter((f) => f.includes("integration"));

  it("finds Postgres integration tests on disk, so this cannot pass vacuously", () => {
    expect(onDisk.length).toBeGreaterThanOrEqual(4);
    expect(onDisk).toContain("src/lib/ops/schemaProbe.pg.integration.test.ts");
  });

  it("extracts the job's filters from the workflow itself", () => {
    // Read from ci.yml, never from a copy — a copy is a second thing to keep in
    // sync and this test exists because a list went out of sync.
    expect(filters.length).toBeGreaterThan(0);
  });

  it("matches every Postgres integration test with at least one filter", () => {
    const unmatched = onDisk.filter((f) => !filters.some((pattern) => f.includes(pattern)));
    expect(
      unmatched,
      `these Postgres integration tests exist but the CI job's filters do not select ` +
        `them, so the production driver is not exercised:\n${unmatched.join("\n")}`
    ).toEqual([]);
  });

  it("does not drag in non-Postgres integration tests", () => {
    // `values.integration.test.ts` is a trade-values suite with different
    // gating. Over-matching would change its behaviour in a job that spins up a
    // database it does not want.
    const all = walk(join(ROOT, "src")).filter((f) => f.endsWith(".test.ts"));
    const selected = all.filter((f) => filters.some((pattern) => f.includes(pattern)));
    const wrong = selected.filter((f) => !isPgIntegrationTest(f));
    expect(wrong, `these are selected but are not Postgres tests: ${wrong.join(", ")}`).toEqual([]);
  });

  it("would notice a new Postgres test that nobody wired up — the canary", () => {
    // Proves the check can fail. A hypothetical file following the convention
    // must be matched by the existing filters; if the pattern were narrowed to
    // literal paths again, this is what breaks.
    const hypothetical = "src/lib/whatever/newThing.pg.integration.test.ts";
    expect(isPgIntegrationTest(hypothetical)).toBe(true);
    expect(filters.some((pattern) => hypothetical.includes(pattern))).toBe(true);
  });
});
