import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 });
await ctx.addInitScript(()=>{ localStorage.setItem("cm-onboarded","1"); localStorage.setItem("cm-cine-skip","1"); });
const page = await ctx.newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
const txt = () => page.evaluate(()=>document.body.innerText.replace(/\s+/g," "));

await page.goto(URL,{waitUntil:"load",timeout:60000}); await page.waitForTimeout(1000);
await page.getByText(/Grade A City|เมืองเกรด A/).first().click();
await page.getByRole("button",{name:/Start building|เริ่มสร้างเมือง/}).first().click();
await page.waitForTimeout(700);
// dismiss the appointment cutscene
const skip = page.getByRole("button",{name:/Skip ✕|ข้าม ✕/}); if(await skip.count()) await skip.first().click();
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(900);

const t0 = await txt();
// 1) exactly the 4 primary buttons present
const four = ["Speed","Metro","Songthaew","Pan"].filter(n=>new RegExp(n).test(t0));
console.log("[bar] 4 primary buttons:", four.join(", "), four.length===4?"✓":"⚠");
// 2) Density + Zen removed everywhere
console.log("[bar] Density removed:", /Density|ความหนาแน่น/.test(t0)?"✗ still present":"✓ gone");
console.log("[bar] Zen removed:", /🌿|Zen|เซน/.test(t0)?"✗ still present":"✓ gone");

// 3) Speed → gauge (range slider) 1–1000
await page.getByRole("button",{name:/Speed|ความเร็ว/}).first().click();
await page.waitForTimeout(400);
const range = page.locator('input[type=range]');
console.log("[speed] gauge slider appears:", await range.count()?"✓":"✗");
await range.first().fill("500");
await page.waitForTimeout(500);
const tSpeed = await txt();
console.log("[speed] slider sets speed to 500×:", /500×/.test(tSpeed)?"✓":"⚠ "+(tSpeed.match(/\d+×/g)||[]).join(","));

// 4) Metro → metro tools emerge
await page.getByRole("button",{name:/Metro|รถไฟฟ้า/}).first().click();
await page.waitForTimeout(400);
const tMetro = await txt();
console.log("[metro] tools emerge (Place/Connect/Demolish):", ["Place stations|วางสถานี","Connect stations|เชื่อมสถานี","Demolish|รื้อถอน"].every(r=>new RegExp(r).test(tMetro))?"✓":"⚠");

// 5) Songthaew → songthaew tools emerge
await page.getByRole("button",{name:/Songthaew|สองแถว/}).first().click();
await page.waitForTimeout(400);
const tSong = await txt();
console.log("[songthaew] tools emerge (Draw route + Demolish):", /Draw route|วาดเส้นทาง/.test(tSong) && /Demolish|รื้อถอน/.test(tSong)?"✓":"⚠");

// 6) Pan → activates, menus close
await page.getByRole("button",{name:/Pan|เลื่อนแผนที่/}).first().click();
await page.waitForTimeout(300);

// 7) People / Demand / Sound toggles now live under the advisors (bottom-right)
const tEnd = await txt();
console.log("[dock] People/Demand/Sound under advisors:", /People|ผู้คน/.test(tEnd) && /Demand|ความต้องการ/.test(tEnd)?"✓":"⚠");
// confirm they sit in the bottom-right (near the advisor faces), not the center bar
const ppos = await page.evaluate(()=>{
  const b=[...document.querySelectorAll("button")].find(x=>/People|ผู้คน/.test(x.textContent||""));
  if(!b) return null; const r=b.getBoundingClientRect();
  return { right: Math.round(window.innerWidth - r.right), bottom: Math.round(window.innerHeight - r.bottom) };
});
console.log("[dock] People toggle bottom-right:", ppos && ppos.right < 360 && ppos.bottom < 200 ? `✓ (${ppos.right}px right, ${ppos.bottom}px bottom)` : `⚠ ${JSON.stringify(ppos)}`);
await page.screenshot({path:"/tmp/bottombar.png"});

console.log("[done] CONSOLE ERRORS:", errs.length?JSON.stringify(errs.slice(0,5)):"none ✓");
await ctx.close();
await browser.close();
