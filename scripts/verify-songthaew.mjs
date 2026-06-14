import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => localStorage.setItem("cm-onboarded","1"));
const page = await ctx.newPage();
const errors=[]; page.on("pageerror",e=>errors.push(e.message)); page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
const txt = () => page.evaluate(()=>document.body.innerText.replace(/\s+/g," "));
const lc = () => page.evaluate(()=>+(document.body.innerText.match(/(?:YOUR NETWORK|เครือข่ายของคุณ) · (\d+)/)?.[1]||0));
await page.goto(URL,{waitUntil:"load",timeout:60000});
await page.waitForFunction(()=>/Pick a goal|เลือกเป้าหมาย/.test(document.body.innerText),{timeout:60000}).catch(()=>{});
await page.getByText(/Grade A City|เมืองเกรด A/).click();
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(2200);

// build-mode toggle present
console.log("MODE_TOGGLE", await page.getByRole("button",{name:/Songthaew|สองแถว/}).count() ? "✓" : "✗");
// switch to songthaew
await page.getByRole("button",{name:/Songthaew|สองแถว/}).first().click();
await page.waitForTimeout(300);
console.log("ROUTE_TOOL_SHOWN", /วาดเส้นทาง|Draw route/.test(await txt()) ? "✓" : "✗");
// pick route tool + draw a route along roads
await page.getByRole("button",{name:/วาดเส้นทาง/}).click();
const pts=[[560,420],[640,415],[720,420],[800,430],[880,440]];
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(150);}
console.log("ROUTE_DRAFT_COUNT_VISIBLE", /· 5\b/.test(await txt()) ? "✓ 5 pts" : "?");
const fin=page.getByRole("button",{name:/Finish/}); if(await fin.isEnabled().catch(()=>false))await fin.click();
await page.waitForTimeout(2500);
const linesN = await lc();
const b = await txt();
console.log("SONGTHAEW_LINE_BUILT", linesN>=1 ? "✓ "+linesN : "✗", "LIST_HAS_🛻", /🛻/.test(b)?"✓":"✗", "LIST_HAS_Songthaew", /Songthaew|สองแถว/.test(b)?"✓":"✗");
await page.getByRole("button",{name:/เลื่อนแผนที่/}).click().catch(()=>{});
await page.getByRole("button",{name:/^1200×$/}).click().catch(()=>{});
await page.waitForTimeout(6000);
await page.screenshot({ path: "/tmp/cm-songthaew.png" });
console.log("ERRORS", JSON.stringify(errors.slice(0,8)));
await browser.close();
