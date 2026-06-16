import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 });
// the cinematic plays EVERY entry now (no cm-cine-skip set) → should auto-play
const page = await ctx.newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
const txt = () => page.evaluate(()=>document.body.innerText.replace(/\s+/g," "));

await page.goto(URL,{waitUntil:"load",timeout:60000}); await page.waitForTimeout(1500);

// 1) cinematic auto-plays on first open
const t0 = await txt();
console.log("[cine] auto-plays on first open:", /new Governor|ผู้ว่าราชการ|Chiang Mai —|เชียงใหม่ —|Skip ⏭|ข้าม/.test(t0)?"✓":"✗ MISSING");
// scene image loaded (real generated art)
const imgOk = await page.evaluate(()=>[...document.querySelectorAll('img[src*="/cinematic/"]')].some(i=>i.naturalWidth>0));
console.log("[cine] scene image loaded (real art):", imgOk?"✓":"⚠ fallback gradient");
await page.screenshot({path:"/tmp/cine-scene1.png"});

// 2) click advances scenes → reach the title card with Begin (5 clicks: scene 0→5)
for (let k=0;k<5;k++){ await page.mouse.click(683,300); await page.waitForTimeout(500); }
const tEnd = await txt();
const hasBegin = /Begin your term|เริ่มวาระ/.test(tEnd);
console.log("[cine] reaches title card + Begin:", hasBegin?"✓":"⚠");
await page.screenshot({path:"/tmp/cine-title.png"});

// 3) Begin → cinematic closes, start screen (goal wizard) shows
if (hasBegin) await page.getByRole("button",{name:/Begin your term|เริ่มวาระ/}).first().click();
await page.waitForTimeout(900);
const tStart = await txt();
console.log("[cine] Begin → start screen shows:", /Choose your path|เลือกเส้นทาง|Win the Cars|เอาชนะรถยนต์/.test(tStart)?"✓":"⚠");
console.log("[cine] cinematic dismissed:", /Skip ⏭|ข้าม ⏭/.test(tStart)?"⚠ still up":"✓ closed");

// 4) reload → cinematic AUTO-PLAYS AGAIN every entry (user wants it every time)
await page.reload({waitUntil:"load"}); await page.waitForTimeout(1500);
const tReload = await txt();
console.log("[cine] auto-plays AGAIN on reload (every entry):", /Skip ⏭|ข้าม ⏭/.test(tReload)?"✓ replays":"✗ did not replay");
// Skip ⏭ works → jumps straight to the start screen
await page.getByRole("button",{name:/Skip ⏭|ข้าม ⏭/}).first().click(); await page.waitForTimeout(700);
const tSkip = await txt();
console.log("[cine] Skip ⏭ → start screen:", /Choose your path|เลือกเส้นทาง|Win the Cars|เอาชนะรถยนต์/.test(tSkip) && !/Skip ⏭|ข้าม ⏭/.test(tSkip)?"✓":"⚠");

console.log("[done] CONSOLE ERRORS:", errs.length?JSON.stringify(errs.slice(0,5)):"none ✓");
await ctx.close();
await browser.close();
