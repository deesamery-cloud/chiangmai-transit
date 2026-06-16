import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 } });
await ctx.addInitScript(() => { localStorage.setItem("cm-onboarded","1"); localStorage.setItem("cm-cine-skip","1"); });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
const body = async () => (await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ")));

await page.goto(URL, { waitUntil: "load", timeout: 45000 });
await page.waitForFunction(() => /Difficulty/i.test(document.body.innerText), { timeout: 45000 }).catch(() => {});

// 4 difficulty chips present
const b0 = await body();
const fourTiers = ["Easy","Medium","Challenge","Hard"].every((n) => new RegExp(n).test(b0));
console.log("SELECTOR_4TIERS", fourTiers ? "✓ Easy/Medium/Challenge/Hard" : "✗");

// select the Grade A goal so its target shows in the hero, then read per-difficulty target
await page.getByText(/Grade A City|เมืองเกรด A/).first().click(); await page.waitForTimeout(250);
const target = async (re, label) => {
  await page.getByRole("button", { name: re }).first().click();
  await page.waitForTimeout(250);
  return await body();
};
console.log("EASY_grade_target", /≥ 62/.test(await target(/🟢 Easy|Easy/)) ? "✓ ≥62" : "✗");
console.log("MEDIUM_grade_target", /≥ 72/.test(await target(/🟡 Medium|Medium/)) ? "✓ ≥72" : "✗");
console.log("CHALLENGE_grade_target", /≥ 76/.test(await target(/🟠 Challenge|Challenge/)) ? "✓ ≥76" : "✗");
const bh = await target(/🔴 Hard|Hard/);
console.log("HARD_grade_target", /≥ 80/.test(bh) ? "✓ ≥80" : "✗");

// start Hard + Grade A → budget ≈ ฿52M (80M×0.65), HUD shows 🔴 + /85 deadline
await page.getByRole("button", { name: /Begin your term|เริ่มวาระ/ }).first().click();
const sk = page.getByRole("button", { name: /Skip intro ⏭|ข้ามฉาก ⏭/ }); if (await sk.count()) await sk.first().click();
await page.waitForSelector("canvas", { timeout: 20000 });
await page.waitForTimeout(2500);
const game = await body();
const budget = (game.match(/฿([\d.]+)M/) || [])[1];
console.log("HARD_start_budget", "฿" + budget + "M", Math.abs(Number(budget) - 52) < 4 ? "✓ ~52M (80M×0.65)" : "✗ expected ~52M");
console.log("HARD_deadline_badge", /\/85/.test(game) ? "✓ /85 shown" : "✗");
console.log("HARD_difficulty_icon", /🔴/.test(game) ? "✓ 🔴 in HUD" : "✗");
console.log("ERRORS", errors.length ? JSON.stringify(errors.slice(0, 6)) : "none ✓");
await browser.close();
