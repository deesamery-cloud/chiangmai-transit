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
await page.getByText(/Grade A City|เมืองเกรด A/).first().click();
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(1600);
console.log("Breakdown hidden before line:", /Biggest gain|เพิ่มคะแนน/.test(await txt())?"⚠ shown":"✓ hidden (cold state)");
// build a metro line
await page.getByRole("button",{name:/Place stations|วางสถานี/}).first().click();
const pts=[[520,430],[660,420],[800,440],[920,430]];
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(150);}
await page.getByRole("button",{name:/Connect stations|เชื่อมสถานี/}).first().click();
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(140);}
const fin=page.getByRole("button",{name:/✓ Finish|✓ เสร็จ/}); if(await fin.count() && await fin.first().isEnabled().catch(()=>false))await fin.first().click();
await page.waitForTimeout(2000);
const t1 = await txt();
console.log("Breakdown shows after line:", /Biggest gain|เพิ่มคะแนน/.test(t1)?"✓":"✗");
console.log("Component labels present:", ["Demand served","Coverage","Traffic relief"].filter(l=>t1.includes(l)).join(" · ") || "✗ none");
console.log("Weights ·68 ·18 ·14:", ["·68","·18","·14"].every(w=>t1.includes(w))?"✓":"⚠ "+["·68","·18","·14"].filter(w=>t1.includes(w)).join(","));
console.log("Glow-pulse class on crowded add btn:", await page.evaluate(()=>!!document.querySelector(".cm-glow-pulse"))?"present(if crowded)":"absent(not crowded yet)");
await page.screenshot({path:"/tmp/ux-breakdown.png"});
console.log("ERRORS:", JSON.stringify(errs.slice(0,5)));
await browser.close();
