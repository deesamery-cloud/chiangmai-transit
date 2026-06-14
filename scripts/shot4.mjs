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

const hud = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 460));

await page.goto(URL, { waitUntil: "load", timeout: 30000 });
await page.waitForTimeout(7000); // bigger graph to parse
await page.getByRole("button", { name: /build/ }).click();
await page.getByRole("button", { name: "60×", exact: true }).click();
await page.waitForTimeout(5000);
await page.screenshot({ path: "/tmp/cm-base.png" });
const before = await hud();

const routes = [
  { mode: "Bus", pts: [[470, 400], [640, 398], [810, 400]] },
  { mode: "Metro", pts: [[640, 270], [640, 400], [640, 535]] },
  { mode: "Bus", pts: [[500, 300], [640, 400], [800, 520]] },
  { mode: "Metro", pts: [[500, 520], [645, 400], [800, 285]] },
];
for (const r of routes) {
  await page.getByRole("button", { name: r.mode, exact: true }).first().click();
  await page.getByRole("button", { name: /Draw/ }).click();
  await page.waitForTimeout(200);
  for (const [x, y] of r.pts) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(160);
  }
  await page.getByRole("button", { name: /Finish/ }).click();
  await page.waitForTimeout(700);
}

await page.waitForTimeout(9000); // let mode-shift settle
await page.screenshot({ path: "/tmp/cm-net.png" });
const after = await hud();

console.log("ERRORS " + JSON.stringify(errors.slice(0, 20)));
console.log("BEFORE " + JSON.stringify(before));
console.log("AFTER  " + JSON.stringify(after));
await browser.close();
