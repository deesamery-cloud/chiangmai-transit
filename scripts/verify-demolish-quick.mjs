import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 } });
await ctx.addInitScript(() => localStorage.setItem("cm-onboarded","1"));
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type()==="error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: "+e.message));
const lc = () => page.evaluate(()=>+(document.body.innerText.match(/(?:YOUR NETWORK|เครือข่ายของคุณ) · (\d+)/)?.[1]||0));
await page.goto(URL,{waitUntil:"load",timeout:60000});
await page.waitForFunction(()=>/Pick a goal|เลือกเป้าหมาย/.test(document.body.innerText),{timeout:60000}).catch(()=>{});
await page.getByText(/Grade A City|เมืองเกรด A/).click();
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(2200);
const pts=[[600,380],[690,400],[760,460],[660,480]];
await page.getByRole("button",{name:/วางสถานี/}).click();
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(150);}
await page.getByRole("button",{name:/วางราง/}).click();
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(140);}
const fin=page.getByRole("button",{name:/Finish/}); if(await fin.isEnabled().catch(()=>false))await fin.click();
await page.waitForTimeout(1500);
const built=await lc();
await page.getByRole("button",{name:/รื้อถอน/}).click();
await page.mouse.click(760,460); // demolish a middle station
await page.waitForTimeout(1200);
const after=await lc();
console.log("BUILD_lines",built,built===1?"✓":"✗");
console.log("AFTER_DEMOLISH_station_lines",after,after===1?"✓ line re-routed, not deleted":"✗");
console.log("ERRORS",JSON.stringify(errors.slice(0,6)));
await browser.close();
