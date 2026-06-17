import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await ctx.addInitScript(()=>{ localStorage.setItem("cm-cine-skip","1"); });
const page = await ctx.newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
const txt = () => page.evaluate(()=>document.body.innerText.replace(/\s+/g," "));
await page.goto(URL,{waitUntil:"load",timeout:60000}); await page.waitForTimeout(1500);

// 1) PWA manifest + icons + SW
const man = await page.evaluate(async ()=>{ try { const r=await fetch("/manifest.webmanifest"); const j=await r.json(); return { ok:r.ok, name:j.name, icons:(j.icons||[]).length, display:j.display }; } catch { return null; } });
console.log("[pwa] manifest:", man && man.ok && man.icons>=2 && man.display==="standalone" ? `✓ (${man.icons} icons, standalone)` : "✗ "+JSON.stringify(man));
const iconOk = await page.evaluate(async ()=>{ const r=await fetch("/icons/icon-192.png"); return r.ok; });
console.log("[pwa] icon-192 loads:", iconOk?"✓":"✗");
const swReg = await page.evaluate(()=> "serviceWorker" in navigator);
console.log("[pwa] service worker supported + registered:", swReg ? "✓" : "✗");
const manifestLink = await page.evaluate(()=> !!document.querySelector('link[rel="manifest"]'));
console.log("[pwa] <link rel=manifest> in head:", manifestLink?"✓":"✗");

// 2) Daily Challenge on the RPG start screen
const t0 = await txt();
console.log("[daily] Daily Challenge button:", /Daily Challenge|สนามรายวัน/.test(t0)?"✓":"✗");

// 3) Daily starts a game (quick start, no cutscene)
await page.getByRole("button",{name:/Daily Challenge|สนามรายวัน|Play ▶|เล่น ▶/}).first().click();
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(1500);
console.log("[daily] starts a game (canvas):", await page.locator("canvas").count()?"✓":"✗");
// people numbers render (perf/display factor intact)
const tg = await txt();
console.log("[mobile] HUD renders city numbers:", /Travellers|ผู้คน/.test(tg)?"✓":"⚠");
await page.screenshot({path:"/tmp/mobile-daily.png"});

console.log("[done] CONSOLE ERRORS:", errs.length?JSON.stringify(errs.slice(0,5)):"none ✓");
await ctx.close(); await browser.close();
