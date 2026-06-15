import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(URL,{waitUntil:"load",timeout:60000});
await page.waitForTimeout(1500);
// 1) START / onboarding screen (no localStorage seed)
await page.screenshot({ path: "/tmp/ux-1-start.png" });
// dismiss onboarding for the rest
await page.evaluate(()=>localStorage.setItem("cm-onboarded","1"));
await page.reload({waitUntil:"load"});
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/ux-2-goalpick.png" });
// pick a goal -> enter game
const g = page.getByText(/Grade A City|เมืองเกรด A|Connect|เชื่อม/).first();
if (await g.count()) await g.click().catch(()=>{});
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/ux-3-fresh.png" });
// build a metro line
const station = page.getByRole("button",{name:/วางสถานี|Place station/});
if (await station.count()) {
  await station.first().click();
  const pts=[[520,430],[660,420],[800,440],[920,430]];
  for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(150);}
  const track = page.getByRole("button",{name:/วางราง|Lay (track|rail)/});
  if (await track.count()){await track.first().click();for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(140);}}
  const fin=page.getByRole("button",{name:/✓ Finish|Finish/}); if(await fin.count() && await fin.first().isEnabled().catch(()=>false))await fin.first().click();
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: "/tmp/ux-4-built-strip.png" });
// toggle density + people
for (const re of [/Density|ความหนาแน่น/, /People|ผู้คน/, /Demand|อุปสงค์/]) {
  const b = page.getByRole("button",{name:re}); if (await b.count()) await b.first().click().catch(()=>{});
}
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/ux-5-layers.png" });
console.log("shots done");
await browser.close();
