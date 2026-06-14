import { chromium } from "playwright-core";

const URL = "http://localhost:3000";
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

await page.goto(URL, { waitUntil: "load", timeout: 30000 });
await page.waitForTimeout(6000); // worker init + data + first agents

// speed up so lots of agents are active, then snapshot the walking city
await page.click("text=60×");
await page.waitForTimeout(5000);
await page.screenshot({ path: "/tmp/cm-walk.png" });
const hud1 = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 320));

// draw a bus line: click Draw, place stops along an east-west corridor, Finish
await page.click("text=Draw bus line");
await page.waitForTimeout(400);
const pts = [
  [330, 430],
  [520, 415],
  [710, 415],
  [905, 430],
];
for (const [x, y] of pts) {
  await page.mouse.click(x, y);
  await page.waitForTimeout(250);
}
const placed = await page.evaluate(() => document.body.innerText.match(/(\d+) placed/)?.[1] ?? "0");
await page.click("text=Finish line");
await page.waitForTimeout(7000); // let buses run and pick up riders
await page.screenshot({ path: "/tmp/cm-bus.png" });
const hud2 = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 320));

console.log("ERRORS " + JSON.stringify(errors.slice(0, 20)));
console.log("PLACED " + placed);
console.log("HUD_WALK " + JSON.stringify(hud1));
console.log("HUD_BUS " + JSON.stringify(hud2));
await browser.close();
