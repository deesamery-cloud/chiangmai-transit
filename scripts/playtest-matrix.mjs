// Automated playtest sweep over EVERY config cell: 4 goals × 2 build-sources ×
// 4 difficulties = 32 cells. For each cell it actually drives the real game in
// headless Chrome — selects the config, starts, skips the cutscene, builds a
// metro line, fast-forwards time, toggles overlays, clicks an advisor — while
// capturing console errors / page exceptions / failures. Finds REAL bugs.
// Output: JSON to /tmp/playtest-matrix.json + a console summary.
// Run: node scripts/playtest-matrix.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const GOALS = [
  { key: "cars", re: /Win the Cars|เอาชนะรถยนต์/ },
  { key: "money", re: /Transit Tycoon|เจ้าพ่อขนส่ง/ },
  { key: "grade", re: /Grade A City|เมืองเกรด A/ },
  { key: "free", re: /Free Build|สร้างอิสระ/ },
];
const SOURCES = [
  { key: "scratch", re: /From scratch|สร้างใหม่/ },
  { key: "existing", re: /Existing songthaew|ระบบสองแถวที่มีอยู่/ },
];
const DIFFS = [
  { key: "easy", re: /Easy|ง่าย/ },
  { key: "medium", re: /Medium|ปานกลาง/ },
  { key: "challenge", re: /Challenge|ท้าทาย/ },
  { key: "hard", re: /Hard|ยาก/ },
];

const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--no-sandbox","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });

async function playCell(goal, source, diff) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 850 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { localStorage.setItem("cm-onboarded","1"); localStorage.setItem("cm-cine-skip","1"); });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 200)); });
  const steps = [];
  const note = (s) => steps.push(s);
  const num = (re, txt) => { const m = txt.match(re); return m ? Number(m[1]) : null; };
  let cityScore0 = null, cityScore1 = null, day = null, built = false;

  try {
    await page.goto(URL, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(900);
    // select config
    await page.getByText(goal.re).first().click(); await page.waitForTimeout(120);
    await page.getByText(source.re).first().click(); await page.waitForTimeout(120);
    await page.getByRole("button", { name: diff.re }).first().click(); await page.waitForTimeout(120);
    const startBtn = page.getByRole("button", { name: /Begin your term|เริ่มวาระ/ });
    if (!(await startBtn.count())) { note("no Start button"); }
    await startBtn.first().click(); await page.waitForTimeout(500);
    const sk = page.getByRole("button", { name: /Skip intro ⏭|ข้ามฉาก ⏭/ }); if (await sk.count()) await sk.first().click();
    await page.waitForSelector("canvas", { timeout: 30000 }); await page.waitForTimeout(1500);
    const t0 = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
    cityScore0 = num(/(\d+)\s*\/\s*100/, t0);

    // build a metro line: Metro → Place stations → 3 clicks → Connect → 3 clicks → Finish
    await page.getByRole("button", { name: /^🚆|Metro|รถไฟฟ้า/ }).first().click().catch(() => note("metro btn fail"));
    await page.waitForTimeout(250);
    const pts = [[520, 440], [660, 420], [800, 450]];
    const place = page.getByRole("button", { name: /Place stations|วางสถานี/ });
    if (await place.count()) {
      await place.first().click(); await page.waitForTimeout(150);
      for (const [x, y] of pts) { await page.mouse.click(x, y); await page.waitForTimeout(140); }
      const conn = page.getByRole("button", { name: /Connect stations|เชื่อมสถานี/ });
      if (await conn.count() && await conn.first().isEnabled().catch(() => false)) {
        await conn.first().click(); await page.waitForTimeout(150);
        for (const [x, y] of pts) { await page.mouse.click(x, y); await page.waitForTimeout(140); }
        const fin = page.getByRole("button", { name: /✓ Finish|✓ เสร็จ/ });
        if (await fin.count() && await fin.first().isEnabled().catch(() => false)) { await fin.first().click(); built = true; }
      }
    } else note("no Place-stations tool");
    await page.waitForTimeout(1200);

    // fast-forward time: Speed → slider to 300×
    await page.getByRole("button", { name: /Speed|ความเร็ว/ }).first().click().catch(() => {});
    await page.waitForTimeout(250);
    const range = page.locator('input[type=range]');
    if (await range.count()) { await range.first().fill("300"); }
    await page.waitForTimeout(4000); // let several sim-days pass (events, briefings, crowding)

    // toggle overlays (People / Demand / Coverage) — exercise deck layers
    for (const re of [/People|ผู้คน/, /Demand|ความต้องการ/, /Coverage|ครอบคลุม/]) {
      const b = page.getByRole("button", { name: re }); if (await b.count()) { await b.first().click(); await page.waitForTimeout(350); }
    }
    // click an advisor face → advice popover
    const ploy = page.getByRole("button", { name: /^Ploy/ }); if (await ploy.count()) { await ploy.first().click(); await page.waitForTimeout(300); }

    const t1 = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
    cityScore1 = num(/(\d+)\s*\/\s*100/, t1);
    day = num(/day\s*(\d+)|วัน\s*(\d+)/i, t1) ?? num(/(\d+)\s*\/\s*\d+/, t1);
  } catch (e) {
    note("EXCEPTION: " + (e.message || String(e)).slice(0, 160));
  }
  await ctx.close();
  return { cell: `${goal.key}/${source.key}/${diff.key}`, goal: goal.key, source: source.key, diff: diff.key, built, cityScore0, cityScore1, day, steps, errors: errs.slice(0, 8), errorCount: errs.length };
}

const results = [];
for (const g of GOALS) for (const s of SOURCES) for (const d of DIFFS) {
  const r = await playCell(g, s, d);
  results.push(r);
  console.log(`${r.cell.padEnd(26)} built=${r.built?"Y":"n"} score ${r.cityScore0 ?? "?"}→${r.cityScore1 ?? "?"} errs=${r.errorCount}${r.steps.length?" · "+r.steps.join("; "):""}`);
}
await browser.close();

const withErrors = results.filter((r) => r.errorCount > 0);
const notBuilt = results.filter((r) => !r.built);
const summary = {
  cells: results.length,
  cellsWithErrors: withErrors.length,
  cellsBuildFailed: notBuilt.length,
  uniqueErrors: [...new Set(results.flatMap((r) => r.errors))].slice(0, 40),
  results,
};
fs.writeFileSync("/tmp/playtest-matrix.json", JSON.stringify(summary, null, 2));
console.log("\n=== SUMMARY ===");
console.log(`cells: ${summary.cells} · with console/page errors: ${summary.cellsWithErrors} · build failed: ${summary.cellsBuildFailed}`);
console.log("unique errors:", summary.uniqueErrors.length ? "\n - " + summary.uniqueErrors.join("\n - ") : "NONE ✓");
console.log("wrote /tmp/playtest-matrix.json");
