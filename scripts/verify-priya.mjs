import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors=[]; page.on("pageerror",e=>errors.push(e.message)); page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
await page.goto(URL,{waitUntil:"load",timeout:60000});
await page.waitForFunction(()=>/Pick a goal|เลือกเป้าหมาย/.test(document.body.innerText),{timeout:60000}).catch(()=>{});
// 1) START SCREEN
await page.screenshot({ path: "/tmp/priya-1-start.png" });

// start a Grade A game, keep coachmark on first (it is the default first-run state)
await page.getByText(/Grade A City|เมืองเกรด A/).click();
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(2500);
// 2) FRESH MAIN GAME — default Pan tool, coachmark step 1 showing, no line yet
await page.screenshot({ path: "/tmp/priya-2-fresh.png" });

// dismiss coach if present
const skip = page.getByRole("button",{name:/Skip|ข้าม/}); if(await skip.isVisible().catch(()=>false)) await skip.click();
await page.waitForTimeout(300);
// 3) BOTTOM BAR idle (Pan selected) — affordance state of tools/tabs/toggles
await page.screenshot({ path: "/tmp/priya-3-bottombar-idle.png", clip:{x:0,y:690,width:1366,height:160} });

// enter Place stations, drop 3 stations
await page.getByRole("button",{name:/วางสถานี/}).click();
await page.waitForTimeout(200);
await page.screenshot({ path: "/tmp/priya-4-station-tool-active.png", clip:{x:0,y:690,width:1366,height:160} });
const pts=[[560,420],[680,418],[800,430]];
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(160);}
// 5) lay track state
await page.getByRole("button",{name:/วางราง/}).click();
await page.waitForTimeout(200);
await page.screenshot({ path: "/tmp/priya-5-track-tool.png", clip:{x:0,y:690,width:1366,height:160} });
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(150);}
const fin=page.getByRole("button",{name:/✓ Finish/}); if(await fin.isEnabled().catch(()=>false))await fin.click();
await page.waitForTimeout(1200);
// 6) EDIT STRIP (auto-selected after finish)
await page.screenshot({ path: "/tmp/priya-6-editstrip.png", clip:{x:0,y:690,width:1366,height:160} });
// full frame too, to see whole HUD with a line
await page.screenshot({ path: "/tmp/priya-6b-full.png" });

// 7) switch to songthaew tab to see mode-tab affordance + tool change
await page.getByRole("button",{name:/Songthaew|สองแถว/}).first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: "/tmp/priya-7-songthaew-mode.png", clip:{x:0,y:690,width:1366,height:160} });

console.log("ERRORS", JSON.stringify(errors.slice(0,6)));
await browser.close();
