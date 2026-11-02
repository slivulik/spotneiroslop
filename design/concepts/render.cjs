const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
  for (const c of ["A", "B", "C"]) for (const v of ["home", "lyrics"]) {
    await p.goto(`file://${__dirname}/concept.html?c=${c}&v=${v}`); await p.waitForTimeout(600);
    await p.screenshot({ path: `${__dirname}/${c}-${v}.png` });
  }
  await b.close();
})();
