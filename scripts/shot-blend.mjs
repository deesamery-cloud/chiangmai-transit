import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { localStorage.setItem("cm-onboarded","1"); });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await page.goto(URL, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => /Pick a goal to begin|เลือกเป้าหมาย/.test(document.body.innerText), { timeout: 60000 }).catch(()=>{});
await page.getByText(/Grade A City|เมืองเกรด A/).click();
await page.waitForSelector("canvas", { timeout: 30000 });
await page.waitForTimeout(2500);

await page.getByRole("button", { name: /วางสถานี/ }).click();
const pts = [[600,360],[700,390],[770,450],[680,470],[590,440],[640,520]];
for (const [x,y] of pts) { await page.mouse.click(x,y); await page.waitForTimeout(180); }
await page.waitForTimeout(400);
await page.screenshot({ path: "/tmp/cm-blend-stations.png" });

await page.getByRole("button", { name: /วางราง/ }).click();
for (const [x,y] of pts) { await page.mouse.click(x,y); await page.waitForTimeout(160); }
const fin = page.getByRole("button", { name: /Finish/ });
if (await fin.isEnabled().catch(()=>false)) await fin.click();
await page.waitForTimeout(2500);
await page.getByRole("button", { name: /เลื่อนแผนที่/ }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: "/tmp/cm-blend-line.png" });
console.log("stations:", await page.evaluate(()=>document.body.innerText.match(/(\d+) สถานี/)?.[0]||"?"));
console.log("lines:", await page.evaluate(()=>document.body.innerText.match(/เครือข่ายของคุณ · (\d+)|YOUR NETWORK · (\d+)/)?.[0]||"0"));
console.log("ERRORS", JSON.stringify(errors.slice(0,8)));
await browser.close();
