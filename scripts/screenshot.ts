import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const URL = "http://localhost:3456";
const OUT = join(process.cwd(), "artifacts");
mkdirSync(OUT, { recursive: true });

const CHROMIUM_PATH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "mobile-390",   width: 390,  height: 844 },
];

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);

    const path = join(OUT, `${vp.name}.png`);
    await page.screenshot({ path, fullPage: false });
    console.log(`Saved ${path}`);
    await page.close();
  }

  await browser.close();
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
