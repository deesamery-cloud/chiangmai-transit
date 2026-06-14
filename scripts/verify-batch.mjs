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
await page.goto(URL,{waitUntil:"load",timeout:60000});
await page.waitForFunction(()=>/Pick a goal|เลือกเป้าหมาย/.test(document.body.innerText),{timeout:60000}).catch(()=>{});
await page.getByText(/Grade A City|เมืองเกรด A/).click();
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(2200);

// build a SMALL line (3 stations) — should NOT be grade A
await page.getByRole("button",{name:/วางสถานี/}).click();
const small=[[640,430],[700,425],[760,430]];
for(const[x,y]of small){await page.mouse.click(x,y);await page.waitForTimeout(150);}
await page.getByRole("button",{name:/วางราง/}).click();
for(const[x,y]of small){await page.mouse.click(x,y);await page.waitForTimeout(150);}
let fin=page.getByRole("button",{name:/Finish/}); if(await fin.isEnabled().catch(()=>false))await fin.click();
await page.getByRole("button",{name:/เลื่อนแผนที่/}).click();
await page.getByRole("button",{name:/^1200×$/}).click().catch(()=>{});
await page.waitForTimeout(14000);
const b1 = await txt();
const score = +(((b1.match(/(\d+)\/100/)||[])[1])||-1);
console.log("#1 SMALL_LINE_SCORE", score, score<82 ? "✓ not A" : "✗ too easy");
console.log("#1 GRADE_GOAL_TARGET_SHOWN", /goal ≥\d+|เป้า ≥\d+/.test(b1) ? "✓" : "✗");
console.log("#3 NO_SECOND_GRADE_BOX", /🎯 .*Grade A City|🎯 .*เมืองเกรด A/.test(b1) ? "✗ two grades" : "✓ one grade");
console.log("#5 ONE_TRAIN_DEFAULT", /🚆1\b/.test(b1) ? "✓ fleet 1" : ("? "+((b1.match(/🚆(\d)/)||[])[1])));
console.log("#6 SATISFACTION_SHOWN", /% (happy|พอใจ)/.test(b1) ? "✓" : "✗", "WAIT", /min wait|นาทีรอ/.test(b1)?"✓":"✗");

// select the line → fare control (#7)
await page.locator("text=/Metro/").first().click().catch(()=>{});
await page.waitForTimeout(400);
const b2 = await txt();
console.log("#7 FARE_CONTROL", /Fare|ค่าโดยสาร/.test(b2) && /฿\d+/.test(b2) ? "✓" : "✗");

// #4 people toggle
const peopleBtn = page.getByRole("button",{name:/👣/});
console.log("#4 PEOPLE_TOGGLE_PRESENT", await peopleBtn.count() ? "✓" : "✗");
await peopleBtn.click().catch(()=>{});
await page.waitForTimeout(800);
await page.screenshot({ path: "/tmp/cm-batch-peopleoff.png" });

// #2 station names — zoom in and screenshot
await page.mouse.move(700,430);
for(let i=0;i<4;i++){await page.mouse.wheel(0,-300);await page.waitForTimeout(250);}
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/cm-batch-zoom.png" });

console.log("ERRORS", JSON.stringify(errors.slice(0,8)));
await browser.close();
