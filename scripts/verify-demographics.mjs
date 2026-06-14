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

await page.goto(URL,{waitUntil:"load",timeout:60000});
await page.waitForFunction(()=>/Pick a goal|เลือกเป้าหมาย/.test(document.body.innerText),{timeout:60000}).catch(()=>{});
await page.getByText(/Grade A City|เมืองเกรด A/).click();
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(2500);

// build a line through the center so riders accrue
await page.getByRole("button",{name:/วางสถานี/}).click();
const pts=[[520,430],[620,418],[720,420],[820,432],[910,448]];
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(150);}
await page.getByRole("button",{name:/วางราง/}).click();
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(140);}
const fin=page.getByRole("button",{name:/Finish/}); if(await fin.isEnabled().catch(()=>false))await fin.click();
await page.getByRole("button",{name:/เลื่อนแผนที่/}).click();
await page.waitForTimeout(5000);

const b = await txt();
const ridersM = b.match(/🚆 ([\d,]+) (?:riders\/day|คน\/วัน)/);
console.log("RIDERS_DAY_DISPLAY", ridersM ? ridersM[1] : "?");
console.log("RIDER_MIX_PRESENT", /🧑 \d+% 🎓 \d+% 🧳 \d+%/.test(b) ? "✓" : "✗", (b.match(/🧑 \d+% 🎓 \d+% 🧳 \d+%/)||[])[0]||"");
console.log("DENSITY_BTN", /🔥 (Density|ความหนาแน่น)/.test(b) ? "✓" : "✗");

// toggle density ON
await page.getByRole("button",{name:/🔥/}).click();
await page.waitForTimeout(2500);
console.log("DENSITY_LEGEND_ON", /Population density|ความหนาแน่นประชากร/.test(await txt()) ? "✓" : "✗");
await page.screenshot({ path: "/tmp/cm-density-on.png" });
// toggle OFF
await page.getByRole("button",{name:/🔥/}).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/cm-density-off.png" });
console.log("ERRORS", JSON.stringify(errors.slice(0,10)));
await browser.close();
