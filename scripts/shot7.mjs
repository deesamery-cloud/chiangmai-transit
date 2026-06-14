import { chromium } from "playwright-core";

const URL = process.argv[2] || "http://localhost:3100";
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
page.on("worker", (w) => {
  w.on("console", (m) => m.type() === "error" && errors.push("WORKER: " + m.text()));
});
const hud = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 520));

await page.goto(URL, { waitUntil: "load", timeout: 30000 });
await page.waitForTimeout(9000);
await page.screenshot({ path: "/tmp/cm-start.png" });
console.log("INITIAL_HUD " + JSON.stringify(await hud()));
console.log("INITIAL_ERRORS " + JSON.stringify(errors.slice(0, 12)));
try {
  await page.getByRole("button", { name: /Campaign/ }).click({ timeout: 4000 });
  await page.waitForTimeout(7000);
} catch {
  console.log("Campaign not clickable (data not loaded?)");
  console.log("LATER_ERRORS " + JSON.stringify(errors.slice(0, 12)));
  await browser.close();
  process.exit(0);
}
try {
  await page.getByRole("button", { name: "60×", exact: true }).click({ timeout: 4000 });
} catch {
  console.log("60x not clickable (not ready?)");
}

async function draw(modeChip, colorName, pts, shot) {
  await page.getByRole("button", { name: modeChip, exact: true }).first().click();
  await page.getByRole("button", { name: /Draw/ }).click();
  await page.waitForTimeout(400);
  if (shot) await page.screenshot({ path: shot }); // cyan buildable-roads + colour picker
  try {
    await page.getByTitle(colorName, { exact: true }).first().click({ timeout: 2500 });
  } catch {
    console.log("colour pick failed for " + colorName);
  }
  for (const [x, y] of pts) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(160);
  }
  await page.getByRole("button", { name: /Finish/ }).click();
  await page.waitForTimeout(700);
}

await draw("Metro", "Blue", [[470, 400], [640, 400], [810, 400]], "/tmp/cm-draw.png");
await draw("Metro", "Green", [[640, 300], [640, 400], [640, 500]], null);
await draw("Bus", "Orange", [[520, 330], [640, 400], [770, 480]], null);

// select the first line via its Your Lines row, recolour + add a train
try {
  await page.locator("button", { hasText: "km" }).first().click({ timeout: 3000 });
  await page.waitForTimeout(400);
  await page.getByTitle("Red", { exact: true }).first().click({ timeout: 2500 });
  await page.getByRole("button", { name: "+", exact: true }).first().click({ timeout: 2500 });
  console.log("selection + recolour + fleet+ OK");
} catch (e) {
  console.log("selection step failed: " + e.message.split("\n")[0]);
}
await page.waitForTimeout(8000);
await page.screenshot({ path: "/tmp/cm-metro2.png" });

console.log("ERRORS " + JSON.stringify(errors.slice(0, 20)));
console.log("HUD " + JSON.stringify(await hud()));
await browser.close();
