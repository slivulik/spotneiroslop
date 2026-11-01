// E2E: on a long hi-res track, seeking back past the MSE back buffer must be served from the
// segment cache (no repeated storage requests). Needs a track titled "Долгая дорога" (≥ 5 min).
const { chromium } = require("playwright");
const BASE = process.env.BASE ?? "http://127.0.0.1:8080";
(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const reqs = [];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => /\/sonora-media\/.+\.(m4s|mp4)/.test(r.url()) && reqs.push(new URL(r.url()).pathname.split("/").slice(-2).join("/")));
  await page.goto(BASE + "/login");
  await page.fill('input[name="email"]', process.env.EMAIL ?? "admin@e2e.example.com");
  await page.fill('input[name="password"]', process.env.PASSWORD ?? "e2e admin pass");
  await page.click('button[type="submit"]');
  await page.waitForURL(BASE + "/");
  await page.goto(BASE + "/search?q=Долгая");
  await page.waitForTimeout(1500);
  await page.getByText("Долгая дорога").first().click();
  await page.waitForTimeout(2500);
  await page.locator('select[aria-label="Качество воспроизведения"]').first().selectOption("hires").catch((e) => errors.push("quality select: " + e.message));
  await page.waitForTimeout(6000);
  const opts = await page.locator('select[aria-label="Качество воспроизведения"]').first().locator("option").allInnerTexts();
  console.log("quality options:", opts);
  const bar = page.locator('[aria-label="Перемотка"]').first();
  const box = await bar.boundingBox();
  const seek = async (f) => { await page.mouse.click(box.x + box.width * f, box.y + box.height / 2); };
  await seek(0.7);
  await page.waitForTimeout(6000);
  const mark = reqs.length;
  const statsMid = await page.evaluate(() => window.__sonoraCache());
  await seek(0.02);
  await page.waitForTimeout(5000);
  const after = reqs.slice(mark);
  const statsEnd = await page.evaluate(() => window.__sonoraCache());
  const hist = {}; for (const p of reqs.slice(0, mark)) { const q = p.split("/")[0]; hist[q] = (hist[q] ?? 0) + 1; }
  console.log("requests before seek-back:", mark, hist, reqs.slice(0, mark).filter((p) => p.startsWith("hires")).slice(0, 40).join(" "));
  console.log("seek-back requests:", after.length, after);
  console.log("cache mid:", statsMid, "\ncache end:", statsEnd);
  const seen = new Set(reqs.slice(0, mark));
  const repeated = after.filter((p) => seen.has(p));
  console.log("re-downloaded (already fetched before):", repeated.length, repeated);
  if (repeated.length) { console.error("FAIL: segments re-downloaded", repeated); process.exitCode = 1; }
  if (statsEnd.hits <= statsMid.hits) { console.error("FAIL: no cache hits on seek-back"); process.exitCode = 1; }
  if (errors.length) { console.error("errors:", errors); process.exitCode = 1; }
  await browser.close();
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
