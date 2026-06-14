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
const net = async () => { const m = (await hud()).match(/YOUR NETWORK · (\d+)/); return m ? +m[1] : 0; };

await page.goto(URL, { waitUntil: "load", timeout: 45000 });
await page.waitForFunction(() => document.body.innerText.includes("Choose a mode to begin"), { timeout: 45000 }).catch(() => {});
await page.getByText("Sandbox").click();
await page.waitForTimeout(3500);
const box = await page.evaluate(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const cy = box.y + box.h * 0.5;
const xs = [0.4, 0.5, 0.6, 0.7];
const px = (fx) => box.x + box.w * fx;

// 1) PLACE STATIONS — should create NO rail
await page.getByRole("button", { name: /วางสถานี/ }).click();
for (const fx of xs) { await page.mouse.click(px(fx), cy); await page.waitForTimeout(250); }
await page.screenshot({ path: "/tmp/cm-s1-stations.png" });
const afterPlace = await net();
console.log("AFTER_PLACE_lines", afterPlace, afterPlace === 0 ? "✓ no rail yet" : "✗ rail appeared early!");

// 2) LAY TRACK — connect the 4 stations, Finish builds the line
await page.getByRole("button", { name: /วางราง/ }).click();
await page.waitForTimeout(300);
for (const fx of xs) { await page.mouse.click(px(fx), cy); await page.waitForTimeout(300); }
await page.screenshot({ path: "/tmp/cm-s2-chain.png" });
await page.getByRole("button", { name: /Finish/ }).click();
await page.waitForTimeout(800);
const afterFinish = await net();
await page.getByRole("button", { name: "60×" }).click().catch(() => {});
await page.waitForTimeout(6000);
const h = await hud();
const onTransit = (h.match(/On transit ([\d,]+)/) || [])[1] || "?";
await page.screenshot({ path: "/tmp/cm-s3-built.png" });
console.log("AFTER_FINISH_lines", afterFinish, afterFinish >= 1 ? "✓ rail built on Finish" : "✗");
console.log("ON_TRANSIT", onTransit);

// 3) DEMOLISH the line (click between stations, away from any station)
await page.getByRole("button", { name: /รื้อถอน/ }).click();
await page.waitForTimeout(300);
let afterDemo = afterFinish;
// scan the safe corridor between stations (x mid-gaps are >430m from any station,
// so only the routed line — not a station — can be hit there)
outer: for (const fx of [0.45, 0.55, 0.65]) {
  for (let fy = 0.44; fy <= 0.56; fy += 0.01) {
    await page.mouse.click(px(fx), box.y + box.h * fy);
    await page.waitForTimeout(180);
    afterDemo = await net();
    if (afterDemo < afterFinish) break outer;
  }
}
console.log("AFTER_DEMOLISH_lines", afterDemo, afterDemo < afterFinish ? "✓ line removed" : "✗ not removed");

// 4) assert POI/OD UI gone
console.log("NO_MAP_LAYERS", !h.includes("MAP LAYERS"));
console.log("NO_TRIP_FLOWS", !h.includes("Trip flows") && !/home → work|work → home/.test(h));
console.log("NO_WHERE_TO_BUILD", !h.includes("WHERE TO BUILD"));
console.log("ERRORS", JSON.stringify(errors.slice(0, 12)));
await browser.close();
