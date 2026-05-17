/**
 * RAE Dashboard — Visual / Functional QA Verification
 *
 * Run with: npx tsx scripts/qa_verify.ts
 *
 * Produces:
 *   - artifacts/qa-desktop-{tab}.png  (5 system tab screenshots @ 1440x900)
 *   - artifacts/qa-liquidity.png      (Market Intelligence > Liquidity Flow)
 *   - artifacts/qa-sentiment.png      (Market Intelligence > Sentiment)
 *   - artifacts/qa-scenarios.png      (Nexus Simulator > Scenarios)
 *   - artifacts/qa-risk.png           (Nexus Simulator > Risk Analysis)
 *   - artifacts/qa-mobile.png         (390x844)
 *   - artifacts/qa-report.json        (machine-readable results)
 *   - structured PASS/FAIL summary to stdout
 */

import { chromium, type Browser, type Page, type ConsoleMessage } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const URL = "http://localhost:3456";
const OUT = join(process.cwd(), "artifacts");
mkdirSync(OUT, { recursive: true });

const CHROMIUM_PATH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const LAUNCH_ARGS = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];

type Result = { name: string; pass: boolean; detail: string };
const results: Result[] = [];
const errors: { type: string; text: string; location?: string }[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  const tag = pass ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name} — ${detail}`);
}

function attachListeners(page: Page, label: string) {
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      const loc = msg.location();
      errors.push({
        type: `console:${msg.type()}@${label}`,
        text: msg.text(),
        location: loc ? `${loc.url}:${loc.lineNumber}` : undefined,
      });
    }
  });
  page.on("pageerror", (err) => {
    errors.push({ type: `pageerror@${label}`, text: err.message });
  });
  page.on("requestfailed", (req) => {
    const fail = req.failure();
    errors.push({ type: `requestfailed@${label}`, text: `${req.url()} :: ${fail?.errorText ?? "unknown"}` });
  });
}

async function clickTopTab(page: Page, label: string) {
  const btn = page.locator(`.system-tabs .tab-link`, { hasText: label }).first();
  await btn.click({ timeout: 5000 });
  await page.waitForTimeout(1500);
}

async function clickSubTab(page: Page, panelSelector: string, label: string) {
  const btn = page.locator(`${panelSelector} .tab-btn`, { hasText: label }).first();
  await btn.scrollIntoViewIfNeeded();
  await btn.click({ timeout: 5000 });
  await page.waitForTimeout(1500);
}

async function shot(page: Page, name: string) {
  const path = join(OUT, name);
  await page.screenshot({ path, fullPage: true });
  console.log(`  screenshot -> ${path}`);
  return path;
}

async function runDesktop(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  attachListeners(page, "desktop");
  await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);

  // ---- (5) CSS property assertions ----
  // body bg has >= 3 radial-gradient layers
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundImage);
  const gradCount = (bodyBg.match(/radial-gradient/g) || []).length;
  record(
    "body background has >=3 radial gradients",
    gradCount >= 3,
    `found ${gradCount} radial-gradient layers; backgroundImage="${bodyBg.slice(0, 140)}..."`
  );

  // .panel-command::before has a box-shadow or background
  const cmdBefore = await page.evaluate(() => {
    const el = document.querySelector(".panel-command");
    if (!el) return { ok: false, reason: "no .panel-command element" };
    const cs = getComputedStyle(el, "::before");
    return {
      ok: (cs.boxShadow && cs.boxShadow !== "none") || (cs.backgroundImage && cs.backgroundImage !== "none"),
      boxShadow: cs.boxShadow,
      backgroundImage: cs.backgroundImage,
    };
  });
  record(
    ".panel-command::before has glow (box-shadow or background)",
    !!cmdBefore.ok,
    `boxShadow="${cmdBefore.boxShadow ?? "-"}" bg="${(cmdBefore.backgroundImage ?? "-").toString().slice(0, 120)}"`
  );

  // per-panel top-glow colors
  const panelColors: Record<string, string> = {
    "panel-command": "123, 183, 206",
    "panel-market": "119, 215, 176",
    "panel-universe": "215, 168, 87",
    "panel-narrative": "155, 127, 232",
    "panel-nexus": "77, 217, 192",
  };
  for (const [cls, rgb] of Object.entries(panelColors)) {
    const r = await page.evaluate((c) => {
      const el = document.querySelector("." + c);
      if (!el) return { found: false };
      const cs = getComputedStyle(el, "::before");
      return { found: true, bg: cs.backgroundImage, boxShadow: cs.boxShadow };
    }, cls);
    const hay = `${r.bg ?? ""} ${r.boxShadow ?? ""}`;
    const has = hay.includes(rgb);
    record(`.${cls}::before contains rgb(${rgb})`, has, `bg/shadow combined: ${hay.slice(0, 160)}`);
  }

  // KPI strong text-shadow non-zero
  const kpiStrong = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll(".kpi-card strong"));
    if (nodes.length === 0) return { ok: false, count: 0, samples: [] as string[] };
    const samples = nodes.slice(0, 5).map((n) => getComputedStyle(n as HTMLElement).textShadow);
    const ok = samples.every((s) => s && s !== "none");
    return { ok, count: nodes.length, samples };
  });
  record(
    ".kpi-card strong has non-zero text-shadow",
    !!kpiStrong.ok,
    `count=${kpiStrong.count} samples=${JSON.stringify(kpiStrong.samples).slice(0, 200)}`
  );

  // .pulse-3d-tilt has transform containing 'perspective'
  const tilt = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll(".pulse-3d-tilt"));
    if (nodes.length === 0) return { ok: false, count: 0, transform: "" };
    const t = getComputedStyle(nodes[0] as HTMLElement).transform;
    // computed transform is matrix() form when perspective+rotate applied; check non-identity
    return { ok: t && t !== "none", count: nodes.length, transform: t };
  });
  record(
    ".pulse-3d-tilt has computed transform (perspective+rotateX)",
    !!tilt.ok,
    `count=${tilt.count} transform=${tilt.transform}`
  );

  // also verify the raw rule includes 'perspective'
  const tiltRule = await page.evaluate(() => {
    for (const ss of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from((ss as CSSStyleSheet).cssRules || [])) {
          if ((rule as CSSStyleRule).selectorText === ".pulse-3d-tilt") {
            return (rule as CSSStyleRule).style.transform;
          }
        }
      } catch { /* cross-origin */ }
    }
    return "";
  });
  record(
    ".pulse-3d-tilt CSS rule includes 'perspective'",
    tiltRule.includes("perspective"),
    `rule.transform="${tiltRule}"`
  );

  // .system-panel has 28px grid texture
  const grid = await page.evaluate(() => {
    const el = document.querySelector(".system-panel");
    if (!el) return { ok: false };
    const cs = getComputedStyle(el as HTMLElement);
    return { ok: cs.backgroundSize.includes("28px"), bg: cs.backgroundImage.slice(0, 200), size: cs.backgroundSize };
  });
  record(".system-panel has 28px grid texture", !!grid.ok, `backgroundSize="${grid.size}" bg="${grid.bg}"`);

  // galaxy stars count
  const stars = await page.evaluate(() => {
    // they are likely circles with class 'star' or inside .galaxy-field
    const candidates = document.querySelectorAll(".galaxy-field circle, .galaxy-field .star, .galaxy-stars *");
    return candidates.length;
  });
  record("Galaxy star-field has ~180 stars", stars >= 150, `found ${stars} star nodes inside .galaxy-field`);

  // ---- (1) Top-tab screenshots ----
  const systems = ["Command Center", "Market Intelligence", "Player Universe", "Narrative Engine", "Nexus Simulator"];
  for (const sys of systems) {
    try {
      await clickTopTab(page, sys);
      const slug = sys.toLowerCase().replace(/\s+/g, "-");
      await shot(page, `qa-desktop-${slug}.png`);
      record(`top-tab click: ${sys}`, true, "clicked and screenshotted");
    } catch (e: unknown) {
      record(`top-tab click: ${sys}`, false, e instanceof Error ? e.message : String(e));
    }
  }

  // ---- (2) Sub-tab screenshots ----
  // Market Intelligence > Liquidity Flow
  try {
    await clickTopTab(page, "Market Intelligence");
    await clickSubTab(page, ".panel-market", "Liquidity Flow");
    await shot(page, "qa-liquidity.png");
    record("sub-tab MI > Liquidity Flow", true, "clicked");
  } catch (e: unknown) {
    record("sub-tab MI > Liquidity Flow", false, e instanceof Error ? e.message : String(e));
  }
  // Market Intelligence > Sentiment
  try {
    await clickSubTab(page, ".panel-market", "Sentiment");
    await shot(page, "qa-sentiment.png");
    record("sub-tab MI > Sentiment", true, "clicked");
  } catch (e: unknown) {
    record("sub-tab MI > Sentiment", false, e instanceof Error ? e.message : String(e));
  }
  // Nexus Simulator > Scenarios
  try {
    await clickTopTab(page, "Nexus Simulator");
    await clickSubTab(page, ".panel-nexus", "Scenarios");
    await shot(page, "qa-scenarios.png");
    record("sub-tab Nexus > Scenarios", true, "clicked");
  } catch (e: unknown) {
    record("sub-tab Nexus > Scenarios", false, e instanceof Error ? e.message : String(e));
  }
  // Nexus Simulator > Risk Analysis
  try {
    await clickSubTab(page, ".panel-nexus", "Risk Analysis");
    await shot(page, "qa-risk.png");
    record("sub-tab Nexus > Risk Analysis", true, "clicked");
  } catch (e: unknown) {
    record("sub-tab Nexus > Risk Analysis", false, e instanceof Error ? e.message : String(e));
  }

  await page.close();
}

async function runMobile(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  attachListeners(page, "mobile");
  await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot(page, "qa-mobile.png");

  const sidebar = await page.evaluate(() => {
    const el = document.querySelector(".rae-sidebar");
    if (!el) return { exists: false, display: "" };
    return { exists: true, display: getComputedStyle(el as HTMLElement).display };
  });
  record(
    "mobile sidebar hidden (display:none)",
    sidebar.exists && sidebar.display === "none",
    `exists=${sidebar.exists} display="${sidebar.display}"`
  );

  // KPIs in ~2-col grid: inspect the .kpi-grid (or parent of .kpi-card) computed grid-template-columns
  const kpiGrid = await page.evaluate(() => {
    const card = document.querySelector(".kpi-card");
    if (!card || !card.parentElement) return { ok: false, cols: "" };
    const cs = getComputedStyle(card.parentElement);
    return { ok: true, cols: cs.gridTemplateColumns };
  });
  // count tokens (skip "none")
  const cols = kpiGrid.cols && kpiGrid.cols !== "none" ? kpiGrid.cols.split(/\s+/).filter(Boolean).length : 0;
  record(
    "mobile KPIs in ~2-col grid",
    cols === 2,
    `grid-template-columns="${kpiGrid.cols}" (token count=${cols})`
  );

  await page.close();
}

async function runReducedMotion(browser: Browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  attachListeners(page, "reduced-motion");
  await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);

  // Sample a few elements that might animate; ensure animationName is 'none' OR durations are 0.
  const animSample = await page.evaluate(() => {
    const selectors = [".pulse-3d-tilt", ".galaxy-3d-tilt", ".kpi-card", ".system-panel", ".galaxy-field circle"];
    const out: Array<{ sel: string; animation: string; transition: string }> = [];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el as HTMLElement);
      out.push({ sel, animation: cs.animation, transition: cs.transition });
    }
    return out;
  });
  // pass if none of the sampled elements have a non-zero animation duration
  const offenders = animSample.filter((s) => /[\d.]+s/.test(s.animation) && !/0s/.test(s.animation) && !/none/.test(s.animation));
  record(
    "reduced-motion: no firing animations on sampled selectors",
    offenders.length === 0,
    `samples=${JSON.stringify(animSample)} offenders=${JSON.stringify(offenders)}`
  );

  await ctx.close();
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: LAUNCH_ARGS });
  try {
    await runDesktop(browser);
    await runMobile(browser);
    await runReducedMotion(browser);
  } finally {
    await browser.close();
  }

  // ---- Final report ----
  const passes = results.filter((r) => r.pass).length;
  const fails = results.filter((r) => !r.pass);
  console.log("\n=== QA REPORT ===");
  console.log(`Checks: ${results.length}  Pass: ${passes}  Fail: ${fails.length}`);
  console.log(`Console/page errors captured: ${errors.length}`);
  if (errors.length > 0) {
    console.log("\n-- JS / Network Errors --");
    for (const e of errors) console.log(`  [${e.type}] ${e.text}${e.location ? " @ " + e.location : ""}`);
  }
  if (fails.length > 0) {
    console.log("\n-- FAILURES --");
    for (const f of fails) console.log(`  FAIL: ${f.name} — ${f.detail}`);
  }
  const reportPath = join(OUT, "qa-report.json");
  writeFileSync(reportPath, JSON.stringify({ results, errors }, null, 2));
  console.log(`\nReport JSON: ${reportPath}`);
  process.exit(fails.length === 0 && errors.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
