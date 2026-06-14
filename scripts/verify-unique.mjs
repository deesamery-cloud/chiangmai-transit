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
const net = async () => { const m = (await hud()).match(/NETWORK · (\d+)|เครือข่ายของคุณ · (\d+)/); return m ? +(m[1] || m[2]) : 0; };

await page.goto(URL, { waitUntil: "load", timeout: 45000 });
await page.waitForFunction(() => /Pick a goal to begin|เลือกเป้าหมาย/.test(document.body.innerText), { timeout: 45000 }).catch(() => {});

// #1 — Win the Cars: bar should be ~0% with no lines
await page.getByText(/Win the Cars/).click();
await page.waitForSelector("canvas", { timeout: 20000 });
await page.getByRole("button", { name: "1200×" }).click().catch(() => {});
await page.waitForTimeout(6000); // let the city wake up so the no-network baseline settles
const h0 = await hud();
const carsPct = (h0.match(/Win the Cars (\d+)%/) || [])[1];
console.log("CARS_BAR_at_0_lines", carsPct + "%", Number(carsPct) <= 5 ? "✓ ~0%" : "✗ should be near 0");
// #6 — rush indicator present
console.log("RUSH_BADGE", /🌅|☀️|🌙/.test(h0) ? "✓ shown" : "✗ missing");

const box = await page.evaluate(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const P = (fx) => [box.x + box.w * fx, box.y + box.h * 0.5];
const click = async (fx) => { const [x, y] = P(fx); await page.mouse.click(x, y); await page.waitForTimeout(180); };
// place 2 stations
await page.getByRole("button", { name: /วางสถานี/ }).click();
await click(0.42); await click(0.58);
await page.getByRole("button", { name: /วางราง/ }).click();
await page.waitForTimeout(200);

// #5 — press-drag through both stations should NOT auto-build
const [x1, y1] = P(0.42), [x2, y2] = P(0.58);
await page.mouse.move(x1, y1);
await page.mouse.down();
await page.mouse.move((x1 + x2) / 2, y1, { steps: 4 });
await page.mouse.move(x2, y2, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(500);
const afterDrag = await net();
console.log("DRAG_NO_AUTOBUILD", afterDrag === 0 ? "✓ drag chained, did NOT build" : `✗ built (${afterDrag}) on drag`);
// pressing Finish builds
await page.getByRole("button", { name: /Finish/ }).click();
await page.waitForTimeout(600);
const afterFinish = await net();
console.log("FINISH_BUILDS", afterFinish >= 1 ? "✓ Finish built the line" : "✗");

console.log("ERRORS", JSON.stringify(errors.slice(0, 8)));
await page.screenshot({ path: "/tmp/cm-unique.png" });
await browser.close();
