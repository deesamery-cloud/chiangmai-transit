import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--no-sandbox"]
});

const ctx = await browser.newContext({
  viewport: { width: 1366, height: 850 },
});

// Skip onboarding
await ctx.addInitScript(() => localStorage.setItem("cm-onboarded", "1"));

const page = await ctx.newPage();
const errs = [];
page.on("pageerror", e => errs.push(e.message));

console.log("Loading game...");
await page.goto(URL, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1000);

// Screenshot 1: Start screen
await page.screenshot({ path: "/tmp/00-start.png" });
console.log("✓ Start screen captured");

// Start a game with Grade A goal
console.log("Starting Grade A game...");
const startBtn = await page.locator("button").filter({ hasText: /Grade|เกรด/ }).first();
if (startBtn) {
  await startBtn.click();
  await page.waitForTimeout(1000);
}

await page.waitForSelector("canvas", { timeout: 30000 });
await page.waitForTimeout(1000);

// Screenshot 2: Game loaded
await page.screenshot({ path: "/tmp/01-clean-map.png" });
console.log("✓ Game loaded");

// Get text content to understand UI
const text = await page.evaluate(() => document.body.innerText);
const hasMetro = text.includes("Metro") || text.includes("🚆");
const hasSong = text.includes("Songthaew") || text.includes("🛻");

console.log("Has Metro button:", hasMetro);
console.log("Has Songthaew button:", hasSong);

if (hasMetro) {
  const metroBtn = await page.locator("button").filter({ hasText: /Metro|🚆/ }).first();
  if (metroBtn && await metroBtn.isVisible()) {
    await metroBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "/tmp/02-metro-tool.png" });
    console.log("✓ Metro tool selected");
  }
}

if (hasSong) {
  const songBtn = await page.locator("button").filter({ hasText: /Songthaew|🛻|วาด/ }).first();
  if (songBtn && await songBtn.isVisible()) {
    await songBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "/tmp/03-songthaew-tool.png" });
    console.log("✓ Songthaew tool selected");
  }
}

await page.screenshot({ path: "/tmp/04-final.png" });
console.log("✓ Final screenshot captured");
console.log("Errors:", errs.length ? errs.slice(0, 2) : "none");

await browser.close();
console.log("Done");
