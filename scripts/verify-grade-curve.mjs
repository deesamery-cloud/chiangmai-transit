import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => localStorage.setItem("cm-onboarded","1"));
const page = await ctx.newPage();
const errors=[]; page.on("pageerror",e=>errors.push(e.message)); page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
const score = async () => +(((await page.evaluate(()=>document.body.innerText))?.match(/(\d+)\/100/)||[])[1]||-1);
const buildLine = async (pts) => {
  await page.getByRole("button",{name:/วางสถานี/}).click();
  for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(110);}
  await page.getByRole("button",{name:/วางราง/}).click();
  for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(100);}
  const fin=page.getByRole("button",{name:/Finish/}); if(await fin.isEnabled().catch(()=>false))await fin.click();
  await page.getByRole("button",{name:/เลื่อนแผนที่/}).click();
};
await page.goto(URL,{waitUntil:"load",timeout:60000});
await page.waitForFunction(()=>/Pick a goal|เลือกเป้าหมาย/.test(document.body.innerText),{timeout:60000}).catch(()=>{});
await page.getByText(/Grade A City|เมืองเกรด A/).click();
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(2000);
await page.getByRole("button",{name:/^1200×$/}).click().catch(()=>{});
// line 1 (E-W through centre)
await buildLine([[500,430],[580,424],[660,420],[740,422],[820,430],[900,440]]);
await page.waitForTimeout(11000);
const s1 = await score();
// line 2 (N-S crossing centre)
await buildLine([[700,300],[700,360],[700,420],[700,490],[700,560]]);
await page.waitForTimeout(12000);
const s2 = await score();
console.log("ONE_LINE_SCORE", s1, "TWO_LINE_SCORE", s2, s2>s1 ? "✓ climbs" : "✗");
console.log("ERRORS", JSON.stringify(errors.slice(0,5)));
await browser.close();
