import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 850 } })).newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
const hud = async () => (await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ")));
const num = (s) => { // "฿47.2M" / "฿820k" / "-฿5k" -> number
  if (!s) return NaN; const neg = s.includes("-"); const m = s.match(/([\d.]+)\s*([Mk]?)/);
  if (!m) return NaN; let v = parseFloat(m[1]); if (m[2] === "M") v *= 1e6; else if (m[2] === "k") v *= 1e3;
  return neg ? -v : v;
};
const money = async () => {
  // top-left budget = the big ฿ figure on the title panel; net = ".../day"
  const r = await page.evaluate(() => {
    const t = document.body.innerText;
    const net = (t.match(/([+\-]?฿[\d.]+[Mk]?)\s*\/\s*day/) || [])[1] || "";
    const day = (t.match(/day (\d+)/) || [])[1] || "?";
    return { net, day, full: t.replace(/\s+/g, " ") };
  });
  const budgetM = (r.full.match(/Transit\s*([\w\d]+)?.*?฿([\d.]+)M/) || [])[2];
  return { netStr: r.net, net: num(r.net), day: r.day, full: r.full };
};

await page.goto(URL, { waitUntil: "load", timeout: 45000 });
await page.waitForFunction(() => document.body.innerText.includes("Choose a mode to begin"), { timeout: 45000 }).catch(() => {});
await page.getByText("Campaign").click(); // the mode WITH bankruptcy — the real test
await page.waitForTimeout(3000);
const box = await page.evaluate(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const px = (fx) => box.x + box.w * fx, py = (fy) => box.y + box.h * fy;
const build = async (pts) => {
  await page.getByRole("button", { name: /วางสถานี/ }).click();
  for (const p of pts) { await page.mouse.click(px(p[0]), py(p[1])); await page.waitForTimeout(160); }
  await page.getByRole("button", { name: /วางราง/ }).click();
  await page.waitForTimeout(150);
  for (const p of pts) { await page.mouse.click(px(p[0]), py(p[1])); await page.waitForTimeout(170); }
  await page.getByRole("button", { name: /Finish/ }).click();
  await page.waitForTimeout(500);
};
// two downtown lines (the scenario the user said bled money)
await build([[0.34, 0.48], [0.40, 0.49], [0.46, 0.48], [0.52, 0.50], [0.58, 0.48], [0.64, 0.49]]);
// pick a second colour automatically (pickTool 'track' chooses a free colour); build a crossing line
await build([[0.50, 0.40], [0.50, 0.46], [0.50, 0.52], [0.50, 0.58]]);

await page.getByRole("button", { name: "300×" }).click().catch(() => {});
await page.waitForTimeout(4000);
const m1 = await money();
await page.waitForTimeout(9000); // let a few sim-hours pass
const m2 = await money();
const h = await hud();
const lines = (h.match(/YOUR NETWORK · (\d+)/) || [])[1] || "0";
const riders = (h.match(/Riders\/day ([\d,]+)/) || [])[1] || "?";
const waiting = (h.match(/Waiting ([\d,]+)/) || [])[1] || "?";
const bankrupt = h.includes("Bankrupt");
const budgetEarly = (m1.full.match(/\/ day .*?฿([\d.]+)M/) || [])[1];
console.log("LINES", lines);
console.log("NET/DAY (later)", m2.netStr, "→", m2.net >= 0 ? "✓ PROFIT" : "✗ loss");
console.log("RIDERS/DAY", riders, "WAITING", waiting);
console.log("BANKRUPT", bankrupt ? "✗ went bankrupt" : "✓ solvent");
console.log("ERRORS", JSON.stringify(errors.slice(0, 8)));
await page.screenshot({ path: "/tmp/cm-money.png" });
await browser.close();
