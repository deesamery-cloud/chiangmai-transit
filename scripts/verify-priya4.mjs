import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => localStorage.setItem("cm-onboarded","1"));
const page = await ctx.newPage();
await page.goto(URL,{waitUntil:"load",timeout:60000});
await page.waitForFunction(()=>/Pick a goal|เลือกเป้าหมาย/.test(document.body.innerText),{timeout:60000}).catch(()=>{});
await page.getByText(/Grade A City|เมืองเกรด A/).click();
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(2500);
await page.getByRole("button",{name:/วางสถานี/}).click();
const pts=[[560,420],[680,418],[800,430]];
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(160);}
await page.getByRole("button",{name:/วางราง/}).click();
await page.waitForTimeout(200);
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(150);}
const fin=page.getByRole("button",{name:/✓ Finish/}); if(await fin.isEnabled().catch(()=>false))await fin.click();
await page.waitForTimeout(1500);

// Dump every interactive control in the bottom bar with role/label/size/colors
const dump = await page.evaluate(() => {
  // find the bottom bar panel (the one with the speed/tool buttons)
  const panels = [...document.querySelectorAll("div.panel")];
  const bar = panels.find(p => /Finish|Metro|Add train|เพิ่มขบวน|Density|Pan|เลื่อนแผนที่/.test(p.innerText) && p.querySelectorAll("button").length > 5);
  if (!bar) return {error:"no bar found", panelTexts: panels.map(p=>p.innerText.slice(0,40))};
  const ctrls = [...bar.querySelectorAll("button, span")].map(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      role: el.tagName === "BUTTON" ? "button" : (el.onclick||cs.cursor==="pointer"?"clickable-span":"text"),
      text: (el.innerText||"").trim().slice(0,28),
      disabled: el.disabled ?? null,
      w: Math.round(r.width), h: Math.round(r.height),
      bg: cs.backgroundColor, color: cs.color, cursor: cs.cursor,
      fontWeight: cs.fontWeight, fontSize: cs.fontSize, border: cs.borderColor,
    };
  }).filter(Boolean).filter(c=>c.text.length>0);
  return { count: ctrls.length, ctrls };
});
console.log(JSON.stringify(dump, null, 1));
await browser.close();
