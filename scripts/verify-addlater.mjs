import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 });
await ctx.addInitScript(()=>localStorage.setItem("cm-onboarded","1"));
const page = await ctx.newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
const txt = () => page.evaluate(()=>document.body.innerText.replace(/\s+/g," "));
const stripShown = async () => /＋ (Add train|เพิ่มขบวน|Add songthaew|เพิ่มสองแถว)/.test(await txt());
await page.goto(URL,{waitUntil:"load",timeout:60000}); await page.waitForTimeout(1200);
await page.getByText(/Grade A City|เมืองเกรด A/).first().click();
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(1600);
// build a line
await page.getByRole("button",{name:/Place stations|วางสถานี/}).first().click();
const pts=[[520,430],[660,420],[800,440],[920,430]];
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(140);}
await page.getByRole("button",{name:/Connect stations|เชื่อมสถานี/}).first().click();
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(130);}
const fin=page.getByRole("button",{name:/✓ Finish|✓ เสร็จ/}); if(await fin.count()&&await fin.first().isEnabled().catch(()=>false))await fin.first().click();
await page.waitForTimeout(1500);
console.log("1) strip shows right after build (auto-select):", await stripShown()?"✓":"✗");
// "go do other things": switch to Place-stations tool → selection clears, strip hides
await page.getByRole("button",{name:/Place stations|วางสถานี/}).first().click();
await page.waitForTimeout(500);
console.log("2) after switching tool (doing other things), strip hidden:", await stripShown()?"⚠ still shown":"✓ hidden");
// come back LATER: click the line row in YOUR NETWORK
await page.getByRole("button",{name:/km ·/}).first().click();
await page.waitForTimeout(500);
console.log("3) clicking the line row brings the strip back:", await stripShown()?"✓ strip back":"✗ still hidden");
// and the ＋ Add train works
const before=(await txt()).match(/(\d)\/5\b/)?.[1];
await page.getByRole("button",{name:/＋ (Add train|เพิ่มขบวน|Add songthaew|เพิ่มสองแถว)/}).click();
await page.waitForTimeout(400);
await page.getByRole("button",{name:/＋ (Add train|เพิ่มขบวน|Add songthaew|เพิ่มสองแถว)/}).click();
await page.waitForTimeout(600);
const after=(await txt()).match(/(\d)\/5\b/)?.[1];
console.log("4) add-train later works: fleet", before, "→", after, before&&after&&+after>+before?"✓":"(check)");
await page.screenshot({path:"/tmp/ux-addlater.png"});
console.log("ERRORS:", JSON.stringify(errs.slice(0,5)));
await browser.close();
