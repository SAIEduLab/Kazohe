import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { K } from "./load-inline-core.mjs";
import { hash } from "./report.mjs";
const evidence = JSON.parse(
  readFileSync(
    `reports/${process.env.E2E_REPORT_NAME || "e2e-chromium"}.json`,
    "utf8",
  ),
);
assert.equal(
  evidence.htmlSha256,
  hash,
  "Images must belong to the current HTML",
);
assert.equal(evidence.runnerStatus, "passed");
assert(
  evidence.cases.some(
    (c) => c.id === "TC-B05" && c.browser === "chromium" && c.status === "PASS",
  ),
  "Full catalog image run required",
);
const root = "reports/screens/contact";
mkdirSync(root, { recursive: true });
const browser = await chromium.launch(),
  page = await browser.newPage({ viewport: { width: 1080, height: 800 } }),
  files = [];
try {
  for (let first = 0; first < K.CATALOG.length; first += 6) {
    const ids = K.CATALOG.slice(first, first + 6),
      name = String(first + 1).padStart(3, "0");
    const cards = ids
      .map((c) => {
        const image = readFileSync(
          `reports/screens/catalog/${c.id}-solution.png`,
        ).toString("base64");
        return `<section><h2>${c.id} ${c.title}</h2><img alt="${c.id} help" src="data:image/png;base64,${image}"></section>`;
      })
      .join("");
    const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>かぞへ 全技能の支援画面</title><style>body{margin:12px;font:13px system-ui;background:#e8ece9;color:#243857}main{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;align-items:start}section{background:white;border:1px solid #b0beb7;padding:6px;min-width:0}h1{font-size:16px}h2{font-size:13px;margin:4px 0 8px}img{width:100%;display:block}</style><h1>全技能の支援画面 / ${name}–${first + ids.length}</h1><p>HTML ${hash} / 画像生成は目視確認の代わりではありません。</p><main>${cards}</main></html>`;
    writeFileSync(`${root}/${name}.html`, html);
    await page.goto(pathToFileURL(resolve(`${root}/${name}.html`)).href);
    await page
      .locator("img")
      .evaluateAll((xs) => Promise.all(xs.map((i) => i.decode())));
    await page.screenshot({ path: `${root}/${name}.png`, fullPage: true });
    files.push(`${name}.png`);
  }
  writeFileSync(
    `${root}/index.json`,
    JSON.stringify(
      {
        htmlSha256: hash,
        files,
        ids: K.CATALOG.map((c) => c.id),
        visualApproval: "NOT_RUN",
      },
      null,
      2,
    ),
  );
  console.log(
    `${files.length} contact sheets; visual review remains separate.`,
  );
} finally {
  await browser.close();
}
