// CLI guard: fails the build if a *.md / *.json / *.env* file contains a
// secret-shaped literal next to a secret keyword. Detector logic + tests live in
// src/lib/security/docSecrets.ts. Run: `npm run check:secrets`.
//
// IT MUST SEE UNCOMMITTED FILES. This asked git for `ls-files`, which lists only
// files already COMMITTED — so the highest-risk case it exists to catch, a
// credential freshly pasted into a new file that has not been committed yet, was
// the one case it could not see. It scanned 379 files, said "no secret-shaped
// literals", and was describing a set that excluded everything new.
//
// `--others --exclude-standard` adds untracked files while still honouring
// .gitignore, so `.env.local` and build output stay out. Same fix, same reason,
// as `scripts/audit-reachability.ts`; the shared lesson is that a check which
// cannot see its input reports success.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { scanFiles, isScannableDocPath, GIT_LIST_ARGS } from "../src/lib/security/docSecrets";

function scannableFiles(): string[] {
  // No shell, fixed argv — not susceptible to command injection.
  const out = execFileSync("git", GIT_LIST_ARGS, { encoding: "utf8" });
  return out.split("\n").filter(Boolean).filter(isScannableDocPath);
}

function main(): void {
  const files = scannableFiles();
  const found = scanFiles(files, (p) => readFileSync(p, "utf8"));
  const entries = Object.entries(found);
  if (entries.length === 0) {
    console.log(
      `check-doc-secrets: scanned ${files.length} files (tracked + untracked) — no secret-shaped literals.`
    );
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
