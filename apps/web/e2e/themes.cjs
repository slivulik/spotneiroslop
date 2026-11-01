// Screenshots of key screens in both themes + console/network error check.
const { chromium } = require("playwright");
const BASE = process.env.BASE ?? "http://127.0.0.1:8080";
const OUT = process.env.OUT ?? "/home/user/spotneiroslop/screenshots";
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  for (const theme of ["dark", "light"]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    await ctx.addInitScript((t) => localStorage.setItem("sonora-settings", JSON.stringify({ state: { theme: t, accent: "default" }, version: 1 })), theme);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${theme}: ${e.message}`));
    page.on("response", (r) => r.status() >= 400 && errors.push(`${theme}: ${r.status()} ${r.url().slice(0, 90)}`));
    await page.goto(BASE + "/login");
    await page.fill('input[name="email"]', "admin@e2e.example.com");
    await page.fill('input[name="password"]', "e2e admin pass");
    await page.click('button[type="submit"]');
    await page.waitForURL(BASE + "/");
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/60-${theme}-home.png` });
    await page.getByRole("link", { name: /Северное сияние/ }).first().click();
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Слушать" }).first().click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/61-${theme}-album.png` });
    await page.goto(BASE + "/admin");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/62-${theme}-admin.png` });
    console.log(theme, "data-theme =", await page.evaluate(() => document.documentElement.dataset.theme));
    await ctx.close();
  }
  console.log(JSON.stringify({ errors }, null, 2));
  await browser.close();
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
