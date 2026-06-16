import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(()=>{ localStorage.setItem("cm-onboarded","1"); localStorage.setItem("cm-cine-skip","1"); });
const page = await ctx.newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
const txt = () => page.evaluate(()=>document.body.innerText.replace(/\s+/g," "));

await page.goto(URL,{waitUntil:"load",timeout:60000}); await page.waitForTimeout(1200);

// 1) RPG mode-select: path hero + start-from + difficulty deck + seed hidden
const t0 = await txt();
console.log("[start] RPG 'Choose your path' hero:", /Choose your path|เลือกเส้นทาง/.test(t0)?"✓":"✗");
console.log("[start] 4 goal tiles:", ["Win the Cars|เอาชนะรถยนต์","Transit Tycoon|เจ้าพ่อขนส่ง","Grade A City|เมืองเกรด A","Free Build|สร้างอิสระ"].every(r=>new RegExp(r).test(t0))?"✓":"✗");
console.log("[start] Start-from + Difficulty deck:", /Start from|เริ่มจาก/i.test(t0) && /Difficulty|ความยาก/i.test(t0)?"✓":"✗");
console.log("[start] existing-songthaew option:", /Existing songthaew|ระบบสองแถวที่มีอยู่/.test(t0)?"✓":"✗");
console.log("[start] seed/dice HIDDEN:", /🎲|re-roll|สุ่มใหม่|Seed|ซีด/.test(t0)?"✗ still shown":"✓ hidden");
// Start disabled until a goal is picked
const startBtn = page.getByRole("button",{name:/Begin your term|เริ่มวาระ|Pick a goal|เลือกเป้าหมาย/});
console.log("[start] Start disabled before goal:", await startBtn.first().isDisabled().catch(()=>null)===true?"✓":"⚠");

// 2) pick goal (Free Build — no win overlay) + "existing songthaew", then Start
await page.getByText(/Free Build|สร้างอิสระ/).first().click(); await page.waitForTimeout(200);
await page.getByText(/Existing songthaew|ระบบสองแถวที่มีอยู่/).first().click(); await page.waitForTimeout(200);
await page.getByRole("button",{name:/Begin your term|เริ่มวาระ/}).first().click(); await page.waitForTimeout(500);
const skip = page.getByRole("button",{name:/Skip intro ⏭|ข้ามฉาก ⏭/}); if(await skip.count()) await skip.first().click();
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(2500);

// 3) the real Chiang Mai songthaew network got seeded — YOUR-NETWORK header "· N"
const tGame = await txt();
const netCount = Number((tGame.match(/(?:YOUR NETWORK|เครือข่ายของคุณ)\s*·\s*(\d+)/)||[])[1] || 0);
console.log("[seed] existing songthaew network seeded:", netCount>0?`✓ (${netCount} lines in YOUR NETWORK)`:"✗ none");

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
