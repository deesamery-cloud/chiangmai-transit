import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });

// ── DESKTOP ───────────────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(()=>localStorage.setItem("cm-onboarded","1"));
  const page = await ctx.newPage();
  const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
  const txt = () => page.evaluate(()=>document.body.innerText.replace(/\s+/g," "));
  await page.goto(URL,{waitUntil:"load",timeout:60000}); await page.waitForTimeout(1200);
  await page.getByText(/Grade A City|เมืองเกรด A/).first().click();
  await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(1600);
  // signifier grammars present
  const counts = await page.evaluate(()=>({
    segmented: document.querySelectorAll(".segmented").length,
    segOn: document.querySelectorAll(".seg-on").length,
    vtoggle: document.querySelectorAll(".vtoggle").length,
    vtoggleOn: document.querySelectorAll(".vtoggle-on").length,
    goldActive: document.querySelectorAll(".btn-active").length, // should be 0 now (gold reserved for tool inline)
  }));
  console.log("[desktop] segmented controls:", counts.segmented, "(speed+mode=2)", "· seg-on:", counts.segOn);
  console.log("[desktop] vtoggle switches:", counts.vtoggle, "· on:", counts.vtoggleOn, "· stray .btn-active:", counts.goldActive);
  const t0 = await txt();
  console.log("[desktop] COLD: OD 'Start here':", /Start here|เริ่มจากตรงนี้/.test(t0)?"✓":"✗", "· waiting row hidden:", /min wait|นาทีรอ/.test(t0)?"⚠ shown":"✓ hidden", "· cold CTA:", /Place stations, then connect|วางสถานี แล้วเชื่อม/.test(t0)?"✓":"—");
  // build a line
  await page.getByRole("button",{name:/Place stations|วางสถานี/}).first().click();
  const pts=[[520,430],[660,420],[800,440],[920,430]];
  for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(140);}
  await page.getByRole("button",{name:/Connect stations|เชื่อมสถานี/}).first().click();
  for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(130);}
  const fin=page.getByRole("button",{name:/✓ Finish|✓ เสร็จ/}); if(await fin.count()&&await fin.first().isEnabled().catch(()=>false))await fin.first().click();
  await page.waitForTimeout(2200);
  const t1 = await txt();
  console.log("[desktop] AFTER LINE: breakdown ·68/·18/·14:", ["·68","·18","·14"].every(w=>t1.includes(w))?"✓":"⚠", "· waiting/min-wait now shown:", /min wait|นาทีรอ/.test(t1)?"✓":"✗", "· OD served%:", /% served|ตอบโจทย์/.test(t1)?"✓":"—");
  console.log("[desktop] score-flash span:", await page.evaluate(()=>!!document.querySelector(".cm-flash-up,.cm-flash-down,.cm-tick"))?"present":"absent");
  await page.screenshot({path:"/tmp/ux-doall-desktop.png"});
  console.log("[desktop] ERRORS:", JSON.stringify(errs.slice(0,5)));
  await ctx.close();
}

// ── MOBILE ────────────────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.addInitScript(()=>localStorage.setItem("cm-onboarded","1"));
  const page = await ctx.newPage();
  const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
  await page.goto(URL,{waitUntil:"load",timeout:60000}); await page.waitForTimeout(1200);
  // renders at device width (viewport meta applied)?
  const vp = await page.evaluate(()=>({iw:window.innerWidth, dw:document.documentElement.clientWidth, hasMeta: !!document.querySelector('meta[name=viewport]')}));
  console.log("[mobile] innerWidth:", vp.iw, "(expect ~390, not 1366)", "· viewport meta:", vp.hasMeta?"✓":"✗");
  await page.getByText(/Grade A City|เมืองเกรด A/).first().click().catch(()=>{});
  await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(1600);
  // tap-target sizes on the bottom bar
  const minBtn = await page.evaluate(()=>{
    const bs=[...document.querySelectorAll(".btn,.seg,.vtoggle")]; let min=999;
    for(const b of bs){const r=b.getBoundingClientRect(); if(r.height>0) min=Math.min(min,r.height);} return Math.round(min);
  });
  console.log("[mobile] smallest control height:", minBtn, "px (target ≥44)");
  // tap to place stations + connect (touch)
  const taps = [[110,620],[195,600],[280,620]]; // lower-centre map, clear of the top panels (≤44vh) + bottom bar
  await page.getByRole("button",{name:/Place stations|วางสถานี/}).first().click();
  for(const[x,y] of taps){await page.touchscreen.tap(x,y);await page.waitForTimeout(180);}
  const placed = await page.evaluate(()=>document.body.innerText).then(s=>(s.match(/(\d+)\s*(placed|สถานี)/)||[])[1]);
  console.log("[mobile] stations placed via touch:", placed ?? "?");
  await page.getByRole("button",{name:/Connect stations|เชื่อมสถานี/}).first().click();
  for(const[x,y] of taps){await page.touchscreen.tap(x,y);await page.waitForTimeout(180);}
  const fin=page.getByRole("button",{name:/✓ Finish|✓ เสร็จ/}); const built = await fin.count() && await fin.first().isEnabled().catch(()=>false);
  if(built) await fin.first().click();
  await page.waitForTimeout(1500);
  console.log("[mobile] touch build → line finishable:", built?"✓ (tap-to-build works)":"⚠ couldn't finish (stations may need closer taps)");
  await page.screenshot({path:"/tmp/ux-doall-mobile.png"});
  console.log("[mobile] ERRORS:", JSON.stringify(errs.slice(0,5)));
  await ctx.close();
}
await browser.close();
