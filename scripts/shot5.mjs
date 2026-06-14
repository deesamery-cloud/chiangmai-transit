import { chromium } from "playwright-core";

const URL = process.argv[2] || "http://localhost:3001";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
const hud = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 480));

await page.goto(URL, { waitUntil: "load", timeout: 30000 });
await page.waitForTimeout(7000);
await page.getByRole("button", { name: /build/ }).click();

const routes = [
  { mode: "Bus", pts: [[470, 400], [640, 400], [810, 400]] },
  { mode: "Bus", pts: [[640, 300], [640, 400], [640, 505]] },
  { mode: "Bus", pts: [[520, 320], [640, 400], [770, 495]] },
  { mode: "Metro", pts: [[440, 300], [640, 400], [860, 520]] },
  { mode: "Metro", pts: [[440, 520], [640, 400], [860, 300]] },
];
for (const r of routes) {
  await page.getByRole("button", { name: new RegExp(`${r.mode} \\d`) }).first().click();
  await page.getByRole("button", { name: /Draw/ }).click();
  await page.waitForTimeout(180);
  for (const [x, y] of r.pts) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(150);
  }
  await page.getByRole("button", { name: /Finish/ }).click();
  await page.waitForTimeout(500);
}

await page.getByRole("button", { name: "300×", exact: true }).click();
await page.waitForTimeout(14000); // ~1+ sim-hour to reach steady state
await page.screenshot({ path: "/tmp/cm-ride.png" });
const after = await hud();
console.log("ERRORS " + JSON.stringify(errors.slice(0, 15)));
console.log("HUD " + JSON.stringify(after));
await browser.close();
