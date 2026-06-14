import { chromium } from "playwright-core";

const URL = process.env.CM_URL || "http://localhost:3001";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

const log = (...a) => console.log(...a);

await page.goto(URL, { waitUntil: "load", timeout: 45000 });
// wait until data loaded (mode-select enabled)
await page.waitForFunction(() => document.body.innerText.includes("Choose a mode to begin"), { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(800);

// pick Sandbox (unlimited budget, no goal)
const sandbox = page.getByRole("button", { name: /Sandbox/ });
await sandbox.click().catch(async () => { await page.getByText("Sandbox").click(); });
await page.waitForTimeout(1500);

// crank speed so commuters move quickly, let the map settle
await page.getByRole("button", { name: "60×" }).click().catch(() => {});
await page.waitForTimeout(5000);
await page.screenshot({ path: "/tmp/cm-1-started.png" });

// check the four Thai tools are present
const toolText = await page.evaluate(() => document.body.innerText);
const toolsPresent = ["เลื่อนแผนที่", "วางสถานี", "วางราง", "รื้อถอน"].filter((t) => toolText.includes(t));
log("TOOLS_PRESENT", JSON.stringify(toolsPresent));

// --- lay a track line across the CBD ---
await page.getByRole("button", { name: /วางราง/ }).click();
await page.waitForTimeout(400);
const box = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
// click 5 points along a horizontal sweep through the city centre
const cy = box.y + box.h * 0.5;
const xs = [0.36, 0.44, 0.52, 0.6, 0.68];
for (const fx of xs) {
  await page.mouse.click(box.x + box.w * fx, cy);
  await page.waitForTimeout(250);
}
await page.screenshot({ path: "/tmp/cm-2-drawing.png" });
await page.getByRole("button", { name: /Finish/ }).click();
await page.waitForTimeout(6000);
await page.screenshot({ path: "/tmp/cm-3-built.png" });

// switch to pan, zoom into the CBD to show categorised POIs + labels + arcs
await page.getByRole("button", { name: /เลื่อนแผนที่/ }).click();
await page.waitForTimeout(300);
const cx = box.x + box.w * 0.5, cyc = box.y + box.h * 0.5;
await page.mouse.move(cx, cyc);
for (let i = 0; i < 4; i++) { await page.mouse.dblclick(cx, cyc); await page.waitForTimeout(700); }
await page.waitForTimeout(3500);
await page.screenshot({ path: "/tmp/cm-4-cbd.png" });

const hud = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
const netMatch = hud.match(/YOUR NETWORK · (\d+)/);
const ridersMatch = hud.match(/On transit\s*([\d,]+)/);
const ridersDayMatch = hud.match(/Riders\/day\s*([\d,]+)/);
log("NETWORK_LINES", netMatch ? netMatch[1] : "0");
log("ON_TRANSIT", ridersMatch ? ridersMatch[1] : "?");
log("RIDERS_DAY", ridersDayMatch ? ridersDayMatch[1] : "?");
log("WHERE_TO_BUILD_REMOVED", !hud.includes("WHERE TO BUILD"));
log("LAYERS_PANEL", hud.includes("MAP LAYERS"));
log("OD_BADGE", /home → work|work → home/.test(hud));
log("BUS_ABSENT", !/\bBus\b/.test(hud));
log("METRO_PRESENT", /Metro/.test(hud));

log("ERRORS", JSON.stringify(errors.slice(0, 20)));
await browser.close();
