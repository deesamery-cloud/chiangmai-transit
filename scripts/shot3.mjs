import { chromium } from "playwright-core";

const URL = process.argv[2] || "http://localhost:3001";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await page.goto(URL, { waitUntil: "load", timeout: 30000 });
await page.waitForTimeout(5500);

// dismiss onboarding, speed up
await page.getByRole("button", { name: /build/ }).click();
await page.getByRole("button", { name: "60×", exact: true }).click();
await page.waitForTimeout(3500);

const routes = {
  Bus: [[320, 440], [520, 425], [720, 425], [915, 440]],
  Tram: [[640, 300], [640, 420], [648, 540], [655, 645]],
  Metro: [[345, 305], [640, 435], [935, 560]],
  "สองแถว": [[360, 470], [430, 515], [395, 585]],
};

for (const [label, pts] of Object.entries(routes)) {
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await page.getByRole("button", { name: /Draw/ }).click();
  await page.waitForTimeout(250);
  for (const [x, y] of pts) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(180);
  }
  await page.getByRole("button", { name: /Finish/ }).click();
  await page.waitForTimeout(800);
}

await page.waitForTimeout(6000); // let all modes pick up riders
await page.screenshot({ path: "/tmp/cm-multi.png" });

const net = await page.evaluate(() => {
  const t = document.body.innerText;
  return t.replace(/\s+/g, " ").slice(0, 460);
});
console.log("ERRORS " + JSON.stringify(errors.slice(0, 20)));
console.log("HUD " + JSON.stringify(net));
await browser.close();
