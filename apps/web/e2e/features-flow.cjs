// E2E: everyday streaming features — radio from a track / an artist, sleep timer with fade-out,
// keyboard shortcuts overlay. Usage: BASE=… EMAIL=… PASSWORD=… node e2e/features-flow.cjs
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
  await page.clock.install();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url().slice(0, 100)}`));
  await page.goto(BASE + "/login");
  await page.fill('input[name="email"]', process.env.EMAIL ?? "admin@e2e.example.com");
  await page.fill('input[name="password"]', process.env.PASSWORD ?? "e2e admin pass");
  await page.click('button[type="submit"]');
  await page.waitForURL(BASE + "/");
  await page.waitForTimeout(1200);
  await page.getByRole("link", { name: /Северное сияние/ }).first().click();
  await page.waitForTimeout(1200);

  // Radio from a track: starts with that track, context reads "Радио: …", queue keeps flowing.
  const row = page.locator('li[id^="t-"]').first();
  const title = (await row.locator("a, span").first().innerText()).trim();
  await row.hover();
  await row.getByRole("button", { name: "Ещё" }).click();
  await page.getByRole("menuitem", { name: "Радио по треку" }).click();
  await page.waitForTimeout(2500);
  const ctx = await page.evaluate(() => JSON.parse(localStorage.getItem("sonora-player") ?? "{}")?.state?.context ?? null);
  check("track radio sets a radio context", ctx?.type === "wave" && String(ctx?.id).startsWith("track:") && /^Радио: /.test(ctx?.title ?? ""), JSON.stringify(ctx));
  const q = await page.evaluate(() => JSON.parse(localStorage.getItem("sonora-player") ?? "{}")?.state?.queue ?? null);
  const firstId = q ? q.items[q.order[q.cursor]]?.id : null;
  check("track radio starts with the seed track", firstId && ctx?.id === `track:${firstId}`, `${title} ${firstId}`);
  check("track radio queues similar tracks", (q?.items.length ?? 0) > 1, `items=${q?.items.length}`);

  // Sleep timer: 15 min shows a countdown; jumping the clock fades out and pauses.
  await page.getByRole("button", { name: "Таймер сна" }).first().click();
  await page.getByRole("menuitemradio", { name: "15 минут" }).click();
  await page.waitForTimeout(400);
  const timerLabel = await page.locator('button[aria-label^="Таймер сна:"]').first().getAttribute("aria-label");
  check("sleep timer shows minutes left", /15 мин/.test(timerLabel ?? ""), timerLabel ?? "");
  await page.screenshot({ path: `${OUT}/90-sleep.png` });
  const snap = () => page.evaluate(() => window.__sonoraPlayback?.() ?? null);
  const vol0 = (await snap())?.volume ?? null;
  await page.clock.fastForward("14:55");
  await page.clock.runFor(12_000);
  await page.waitForTimeout(800);
  const after = (await snap()) ?? {};
  check("sleep timer pauses after a fade and restores volume", after.paused === true && Math.abs((after.volume ?? 0) - (vol0 ?? 1)) < 0.01, JSON.stringify({ vol0, ...after }));
  check("sleep timer clears itself", (await page.locator('button[aria-label^="Таймер сна:"]').count()) === 0);

  // "Until the end of the track" and cancel.
  await page.getByRole("button", { name: "Таймер сна" }).first().click();
  await page.getByRole("menuitemradio", { name: "До конца трека" }).click();
  check("end-of-track timer is shown", (await page.locator('button[aria-label="Таймер сна: трек"]').count()) > 0);
  await page.locator('button[aria-label="Таймер сна: трек"]').first().click();
  await page.getByRole("menuitem", { name: "Выключить таймер" }).click();
  check("sleep timer can be cancelled", (await page.locator('button[aria-label^="Таймер сна:"]').count()) === 0);

  // Shortcuts: "?" shows the overlay, Esc closes it, "/" focuses search.
  await page.locator("body").click({ position: { x: 700, y: 450 } }).catch(() => {});
  await page.keyboard.press("Shift+Slash");
  await page.waitForTimeout(300);
  const dialog = page.getByRole("dialog", { name: "Горячие клавиши" });
  check("? opens shortcuts", await dialog.isVisible());
  await page.screenshot({ path: `${OUT}/91-shortcuts.png` });
  await page.keyboard.press("Escape");
  check("Esc closes shortcuts", !(await dialog.isVisible()));
  await page.keyboard.press("Slash");
  check("/ focuses search", await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Поиск"));
  await page.keyboard.press("Escape");

  // Artist radio.
  await page.goto(BASE + "/");
  await page.waitForTimeout(1000);
  const artistLink = page.locator('a[href^="/artist/"]').first();
  await artistLink.click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /^Радио: / }).click();
  await page.waitForTimeout(2500);
  const ctx2 = await page.evaluate(() => JSON.parse(localStorage.getItem("sonora-player") ?? "{}")?.state?.context ?? null);
  check("artist radio sets a radio context", ctx2?.type === "wave" && String(ctx2?.id).startsWith("artist:"), JSON.stringify(ctx2));
  await page.screenshot({ path: `${OUT}/92-artist-radio.png` });

  check("no page errors / failed requests", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
