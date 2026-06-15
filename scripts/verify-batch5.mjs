import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors=[]; page.on("pageerror",e=>errors.push(e.message)); page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
const txt = () => page.evaluate(()=>document.body.innerText.replace(/\s+/g," "));
await page.goto(URL,{waitUntil:"load",timeout:60000});
await page.waitForFunction(()=>/Pick a goal|เลือกเป้าหมาย/.test(document.body.innerText),{timeout:60000}).catch(()=>{});
const b0 = await txt();
const seed1 = (b0.match(/(?:Seed|ซีด) (\d{6})/)||[])[1];
console.log("SEED_SHOWN", seed1 ? "✓ "+seed1 : "✗");
await page.getByRole("button",{name:/re-roll|สุ่มใหม่/}).click();
await page.waitForTimeout(200);
const seed2 = ((await txt()).match(/(?:Seed|ซีด) (\d{6})/)||[])[1];
console.log("SEED_REROLL", seed2 && seed2!==seed1 ? "✓ "+seed2 : "✗ "+seed2);
await page.getByText(/Grade A City|เมืองเกรด A/).click();
await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(2500);
// build a line (onboarding ON → coachmark should appear/advance)
await page.getByRole("button",{name:/วางสถานี/}).click();
const pts=[[560,420],[660,418],[760,422],[860,432]];
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(140);}
await page.getByRole("button",{name:/วางราง/}).click();
for(const[x,y]of pts){await page.mouse.click(x,y);await page.waitForTimeout(130);}
const fin=page.getByRole("button",{name:/✓ Finish/}); if(await fin.isEnabled().catch(()=>false))await fin.click();
await page.waitForTimeout(1500);
let b=await txt();
console.log("TUTORIAL_6STEP", /Step [3-6]\/6|ขั้นที่ [3-6]\/6/.test(b) ? "✓" : "✗");
// advance tutorial
const nextBtn=page.getByRole("button",{name:/Next →|ถัดไป/});
if(await nextBtn.count()){ await nextBtn.click({force:true}).catch(()=>{}); await page.waitForTimeout(400); }
b=await txt();
console.log("TUTORIAL_OD_BEAT", /Travel demand|ความต้องการเดินทาง|why your grade/.test(b) ? "✓ (OD taught)" : "(advanced)");
// dismiss coach
await page.getByRole("button",{name:/Skip|ข้าม/}).first().click({force:true}).catch(()=>{});
await page.waitForTimeout(400);
// zen toggle: hides stats
console.log("STATS_BEFORE_ZEN", /Travellers|ผู้คน/.test(await txt()) ? "shown" : "hidden");
await page.getByRole("button",{name:/🌿|Zen|เซน/}).click();
await page.waitForTimeout(500);
console.log("ZEN_HIDES_STATS", /Travellers|ผู้คน/.test(await txt()) ? "✗ still shown" : "✓ hidden");
await page.getByRole("button",{name:/^1200×$/}).click().catch(()=>{});
await page.waitForTimeout(3000);
await page.screenshot({ path: "/tmp/cm-zen.png" });
console.log("ERRORS", JSON.stringify(errors.slice(0,8)));
await browser.close();
