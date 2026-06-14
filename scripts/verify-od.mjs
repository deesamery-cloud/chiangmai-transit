import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => localStorage.setItem("cm-onboarded","1"));
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type()==="error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: "+e.message));
const txt = () => page.evaluate(()=>document.body.innerText.replace(/\s+/g," "));
const served = async () => +(((await txt()).match(/(\d+)% served/)||[])[1] ?? -1);
const grade = async () => (((await txt()).match(/City score.*?([A-F])\b/)||[])[1] ?? "?");
const lc = () => page.evaluate(()=>+(document.body.innerText.match(/(?:YOUR NETWORK|เครือข่ายของคุณ) · (\d+)/)?.[1]||0));

await page.goto(URL,{waitUntil:"load",timeout:60000});
await page.waitForFunction(()=>/Pick a goal|เลือกเป้าหมาย/.test(document.body.innerText),{timeout:60000}).catch(()=>{});
await page.getByText(/Grade A City|เมืองเกรด A/).click();
await page.waitForSelector("canvas",{timeout:30000});
await page.waitForTimeout(3000);

// at 0 lines: OD panel should show unmet, 0% served
const odPresent = /Travel demand|ความต้องการ/.test(await txt());
console.log("OD_PANEL_PRESENT", odPresent ? "✓" : "✗");
console.log("SERVED_0_LINES", await served(), "GRADE", await grade());
await page.screenshot({ path: "/tmp/cm-od-start.png" });

// build a good cross-city line through the center
await page.getByRole("button",{name:/วางสถานี/}).click();
const pts = [[470,430],[560,420],[660,418],[740,420],[840,430],[930,440]];
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(150);}
await page.getByRole("button",{name:/วางราง/}).click();
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(140);}
let fin=page.getByRole("button",{name:/Finish/}); if(await fin.isEnabled().catch(()=>false))await fin.click();
await page.waitForTimeout(4000);
const linesA = await lc();
console.log("LINES_AFTER_BUILD", linesA, linesA===1?"✓":"✗");
console.log("SERVED_AFTER_BUILD", await served(), "GRADE", await grade());
await page.screenshot({ path: "/tmp/cm-od-built.png" });

// EXTEND: add 2 stations east, connect from the existing east endpoint
await page.getByRole("button",{name:/วางสถานี/}).click();
const ext = [[1010,450],[1090,460]];
for(const[x,y]of ext){await page.mouse.click(x,y);await page.waitForTimeout(150);}
await page.getByRole("button",{name:/วางราง/}).click();
for(const[x,y]of [[930,440],...ext]){await page.mouse.click(x,y);await page.waitForTimeout(150);}
fin=page.getByRole("button",{name:/Finish/}); if(await fin.isEnabled().catch(()=>false))await fin.click();
await page.waitForTimeout(3000);
const linesB = await lc();
console.log("LINES_AFTER_EXTEND", linesB, linesB===1?"✓ still 1 (extended)":"✗");
console.log("SERVED_AFTER_EXTEND", await served(), "GRADE", await grade());
// pan tool to clear draft, screenshot the extended rail
await page.getByRole("button",{name:/เลื่อนแผนที่/}).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/cm-od-extended.png" });
console.log("ERRORS", JSON.stringify(errors.slice(0,8)));
await browser.close();
