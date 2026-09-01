import { readFileSync } from "node:fs";

/**
 * Refuse to test a server that is not running the code on disk.
 *
 * `reuseExistingServer` is true outside CI, which is the right default: it makes
 * local iteration fast. It is also silent, and that combination cost three
 * separate investigations on 2026-08-24 alone:
 *
 *  1. Three runs of the UI audit reported that a fix to `PanelTabs` had not
 *     taken effect. The fix was correct and present in `.next`. An orphaned
 *     server from an earlier probe held the port, so every restart failed with
 *     EADDRINUSE into a log nobody read.
 *  2. A full e2e run produced three timing-out failures in the sign-in spec
 *     that looked like a regression in the proxy's login redirect. The same
 *     redirect measured correct on a clean server seconds later. The suite had
 *     reused a wedged server left behind when a previous run was cancelled.
 *  3. Every "pass" in that run was equally meaningless, which is the worse half:
 *     a stale server does not announce itself, and a green suite is exactly what
 *     it looks like from the outside.
 *
 * A stale target is the most expensive kind of wrong measurement, because it is
 * indistinguishable from a failed fix and sends you to re-fix working code.
 *
 * Next embeds its build id in the asset URLs of every page, so one fetch settles
 * it. If `.next/BUILD_ID` cannot be read there is nothing to compare against and
 * the check stands aside rather than blocking a run it cannot judge.
 */
export default async function globalSetup(): Promise<void> {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

  let expected: string;
  try {
    expected = readFileSync(".next/BUILD_ID", "utf8").trim();
  } catch {
    return; // no local build to compare against
  }
  if (!expected) return;

  const res = await fetch(`${baseURL}/players`, { redirect: "follow" });
  const html = await res.text();
  if (html.includes(expected)) return;

  throw new Error(
    [
      `The server at ${baseURL} is NOT serving the local build (${expected}).`,
      "",
      "It is almost certainly an orphaned process from a cancelled run holding the",
      "port, so every result this suite produced would describe code that no longer",
      "exists — failures that look like regressions, and passes that mean nothing.",
      "",
      "Stop whatever is on the port and run again:",
      "  Windows:  Get-NetTCPConnection -LocalPort 3000 -State Listen |",
      "              ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }",
      "  POSIX:    lsof -ti tcp:3000 | xargs kill -9"
    ].join("\n")
  );
}
