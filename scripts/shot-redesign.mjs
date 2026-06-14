import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await page.goto(URL, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => /Pick a goal to begin|Loading Chiang Mai|เลือกเป้าหมาย|กำลังโหลด/.test(document.body.innerText), { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/cm-redesign-start.png" });
console.log("START shot done");

// start a Grade A game to see the in-game HUD
await page.getByText(/Grade A City|เมืองเกรด A/).click();
await page.waitForSelector("canvas", { timeout: 30000 });
await page.waitForTimeout(3500);
await page.screenshot({ path: "/tmp/cm-redesign-game.png" });
console.log("GAME shot done");

// place a couple stations + a line to show stations/HUD populated
console.log("ERRORS", JSON.stringify(errors.slice(0, 10)));
await browser.close();
