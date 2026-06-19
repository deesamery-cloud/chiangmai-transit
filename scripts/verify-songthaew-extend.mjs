// Songthaew: (1) a line EXTENDS when you draw from its end; (2) drawing a new
// route elsewhere makes a SEPARATE line (does NOT merge into the selected one).
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
const maxKm = async () => { const t=await txt(); const ms=[...t.matchAll(/(\d+\.\d+)\s*km/g)].map(m=>+m[1]); return ms.length?Math.max(...ms):0; };
const drawRoute = async (pts) => {
  await p.getByRole("button",{name:/วาดเส้นทาง|Draw route/}).click(); await p.waitForTimeout(150);
  for (const [x,y] of pts) { await p.mouse.click(x,y); await p.waitForTimeout(140); }
  await p.getByRole("button",{name:/✓ Finish|Finish/}).first().click().catch(()=>{}); await p.waitForTimeout(1800);
};

await p.goto(URL,{waitUntil:"load",timeout:60000});
await p.waitForFunction(()=>/Pick a goal|เลือกเป้าหมาย|Begin your term|เริ่มวาระ/.test(document.body.innerText),{timeout:60000}).catch(()=>{});
await p.getByText(/Grade A City|เมืองเกรด A/).click().catch(()=>{});
await p.getByRole("button",{name:/Begin your term|เริ่มวาระ/}).first().click().catch(()=>{});
await p.waitForSelector("canvas",{timeout:30000}); await p.waitForTimeout(2000);
await p.getByRole("button",{name:/Skip intro|ข้ามฉาก/}).first().click().catch(()=>{});
await p.getByRole("button",{name:/^.*Songthaew|สองแถว/}).first().click(); await p.waitForTimeout(300);

// line 1
await drawRoute([[560,420],[640,415],[720,420],[800,430]]);
const n1 = await lineCount(), km1 = await maxKm();
console.log(`build line 1 : lines=${n1} maxKm=${km1}`, n1===1?"✓":"✗");

// EXTEND: draw from line 1's end (still auto-selected)
await drawRoute([[800,430],[870,450],[940,470]]);
const n2 = await lineCount(), km2 = await maxKm();
console.log(`extend (from end): lines=${n2} maxKm=${km2}`, (n2===1 && km2>km1)?`✓ still 1, longer (${km1}→${km2})`:`✗`);

// NEW LINE elsewhere while the line is still selected — must NOT merge
await drawRoute([[520,250],[640,250],[760,250]]);
const n3 = await lineCount();
console.log(`new line elsewhere: lines=${n3}`, n3===2?"✓ separate line (no merge)":`✗ (${n3}) — merged or failed`);

console.log("ERRORS:", errs.length?JSON.stringify(errs.slice(0,5)):"none ✓");
await p.screenshot({path:"/tmp/cm-st-extend.png"});
await b.close();
