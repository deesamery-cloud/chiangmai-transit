import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 800, height: 360 }, deviceScaleFactor: 2 })).newPage();
await page.goto("file:///Users/deesameryimprasit/Desktop/chiangmai-transit/design-system/components/train-crowding.html",{waitUntil:"networkidle",timeout:20000});
await page.waitForTimeout(700);
await page.screenshot({ path: "/tmp/cm-train-card.png" });
await browser.close();
console.log("done");
