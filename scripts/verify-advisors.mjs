import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });

const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 });
await ctx.addInitScript(()=>localStorage.setItem("cm-onboarded","1")); // silence the build coachmark — testing advisors
const page = await ctx.newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
const txt = () => page.evaluate(()=>document.body.innerText.replace(/\s+/g," "));

await page.goto(URL,{waitUntil:"load",timeout:60000}); await page.waitForTimeout(1200);

// 1) start a game → appointment cutscene appears (select goal, then Start)
await page.getByText(/Grade A City|เมืองเกรด A/).first().click();
await page.getByRole("button",{name:/Start building|เริ่มสร้างเมือง/}).first().click();
await page.waitForTimeout(900);
const t0 = await txt();
console.log("[intro] appointment cutscene:", /new Governor|ผู้ว่าราชการคนใหม่/.test(t0)?"✓ shown":"✗ MISSING");
console.log("[intro] goal echoed in cutscene:", /Your goal|เป้าหมายของท่าน/.test(t0)?"✓":"—");

// 2) step through the 4 advisors via Next, collecting names + checking each
//    advisor's portrait loaded as a real face (not the emoji fallback)
const names = new Set();
let introLoaded = 0;
for (let i=0;i<5;i++){
  const tt = await txt();
  for (const n of ["Ploy","Napha","Kanya","Mali"]) if (tt.includes(n)) names.add(n);
  const shown = await page.evaluate(()=>[...document.querySelectorAll('img[src*="/advisors/"]')].filter(i=>i.naturalWidth>0).length);
  introLoaded = Math.max(introLoaded, shown);
  const next = page.getByRole("button",{name:/Next →|ถัดไป →|Begin building|เริ่มสร้างเมือง/});
  if (await next.count()) { await next.first().click(); await page.waitForTimeout(450); }
}
console.log("[intro] advisor names met:", [...names].join(", "), names.size===4?"✓ all 4":"⚠ expected 4");
console.log("[intro] portrait loaded during cutscene:", introLoaded>0?"✓ real face":"⚠ fallback only");

// intro should now be closed (we clicked Begin building on the last step)
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(800);
const tAfter = await txt();
console.log("[intro] cutscene dismissed after Begin:", /new Governor|ผู้ว่าราชการคนใหม่/.test(tAfter)?"⚠ still up":"✓ closed");

// 4) persistent dock (bottom-right): all 4 faces visible at all times
const dockNames = ["Ploy","Napha","Kanya","Mali"].filter(n=>tAfter.includes(n));
console.log("[dock] all 4 advisor faces shown at all times:", dockNames.join(", "), dockNames.length===4?"✓":"✗");
const dockImgs = await page.evaluate(()=>[...document.querySelectorAll('img[src*="/advisors/"]')].filter(i=>i.naturalWidth>0).length);
console.log("[dock] portraits loaded in dock:", dockImgs, dockImgs===4?"✓ all 4 real faces":dockImgs>0?"⚠ some":"✗ none");
// dock sits in the bottom-right corner
const pos = await page.evaluate(()=>{
  const imgs=[...document.querySelectorAll('img[src*="/advisors/"]')]; if(!imgs.length) return null;
  const r=imgs[0].getBoundingClientRect();
  return { right: window.innerWidth - r.right, bottom: window.innerHeight - r.bottom };
});
console.log("[dock] anchored bottom-right:", pos && pos.right < 380 && pos.bottom < 220 ? `✓ (${Math.round(pos.right)}px from right, ${Math.round(pos.bottom)}px from bottom)` : `⚠ ${JSON.stringify(pos)}`);

// 5) click a face → that advisor's advice pops up
await page.getByRole("button",{name:/^Ploy/}).first().click();
await page.waitForTimeout(500);
const tPloy = await txt();
console.log("[click] Ploy's advice appears:", /metro trunk|รถไฟฟ้า|Coverage|ความครอบคลุม/.test(tPloy)?"✓ metrics-driven":"⚠");
await page.screenshot({path:"/tmp/advisors-dock.png"});

// 6) click another face → switches to that advisor (finance shows treasury)
await page.getByRole("button",{name:/^Kanya/}).first().click();
await page.waitForTimeout(500);
const tKanya = await txt();
console.log("[click] switches to Kanya (finance):", /Treasury|เงินคงคลัง|profit|loss|กำไร|ขาดทุน/.test(tKanya)?"✓":"⚠");

// 7) ✕ closes the popover; faces stay
await page.getByRole("button",{name:"✕"}).first().click().catch(()=>{});
await page.waitForTimeout(300);
const tClosed = await txt();
console.log("[click] popover closes, faces remain:", ["Ploy","Mali"].every(n=>tClosed.includes(n)) && !/Treasury|เงินคงคลัง/.test(tClosed)?"✓":"⚠");

console.log("[done] CONSOLE ERRORS:", errs.length?JSON.stringify(errs.slice(0,5)):"none ✓");
await ctx.close();
await browser.close();
