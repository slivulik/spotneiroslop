// E2E: player dock, right panels (lyrics / info / queue), queue editing, full screen, hotkeys,
// rapid switching. Usage: BASE=… EMAIL=… PASSWORD=… node e2e/player-flow.cjs
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
  await page.goto(BASE + "/login");
  await page.fill('input[name="email"]', process.env.EMAIL ?? "admin@e2e.example.com");
  await page.fill('input[name="password"]', process.env.PASSWORD ?? "e2e admin pass");
  await page.click('button[type="submit"]');
  await page.waitForURL(BASE + "/");
  await page.waitForTimeout(1200);
  await page.getByRole("link", { name: /Северное сияние/ }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Слушать" }).first().click();
  await page.waitForTimeout(2500);
  const dock = page.locator(".player-dock");
  check("player dock visible", await dock.isVisible());
  await page.screenshot({ path: `${OUT}/80-dock.png` });

  // Queue: play-next, remove, clear.
  await page.getByRole("button", { name: "Очередь", exact: true }).click();
  await page.waitForTimeout(600);
  const panel = page.locator('aside[aria-label="Очередь"]');
  const label = async () => (await panel.locator(".mono-label", { hasText: "Далее" }).innerText()).replace(/\D+/g, "");
  const n0 = Number(await label());
  check("queue panel opens with upcoming tracks", (await panel.isVisible()) && n0 >= 1, `next=${n0}`);
  const row = page.locator('li[id^="t-"]').nth(3);
  await row.hover();
  await row.getByRole("button", { name: "Ещё" }).click();
  await page.getByRole("menuitem", { name: "Слушать следующим" }).click();
  await page.waitForTimeout(500);
  const firstNext = await panel.getByRole("button", { name: /^Слушать: / }).nth(1).getAttribute("aria-label");
  const rowTitle = (await row.locator(".min-w-0 span").first().innerText()).split("\n")[0];
  check("'play next' puts the track first in the queue", rowTitle.startsWith(firstNext?.replace("Слушать: ", "") ?? "#"), `${firstNext} vs ${rowTitle}`);
  check("queue grew by one", Number(await label()) === n0 + 1);
  await panel.getByRole("button", { name: /^Убрать из очереди/ }).first().click();
  await page.waitForTimeout(300);
  check("remove shrinks the queue", Number(await label()) === n0);
  await page.screenshot({ path: `${OUT}/81-queue-panel.png` });
  await panel.getByRole("button", { name: "Очистить" }).click();
  await page.waitForTimeout(300);
  check("clear empties upcoming", Number(await label()) === 0);

  // Lyrics follow the track: no stale text after switching.
  await page.getByRole("button", { name: "Текст песни" }).click();
  await page.waitForTimeout(1200);
  const lyricsPanel = page.locator('aside[aria-label="Текст"]');
  const before = await lyricsPanel.innerText();
  await page.screenshot({ path: `${OUT}/82-lyrics-panel.png` });
  await page.getByRole("link", { name: /Северное сияние/ }).first().isVisible().catch(() => false);
  const second = page.locator('li[id^="t-"]').nth(2);
  await second.getByRole("button", { name: /^Слушать: / }).click();
  await page.waitForTimeout(2000);
  const after = await lyricsPanel.innerText();
  check("lyrics change with the track (no stale text)", before !== after, `${before.slice(0, 40)} → ${after.slice(0, 40)}`);

  // Info panel.
  await page.getByRole("button", { name: "О треке", exact: true }).first().click();
  await page.waitForTimeout(1200);
  check("info panel shows the playing track", (await page.locator('aside[aria-label="О треке"] h3').innerText()).length > 0);
  await page.screenshot({ path: `${OUT}/83-info-panel.png` });
  await page.getByRole("button", { name: "Закрыть панель" }).click();

  // Full screen: button opens, Escape closes; hotkey F toggles.
  await page.getByRole("button", { name: "Полноэкранный плеер" }).click();
  await page.waitForTimeout(900);
  check("full-screen player opens", await page.getByRole("dialog", { name: "Сейчас играет" }).isVisible());
  await page.screenshot({ path: `${OUT}/84-fullscreen.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  check("Escape closes full screen", !(await page.getByRole("dialog", { name: "Сейчас играет" }).isVisible()));

  // Space toggles play/pause.
  const pp = dock.getByRole("button", { name: /^(Пауза|Играть)$/ });
  const s0 = await pp.getAttribute("aria-label");
  await page.locator("body").press("Space");
  await page.waitForTimeout(600);
  const s1 = await pp.getAttribute("aria-label");
  check("Space toggles playback", s0 !== s1, `${s0} → ${s1}`);
  if (s1 === "Играть") await page.locator("body").press("Space");

  // Rapid switching: 12 next/prev clicks in a burst must leave one consistent playing state.
  await page.getByRole("button", { name: "Слушать" }).first().click();
  await page.waitForTimeout(1500);
  for (let i = 0; i < 12; i++) await dock.getByRole("button", { name: i % 3 === 2 ? "Предыдущий" : "Следующий" }).click({ delay: 10 });
  await page.waitForTimeout(3000);
  const finalState = await pp.getAttribute("aria-label");
  check("rapid next/prev settles in a playing state", finalState === "Пауза", finalState);

  check("no console/page/network errors", errors.length === 0, errors.slice(0, 5).join(" | "));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
  await browser.close();
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
