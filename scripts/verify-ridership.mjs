import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => localStorage.setItem("cm-onboarded","1"));
const page = await ctx.newPage();
const errors=[]; page.on("pageerror",e=>errors.push(e.message));
page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
const txt = () => page.evaluate(()=>document.body.innerText.replace(/\s+/g," "));
await page.goto(URL,{waitUntil:"load",timeout:60000});
await page.waitForFunction(()=>/Pick a goal|เลือกเป้าหมาย/.test(document.body.innerText),{timeout:60000}).catch(()=>{});
await page.getByText(/Grade A City|เมืองเกรด A/).click();
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(2000);
// build a central line
await page.getByRole("button",{name:/วางสถานี/}).click();
const pts=[[520,430],[620,418],[720,420],[820,432],[910,448]];
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(130);}
await page.getByRole("button",{name:/วางราง/}).click();
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(130);}
const fin=page.getByRole("button",{name:/Finish/}); if(await fin.isEnabled().catch(()=>false))await fin.click();
await page.getByRole("button",{name:/เลื่อนแผนที่/}).click();
// crank to 1200x and let a full sim-day+ accrue
await page.getByRole("button",{name:/^1200×$/}).click().catch(()=>{});
await page.waitForTimeout(28000);
const b = await txt();
console.log("RIDERS_DAY", (b.match(/🚆 ([\d,]+)/)||[])[1]||"?");
console.log("RIDER_MIX", (b.match(/🧑 \d+% 🎓 \d+% 🧳 \d+%/)||[])[0]||"?");
console.log("DAY", (b.match(/day (\d+)/)||[])[1]||"?");
console.log("ERRORS", JSON.stringify(errors.slice(0,6)));
await browser.close();
