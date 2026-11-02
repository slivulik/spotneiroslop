// E2E: personal home (wave, continue, mixes, artists), endless wave refill, artist page, mix page.
const { chromium } = require("playwright");
const BASE = process.env.BASE ?? "http://127.0.0.1:8080";
const OUT = process.env.OUT ?? "/home/user/spotneiroslop/screenshots";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};
(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text().slice(0, 160)));
  page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url().slice(0, 100)}`));
  let waveCalls = 0;
  page.on("request", (r) => r.url().includes("/v1/me/wave") && waveCalls++);
  await page.goto(BASE + "/login");
  await page.fill('input[name="email"]', process.env.EMAIL ?? "admin@e2e.example.com");
  await page.fill('input[name="password"]', process.env.PASSWORD ?? "e2e admin pass");
  await page.click('button[type="submit"]');
  await page.waitForURL(BASE + "/");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/90-home-personal.png` });
  await page.screenshot({ path: `${OUT}/90-home-personal-full.png`, fullPage: true });
  check("wave card on home", await page.getByRole("button", { name: /Моя волна/ }).isVisible());
  check("continue listening present", (await page.getByRole("group", { name: "Продолжить слушать" }).count()) > 0);

  await page.getByRole("button", { name: /Моя волна/ }).click();
  await page.waitForTimeout(2500);
  const ctx = await page.evaluate(() => JSON.parse(localStorage.getItem("sonora-player") ?? "{}").state?.context?.type);
  check("wave starts playing with a wave context", ctx === "wave", ctx);
  // Skip through the wave: the queue must be topped up from the server without repeats.
  const dock = page.locator(".player-dock");
  for (let i = 0; i < 12; i++) {
    await dock.getByRole("button", { name: "Следующий" }).click();
    await page.waitForTimeout(700);
  }
  const queue = await page.evaluate(() => JSON.parse(localStorage.getItem("sonora-player") ?? "{}").state?.queue?.items?.map((t) => t.id) ?? []);
  check("wave refilled from the server", waveCalls >= 2, `wave requests=${waveCalls}, queue=${queue.length}`);
  const firstBatch = queue.slice(0, 12);
  check("first batch has no repeats", new Set(firstBatch).size === firstBatch.length, `${queue.length} items in queue`);
  check("wave keeps going past the catalogue size", queue.length > 12, `${queue.length}`);

  await page.goto(BASE + "/");
  await page.waitForTimeout(1500);
  const mixLink = page.locator('a[href^="/mix/"]').first();
  if (await mixLink.count()) {
    await mixLink.click();
    await page.waitForTimeout(1500);
    check("mix page lists tracks", (await page.locator('li[id^="t-"]').count()) >= 3);
    await page.screenshot({ path: `${OUT}/91-mix.png` });
  } else {
    console.log("SKIP mix page — no mixes for this account (no genre data in the test catalogue)");
  }

  await page.goto(BASE + "/");
  await page.waitForTimeout(1200);
  await page.getByRole("link", { name: /Северное сияние/ }).first().click();
  await page.waitForTimeout(1200);
  await page.locator('a[href^="/artist/"]').first().click();
  await page.waitForTimeout(2000);
  check("artist page shows live listeners", (await page.getByText(/слушателей за месяц/).count()) > 0);
  check("artist stats section", (await page.getByRole("heading", { name: "Статистика" }).count()) > 0);
  await page.screenshot({ path: `${OUT}/92-artist.png`, fullPage: true });

  check("no console/page/network errors", errors.length === 0, errors.slice(0, 5).join(" | "));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
  await browser.close();
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
