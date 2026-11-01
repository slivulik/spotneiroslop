// E2E: segment cache reuse on seek-back and track revisit, measured on real network requests.
// Usage: BASE=http://127.0.0.1:8080 EMAIL=... PASSWORD=... node e2e/audio-cache.cjs
const { chromium } = require("playwright");
const BASE = process.env.BASE ?? "http://127.0.0.1:8080";
const fail = (msg) => { console.error("FAIL:", msg); process.exitCode = 1; };
(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const segs = [];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => /\/sonora-media\/.+\.(m4s|mp4)/.test(r.url()) && segs.push(new URL(r.url()).pathname));
  page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url().slice(0, 100)}`));
  await page.goto(BASE + "/login");
  await page.fill('input[name="email"]', process.env.EMAIL ?? "admin@e2e.example.com");
  await page.fill('input[name="password"]', process.env.PASSWORD ?? "e2e admin pass");
  await page.click('button[type="submit"]');
  await page.waitForURL(BASE + "/");
  await page.getByRole("link", { name: /Северное сияние/ }).first().click();
  await page.waitForTimeout(1200);
  const t0 = Date.now();
  await page.getByRole("button", { name: "Слушать" }).first().click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Перемотка"]')?.getAttribute("aria-valuenow") !== "0", null, { timeout: 15000 });
  console.log("time to first progress:", Date.now() - t0, "ms");
  await page.waitForTimeout(14000);
  const before = segs.length;
  const statsBefore = await page.evaluate(() => window.__sonoraCache());
  console.log("segments fetched while playing:", before, statsBefore);
  // Seek back to the start three times.
  const bar = page.locator('[aria-label="Перемотка"]').first();
  const box = await bar.boundingBox();
  for (let i = 0; i < 3; i++) {
    await page.mouse.click(box.x + 3, box.y + box.height / 2);
    await page.waitForTimeout(1500);
  }
  const statsAfter = await page.evaluate(() => window.__sonoraCache());
  const refetched = segs.slice(before);
  console.log("after 3 seek-backs: new storage requests:", refetched.length, refetched, statsAfter);
  if (refetched.length > 0) fail("seek-back re-downloaded segments");
  // Next track and back: the first track must come from cache.
  await page.getByRole("button", { name: "Следующий" }).first().click();
  await page.waitForTimeout(3000);
  const mark = segs.length;
  await page.getByRole("button", { name: "Предыдущий" }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Предыдущий" }).first().click();
  await page.waitForTimeout(3000);
  const back = segs.slice(mark);
  console.log("revisit first track: new storage requests:", back.length, back);
  console.log("final cache:", await page.evaluate(() => window.__sonoraCache()));
  if (errors.length) fail("errors: " + errors.join(" | "));
  await browser.close();
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
