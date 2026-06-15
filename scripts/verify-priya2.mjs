import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 });
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
const hasStrip = await page.getByRole("button",{name:/Add train|เพิ่มขบวน/}).isVisible().catch(()=>false);
console.log("STRIP_VISIBLE", hasStrip);
await page.screenshot({ path: "/tmp/priya-6-editstrip.png", clip:{x:0,y:680,width:1366,height:170}, animations:"disabled", timeout:15000 }).catch(e=>console.log("shot1 fail",e.message));
await browser.close();
