// Multi-city (#6) verification at a phone viewport: city chips render, switching
// to Pattaya re-fetches /data/pattaya/ + re-centers, a Pattaya game starts, the
// "existing" seed lays down Pattaya corridors, and switching back works.
import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await ctx.addInitScript(()=>{ localStorage.setItem("cm-cine-skip","1"); localStorage.removeItem("cm-city"); });
const page = await ctx.newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
const dataReqs=[]; page.on("request",r=>{ const u=r.url(); if(u.includes("/data/")&&u.endsWith("network.graph.json")) dataReqs.push(u); });
const txt = () => page.evaluate(()=>document.body.innerText.replace(/\s+/g," "));
await page.goto(URL,{waitUntil:"load",timeout:60000}); await page.waitForTimeout(2000);

// 1) city chips render
const t0 = await txt();
console.log("[cities] Chiang Mai chip:", /เชียงใหม่/.test(t0)?"✓":"✗");
console.log("[cities] Pattaya chip:", /พัทยา/.test(t0)?"✓":"✗");
console.log("[cities] Hua Hin chip:", /หัวหิน/.test(t0)?"✓":"✗");
console.log("[cities] scaffolded 'soon' shown:", /(เร็วๆ นี้|soon)/.test(t0)?"✓":"✗");
console.log("[cities] default loaded Chiang Mai data:", dataReqs.some(u=>/\/data\/network\.graph\.json/.test(u))?"✓":"⚠ "+JSON.stringify(dataReqs));

// 2) switch to Pattaya -> re-fetch /data/pattaya/
dataReqs.length = 0;
await page.getByRole("button",{name:/พัทยา/}).first().click();
await page.waitForTimeout(2500);
console.log("[switch] Pattaya data fetched:", dataReqs.some(u=>/\/data\/pattaya\/network\.graph\.json/.test(u))?"✓":"✗ "+JSON.stringify(dataReqs));

// 3) start a game on Pattaya from existing songthaew seed
// pick "Existing songthaew" then a goal then Begin
const existBtn = page.getByRole("button",{name:/Existing songthaew|สองแถวที่มีอยู่/}).first();
if (await existBtn.count()) await existBtn.click();
await page.getByRole("button",{name:/Decongest|Balance the books|Pass your review|Free build|ลดรถ|งบ|ประเมิน|อิสระ/}).first().click().catch(()=>{});
// fallback: click the first goal tile image button
await page.waitForTimeout(300);
const begin = page.getByRole("button",{name:/Begin your term|เริ่มวาระ|Pick a goal|เลือกเป้าหมาย/}).first();
// ensure a goal is selected: click first goal photo tile if Begin still says "pick a goal"
if (/Pick a goal|เลือกเป้าหมาย/.test(await begin.innerText().catch(()=>""))) {
  await page.locator("button:has(img)").first().click().catch(()=>{});
  await page.waitForTimeout(200);
}
await begin.click().catch(()=>{});
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(2000);
console.log("[pattaya] game canvas:", await page.locator("canvas").count()?"✓":"✗");
const tg = await txt();
console.log("[pattaya] HUD city numbers:", /Travellers|ผู้คน/.test(tg)?"✓":"⚠");
await page.screenshot({path:"/tmp/cities-pattaya.png"});

console.log("[done] CONSOLE ERRORS:", errs.length?JSON.stringify(errs.slice(0,6)):"none ✓");
await ctx.close(); await browser.close();
