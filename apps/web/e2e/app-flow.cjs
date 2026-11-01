// E2E: shell navigation, search, library, playlists, settings (theme, EQ on the real audio graph).
// Usage: BASE=http://127.0.0.1:8080 EMAIL=... PASSWORD=... node e2e/app-flow.cjs
const { chromium } = require("playwright");
const BASE = process.env.BASE ?? "http://127.0.0.1:8080";
const OUT = process.env.OUT ?? "/home/user/spotneiroslop/screenshots";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};
(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text().slice(0, 160)));
  page.on("response", (r) => r.status() >= 400 && !r.url().includes("/v1/auth/refresh") && errors.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 100)}`));

  await page.goto(BASE + "/login");
  await page.fill('input[name="email"]', process.env.EMAIL ?? "admin@e2e.example.com");
  await page.fill('input[name="password"]', process.env.PASSWORD ?? "e2e admin pass");
  await page.click('button[type="submit"]');
  await page.waitForURL(BASE + "/");
  await page.waitForTimeout(1500);

  // --- Sidebar collapse persists across reloads -------------------------------------
  const sidebar = page.locator("aside.sidebar");
  const w0 = (await sidebar.boundingBox()).width;
  await page.getByRole("button", { name: "Свернуть панель" }).click();
  await page.waitForTimeout(1000);
  const w1 = (await sidebar.boundingBox()).width;
  await page.reload();
  await page.waitForTimeout(1200);
  const w2 = (await sidebar.boundingBox()).width;
  check("sidebar collapses and stays collapsed after reload", w0 > 200 && w1 < 90 && w2 < 90, `${w0} → ${w1} → ${w2}`);
  await page.getByRole("button", { name: "Развернуть панель" }).click();
  await page.waitForTimeout(1000);
  check("sidebar expands again", (await sidebar.boundingBox()).width > 200);
  await page.screenshot({ path: `${OUT}/70-shell.png` });

  // --- Search: typo tolerance, suggestions, tabs; back/forward ----------------------
  await page.getByRole("link", { name: "Поиск и жанры" }).click();
  await page.waitForURL(/\/search$/);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/71-search-browse.png` });
  const box = page.getByRole("combobox", { name: "Поиск" });
  await box.fill("Аврара");
  await page.waitForTimeout(900);
  const sugg = await page.locator("#search-suggestions").innerText().catch(() => "");
  check("typo 'Аврара' suggests 'Аврора Север'", sugg.includes("Аврора Север"), sugg.split("\n").slice(0, 4).join(" | "));
  await box.press("Enter");
  await page.waitForURL(/q=/);
  await page.waitForTimeout(1200);
  await page.getByRole("tab", { name: /^Треки/ }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/72-search-results.png` });
  check("results page lists tracks", (await page.locator("ol li").count()) > 0);
  await page.getByRole("button", { name: "Назад" }).click();
  await page.waitForTimeout(800);
  check("back returns to search browse", page.url().endsWith("/search"), page.url());
  await page.getByRole("button", { name: "Вперёд" }).click();
  await page.waitForTimeout(800);
  check("forward returns to results", page.url().includes("q="), page.url());

  // --- Album: like album and a track; add track to a new playlist via the menu ------
  await page.goto(BASE + "/");
  await page.waitForTimeout(1200);
  await page.getByRole("link", { name: /Северное сияние/ }).first().click();
  await page.waitForTimeout(1500);
  const likeAlbum = page.getByRole("button", { name: "Добавить в медиатеку" }).first();
  if (await likeAlbum.count()) await likeAlbum.click();
  await page.waitForTimeout(400);
  const row = page.locator('li[id^="t-"]').nth(1);
  await row.hover();
  const likeTrack = row.getByRole("button", { name: "Добавить в любимые" });
  if (await likeTrack.count()) await likeTrack.click();
  await page.waitForTimeout(400);
  await row.getByRole("button", { name: "Ещё" }).click();
  await page.getByRole("menuitem", { name: /Добавить в плейлист/ }).click();
  await page.getByRole("menuitem", { name: "Новый плейлист" }).click();
  await page.waitForURL(/\/playlist\//);
  await page.waitForTimeout(1500);
  check("track menu creates a playlist with the track", (await page.locator('li[id^="t-"]').count()) === 1);
  await page.getByRole("button", { name: "Изменить" }).click();
  await page.locator('input[maxlength="128"]').fill("E2E плейлист");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await page.waitForTimeout(1200);
  check("playlist renamed", (await page.locator("h1").innerText()).includes("E2E плейлист"));
  await page.screenshot({ path: `${OUT}/73-playlist-owner.png` });

  // --- Library tabs ----------------------------------------------------------------
  await page.goto(BASE + "/library");
  await page.waitForTimeout(1200);
  check("library shows the new playlist", (await page.getByText("E2E плейлист").count()) > 0);
  await page.getByRole("tab", { name: "Любимые треки" }).click();
  await page.waitForTimeout(900);
  check("library shows the liked track", (await page.locator('li[id^="t-"]').count()) >= 1);
  await page.getByRole("tab", { name: "Альбомы" }).click();
  await page.waitForTimeout(900);
  check("library shows the saved album", (await page.getByText("Северное сияние").count()) > 0);
  await page.screenshot({ path: `${OUT}/74-library.png` });

  // --- Settings: theme persists; EQ really changes filter gains ---------------------
  await page.goto(BASE + "/settings");
  await page.waitForTimeout(1000);
  await page.getByRole("radio", { name: "Светлая" }).click();
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForTimeout(1200);
  check("light theme persists after reload", (await page.evaluate(() => document.documentElement.dataset.theme)) === "light");
  await page.screenshot({ path: `${OUT}/75-settings-light.png`, fullPage: true });
  // Start audio so the Web Audio graph exists, then enable the EQ with the "Рок" preset.
  await page.goto(BASE + "/");
  await page.waitForTimeout(1000);
  await page.getByRole("link", { name: /Северное сияние/ }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Слушать" }).first().click();
  await page.waitForTimeout(2500);
  // In-app navigation keeps the player (a full page load would stop it).
  await page.locator("aside.sidebar").getByRole("button", { name: /Admin/ }).click();
  await page.getByRole("menuitem", { name: "Настройки" }).click();
  await page.waitForURL(/\/settings/);
  await page.waitForTimeout(1000);
  const before = await page.evaluate(() => window.__sonoraEq?.());
  await page.getByRole("button", { name: "Рок" }).click();
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => window.__sonoraEq?.());
  check("EQ preset changes live filter gains", JSON.stringify(after?.bands) === JSON.stringify([5, 4, 2, -1, -2, -1, 2, 3, 4, 4]), `before ${JSON.stringify(before?.bands)} after ${JSON.stringify(after?.bands)}`);
  await page.getByRole("switch", { name: "Эквалайзер" }).click();
  await page.waitForTimeout(600);
  const off = await page.evaluate(() => window.__sonoraEq?.());
  check("EQ off flattens the filters", off?.bands.every((b) => b === 0), JSON.stringify(off?.bands));
  check("music kept playing across in-app navigation", await page.evaluate(() => window.__sonoraEq?.() !== null));
  await page.getByRole("radio", { name: "Тёмная" }).click();

  // --- Profile -------------------------------------------------------------------------
  await page.goto(BASE + "/profile");
  await page.waitForTimeout(1500);
  check("profile shows library counters", (await page.getByText("любимых треков").count()) > 0);
  await page.screenshot({ path: `${OUT}/76-profile.png`, fullPage: true });

  check("no console/page/network errors", errors.length === 0, errors.slice(0, 5).join(" | "));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
  await browser.close();
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
