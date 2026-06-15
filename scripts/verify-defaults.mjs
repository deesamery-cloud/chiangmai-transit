import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 });
await ctx.addInitScript(()=>localStorage.setItem("cm-onboarded","1"));
const page = await ctx.newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
await page.goto(URL,{waitUntil:"load",timeout:60000}); await page.waitForTimeout(1200);
await page.getByText(/Grade A City|เมืองเกรด A/).first().click();
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(2000);
const st = await page.evaluate(()=>{
  const segOn = [...document.querySelectorAll(".seg-on")].map(b=>b.textContent.trim());
  const vOn = [...document.querySelectorAll(".vtoggle-on")].map(b=>b.textContent.trim());
  const odPanel = !!document.body.innerText.match(/Travel demand|ความต้องการเดินทาง/);
  return { segOn, vOn, odPanel };
});
console.log("speed segment selected:", st.segOn.find(s=>/×/.test(s)) ?? "?", st.segOn.find(s=>/^1×/.test(s))?"→ 1× ✓":"→ ✗ not 1×");
console.log("view toggles ON at start:", JSON.stringify(st.vOn), st.vOn.length===0?"(none = People+Demand+Density all OFF ✓)":"");
console.log("OD/Demand panel visible:", st.odPanel?"⚠ shown":"✓ hidden");
// sim is at 1× → after ~2s the clock should barely move (a few sim-minutes), not hours
const c1 = await page.evaluate(()=>document.body.innerText.match(/\b(\d{1,2}:\d{2})\b/)?.[1]);
await page.waitForTimeout(2500);
const c2 = await page.evaluate(()=>document.body.innerText.match(/\b(\d{1,2}:\d{2})\b/)?.[1]);
console.log("clock after ~2.5s @1×:", c1, "→", c2, "(should advance only a little, not fly)");
await page.screenshot({path:"/tmp/ux-defaults.png"});
console.log("ERRORS:", JSON.stringify(errs.slice(0,5)));
await browser.close();
