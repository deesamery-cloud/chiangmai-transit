import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => localStorage.setItem("cm-onboarded","1"));
const page = await ctx.newPage();
const errors=[]; page.on("pageerror",e=>errors.push(e.message)); page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
const txt = () => page.evaluate(()=>document.body.innerText.replace(/\s+/g," "));
await page.goto(URL,{waitUntil:"load",timeout:60000});
await page.waitForFunction(()=>/Pick a goal|เลือกเป้าหมาย/.test(document.body.innerText),{timeout:60000}).catch(()=>{});
await page.getByText(/Grade A City|เมืองเกรด A/).click();
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(2200);
// build a metro line (starts at 1 train)
await page.getByRole("button",{name:/วางสถานี/}).click();
const pts=[[560,420],[680,418],[800,430]];
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(140);}
await page.getByRole("button",{name:/วางราง/}).click();
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(130);}
const fin=page.getByRole("button",{name:/✓ Finish/}); if(await fin.isEnabled().catch(()=>false))await fin.click();
await page.getByRole("button",{name:/เลื่อนแผนที่/}).click();
await page.waitForTimeout(1200);
let b=await txt();
console.log("ADD_BTN_VISIBLE", /＋/.test(b) ? "✓ on row" : "✗");
console.log("FLEET_BEFORE", (b.match(/🚆(\d)/)||[])[1]);
// click the ＋ add-train button
const add=page.getByRole("button",{name:/＋/}).first();
await add.click(); await page.waitForTimeout(500);
await add.click(); await page.waitForTimeout(800);
b=await txt();
console.log("FLEET_AFTER", (b.match(/🚆(\d)/)||[])[1], "(expect higher)");
await page.screenshot({ path: "/tmp/cm-addveh.png" });
console.log("ERRORS", JSON.stringify(errors.slice(0,6)));
await browser.close();
