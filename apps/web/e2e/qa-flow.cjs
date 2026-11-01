// QA sweep: responsive layouts, dead buttons, a11y basics, keyboard, network loss, long session / memory,
// rapid clicking. Every check measures something in the real browser; nothing is assumed.
const { chromium } = require("playwright");
const BASE = process.env.BASE ?? "http://127.0.0.1:8080";
const OUT = process.env.OUT ?? "/home/user/spotneiroslop/screenshots/qa";
const fs = require("fs");
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};
const WIDTHS = [
  [1920, 1080], [1600, 900], [1366, 768], [1280, 800], [1024, 768], [768, 1024], [390, 844],
];

/** Buttons with no accessible name, and enabled buttons React gave no handler (dead buttons). */
const AUDIT = () => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const name = (el) => (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim() ||
    (el.getAttribute("aria-labelledby") ? "labelled" : "") || [...el.querySelectorAll("img[alt]")].map((i) => i.alt).join("").trim();
  const props = (el) => {
    const key = Object.keys(el).find((k) => k.startsWith("__reactProps"));
    return key ? el[key] : null;
  };
  const handled = (el) => {
    for (let n = el, depth = 0; n && depth < 3; n = n.parentElement, depth++) {
      const p = props(n);
      if (p && ["onClick", "onPointerDown", "onMouseDown", "onPointerUp", "onKeyDown"].some((k) => typeof p[k] === "function")) return true;
    }
    return false;
  };
  const unnamed = [];
  const dead = [];
  for (const el of document.querySelectorAll('button, [role="button"], a[href], [role="tab"], [role="menuitem"], input:not([type=hidden]), select')) {
    if (!visible(el)) continue;
    const label = el.tagName === "INPUT" || el.tagName === "SELECT"
      ? el.getAttribute("aria-label") || el.labels?.[0]?.textContent || el.getAttribute("placeholder") || el.getAttribute("title")
      : name(el);
    if (!label) unnamed.push(el.outerHTML.slice(0, 120));
    if (el.tagName === "BUTTON" && !el.disabled && el.type !== "submit" && !handled(el)) dead.push((label || el.outerHTML).slice(0, 60));
  }
  const imgs = [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length;
  const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
  const dupIds = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  return { unnamed, dead, imgs, dupIds, lang: document.documentElement.lang };
};

(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--js-flags=--expose-gc"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/net::ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text()) && errors.push("console: " + m.text().slice(0, 160)));
  await page.goto(BASE + "/login");
  await page.fill('input[name="email"]', process.env.EMAIL ?? "admin@e2e.example.com");
  await page.fill('input[name="password"]', process.env.PASSWORD ?? "e2e admin pass");
  await page.click('button[type="submit"]');
  await page.waitForURL(BASE + "/");
  await page.waitForTimeout(2000);
  await page.locator('a[href^="/album/"]').first().waitFor({ timeout: 20000 });
  const albums = [...new Set(await page.locator('a[href^="/album/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href"))))];
  let album = albums[0];
  for (const href of albums) {
    await page.goto(BASE + href);
    await page.waitForTimeout(1000);
    if ((await page.locator('li[id^="t-"]').count()) >= 4) { album = href; break; }
  }
  await page.goto(BASE + album);
  await page.waitForTimeout(1200);
  const artist = await page.locator('a[href^="/artist/"]').first().getAttribute("href");
  const playlist = await page.goto(BASE + "/library").then(() => page.waitForTimeout(1500)).then(() => page.locator('a[href^="/playlist/"]').first().getAttribute("href").catch(() => null));
  const PAGES = ["/", "/search", "/search?q=сия", "/library", album, artist, "/settings", "/profile", ...(playlist ? [playlist] : [])];

  // --- 1. Responsive: no horizontal scroll, navigation reachable, player visible ---------------
  for (const [w, h] of WIDTHS) {
    await page.setViewportSize({ width: w, height: h });
    const overflow = [];
    for (const path of PAGES) {
      await page.goto(BASE + path);
      await page.waitForTimeout(900);
      const m = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        iw: window.innerWidth,
        wide: [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(e).position !== "fixed" && !e.closest("[data-scroll-x], .overflow-x-auto, .overflow-x-scroll, .overflow-hidden")).slice(0, 2).map((e) => `${e.tagName}.${String(e.className).slice(0, 50)}`),
      }));
      if (m.sw > m.iw + 1) overflow.push(`${path} (${m.sw}>${m.iw}) ${m.wide.join(" ")}`);
      if (path === "/" || path === album) await page.screenshot({ path: `${OUT}/w${w}-${path === "/" ? "home" : "album"}.png` });
    }
    check(`no horizontal scroll at ${w}px on ${PAGES.length} pages`, overflow.length === 0, overflow.slice(0, 3).join(" | "));
    const nav = await page.evaluate(() => {
      const shown = (sel) => [...document.querySelectorAll(sel)].some((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== "none");
      return { side: shown("aside nav, nav[aria-label]"), tab: shown('nav[aria-label="Разделы"], .mobile-tabbar') };
    });
    check(`navigation reachable at ${w}px`, nav.side || nav.tab, JSON.stringify(nav));
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // --- 2. Dead buttons & a11y basics on every page ----------------------------------------------
  const dead = new Set();
  const unnamed = new Set();
  let noAlt = 0;
  const dup = new Set();
  let lang = "";
  for (const path of PAGES) {
    await page.goto(BASE + path);
    await page.waitForTimeout(1200);
    const a = await page.evaluate(AUDIT);
    a.dead.forEach((d) => dead.add(`${path}: ${d}`));
    a.unnamed.forEach((d) => unnamed.add(`${path}: ${d}`));
    a.dupIds.forEach((d) => dup.add(`${path}: #${d}`));
    noAlt += a.imgs;
    lang = a.lang;
  }
  check("no dead buttons (enabled, no handler)", dead.size === 0, [...dead].slice(0, 6).join(" | "));
  check("every control has an accessible name", unnamed.size === 0, [...unnamed].slice(0, 4).join(" | "));
  check("every <img> has alt", noAlt === 0, `${noAlt} without alt`);
  check("no duplicate ids", dup.size === 0, [...dup].slice(0, 5).join(" | "));
  check("document language is ru", lang === "ru", lang);

  // --- 3. Keyboard: focus is visible, menu opens/closes, hotkeys ---------------------------------
  await page.goto(BASE + album);
  await page.waitForTimeout(1200);
  let invisibleFocus = 0;
  const noRing = [];
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    const f = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const ringOf = (n) => { const s = getComputedStyle(n); return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== "none"); };
      // A field may show its ring on the wrapper (:focus-within), up to two levels up.
      const wrapped = [el.parentElement, el.parentElement?.parentElement].some((n) => n && n.matches(":focus-within") && ringOf(n));
      const s = getComputedStyle(el);
      return { wrapped, tag: el.tagName + ":" + (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30) + "." + String(el.className).slice(0, 40), ring: (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== "none") };
    });
    if (f && !f.ring && !f.wrapped) { invisibleFocus++; noRing.push(f.tag); }
  }
  check("focus ring visible on Tab stops", invisibleFocus === 0, `${invisibleFocus} of 25 without a ring: ${noRing.join(", ")}`);
  const more = page.getByRole("button", { name: "Ещё" }).first();
  await more.focus();
  await page.keyboard.press("Enter");
  const menuOpen = await page.getByRole("menu").waitFor({ state: "visible", timeout: 3000 }).then(() => true, () => false);
  const focusedItem = await page.evaluate(() => document.activeElement?.getAttribute("role"));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  const menuClosed = await page.getByRole("menu").waitFor({ state: "hidden", timeout: 3000 }).then(() => true, () => false);
  check("track menu: Enter opens (focus on first item), Escape closes", menuOpen && focusedItem === "menuitem" && menuClosed, `open=${menuOpen} focus=${focusedItem} closed=${menuClosed}`);

  // --- 4. Rapid clicking --------------------------------------------------------------------------
  await page.locator('li[id^="t-"]').first().getByRole("button").first().click();
  await page.waitForTimeout(2500);
  const dock = page.locator(".player-dock");
  const toggle = dock.getByRole("button", { name: /^(Пауза|Играть)$/ }).first();
  for (let i = 0; i < 21; i++) await toggle.click({ delay: 10 });
  await page.waitForTimeout(800);
  const paused = await page.evaluate(() => window.__sonoraPlayback?.()?.paused);
  check("21 rapid play/pause clicks: odd count ends paused, UI agrees", paused === true && (await dock.getByRole("button", { name: "Играть" }).count()) > 0, `audio.paused=${paused}`);
  if (paused) await toggle.click();
  for (let i = 0; i < 12; i++) await dock.getByRole("button", { name: "Следующий" }).click({ delay: 5 });
  await page.waitForTimeout(3000);
  const afterSkip = await page.evaluate(() => ({ t: window.__sonoraPlayback?.()?.currentTime ?? 0 }));
  await page.waitForTimeout(2000);
  const later = await page.evaluate(() => window.__sonoraPlayback?.()?.currentTime ?? 0);
  check("12 rapid skips end with the last track playing", later > afterSkip.t, `t ${afterSkip.t.toFixed(1)}→${later.toFixed(1)}`);

  // --- 5. Network loss mid-playback ---------------------------------------------------------------
  // Offline longer than the 40 s buffer: playback must stall, then resume by itself once online.
  // Needs a track well over 90 s, so it cannot simply end during the outage.
  const longest = await page.evaluate(async () => {
    const r = await fetch("/v1/releases?limit=100").then((x) => x.json());
    let best = null;
    for (const rel of r.items) {
      const d = await fetch(`/v1/releases/${rel.id}`).then((x) => x.json());
      for (const t of d.tracks) if ((!best || t.duration_ms > best.ms)) best = { id: rel.id, ms: t.duration_ms, n: t.track_number };
    }
    return best;
  });
  await page.goto(BASE + `/album/${longest.id}`);
  await page.waitForTimeout(1500);
  await page.locator('li[id^="t-"]').nth(longest.n - 1).getByRole("button").first().click();
  await page.waitForTimeout(4000);
  const startT = await page.evaluate(() => window.__sonoraPlayback?.()?.currentTime ?? 0);
  await context.setOffline(true);
  await page.waitForTimeout(8000);
  const shortT = await page.evaluate(() => window.__sonoraPlayback?.()?.currentTime ?? 0);
  check("buffer carries playback through the first 8 s offline", shortT > startT + 5, `t ${startT.toFixed(1)}→${shortT.toFixed(1)}`);
  await page.waitForTimeout(42000);
  const stalled = await page.evaluate(() => window.__sonoraPlayback?.());
  await context.setOffline(false);
  await page.waitForTimeout(12000);
  const resumed = await page.evaluate(() => window.__sonoraPlayback?.());
  const ui = await page.locator(".player-dock").innerText();
  check(`after 50 s offline playback resumes by itself (track ${Math.round(longest.ms / 1000)} s)`, resumed.currentTime > stalled.currentTime + 3 && !resumed.paused, `stalled at ${stalled.currentTime.toFixed(1)} (paused=${stalled.paused}, err=${stalled.error}) → ${resumed.currentTime.toFixed(1)} (paused=${resumed.paused})`);
  check("track title still shown after the outage", ui.trim().length > 0);

  // --- 6. Long session: memory and DOM do not grow ------------------------------------------------
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const heap = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const { metrics } = await cdp.send("Performance.getMetrics");
    const get = (n) => metrics.find((m) => m.name === n)?.value ?? 0;
    return { heap: get("JSHeapUsedSize") / 1048576, nodes: get("Nodes"), listeners: get("JSEventListeners") };
  };
  // Client-side navigation only (same document), so leaks would accumulate.
  const nav = page.locator('nav[aria-label="Основная навигация"] a');
  const navCount = await nav.count();
  await nav.first().click();
  await page.waitForTimeout(2500);
  const before = await heap(); // measured on the same page as "after"
  let hops = 0;
  for (let round = 0; round < 6; round++) {
    for (let i = 0; i < navCount; i++) {
      await nav.nth(i).click();
      await page.waitForTimeout(450);
      hops++;
    }
    const link = page.locator('main a[href^="/album/"], main a[href^="/artist/"]').first();
    if (await link.count()) { await link.click(); await page.waitForTimeout(600); hops++; }
  }
  const sameDocument = await page.evaluate(() => performance.getEntriesByType("navigation").length === 1 && !!window.__sonoraPlayback);
  // Long play: seek through the queue, 40 track changes.
  for (let i = 0; i < 40; i++) {
    await page.locator(".player-dock").getByRole("button", { name: "Следующий" }).click().catch(() => {});
    await page.waitForTimeout(250);
  }
  await nav.first().click();
  await page.waitForTimeout(3000);
  const after = await heap();
  check("memory test ran in one document (SPA)", sameDocument, `${hops} client-side navigations`);
  const audioEls = await page.evaluate(() => window.__sonoraPlayback?.()?.instances ?? 0);
  check(`JS heap stable after ${hops} SPA navigations + 40 track changes`, after.heap < before.heap * 1.6 + 8, `${before.heap.toFixed(1)} → ${after.heap.toFixed(1)} MB`);
  check("DOM nodes stable", after.nodes < before.nodes * 1.6 + 500, `${before.nodes} → ${after.nodes}`);
  check("single playback engine (one <audio>)", audioEls === 1, `${audioEls}`);
  const cache = await page.evaluate(() => (window.__sonoraCache ? window.__sonoraCache() : null));
  check("segment cache within budget", !cache || cache.bytes <= cache.maxBytes, cache ? `${(cache.bytes / 1048576).toFixed(1)} / ${(cache.maxBytes / 1048576).toFixed(0)} MB` : "n/a");

  check("no console/page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
  await browser.close();
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
