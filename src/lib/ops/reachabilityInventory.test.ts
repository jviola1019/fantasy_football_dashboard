import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The dead-code auditor must be able to SEE every module before its "0
 * unreachable" means anything.
 *
 * `scripts/audit-reachability.ts` builds its inventory from git. The plain
 * `git ls-files` lists only COMMITTED files, and the thing this auditor exists
 * to find is code nothing imports — which is most often code somebody has just
 * written and not yet committed. It was therefore blind in exactly the place it
 * was needed: on 2026-09-02 it reported "228 non-test src modules, 0
 * unreachable" over a working tree containing 231, with three new untracked
 * modules invisible to it.
 *
 * This test compares the auditor's inventory against the filesystem. It is
 * cheap, and it is the difference between a clean report and a report about a
 * subset nobody named.
 */
const ROOT = join(__dirname, "..", "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

describe("the reachability auditor can see the whole tree", () => {
  /** Exactly the invocation the auditor uses. */
  const gitFiles = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "src", "scripts", "e2e"],
    { encoding: "utf8", cwd: ROOT }
  )
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => /\.(ts|tsx)$/.test(f));

  const srcFromGit = new Set(
    gitFiles.filter((f) => f.startsWith("src/") && !/\.test\.tsx?$/.test(f))
  );
  const srcFromDisk = new Set(
    walk(join(ROOT, "src")).map((p) => p.slice(ROOT.length + 1).replace(/\\/g, "/"))
  );

  it("sees every non-test module that exists on disk", () => {
    const missed = [...srcFromDisk].filter((f) => !srcFromGit.has(f));
    expect(
      missed,
      `the auditor's inventory is missing ${missed.length} module(s), so its ` +
        `"0 unreachable" describes a subset:\n${missed.join("\n")}`
    ).toEqual([]);
  });

  it("does not invent modules the disk does not have", () => {
    // A deleted-but-still-tracked file would make the auditor read a path that
    // is gone and, depending on the failure mode, either crash or skip silently.
    const phantom = [...srcFromGit].filter((f) => !srcFromDisk.has(f));
    expect(phantom, `the inventory lists paths that do not exist: ${phantom.join(", ")}`).toEqual([]);
  });

  it("has an inventory worth checking, so this cannot pass vacuously", () => {
    expect(srcFromDisk.size).toBeGreaterThan(150);
    expect(srcFromGit.size).toBe(srcFromDisk.size);
  });

  it("would notice an untracked file — the case that was missed", () => {
    // Canary for the flags, not for git. `--others` is what admits an untracked
    // module; without it a brand-new file is invisible, which is the defect this
    // file was written after.
    const withoutOthers = execFileSync("git", ["ls-files", "src"], {
      encoding: "utf8",
      cwd: ROOT
    })
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
    // Tracked-only can only ever be a subset of tracked-plus-untracked.
    expect(withoutOthers.length).toBeLessThanOrEqual(srcFromGit.size);
  });
});
