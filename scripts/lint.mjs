import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { parse } from "parse5";
import { parse as parseJS } from "acorn";
import { html } from "./load-inline-core.mjs";
import { suite, hash } from "./report.mjs";
import { manifest, tcIds } from "./manifest.mjs";
import { K } from "./load-inline-core.mjs";
import { validateEvidence } from "./release-gate.mjs";
const s = suite("lint");
s.check("html-js-syntax", () => {
  const errors = [];
  const tree = parse(html, { onParseError: (e) => errors.push(e) });
  assert.deepEqual(errors, []);
  const ids = new Set();
  function visit(n) {
    for (const a of n.attrs || [])
      if (a.name === "id") {
        assert(!ids.has(a.value));
        ids.add(a.value);
      }
    if (n.tagName === "script")
      parseJS(n.childNodes.map((c) => c.value || "").join(""), {
        ecmaVersion: "latest",
      });
    (n.childNodes || []).forEach(visit);
  }
  visit(tree);
});
s.check("TC-D01", () => {
  for (const path of ["README.md", "CHANGELOG.md", "LICENSE"])
    assert(existsSync(path));
  for (const path of ["README.md", "CHANGELOG.md"]) {
    const text = readFileSync(path, "utf8");
    assert(!text.includes("かぞへ.html"));
    for (const m of text.matchAll(/\]\(([^)]+)\)/g))
      if (!/^(https?:|#)/.test(m[1]))
        assert(existsSync(m[1].split("#")[0]), m[1]);
  }
  const receipt = JSON.parse(
    readFileSync("tests/fixtures/input-receipt.json", "utf8"),
  );
  assert.equal(receipt.markdownFiles, 7);
  assert.equal(receipt.replacements, 8);
  assert.equal(receipt.remainingOldNames, 0);
  assert(receipt.onlyExactReplacement);
});
s.check("TC-D02", () => {
  assert.equal(tcIds.length, 221);
  assert.equal(new Set(tcIds).size, 221);
  assert.equal(new Set(manifest.map((c) => c.id)).size, 221);
  const ownership = JSON.parse(
    readFileSync("tests/fixtures/implementation-map.json", "utf8"),
  );
  const required = [
    "001",
    "002",
    "010",
    "011",
    "012",
    "020",
    "021",
    "022",
    "030",
    "031",
    "040",
    "041",
    "042",
    "050",
    "051",
    "060",
    "061",
    "062",
    "070",
    "071",
    "072",
    "080",
    "081",
    "082",
    "083",
    "084",
    "090",
    "091",
    "100",
    "101",
    "102",
    "103",
    "110",
    ...Array.from({ length: 11 }, (_, i) => String(200 + i)),
  ].map((n) => `KZ-${n}`);
  assert.deepEqual(ownership.map((o) => o.id).sort(), required.sort());
  for (const owner of ownership) {
    assert(existsSync(owner.file), `${owner.id}: missing owner`);
    const source = readFileSync(owner.file, "utf8");
    assert(owner.symbols.length && owner.tests.length, owner.id);
    for (const symbol of owner.symbols)
      assert(source.includes(symbol), `${owner.id}: missing ${symbol}`);
    for (const id of owner.tests)
      assert(
        tcIds.some((tc) => (/\d$/.test(id) ? tc === id : tc.startsWith(id))),
        `${owner.id}: unknown test ${id}`,
      );
  }
});
s.check("TC-D03", () => {
  const receipt = JSON.parse(
    readFileSync("tests/fixtures/input-receipt.json", "utf8"),
  );
  assert.equal(
    receipt.referenceSha256,
    "b3fa503c066e9f26c886ad7e26e043811fd83b01260f283447d298dfb5b09b1b",
  );
});
s.check("TC-D04", () => {
  const receipt = JSON.parse(
    readFileSync("tests/fixtures/input-receipt.json", "utf8"),
  );
  assert.notEqual(hash, receipt.referenceSha256);
  assert.equal(K.CATALOG.length, 101);
});
s.check("TC-D05", () => {
  const codes = new Set([
    "M1A1",
    "M1A2",
    "M2A1",
    "M2A2",
    "M2A3",
    "M3A1",
    "M3A2",
    "M3A3",
    "M3A4",
    "M3A5",
    "M3A6",
    "M3A7",
    "M4A1",
    "M4A2",
    "M4A3",
    "M4A4",
    "M4A5",
    "M4A6",
    "M4A7",
    "M5A1",
    "M5A2",
    "M5A3",
    "M5A4",
    "M5A5",
    "M5A6",
    "M6A1",
    "M6A2",
  ]);
  for (const c of K.CATALOG) assert(c.sourceCodes.every((s) => codes.has(s)));
  assert(html.includes("このアプリ独自の設計"));
});
s.check("TC-D06", () => {
  assert.throws(() => validateEvidence({}, hash, manifest));
  const sample = {};
  for (const name of [
    "lint",
    "catalog",
    "unit",
    "coverage",
    "property",
    "pedagogy",
    "single-html",
    "e2e",
    "visual-diff",
  ])
    sample[name] = {
      status: "PASS",
      htmlSha256: hash,
      appVersion: "0.2",
      cases: [{ id: "control", status: "PASS" }],
    };
  for (const c of manifest.filter(
    (c) => !["visual", "device"].includes(c.method),
  )) {
    const name = c.method === "browser" ? "e2e" : c.method;
    for (const browser of c.method === "browser"
      ? ["chromium", "firefox", "webkit"]
      : [null])
      sample[name].cases.push({ id: c.id, status: "PASS", browser });
  }
  sample.property.generatorCounts = Object.fromEntries(
    K.CATALOG.map((c) => [c.id, { count: 1000, buckets: { control: 1000 } }]),
  );
  sample["visual-diff"].comparisons = Array.from({ length: 16 }, () => ({
    changedPixels: 1,
  }));
  sample["visual-diff"].baseCommit = "fixture-base";
  sample.pedagogy.generatorCoverage = Object.fromEntries(
    K.CATALOG.map((c) => [c.id, { count: 40 }]),
  );
  assert(validateEvidence(sample, hash, manifest));
  for (const mutate of [
    (r) => {
      delete r.unit;
    },
    (r) => {
      r.unit.htmlSha256 = "different HTML";
    },
    (r) => {
      r.unit.cases[1].status = "SKIP";
    },
    (r) => {
      r.unit.cases = r.unit.cases.filter((c) => c.id !== "TC-M01");
    },
    (r) => {
      r.e2e.cases = r.e2e.cases.filter((c) => c.browser !== "firefox");
    },
    (r) => {
      r.property.generatorCounts["G1-N01"].count = 999;
    },
    (r) => {
      delete r.pedagogy;
    },
    (r) => {
      r["visual-diff"].comparisons = [];
    },
    (r) => {
      r.e2e.cases = r.e2e.cases.filter((c) => c.id !== "TC-U05");
    },
  ]) {
    const invalid = structuredClone(sample);
    mutate(invalid);
    assert.throws(() => validateEvidence(invalid, hash, manifest));
  }
});
s.check("TC-D07", () => {
  const cfg = readFileSync("playwright.config.mjs", "utf8");
  for (const engine of ["chromium", "firefox", "webkit"])
    assert(cfg.includes(engine));
  assert(cfg.includes("retries:0") || cfg.includes("retries: 0"));
  assert(!/\.skip\s*\(/.test(readFileSync("tests/e2e/app.spec.mjs", "utf8")));
});
s.check("public-boundary-and-secrets", () => {
  const privateNames = [
    "AGENTS.md",
    "アプリ仕様兼詳細設計図.md",
    "1〜6年チャレンジ一覧＋前提技能ツリー.md",
    "学習内容根拠.md",
    "テストケース.md",
    "監査項目.md",
    "GitHubAction.md",
    "九九練習チャレンジ.html",
  ];
  for (const n of privateNames) assert(!existsSync(n));
  assert(!/localStorage\.clear\s*\(/.test(html));
  assert(
    !/gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/.test(
      html,
    ),
  );
});
s.done();
