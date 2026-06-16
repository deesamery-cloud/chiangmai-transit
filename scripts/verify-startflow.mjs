import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(()=>localStorage.setItem("cm-onboarded","1"));
const page = await ctx.newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
const txt = () => page.evaluate(()=>document.body.innerText.replace(/\s+/g," "));

await page.goto(URL,{waitUntil:"load",timeout:60000}); await page.waitForTimeout(1200);

// 1) start screen: 3 steps in order + seed/dice hidden
const t0 = await txt();
console.log("[start] step 1·Goal:", /1 · Goal|1 · เป้าหมาย/.test(t0)?"✓":"✗");
console.log("[start] step 2·Start from:", /2 · Start from|2 · เริ่มจาก/.test(t0)?"✓":"✗");
console.log("[start] step 3·Difficulty:", /3 · Difficulty|3 · ระดับความยาก/.test(t0)?"✓":"✗");
console.log("[start] existing-songthaew option:", /Existing songthaew|ระบบสองแถวที่มีอยู่/.test(t0)?"✓":"✗");
console.log("[start] seed/dice HIDDEN:", /🎲|re-roll|สุ่มใหม่|Seed|ซีด/.test(t0)?"✗ still shown":"✓ hidden");
// Start disabled until a goal is picked
const startBtn = page.getByRole("button",{name:/Start building|เริ่มสร้างเมือง|Pick a goal first|เลือกเป้าหมายก่อน/});
console.log("[start] Start disabled before goal:", await startBtn.first().isDisabled().catch(()=>null)===true?"✓":"⚠");

// 2) pick goal (Free Build — no win overlay) + "existing songthaew", then Start
await page.getByText(/Free Build|สร้างอิสระ/).first().click(); await page.waitForTimeout(200);
await page.getByText(/Existing songthaew|ระบบสองแถวที่มีอยู่/).first().click(); await page.waitForTimeout(200);
await page.getByRole("button",{name:/Start building|เริ่มสร้างเมือง/}).first().click(); await page.waitForTimeout(500);
const skip = page.getByRole("button",{name:/Skip ✕|ข้าม ✕/}); if(await skip.count()) await skip.first().click();
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(2500);

// 3) the real Chiang Mai songthaew network got seeded (lines now exist → 🛻 rows)
const tGame = await txt();
const songRows = (tGame.match(/🛻/g)||[]).length;
console.log("[seed] existing songthaew network seeded:", songRows>0?`✓ (${songRows} 🛻 markers in HUD)`:"✗ none");

// challenge: the existing songthaew net must NOT start at Grade A (it's a feeder)
const cityScore = Number((tGame.match(/(\d+)\s*\/\s*100/)||[])[1] || 0);
console.log("[challenge] existing-songthaew start score:", cityScore, cityScore>0 && cityScore<82 ? `✓ not an A (challenging)` : "⚠ too high / unread");

// 4) songthaew station-build is back: Songthaew menu has Place + Connect stations
// (target the primary bottom-bar button by title — per-line rows also say "Songthaew")
await page.getByTitle(/road-bound feeders|วิ่งบนถนน/).first().click(); await page.waitForTimeout(500);
const tSong = await txt();
console.log("[songthaew] station-build restored (Place + Connect):", /Place stations|วางสถานี/.test(tSong) && /Connect stations|เชื่อมสถานี/.test(tSong)?"✓":"⚠");

// 5) build-window coverage note shows when placing stations
await page.getByRole("button",{name:/Place stations|วางสถานี/}).first().click(); await page.waitForTimeout(500);
const tNote = await txt();
// songthaew note says "local hail (~200 m)"; metro says "walk-shed (~800 m)"
console.log("[note] coverage note in build window:", /Toggle 📐 Coverage|เปิด 📐 ความครอบคลุม|local hail|ละแวกเล็ก|walk-shed|รัศมีเดิน/.test(tNote)?"✓":"⚠");

// 6) Coverage toggle present under the advisors + togglable (heavy render last)
const cov = page.getByRole("button",{name:/Coverage|ครอบคลุม/});
console.log("[coverage] 📐 Coverage toggle under team:", await cov.count()?"✓":"✗");
await cov.first().click(); await page.waitForTimeout(700);
console.log("[coverage] toggles on (aria-pressed):", await cov.first().getAttribute("aria-pressed")==="true"?"✓":"⚠");
await page.screenshot({path:"/tmp/coverage.png"});

console.log("[done] CONSOLE ERRORS:", errs.length?JSON.stringify(errs.slice(0,5)):"none ✓");
await ctx.close();
await browser.close();
