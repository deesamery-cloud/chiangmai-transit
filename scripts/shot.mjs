import { chromium } from "playwright-core";

const URL = process.argv[2] || "http://localhost:3000";
const OUT = process.argv[3] || "/tmp/cm-shot.png";
const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-webgpu",
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await page.goto(URL, { waitUntil: "load", timeout: 30000 });
await page.waitForTimeout(Number(process.argv[4] || 10000));

const hud = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400));
await page.screenshot({ path: OUT });
console.log("ERRORS " + JSON.stringify(errors.slice(0, 25)));
console.log("HUD " + JSON.stringify(hud));
await browser.close();
