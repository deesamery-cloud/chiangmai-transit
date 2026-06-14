import { chromium } from "playwright-core";
const URL = process.env.CM_URL || "http://localhost:3001";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 850 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: "load", timeout: 45000 });
await page.waitForFunction(() => document.body.innerText.includes("Choose a mode to begin"), { timeout: 45000 }).catch(() => {});
await page.getByText("Sandbox").click();
await page.waitForTimeout(4000);
// pause so the agent field is static, then hide POIs to isolate the OD arcs
await page.getByRole("button", { name: "⏸" }).click().catch(() => {});
await page.waitForTimeout(400);
await page.getByText("Real places (POIs)").click();
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/cm-6-arcs-only.png" });
// then POIs back on, hide trip flows
await page.getByText("Real places (POIs)").click();
await page.getByText("Trip flows (O→D)").click();
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/cm-7-pois-only.png" });
console.log("ERRORS", JSON.stringify(errors.slice(0, 10)));
await browser.close();
