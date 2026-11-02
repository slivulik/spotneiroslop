// Frame-time and rendering-cost probe: home page, music playing, scripted scroll. Prints numbers only.
const { chromium } = require("playwright");
const BASE = process.env.BASE ?? "http://127.0.0.1:8080";
(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE + "/login");
  await p.fill('input[name="email"]', "admin@e2e.example.com");
  await p.fill('input[name="password"]', "e2e admin pass");
  await p.click('button[type="submit"]');
  await p.waitForURL(BASE + "/");
  await p.waitForTimeout(2500);
  const album = await p.locator('a[href^="/album/"]').first().getAttribute("href");
  await p.goto(BASE + album); await p.waitForTimeout(1200);
  await p.locator('li[id^="t-"]').first().getByRole("button").first().click();
  await p.waitForTimeout(1500);
  await p.goto(BASE + "/"); await p.waitForTimeout(2500);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Performance.enable");
  const m = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
  const a = await m();
  const frames = await p.evaluate(async () => {
    const dts = []; let last = performance.now(); let run = true;
    const tick = (t) => { dts.push(t - last); last = t; if (run) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const el = document.scrollingElement;
    for (let i = 0; i < 60; i++) { el.scrollBy(0, i < 30 ? 40 : -40); await new Promise((r) => setTimeout(r, 33)); }
    await new Promise((r) => setTimeout(r, 2000)); // idle while playing
    run = false;
    dts.sort((x, y) => x - y);
    const q = (f) => dts[Math.floor(dts.length * f)].toFixed(1);
    return { n: dts.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), over20: dts.filter((d) => d > 20).length };
  });
  const z = await m();
  const d = (k) => Math.round(z[k] - a[k]);
  console.log(JSON.stringify({ frames, styleRecalcs: d("RecalcStyleCount"), layouts: d("LayoutCount"), recalcMs: Math.round((z.RecalcStyleDuration - a.RecalcStyleDuration) * 1000), layoutMs: Math.round((z.LayoutDuration - a.LayoutDuration) * 1000), scriptMs: Math.round((z.ScriptDuration - a.ScriptDuration) * 1000), taskMs: Math.round((z.TaskDuration - a.TaskDuration) * 1000), backdrop: await p.evaluate(() => [...document.querySelectorAll("*")].filter((e) => getComputedStyle(e).backdropFilter !== "none").length) }));
  await b.close();
})();
