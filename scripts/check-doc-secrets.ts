// CLI guard: fails the build if a tracked *.md / *.json / *.env* file contains a
// secret-shaped literal next to a secret keyword. Detector logic + tests live in
// src/lib/security/docSecrets.ts. Run: `npm run check:secrets`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { scanFiles, isScannableDocPath } from "../src/lib/security/docSecrets";

function trackedTextFiles(): string[] {
  // No shell, fixed argv — not susceptible to command injection.
  const out = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  return out.split("\n").filter(Boolean).filter(isScannableDocPath);
}

function main(): void {
  const files = trackedTextFiles();
  const found = scanFiles(files, (p) => readFileSync(p, "utf8"));
  const entries = Object.entries(found);
  if (entries.length === 0) {
    console.log(`check-doc-secrets: scanned ${files.length} tracked files — no secret-shaped literals.`);
    return;
  }
  for (const [file, leaks] of entries) {
    for (const l of leaks) {
      console.error(`${file}:${l.line}  possible ${l.keyword} secret → ${l.token}`);
    }
  }
  console.error(
    `\ncheck-doc-secrets: FAILED — ${entries.length} file(s) contain secret-shaped literals. Redact them.`
  );
  process.exit(1);
}

main();
