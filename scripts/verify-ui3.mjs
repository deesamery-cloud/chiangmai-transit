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
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(2000);
await page.getByRole("button",{name:/วางสถานี/}).click();
const pts=[[520,430],[620,420],[720,422],[820,432],[910,448]];
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(120);}
await page.getByRole("button",{name:/วางราง/}).click();
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(110);}
const fin=page.getByRole("button",{name:/Finish/}); if(await fin.isEnabled().catch(()=>false))await fin.click();
await page.getByRole("button",{name:/เลื่อนแผนที่/}).click();
await page.getByRole("button",{name:/^1200×$/}).click().catch(()=>{});
await page.waitForTimeout(9000);

const b = await txt();
// #2 per-line perf on left: the network list row shows wait + riding
console.log("#2 PERLINE_WAIT", /🧍 [\d,]+ (wait|รอ)/.test(b) ? "✓" : "✗", "PERLINE_RIDING", /🚆 [\d,]+ (riding|บนรถ)/.test(b) ? "✓" : "✗");
// #3 OD toggle present
const odBtn = page.getByRole("button",{name:/🎯/});
console.log("#3 OD_TOGGLE", await odBtn.count() ? "✓" : "✗");
console.log("#3 OD_PANEL_OPEN", /Travel demand|ความต้องการเดินทาง/.test(b) ? "✓" : "✗");
// click an OD corridor row → highlight on map
const odRow = page.getByRole("button",{name:/→/}).first();
await odRow.click().catch(()=>{});
await page.waitForTimeout(1200);
console.log("#3 OD_SELECTED_PIN", /📍/.test(await txt()) ? "✓" : "✗");
await page.screenshot({ path: "/tmp/cm-ui3-odmap.png" });
// close OD panel
await odBtn.click();
await page.waitForTimeout(600);
console.log("#3 OD_PANEL_CLOSED", /Travel demand|ความต้องการเดินทาง/.test(await txt()) ? "✗ still open" : "✓ closed");
// zoom for train look
await page.mouse.move(720,425);
for(let i=0;i<4;i++){await page.mouse.wheel(0,-300);await page.waitForTimeout(220);}
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/cm-ui3-train.png" });
console.log("ERRORS", JSON.stringify(errors.slice(0,6)));
await browser.close();
