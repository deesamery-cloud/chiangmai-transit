import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3001";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 850 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
const netCount = async () => {
  const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  const m = t.match(/YOUR NETWORK · (\d+)/); return m ? +m[1] : 0;
};
await page.goto(URL, { waitUntil: "load", timeout: 45000 });
await page.waitForFunction(() => document.body.innerText.includes("Choose a mode to begin"), { timeout: 45000 }).catch(() => {});
await page.getByText("Sandbox").click();
await page.waitForTimeout(3500);
const box = await page.evaluate(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const cy = box.y + box.h * 0.5;
// lay a track line
await page.getByRole("button", { name: /วางราง/ }).click();
const xs = [0.4, 0.48, 0.56, 0.64];
for (const fx of xs) { await page.mouse.click(box.x + box.w * fx, cy); await page.waitForTimeout(220); }
await page.getByRole("button", { name: /Finish/ }).click();
await page.waitForTimeout(1500);
const before = await netCount();
// demolish: pick tool, click on the line
await page.getByRole("button", { name: /รื้อถอน/ }).click();
await page.waitForTimeout(300);
let after = before;
for (const fx of [0.48, 0.56, 0.44, 0.6, 0.52]) {
  await page.mouse.click(box.x + box.w * fx, cy);
  await page.waitForTimeout(500);
  after = await netCount();
  if (after < before) break;
}
console.log("NETWORK_BEFORE", before, "NETWORK_AFTER", after, after < before ? "✓ demolished" : "✗ not removed");
console.log("ERRORS", JSON.stringify(errors.slice(0, 8)));
await browser.close();
