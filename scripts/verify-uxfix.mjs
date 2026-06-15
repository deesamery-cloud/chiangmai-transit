import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 });
await ctx.addInitScript(()=>localStorage.setItem("cm-onboarded","1"));
const page = await ctx.newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
const txt = () => page.evaluate(()=>document.body.innerText.replace(/\s+/g," "));
await page.goto(URL,{waitUntil:"load",timeout:60000});
await page.waitForTimeout(1200);
// detect current language from the toggle label
const lang0 = await page.evaluate(()=>document.body.innerText.includes("Choose your goal") ? "EN" : "TH");
console.log("DEFAULT LANG:", lang0);
await page.getByText(/Grade A City|เมืองเกรด A/).first().click();
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(1800);
const t1 = await txt();
console.log("BAHT GLYPH ฿ present:", t1.includes("฿") ? "✓" : "✗ (shows B?)", " 'B<num>M' leak:", /B\d+\.\d+M/.test(t1)?"⚠ yes":"no");
console.log("GOAL prefixed (Goal:/เป้า:):", /GOAL:|Goal:|เป้า:/i.test(t1) ? "✓" : "✗");
console.log("Header still bare 'GRADE A':", /\bGRADE A\b(?!.*Goal)/.test(t1) ? "⚠ maybe" : "ok");
// tool labels in current language
console.log("Tool 'Place stations' (EN):", t1.includes("Place stations")?"✓":"—", " 'Connect stations':", t1.includes("Connect stations")?"✓":"—");
console.log("Old 'Lay track' gone:", t1.includes("Lay track")?"⚠ still there":"✓");
// build-hint language: enter station tool
await page.getByRole("button",{name:/Place stations|วางสถานี/}).first().click();
await page.waitForTimeout(400);
const t2 = await txt();
console.log("Station hint localized (no raw Thai in EN):", lang0==="EN" ? (/Click streets to drop stations/.test(t2)?"✓ EN hint":"✗"): "n/a");
await page.screenshot({path:"/tmp/ux-hint.png"});
// toggle to the OTHER language, re-check tool labels localize
await page.getByRole("button",{name:/🌐/}).click().catch(()=>{});
await page.waitForTimeout(500);
const t3 = await txt();
console.log("After toggle — Thai tools present:", /เชื่อมสถานี|วางสถานี/.test(t3)?"✓":"—");
console.log("ERRORS:", JSON.stringify(errs.slice(0,5)));
await browser.close();
