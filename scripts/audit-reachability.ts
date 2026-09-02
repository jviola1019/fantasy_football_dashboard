/**
 * Which source modules are reachable, and from where.
 *
 * "Never imported" is the wrong question — it finds leaves and misses whole
 * subtrees. A module imported only by another dead module looks referenced. The
 * question that matters for removal is REACHABILITY from something that actually
 * runs:
 *
 *   - Next entry points (pages, layouts, route handlers, the proxy)
 *   - anything in scripts/ (npm scripts, cron helpers, CI gates)
 *   - e2e specs and unit tests
 *
 * A module reachable only from a test is a module whose only purpose is to be
 * tested. That is not automatically dead — a CI gate's implementation looks
 * exactly like it — so the two are reported separately and neither is deleted by
 * this script. It reports; a human decides.
 *
 *   npx tsx scripts/audit-reachability.ts
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * Tracked files AND untracked-but-not-ignored ones.
 *
 * `git ls-files` alone lists only what is COMMITTED, and this auditor exists to
 * find code nothing imports — which is most often code somebody has just
 * written. So the plain invocation was blind in exactly the place it was needed:
 * on 2026-09-02 three new modules sat in `src/lib/stats/` while the audit
 * reported "228 modules, 0 unreachable" over a tree that had 231.
 *
 * `--cached --others --exclude-standard` adds untracked files while still
 * honouring `.gitignore`, so build output and `.data/` stay out.
 */
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "src", "scripts", "e2e"],
  { encoding: "utf8" }
)
  .split("\n")
  .map((f) => f.trim())
  .filter((f) => /\.(ts|tsx)$/.test(f));

const fileSet = new Set(files);
const isTest = (f: string) => /\.test\.tsx?$/.test(f) || f.startsWith("e2e/");
const isScript = (f: string) => f.startsWith("scripts/");
const isSrc = (f: string) => f.startsWith("src/");

/** Next loads these by convention, not by import. */
const isNextEntry = (f: string) =>
  /^src\/app\/.*\/(page|layout|route|loading|error|not-found|template|default)\.tsx?$/.test(f) ||
  /^src\/app\/(layout|page|global-error|not-found|sitemap|robots|manifest)\.tsx?$/.test(f) ||
  /^src\/(proxy|middleware|instrumentation)\.tsx?$/.test(f);

const importsOf = new Map<string, string[]>();
for (const f of files) {
  const text = readFileSync(f, "utf8");
  const specs = [
    ...text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)
  ].map((m) => m[1]!);
  importsOf.set(f, specs);
}

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    base = "src/" + spec.slice(2);
  } else if (spec.startsWith(".")) {
    const parts = (from.split("/").slice(0, -1).join("/") + "/" + spec).split("/");
    const out: string[] = [];
    for (const p of parts) {
      if (p === "." || p === "") continue;
      if (p === "..") out.pop();
      else out.push(p);
    }
    base = out.join("/");
  } else {
    return null; // bare specifier: a package, not our code
  }
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (fileSet.has(cand)) return cand;
  }
  return null;
}

const edges = new Map<string, string[]>();
for (const f of files) {
  edges.set(
    f,
    (importsOf.get(f) ?? []).map((s) => resolveSpec(f, s)).filter((x): x is string => x !== null)
  );
}

function reachableFrom(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of edges.get(cur) ?? []) stack.push(next);
  }
  return seen;
}

const productionRoots = files.filter(isNextEntry);
const scriptRoots = files.filter(isScript);
const testRoots = files.filter(isTest);

// Sanity: refuse to draw conclusions from an analysis that found no roots. An
// empty root set makes EVERY module look unreachable, which reads as a dramatic
// finding rather than as a broken script.
if (productionRoots.length < 5) {
  console.error(
    `audit-reachability: found only ${productionRoots.length} Next entry points. The entry-point patterns are wrong; every module would look dead. Refusing to report.`
  );
  process.exit(1);
}

const fromProduction = reachableFrom(productionRoots);
const fromScripts = reachableFrom(scriptRoots);
const fromTests = reachableFrom(testRoots);

const srcModules = files.filter((f) => isSrc(f) && !isTest(f));

const live = srcModules.filter((f) => fromProduction.has(f));
const scriptOnly = srcModules.filter((f) => !fromProduction.has(f) && fromScripts.has(f));
const testOnly = srcModules.filter(
  (f) => !fromProduction.has(f) && !fromScripts.has(f) && fromTests.has(f)
);
const unreachable = srcModules.filter(
  (f) => !fromProduction.has(f) && !fromScripts.has(f) && !fromTests.has(f)
);

const lines = (f: string) => readFileSync(f, "utf8").split("\n").length;
const total = (list: string[]) => list.reduce((sum, f) => sum + lines(f), 0);

console.log(`audit-reachability: ${srcModules.length} non-test src modules`);
console.log(`  Next entry points: ${productionRoots.length}`);
console.log(`  script entry points: ${scriptRoots.length}`);
console.log(`  test/e2e entry points: ${testRoots.length}\n`);

console.log(`REACHED BY THE APP:        ${live.length} modules, ${total(live)} lines`);
console.log(`REACHED ONLY BY SCRIPTS:   ${scriptOnly.length} modules, ${total(scriptOnly)} lines`);
for (const f of scriptOnly) console.log(`    ${f} (${lines(f)})`);
console.log(`REACHED ONLY BY TESTS:     ${testOnly.length} modules, ${total(testOnly)} lines`);
for (const f of testOnly) console.log(`    ${f} (${lines(f)})`);
console.log(`UNREACHABLE:               ${unreachable.length} modules, ${total(unreachable)} lines`);
for (const f of unreachable) console.log(`    ${f} (${lines(f)})`);

// Test files whose subject is itself unreachable — deleting the subject without
// them leaves a test suite covering nothing.
const orphanTests = files.filter(
  (f) =>
    isTest(f) &&
    !f.startsWith("e2e/") &&
    (edges.get(f) ?? []).some((d) => testOnly.includes(d) || unreachable.includes(d))
);
if (orphanTests.length > 0) {
  console.log(`\nTESTS WHOSE SUBJECT IS NOT REACHED BY THE APP: ${orphanTests.length}`);
  for (const f of orphanTests) console.log(`    ${f} (${lines(f)})`);
}
