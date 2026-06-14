import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 850 } })).newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
const net = async () => { const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ")); const m = t.match(/YOUR NETWORK · (\d+)/); return m ? +m[1] : 0; };

await page.goto(URL, { waitUntil: "load", timeout: 45000 });
await page.waitForFunction(() => document.body.innerText.includes("Choose a mode to begin"), { timeout: 45000 }).catch(() => {});
await page.getByText("Sandbox").click();
await page.waitForTimeout(3000);
const box = await page.evaluate(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const P = (fx, fy) => [box.x + box.w * fx, box.y + box.h * (fy ?? 0.5)];
const click = async (fx, fy) => { const [x, y] = P(fx, fy); await page.mouse.click(x, y); await page.waitForTimeout(180); };
const tool = (re) => page.getByRole("button", { name: re }).click();

// s1..s3 → line A
await tool(/วางสถานี/);
await click(0.40); await click(0.50); await click(0.60);
await tool(/วางราง/); await page.waitForTimeout(150);
await click(0.40); await click(0.50); await click(0.60);
await page.getByRole("button", { name: /Finish/ }).click(); await page.waitForTimeout(500);
const afterBuild = await net();

// place s4,s5 beyond the s3 endpoint, then EXTEND from s3
await tool(/วางสถานี/);
await click(0.68); await click(0.74);
await tool(/วางราง/); await page.waitForTimeout(150);
await click(0.60); await click(0.68); await click(0.74); // chain starts at existing endpoint s3
await page.getByRole("button", { name: /Finish/ }).click(); await page.waitForTimeout(500);
const afterExtend = await net();

// demolish a MIDDLE station (s2 @0.50) — line should survive & re-route
await tool(/รื้อถอน/); await page.waitForTimeout(200);
await click(0.50);
const afterStationDemo = await net();

// click ON the line between stations (0.64, away from any station) — must NOT remove the line
await click(0.64);
const afterLineClick = await net();

console.log("afterBuild", afterBuild, afterBuild === 1 ? "✓" : "✗ (expected 1)");
console.log("afterExtend", afterExtend, afterExtend === 1 ? "✓ EXTENDED (still 1 line)" : "✗ made a new line!");
console.log("afterStationDemo", afterStationDemo, afterStationDemo === 1 ? "✓ station removed, line kept" : "✗ whole line gone");
console.log("afterLineClick", afterLineClick, afterLineClick === 1 ? "✓ line click did NOT delete line" : "✗ line deleted by click");
console.log("ERRORS", JSON.stringify(errors.slice(0, 8)));
await page.screenshot({ path: "/tmp/cm-extend.png" });
await browser.close();
