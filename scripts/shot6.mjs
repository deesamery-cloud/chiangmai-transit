import { chromium } from "playwright-core";

const URL = process.argv[2] || "http://localhost:3000";
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
const hud = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 620));

await page.goto(URL, { waitUntil: "load", timeout: 30000 });
await page.waitForTimeout(6000);

// mode select -> Campaign
await page.getByRole("button", { name: /Campaign/ }).click();
await page.waitForTimeout(3500);
await page.getByRole("button", { name: "300×", exact: true }).click();

const build = async (chip, pts) => {
  await page.getByRole("button", { name: chip, exact: true }).first().click();
  await page.getByRole("button", { name: /Draw/ }).click();
  await page.waitForTimeout(200);
  for (const [x, y] of pts) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(160);
  }
  await page.getByRole("button", { name: /Finish/ }).click();
  await page.waitForTimeout(700);
};

await build("Metro", [[470, 360], [640, 400], [800, 445]]);
await build("Bus", [[560, 470], [645, 400], [740, 355]]);
await build("Bus", [[470, 470], [640, 470], [820, 470]]);

await page.waitForTimeout(12000);
await page.screenshot({ path: "/tmp/cm-game.png" });
console.log("ERRORS " + JSON.stringify(errors.slice(0, 20)));
console.log("HUD " + JSON.stringify(await hud()));
await browser.close();
