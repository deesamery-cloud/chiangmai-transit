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
const g = (h, re) => (h.match(re) || [])[1] || "?";

await page.goto(URL, { waitUntil: "load", timeout: 45000 });
await page.waitForFunction(() => document.body.innerText.includes("Pick a goal to begin"), { timeout: 45000 }).catch(() => {});
const start = await hud();
console.log("GOAL_CARDS", ["Win the Cars", "Transit Tycoon", "Grade A", "Free Build"].filter((t) => start.includes(t)).length, "/4");
await page.screenshot({ path: "/tmp/cm-goal-start.png" });

await page.getByText("Grade A City").click();
await page.waitForSelector("canvas", { timeout: 20000 });
await page.waitForTimeout(2500);
const box = await page.evaluate(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const P = (fx, fy) => [box.x + box.w * fx, box.y + box.h * fy];
const click = async (fx, fy) => { const [x, y] = P(fx, fy); await page.mouse.click(x, y); await page.waitForTimeout(120); };
const tool = (re) => page.getByRole("button", { name: re }).click();
const buildLine = async (pts) => {
  await tool(/วางสถานี/);
  for (const [fx, fy] of pts) await click(fx, fy);
  await tool(/วางราง/); await page.waitForTimeout(120);
  for (const [fx, fy] of pts) await click(fx, fy);
  await page.getByRole("button", { name: /Finish/ }).click(); await page.waitForTimeout(400);
};
const banner0 = await hud();
console.log("OBJECTIVE_BANNER", /🎯.*Grade A/.test(banner0) ? "✓ shown" : "✗ missing");
const day0 = g(banner0, /day (\d+)/);

// blanket the core with horizontal rows of stations → high coverage (→ Grade A)
const xs = [0.30, 0.37, 0.44, 0.51, 0.58, 0.65, 0.72];
for (const y of [0.34, 0.41, 0.48, 0.55, 0.62, 0.69]) {
  await buildLine(xs.map((x) => [x, y]));
}

await page.getByRole("button", { name: "1200×" }).click().catch(() => {});
await page.waitForTimeout(9000);
const h = await hud();
const day1 = g(h, /day (\d+)/);
console.log("FAST_TIME days", day0, "→", day1, Number(day1) > Number(day0) + 2 ? "✓ time advances fast" : "(slow?)");
console.log("CITY_SCORE", g(h, /City Score (\d+)/), "GOAL%", g(h, /🎯 🅰 Grade A City (\d+)%/));
console.log("WIN_OVERLAY", h.includes("world-class network") || h.includes("Keep playing") ? "🏆 SHOWN" : "not yet (need higher coverage)");
console.log("ERRORS", JSON.stringify(errors.slice(0, 8)));
await page.screenshot({ path: "/tmp/cm-goal-play.png" });
await browser.close();
