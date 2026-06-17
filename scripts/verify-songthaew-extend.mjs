// Verify a songthaew line can be EXTENDED (not just replaced by a new line).
import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 });
await ctx.addInitScript(()=>{ localStorage.setItem("cm-onboarded","1"); localStorage.setItem("cm-cine-skip","1"); });
const p = await ctx.newPage();
const errs=[]; p.on("pageerror",e=>errs.push(e.message)); p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
const txt = () => p.evaluate(()=>document.body.innerText.replace(/\s+/g," "));
const lineCount = () => p.evaluate(()=>+(document.body.innerText.match(/(?:YOUR NETWORK|เครือข่ายของคุณ) · (\d+)/)?.[1]||0));
const maxKm = async () => { const t = await txt(); const ms=[...t.matchAll(/(\d+\.\d+)\s*km/g)].map(m=>+m[1]); return ms.length?Math.max(...ms):0; };

await p.goto(URL,{waitUntil:"load",timeout:60000});
await p.waitForFunction(()=>/Pick a goal|เลือกเป้าหมาย|Begin your term|เริ่มวาระ/.test(document.body.innerText),{timeout:60000}).catch(()=>{});
await p.getByText(/Grade A City|เมืองเกรด A/).click().catch(()=>{});
await p.getByRole("button",{name:/Begin your term|เริ่มวาระ/}).first().click().catch(()=>{});
await p.waitForSelector("canvas",{timeout:30000}); await p.waitForTimeout(2200);
await p.getByRole("button",{name:/Skip intro|ข้ามฉาก/}).first().click().catch(()=>{});
await p.waitForTimeout(800);

// open songthaew menu + route tool, draw line 1
await p.getByRole("button",{name:/^.*Songthaew|สองแถว/}).first().click(); await p.waitForTimeout(300);
await p.getByRole("button",{name:/วาดเส้นทาง|Draw route/}).click();
for (const [x,y] of [[560,420],[640,415],[720,420],[800,430]]) { await p.mouse.click(x,y); await p.waitForTimeout(150); }
await p.getByRole("button",{name:/✓ Finish|Finish/}).first().click().catch(()=>{});
await p.waitForTimeout(2000);
const n1 = await lineCount(), km1 = await maxKm();
console.log(`after build : lines=${n1}  maxKm=${km1}`, n1===1?"✓ 1 line":"✗");

// extend: pick route tool again (line is auto-selected) and draw onward from the end
await p.getByRole("button",{name:/วาดเส้นทาง|Draw route/}).click(); await p.waitForTimeout(200);
const hint = await txt();
console.log("extend hint shown:", /extending selected line|ต่อสายที่เลือก/.test(hint) ? "✓" : "(selected-path hint not shown — using proximity)");
for (const [x,y] of [[800,430],[870,450],[940,470]]) { await p.mouse.click(x,y); await p.waitForTimeout(150); }
await p.getByRole("button",{name:/✓ Finish|Finish/}).first().click().catch(()=>{});
await p.waitForTimeout(2000);
const n2 = await lineCount(), km2 = await maxKm();
console.log(`after extend: lines=${n2}  maxKm=${km2}`);
console.log("LINE COUNT stayed 1 (extended, not new):", n2===1 ? "✓" : `✗ (${n2})`);
console.log("LINE got LONGER:", km2 > km1 ? `✓ (${km1}→${km2} km)` : `✗ (${km1}→${km2})`);
console.log("extend toast:", /extended|ต่อเส้นทางสองแถว/.test(await txt()) ? "✓" : "(toast gone)");
console.log("ERRORS:", errs.length?JSON.stringify(errs.slice(0,5)):"none ✓");
await p.screenshot({path:"/tmp/cm-st-extend.png"});
await b.close();
