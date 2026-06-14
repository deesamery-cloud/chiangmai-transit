import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox"] });
const dir = "/Users/deesameryimprasit/Desktop/chiangmai-transit/design-system";
const files = ["patterns/start-screen.html","patterns/hud.html","foundations/colors.html"];
const page = await (await browser.newContext({ viewport: { width: 720, height: 560 }, deviceScaleFactor: 2 })).newPage();
const outs = [];
for (const f of files) {
  await page.goto("file://" + dir + "/" + f, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(800);
  const out = "/tmp/card-" + f.replace(/\//g,"-").replace(".html","") + ".png";
  await page.screenshot({ path: out });
  outs.push(out);
}
await browser.close();
console.log(outs.join("\n"));
