/**
 * Measure the UI instead of describing it.
 *
 * Four things, because they are the four that keep going wrong here and each one
 * is invisible to the checks already in place:
 *
 *   SPACING   axe does not read padding. A panel padded 13px next to one padded
 *             16px looks "fine" in review and wrong on screen.
 *   TABBING   axe checks that a focus style EXISTS in CSS, not that focusing an
 *             element visibly changes anything, and not that a tab is wired to
 *             the panel it claims to control.
 *   OPACITY   axe computes contrast from `color`, and `opacity` is applied
 *             afterwards by the compositor. `--blue` at opacity .75 measured
 *             4.13:1 while every automated check stayed green (audit
 *             2026-08-23). Opacity is a contrast change wearing a costume.
 *   MODEL     CLAUDE.md requires source, freshness, confidence, assumptions,
 *   OUTPUTS   validation state and fixture/live mode on every model output. That
 *             is a claim about panels, so it can be checked as one.
 *
 * EVERY CHECK ASSERTS IT FOUND SOMETHING before it reports that it found nothing
 * wrong. A scan that silently matched zero elements is the failure mode this
 * repository has hit nine separate times, and "0 problems" is exactly what it
 * looks like from the outside.
 *
 *   npx tsx scripts/audit-ui.ts [baseUrl]
 */
