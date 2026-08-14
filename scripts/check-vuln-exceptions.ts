// CLI guard: fails the build if security/exceptions.json is malformed or holds
// an EXPIRED exception. Validation logic + tests live in
// src/lib/security/vulnExceptions.ts. Run: `npm run check:exceptions`.
//
// Audit 2026-08-06 F-006: an exception that never expires is just an ignored
// vulnerability with extra steps. This makes neglect fail loudly.
import { readFileSync } from "node:fs";
import { validateExceptions, type ExceptionsFile } from "../src/lib/security/vulnExceptions";

function main(): void {
  const path = new URL("../security/exceptions.json", import.meta.url);
  const file = JSON.parse(readFileSync(path, "utf8")) as ExceptionsFile;
  const problems = validateExceptions(file, new Date());

  if (problems.length === 0) {
    const n = file.exceptions?.length ?? 0;
    console.log(`check-vuln-exceptions: OK — ${n} exception(s), none expired.`);
    return;
  }

  for (const p of problems) console.error(`${p.advisory}: ${p.problem}`);
  console.error(
    `\ncheck-vuln-exceptions: FAILED — ${problems.length} problem(s). ` +
      `Upgrade the dependency, or consciously re-review and re-date the exception.`
  );
  process.exit(1);
}

main();
