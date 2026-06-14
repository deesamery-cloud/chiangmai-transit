import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 850 } })).newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
const body = async () => (await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ")));

await page.goto(URL, { waitUntil: "load", timeout: 45000 });
await page.waitForFunction(() => /Pick a goal to begin|เลือกเป้าหมาย/.test(document.body.innerText), { timeout: 45000 }).catch(() => {});

const b0 = await body();
// 4-tier selector: Easy / Medium / Challenge / Hard
const fourTiers = /Easy/.test(b0) && /Medium/.test(b0) && /Challenge/.test(b0) && /Hard/.test(b0);
console.log("SELECTOR_4TIERS", /Difficulty/.test(b0) && fourTiers ? "✓ Easy/Medium/Challenge/Hard" : "✗");
console.log("MEDIUM_grade_target", /≥ 72/.test(b0) ? "✓ ≥72" : "✗");

await page.getByRole("button", { name: /🟢 Easy/ }).click();
await page.waitForTimeout(250);
console.log("EASY_grade_target", /≥ 62/.test(await body()) ? "✓ ≥62" : "✗");

// NEW: Challenge tier — grade ≥ 76, bankruptcy ON but no deadline
await page.getByRole("button", { name: /🟠 Challenge/ }).click();
await page.waitForTimeout(250);
const bc = await body();
console.log("CHALLENGE_grade_target", /≥ 76/.test(bc) ? "✓ ≥76" : "✗");

await page.getByRole("button", { name: /🔴 Hard/ }).click();
await page.waitForTimeout(250);
const bh = await body();
console.log("HARD_grade_target", /≥ 80/.test(bh) ? "✓ ≥80 (was 82)" : "✗");

// switch to the Cars card to read its riders target for Hard (40k, was 45k)
console.log("HARD_cars_riders_shown", /40,000 riders/.test(bh) ? "✓ 40k (was 45k)" : "(not on cars card)");
await page.screenshot({ path: "/tmp/cm-diff-start.png" });

// start Hard + Grade A → budget = 80M × 0.65 = ฿52M, HUD shows 🔴 + /85 deadline
await page.getByText(/Grade A City|เมืองเกรด A/).click();
await page.waitForSelector("canvas", { timeout: 20000 });
await page.waitForTimeout(2500);
const game = await body();
const budget = (game.match(/฿([\d.]+)M/) || [])[1];
console.log("HARD_start_budget", "฿" + budget + "M", Math.abs(Number(budget) - 52) < 3 ? "✓ ~52M (80M×0.65)" : "✗ expected ~52M");
console.log("HARD_deadline_badge", /\/85/.test(game) ? "✓ /85 shown (was /60)" : "✗");
console.log("HARD_difficulty_icon", /🔴/.test(game) ? "✓ 🔴 in HUD" : "✗");
console.log("ERRORS", JSON.stringify(errors.slice(0, 8)));
await page.screenshot({ path: "/tmp/cm-diff-game.png" });
await browser.close();
