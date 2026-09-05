import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GIT_LIST_ARGS, isScannableDocPath } from "../security/docSecrets";

/**
 * The secret scanner must be able to SEE an uncommitted file.
 *
 * `check-doc-secrets` asked git for `ls-files`, which lists only files that are
 * already COMMITTED. So the single case the scanner exists to catch — a
 * credential freshly pasted into a new file, before anyone commits it — was the
 * one case it was structurally blind to. It printed "scanned 379 tracked files —
 * no secret-shaped literals" over a working tree with three files it had never
 * opened.
 *
 * That is the third check in this repo found reporting success about a subset
 * nobody named (after `audit-reachability` and the covariate study's CSV
 * loader), and it is the one where being wrong costs the most. This pins the
 * inventory rather than the detector: `docSecrets.test.ts` already covers
 * whether a literal is recognised, and it is worth nothing if the file is never
 * handed to it.
 */
const ROOT = join(__dirname, "..", "..", "..");

function list(args: string[]): string[] {
  return execFileSync("git", args, { encoding: "utf8", cwd: ROOT })
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter(isScannableDocPath);
}

let tempDir: string | null = null;

afterEach(() => {
  // The file is untracked by design, so nothing else would ever clean it up.
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("the secret scanner's inventory includes uncommitted files", () => {
  it("asks git for untracked files as well as tracked ones", () => {
    expect(GIT_LIST_ARGS).toContain("--others");
    // Without --exclude-standard, --others would drag in .env.local and every
    // ignored build artefact, and the scan would fail on the developer's own
    // machine for files git was told to ignore.
    expect(GIT_LIST_ARGS).toContain("--exclude-standard");
  });

  it("actually lists a brand-new file that has never been committed", () => {
    // The end-to-end version of the assertion above, because a flag can be
    // present and still not do what it is assumed to do.
    tempDir = mkdtempSync(join(ROOT, "secret-scan-canary-"));
    const rel = `${tempDir.slice(ROOT.length + 1).replace(/\\/g, "/")}/notes.md`;
    writeFileSync(join(ROOT, rel), "# scratch\n\nnothing sensitive here\n", "utf8");

    expect(list(GIT_LIST_ARGS)).toContain(rel);
    // And the old invocation is exactly the thing that would have missed it.
    expect(list(["ls-files"])).not.toContain(rel);
  });

  it("still honours .gitignore, so the scan is not swamped by build output", () => {
    const files = list(GIT_LIST_ARGS);
    expect(files.some((f) => f.startsWith("node_modules/"))).toBe(false);
    expect(files.some((f) => f.startsWith(".next/"))).toBe(false);
  });

  it("has an inventory worth scanning, so this cannot pass vacuously", () => {
    expect(list(GIT_LIST_ARGS).length).toBeGreaterThan(100);
  });
});
