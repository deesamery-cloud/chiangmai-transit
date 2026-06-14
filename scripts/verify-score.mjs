import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 850 } })).newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
const hud = async () => (await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ")));

await page.goto(URL, { waitUntil: "load", timeout: 45000 });
await page.waitForFunction(() => document.body.innerText.includes("Choose a mode to begin"), { timeout: 45000 }).catch(() => {});
await page.getByText("Sandbox").click();
await page.getByRole("button", { name: "300×" }).click().catch(() => {});
await page.waitForTimeout(6000);
// baseline (no lines): traffic should be high, score F
{
  const h0 = await hud();
  const traffic0 = (h0.match(/Traffic (\d+)%/) || [])[1] || "?";
  const score0 = (h0.match(/City score (\d+)\/100/) || [])[1] || "?";
  const share0 = (h0.match(/(\d+)% on metro/) || [])[1] || "?";
  console.log("BASELINE traffic%", traffic0, "score", score0, "share%", share0);
}
const box = await page.evaluate(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.screenshot({ path: "/tmp/cm-tune-baseline.png" });
const px = (fx) => box.x + box.w * fx;
const py = (fy) => box.y + box.h * fy;

// a dense, demand-centred line through the CBD core (overlapping catchments)
const pts = [
  [0.40, 0.47], [0.44, 0.51], [0.48, 0.47], [0.50, 0.52], [0.52, 0.47],
  [0.54, 0.52], [0.56, 0.48], [0.58, 0.52], [0.60, 0.47], [0.62, 0.50],
];
await page.getByRole("button", { name: /วางสถานี/ }).click();
for (const p of pts) { await page.mouse.click(px(p[0]), py(p[1])); await page.waitForTimeout(220); }
await page.getByRole("button", { name: /วางราง/ }).click();
await page.waitForTimeout(250);
for (const p of pts) { await page.mouse.click(px(p[0]), py(p[1])); await page.waitForTimeout(260); }
await page.getByRole("button", { name: /Finish/ }).click();
await page.getByRole("button", { name: "300×" }).click().catch(() => {});
await page.waitForTimeout(9000);

const h = await hud();
const g = (re) => (h.match(re) || [])[1] || "?";
console.log("AFTER  score", g(/City score (\d+)\/100/), "coverage", g(/Coverage (\d+)%/),
  "traffic%", g(/Traffic (\d+)%/), "ridersDay", g(/Riders\/day ([\d,]+)/), "onTransit", g(/On transit ([\d,]+)/));
console.log("HAS_SCORE_UI", h.includes("City score"));
console.log("ERRORS", JSON.stringify(errors.slice(0, 10)));
await page.screenshot({ path: "/tmp/cm-score-city.png" });
// zoom in on the line to check the rail stands out over the dots
await page.getByRole("button", { name: /เลื่อนแผนที่/ }).click();
await page.mouse.move(px(0.5), py(0.5));
for (let i = 0; i < 2; i++) { await page.mouse.dblclick(px(0.5), py(0.5)); await page.waitForTimeout(700); }
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/cm-score-zoom.png" });
await browser.close();
