import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });

const pts = [[520,440],[660,420],[800,450]];
async function run(diffRe, label, scrimSkipTest) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { localStorage.setItem("cm-onboarded","1"); localStorage.setItem("cm-cine-skip","1"); });
  const page = await ctx.newPage();
  const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
  const txt = () => page.evaluate(()=>document.body.innerText.replace(/\s+/g," "));
  await page.goto(URL,{waitUntil:"load"}); await page.waitForTimeout(900);
  await page.getByText(/Grade A City|เมืองเกรด A/).first().click(); await page.waitForTimeout(120);
  await page.getByText(/From scratch|สร้างใหม่/).first().click(); await page.waitForTimeout(120);
  await page.getByRole("button",{name:diffRe}).first().click(); await page.waitForTimeout(120);
  await page.getByRole("button",{name:/Begin your term|เริ่มวาระ/}).first().click(); await page.waitForTimeout(600);

  // appointment cutscene should be up
  const tAppt = await txt();
  const apptUp = /new Governor|ผู้ว่าราชการคนใหม่/.test(tAppt);
  let skipResult = "(not tested)";
  if (scrimSkipTest) {
    console.log("[skip] appointment cutscene appears:", apptUp?"✓":"✗");
    // tap the scrim (far-left, outside the centered card) → should skip to game
    await page.mouse.click(12, 420); await page.waitForTimeout(500);
    const tAfter = await txt();
    skipResult = /new Governor|ผู้ว่าราชการคนใหม่/.test(tAfter) ? "⚠ still up" : "✓ skipped to game";
    console.log("[skip] tap-scrim instantly skips:", skipResult);
  } else {
    // dismiss via skip button to proceed
    const sk = page.getByRole("button",{name:/Skip intro ⏭|ข้ามฉาก ⏭/}); if (await sk.count()) await sk.first().click();
  }
  await page.waitForSelector("canvas",{timeout:30000}); await page.waitForTimeout(900);

  // build a metro line
  await page.getByRole("button",{name:/^🚆|Metro|รถไฟฟ้า/}).first().click(); await page.waitForTimeout(200);
  await page.getByRole("button",{name:/Place stations|วางสถานี/}).first().click(); await page.waitForTimeout(150);
  for (const [x,y] of pts){ await page.mouse.click(x,y); await page.waitForTimeout(130); }
  await page.getByRole("button",{name:/Connect stations|เชื่อมสถานี/}).first().click(); await page.waitForTimeout(150);
  for (const [x,y] of pts){ await page.mouse.click(x,y); await page.waitForTimeout(130); }
  const fin = page.getByRole("button",{name:/✓ Finish|✓ เสร็จ/});
  if (await fin.count() && await fin.first().isEnabled().catch(()=>false)) await fin.first().click();
  await page.waitForTimeout(700);

  const tBuilt = await txt();
  const toast = /Line open|เปิดสาย|riders boarding|ผู้โดยสารกำลังขึ้น/.test(tBuilt);
  await page.waitForTimeout(1500);
  const tScore = await txt();
  const score = Number((tScore.match(/(\d+)\s*\/\s*100/)||[])[1] || 0);
  await ctx.close();
  return { score, toast, skipResult, errs: errs.length };
}

const easy = await run(/Easy|ง่าย/, "easy", true);
const hard = await run(/Hard|ยาก/, "hard", false);
await browser.close();

console.log("\n[#3 build toast] shown on finish:", easy.toast?"✓":"⚠");
console.log("[#1 difficulty affects score] easy score:", easy.score, "· hard score:", hard.score, "→", easy.score > hard.score ? "✓ Easy climbs higher than Hard" : "⚠ no difference");
console.log("[#2 cutscene skip] tap-scrim:", easy.skipResult);
console.log("[errors] easy:", easy.errs, "hard:", hard.errs, (easy.errs+hard.errs)===0?"✓":"⚠");