import { chromium, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { IN_PAGE_AUDIT, SPACE_SCALE, WAIT_FOR_ANIMATIONS, type UiFinding } from "../src/lib/ops/uiAudit";

const BASE = (process.argv[2] ?? process.env.AUDIT_BASE_URL ?? "http://localhost:3200").replace(/\/$/, "");

const ROUTES = [
  "/",
  "/login",
  "/dashboard",
  "/players",
  "/analytics",
  "/draft",
  "/waivers",
  "/trades",
  "/reports",
  "/mock-draft"
];

interface RouteResult {
  route: string;
  scanned: Record<string, number>;
  findings: UiFinding[];
}

type Scan = { scanned: Record<string, number>; findings: UiFinding[] };

/** Settle the reveal animations, then measure — see WAIT_FOR_ANIMATIONS. */
async function scan(page: Page): Promise<Scan> {
  await page.evaluate(WAIT_FOR_ANIMATIONS);
  return (await page.evaluate(IN_PAGE_AUDIT)) as Scan;
}

/**
 * Scan a route in EVERY tab state, not just the one it opens on.
 *
 * Learned the hard way earlier in this audit: the charts behind in-panel tabs
 * unmount when the tab is inactive, so a single pass measures one tab's content
 * and silently ignores the rest. The first run of this harness reported
 * `dimmedTextElements=0` on all ten routes — not because nothing is dimmed, but
 * because the elements carrying `opacity` were behind tabs that were never
 * opened.
 */
async function auditRoute(page: Page, route: string): Promise<RouteResult> {
  await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60_000 });

  const passes: Scan[] = [await scan(page)];

  const tabIds = await page.evaluate(
    `[...document.querySelectorAll("[role='tab']")].map((t) => t.id).filter(Boolean)`
  );
  for (const id of tabIds as string[]) {
    try {
      await page.click(`#${id}`, { timeout: 5_000 });
      passes.push(await scan(page));
    } catch {
      // A tab that cannot be clicked is itself worth knowing about, but it is
      // already reported by the target-size and wiring checks.
    }
  }

  // Union the findings; keep the LARGEST count seen for each scanned category,
  // since a tab state can reveal more elements than the default one.
  const scanned: Record<string, number> = {};
  const seen = new Set<string>();
  const findings: UiFinding[] = [];
  for (const pass of passes) {
    for (const [k, v] of Object.entries(pass.scanned)) scanned[k] = Math.max(scanned[k] ?? 0, v);
    for (const f of pass.findings) {
      const key = `${f.kind}|${f.selector}|${f.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(f);
    }
  }
  scanned.tabStatesVisited = passes.length;
  return { route, scanned, findings };
}

/**
 * Prove the scan can SEE a violation before believing it when it reports none.
 *
 * This is not ceremony. The first working version of this harness reported
 * "opacity: 0" across all ten routes, and the reason was that
 * `Function.prototype.toString` carried esbuild's `__name(fn, "fn")` wrapper
 * into the page without the helper, so the contrast computation threw for every
 * element it was handed. Zero findings, zero comparisons performed. Exactly the
 * shape of failure this repository has now catalogued ten times.
 *
 * So: inject text that is definitely too faint, and refuse to run if the scan
 * does not notice.
 */
async function selfTest(page: Page): Promise<boolean> {
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle", timeout: 60_000 });
  const before = (await scan(page)).findings.filter(
    (f) => f.kind === "opacity"
  ).length;

  await page.evaluate(() => {
    const el = document.createElement("div");
    el.id = "audit-ui-self-test";
    el.textContent = "self-test: deliberately illegible";
    // #8aa4b8 at 0.55 over the navy ground measures 3.00:1 — comfortably under
    // the 4.5:1 required at 13px, and not so far under that a rounding change
    // would make the test vacuous.
    el.style.cssText = "color:#8aa4b8;opacity:0.55;font-size:13px;padding:8px";
    document.body.appendChild(el);
  });

  const after = (await scan(page)).findings.filter(
    (f) => f.kind === "opacity"
  );
  await page.evaluate(() => document.getElementById("audit-ui-self-test")?.remove());

  const opacityCaught = after.length > before;
  if (opacityCaught) {
    console.log(`audit-ui self-test: opacity PASS — ${after[after.length - 1]!.detail}`);
  } else {
    console.error("audit-ui self-test: opacity FAILED — the scan did not flag text it was told to flag.");
  }

  // The target-size check needs its own canary, because "tabbing: 0" became a
  // headline claim the moment the real findings were fixed, and a check that
  // has stopped firing looks identical to a page that has stopped offending.
  const tabBefore = (await scan(page)).findings.filter(
    (f) => f.kind === "tabbing"
  ).length;
  await page.evaluate(() => {
    // Two 12x12 buttons four pixels apart: too small, hit area not extended, and
    // close enough that the WCAG 2.5.8 spacing exception cannot rescue them.
    const wrap = document.createElement("div");
    wrap.id = "audit-ui-self-test-targets";
    wrap.style.cssText = "position:fixed;top:200px;left:200px;z-index:99999";
    for (let i = 0; i < 2; i += 1) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "x";
      b.style.cssText = `position:absolute;left:${i * 16}px;top:0;width:12px;height:12px;padding:0`;
      wrap.appendChild(b);
    }
    document.body.appendChild(wrap);
  });
  const tabAfter = (await scan(page)).findings.filter(
    (f) => f.kind === "tabbing"
  );
  await page.evaluate(() => document.getElementById("audit-ui-self-test-targets")?.remove());

  const targetCaught = tabAfter.length > tabBefore;
  if (targetCaught) {
    console.log(`audit-ui self-test: target-size PASS — ${tabAfter[tabAfter.length - 1]!.detail}`);
  } else {
    console.error(
      "audit-ui self-test: target-size FAILED — two 12x12 buttons 4px apart were not flagged. 'tabbing: 0' would be meaningless."
    );
  }

  if (!opacityCaught || !targetCaught) {
    console.error("audit-ui: refusing to report results from a scan that cannot see known defects.");
  }
  return opacityCaught && targetCaught;
}

/**
 * Refuse to audit a server that is not running the code on disk.
 *
 * This is not paranoia. Three consecutive runs of this harness reported that a
 * fix to `PanelTabs` had not taken effect. The fix was correct and present in
 * `.next`; the server answering on the port was an ORPHAN from an earlier run
 * that had survived `kill` and held the port, so every restart failed with
 * EADDRINUSE into a log nobody read, and every measurement described a build
 * that no longer existed.
 *
 * A stale target is the most expensive kind of wrong measurement, because it
 * looks exactly like a failed fix and sends you to re-fix working code.
 */
async function assertServerMatchesBuild(page: Page): Promise<boolean> {
  let localBuildId: string;
  try {
    localBuildId = readFileSync(".next/BUILD_ID", "utf8").trim();
  } catch {
    console.error("audit-ui: no .next/BUILD_ID — run `npm run build` first.");
    return false;
  }
  await page.goto(BASE + "/players", { waitUntil: "domcontentloaded", timeout: 60_000 });
  const html = await page.content();
  if (!html.includes(localBuildId)) {
    console.error(
      `audit-ui: the server at ${BASE} is NOT serving the local build (${localBuildId}). ` +
        "It is probably an orphaned process holding the port. Every result below would describe " +
        "code that no longer exists, so nothing is reported."
    );
    return false;
  }
  console.log(`audit-ui: server confirmed on local build ${localBuildId}`);
  return true;
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  if (!(await assertServerMatchesBuild(page))) {
    await browser.close();
    process.exitCode = 1;
    return;
  }

  if (!(await selfTest(page))) {
    await browser.close();
    process.exitCode = 1;
    return;
  }

  const results: RouteResult[] = [];
  for (const route of ROUTES) {
    try {
      results.push(await auditRoute(page, route));
    } catch (err) {
      console.error(
        `audit-ui: ${route} FAILED TO LOAD — ${err instanceof Error ? err.message : String(err)}`
      );
      process.exitCode = 1;
    }
  }
  await browser.close();

  // The check on the checker. A route that matched nothing did not pass; it was
  // not examined, and reporting it as clean would be the exact failure this
  // whole audit keeps finding.
  let refused = false;
  // Per route, because "at least 20 text elements" is right for a data route and
  // wrong for a login form. A blanket floor either exempts the sparse routes or
  // fails them for being sparse, and both hide the thing this is for: a route
  // whose DOM the scan never actually reached.
  //
  // /login is a five-field form. /mock-draft is legitimately in an unavailable
  // state without a cached FantasyPros snapshot, and says so — that is the
  // required behaviour, not a defect, so its floor reflects the empty state.
  const DEFAULT_MINIMA: Record<string, number> = {
    textElements: 20,
    focusables: 3,
    spacingBoxes: 1,
    panels: 1
  };
  const ROUTE_MINIMA: Record<string, Record<string, number>> = {
    "/login": { textElements: 5, focusables: 3, spacingBoxes: 0, panels: 0 },
    "/mock-draft": { textElements: 5, focusables: 1, spacingBoxes: 1, panels: 0 },
    "/": { textElements: 20, focusables: 3, spacingBoxes: 1, panels: 0 }
  };
  for (const r of results) {
    const minima = ROUTE_MINIMA[r.route] ?? DEFAULT_MINIMA;
    for (const [key, min] of Object.entries(minima)) {
      if ((r.scanned[key] ?? 0) < min) {
        console.error(
          `audit-ui: ${r.route} scanned ${r.scanned[key] ?? 0} ${key} (expected >= ${min}) — REFUSING to call this route clean.`
        );
        refused = true;
      }
    }
  }

  const all = results.flatMap((r) => r.findings.map((f) => ({ ...f, route: r.route })));

  console.log(`audit-ui → ${BASE}`);
  console.log(`spacing scale: ${SPACE_SCALE.join("/")}\n`);
  for (const r of results) {
    const counts = Object.entries(r.scanned)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    console.log(`${r.route.padEnd(14)} ${counts}  findings=${r.findings.length}`);
  }
  console.log("");

  for (const kind of ["opacity", "tabbing", "spacing", "model-output"] as const) {
    const fs = all.filter((f) => f.kind === kind);
    console.log(`### ${kind}: ${fs.length}`);
    const seen = new Set<string>();
    for (const f of fs) {
      const key = `${f.selector}|${f.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  [${f.route}] ${f.selector} — ${f.detail}`);
    }
    console.log("");
  }

  writeFileSync("audit-ui.json", JSON.stringify({ base: BASE, results }, null, 2));
  console.log(`audit-ui: ${all.length} findings across ${results.length} routes (detail in audit-ui.json)`);
  if (refused) process.exitCode = 1;
}

main().catch((err) => {
  console.error("audit-ui failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
