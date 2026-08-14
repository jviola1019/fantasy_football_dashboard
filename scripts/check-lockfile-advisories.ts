// CLI guard: fails the build if package-lock.json resolves a package version that a
// known security advisory covers. Detector logic + tests live in
// src/lib/security/lockfileAdvisories.ts. Run: `npm run check:advisories`.
//
// Runs offline with no GitHub token, so it gates pushes, PRs, scheduled scans, and
// local work identically — unlike `dependency-review`, which is PR-only and needs
// the repository dependency graph enabled.
import { readFileSync } from "node:fs";
import {
  ADVISORY_FLOORS,
  findLockfileViolations,
  type LockfileShape
} from "../src/lib/security/lockfileAdvisories";

function main(): void {
  const lockPath = new URL("../package-lock.json", import.meta.url);
  const lock = JSON.parse(readFileSync(lockPath, "utf8")) as LockfileShape;
  const violations = findLockfileViolations(lock);

  if (violations.length === 0) {
    const guarded = Object.keys(ADVISORY_FLOORS).join(", ");
    console.log(`check-lockfile-advisories: OK — no resolved version below a floor (${guarded}).`);
    return;
  }

  for (const v of violations) {
    console.error(
      `${v.path}\n  resolved ${v.version}, needs >= ${v.minVersion}\n  advisories: ${v.advisories.join(", ")}`
    );
  }
  console.error(
    `\ncheck-lockfile-advisories: FAILED — ${violations.length} vulnerable resolution(s). ` +
      `Upgrade the package; do not lower the floor in src/lib/security/lockfileAdvisories.ts.`
  );
  process.exit(1);
}

main();
