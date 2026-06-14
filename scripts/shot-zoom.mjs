import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => localStorage.setItem("cm-onboarded","1"));
const page = await ctx.newPage();
const errors=[]; page.on("pageerror",e=>errors.push(e.message));
await page.goto(URL,{waitUntil:"load",timeout:60000});
await page.waitForFunction(()=>/Pick a goal|เลือกเป้าหมาย/.test(document.body.innerText),{timeout:60000}).catch(()=>{});
await page.getByText(/Grade A City|เมืองเกรด A/).click();
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(2500);
await page.getByRole("button",{name:/วางสถานี/}).click();
const pts=[[600,420],[680,415],[760,420],[840,430]];
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(150);}
await page.getByRole("button",{name:/วางราง/}).click();
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(140);}
const fin=page.getByRole("button",{name:/Finish/}); if(await fin.isEnabled().catch(()=>false))await fin.click();
await page.waitForTimeout(3500);
await page.getByRole("button",{name:/เลื่อนแผนที่/}).click();
// zoom in on the line center with the mouse wheel
await page.mouse.move(720,420);
for(let i=0;i<5;i++){await page.mouse.wheel(0,-300);await page.waitForTimeout(250);}
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/cm-zoom.png" });
console.log("ERRORS", JSON.stringify(errors.slice(0,5)));
await browser.close();
