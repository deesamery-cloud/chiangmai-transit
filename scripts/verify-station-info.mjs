import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 1 });
await ctx.addInitScript(()=>{ localStorage.setItem("cm-onboarded","1"); localStorage.setItem("cm-cine-skip","1"); });
const page = await ctx.newPage();
const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
const txt = () => page.evaluate(()=>document.body.innerText.replace(/\s+/g," "));

await page.goto(URL,{waitUntil:"load"}); await page.waitForTimeout(900);
await page.getByText(/Grade A City|เมืองเกรด A/).first().click(); await page.waitForTimeout(120);
await page.getByRole("button",{name:/Begin your term|เริ่มวาระ/}).first().click(); await page.waitForTimeout(500);
const sk=page.getByRole("button",{name:/Skip intro ⏭|ข้ามฉาก ⏭/}); if(await sk.count()) await sk.first().click();
await page.waitForSelector("canvas"); await page.waitForTimeout(1200);

// build a metro line through 3 spread-out stations
const pts=[[470,440],[680,420],[900,450]];
await page.getByRole("button",{name:/^🚆|Metro|รถไฟฟ้า/}).first().click(); await page.waitForTimeout(200);
await page.getByRole("button",{name:/Place stations|วางสถานี/}).first().click(); await page.waitForTimeout(150);
for(const[x,y]of pts){ await page.mouse.click(x,y); await page.waitForTimeout(150); }
await page.getByRole("button",{name:/Connect stations|เชื่อมสถานี/}).first().click(); await page.waitForTimeout(150);
for(const[x,y]of pts){ await page.mouse.click(x,y); await page.waitForTimeout(150); }
const fin=page.getByRole("button",{name:/✓ Finish|✓ เสร็จ/}); if(await fin.count()&&await fin.first().isEnabled().catch(()=>false)) await fin.first().click();
await page.waitForTimeout(800);

// fast-forward so riders board/alight at the stations
await page.getByRole("button",{name:/Speed|ความเร็ว/}).first().click(); await page.waitForTimeout(250);
const range=page.locator('input[type=range]'); if(await range.count()) await range.first().fill("400");
await page.waitForTimeout(4500);

// back to Pan, then click a station to inspect it
await page.getByRole("button",{name:/Pan|เลื่อนแผนที่/}).first().click(); await page.waitForTimeout(300);
await page.mouse.click(680,420); await page.waitForTimeout(500);
let t1 = await txt();
let open = /Boarded here|ขึ้นรถที่นี่|Waiting now|กำลังรอ|Passed through|ผ่านเลย/.test(t1);
if(!open){ await page.mouse.click(470,440); await page.waitForTimeout(500); t1 = await txt(); open = /Boarded here|ขึ้นรถที่นี่|Waiting now|กำลังรอ/.test(t1); }
console.log("[station] inspector opens on click:", open?"✓":"✗ MISSING");
console.log("[station] shows board/alight/wait/pass labels:", /Boarded here|ขึ้นรถ/.test(t1) && /Alighted here|ลงรถ/.test(t1) && /Waiting now|กำลังรอ/.test(t1) && /Passed through|ผ่าน/.test(t1)?"✓":"⚠");
// at least one non-zero traffic number present in the popover region
const nums = (t1.match(/(?:Boarded here|ขึ้นรถที่นี่)[^\d]*([\d,]+)/)||[])[1];
console.log("[station] boarded value:", nums ?? "?", nums && nums!=="0" ? "✓ has traffic" : "(0 — may need more time)");
await page.screenshot({path:"/tmp/station-info.png"});
console.log("[done] CONSOLE ERRORS:", errs.length?JSON.stringify(errs.slice(0,5)):"none ✓");
await ctx.close(); await browser.close();
