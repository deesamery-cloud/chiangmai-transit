import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
const hud = async () => (await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ")));
const net = async () => { const m = (await hud()).match(/· (\d+) (?:[฀-๿]|clear|YOUR)/) || (await hud()).match(/NETWORK · (\d+)|เครือข่ายของคุณ · (\d+)/); return m ? +(m[1] || m[2]) : 0; };

await page.goto(URL, { waitUntil: "load", timeout: 45000 });
await page.waitForFunction(() => /Pick a goal to begin|เลือกเป้าหมาย/.test(document.body.innerText), { timeout: 45000 }).catch(() => {});

// #4 language toggle
const start0 = await hud();
await page.locator(`button:has-text("🌐")`).first().click();
await page.waitForTimeout(400);
const startTh = await hud();
console.log("LANG_TOGGLE", startTh.includes("เอาชนะรถยนต์") || startTh.includes("เลือกเป้าหมาย") ? "✓ Thai shown" : "✗");
await page.locator(`button:has-text("🌐")`).first().click(); // back to EN
await page.screenshot({ path: "/tmp/cm-fix-start.png" });

// start Grade A
await page.getByText(/Grade A City|เมืองเกรด A/).click();
await page.waitForSelector("canvas", { timeout: 20000 });
await page.waitForTimeout(2500);
const h1 = await hud();
console.log("COACH_SHOWN", /Place stations|วางสถานี/.test(h1) && /Step 1\/3|ขั้นที่ 1/.test(h1) ? "✓" : "✗");

// #1 track tool gated before 2 stations
const trackBtn = page.getByRole("button", { name: /วางราง/ });
console.log("TRACK_GATED_initially", (await trackBtn.isDisabled()) ? "✓ disabled" : "✗ enabled");

const box = await page.evaluate(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const click = async (fx, fy) => { await page.mouse.click(box.x + box.w * fx, box.y + box.h * fy); await page.waitForTimeout(180); };
// place 2 stations
await page.getByRole("button", { name: /วางสถานี/ }).click();
await click(0.42, 0.5); await click(0.58, 0.5);
console.log("TRACK_ENABLED_after2", (await trackBtn.isDisabled()) ? "✗ still disabled" : "✓ enabled");
// build line
await trackBtn.click(); await page.waitForTimeout(150);
await click(0.42, 0.5); await click(0.58, 0.5);
await page.getByRole("button", { name: /Finish/ }).click();
await page.waitForTimeout(700);
const built = await net();
console.log("BUILD", built >= 1 ? "✓ line built" : "✗");
const h2 = await hud();
console.log("COACH_ADVANCED", /first line|เส้นทางแรก/.test(h2) ? "✓ step3" : "(maybe dismissed)");

// #2 undo: undo button enabled; demolish a station then Ctrl+Z
const undoBtn = page.getByRole("button", { name: "↶", exact: true });
console.log("UNDO_ENABLED_after_build", (await undoBtn.isDisabled()) ? "✗" : "✓");
await page.getByRole("button", { name: /รื้อถอน/ }).click();
await click(0.42, 0.5); // remove an endpoint station
await page.waitForTimeout(400);
await page.keyboard.press("Control+z");
await page.waitForTimeout(500);
console.log("UNDO_RAN", errors.length === 0 ? "✓ no error" : "✗ errored");

// #3 save/resume: reload, expect Resume button
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => /Pick a goal to begin|เลือกเป้าหมาย/.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(800);
const reloaded = await hud();
console.log("RESUME_AVAILABLE", /Resume last build|เล่นต่อ/.test(reloaded) ? "✓" : "✗");

console.log("ERRORS", JSON.stringify(errors.slice(0, 10)));
await page.screenshot({ path: "/tmp/cm-fix-reload.png" });
await browser.close();
