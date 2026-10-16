import {
  htmlName,
  appVersion,
  assertCurrentArtifact,
  filename,
} from "./artifact.mjs";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parse } from "parse5";
import { parse as parseJS } from "acorn";
import { html } from "./load-inline-core.mjs";
import { suite } from "./report.mjs";
import { manifest, tcIds } from "./manifest.mjs";
import { K } from "./load-inline-core.mjs";
import { registerGateCheck } from "./lint-gate.mjs";
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
  for (const path of ["README.md", "CHANGELOG.md", "LICENSE", "index.html"])
    assert(existsSync(path));
  for (const path of ["README.md", "CHANGELOG.md"]) {
    const text = readFileSync(path, "utf8");
    assert(!text.includes("かぞへ.html"));
    for (const m of text.matchAll(/\]\(([^)]+)\)/g))
      if (!/^(https?:|#)/.test(m[1]))
        assert(existsSync(m[1].split("#")[0]), m[1]);
  }
  const site = readFileSync("index.html", "utf8");
  const errors = [];
  const tree = parse(site, { onParseError: (e) => errors.push(e) });
  assert.deepEqual(errors, []);
  const nodes = [];
  (function visit(node) {
    nodes.push(node);
    (node.childNodes || []).forEach(visit);
  })(tree);
  const attr = (node, name) =>
    (node.attrs || []).find((a) => a.name === name)?.value;
  const text = (node) =>
    (node.childNodes || [])
      .map((child) => (child.nodeName === "#text" ? child.value : text(child)))
      .join("");
  const htmlNode = nodes.find((node) => node.tagName === "html");
  assert.equal(attr(htmlNode, "lang"), "ja");
  assert(
    nodes.some(
      (node) => node.tagName === "meta" && attr(node, "name") === "viewport",
    ),
  );
  assert(
    nodes.some(
      (node) => node.tagName === "title" && text(node).includes("かぞへ"),
    ),
  );
  assert.equal(nodes.filter((node) => node.tagName === "script").length, 0);
  const ids = new Set(nodes.map((node) => attr(node, "id")).filter(Boolean));
  for (const id of ["main", "features", "howto", "license"])
    assert(ids.has(id));
  const links = nodes.filter((node) => node.tagName === "a");
  const hrefs = new Set(links.map((node) => attr(node, "href")));
  for (const href of [
    `./${htmlName}`,
    "./LICENSE",
    "./README.md",
    "https://github.com/SAIEduLab/Kazohe",
  ])
    assert(hrefs.has(href), `index.html: missing link ${href}`);
  for (const href of hrefs)
    if (href && !/^(https?:|#)/.test(href))
      assert(existsSync(href.split("#")[0].replace(/^\.\//, "")), href);
  const siteText = text(htmlNode).replace(/\s+/g, " ");
  for (const required of [
    "小学1〜6年",
    "101チャレンジ",
    "使い方",
    "MIT License",
    "正式リリース前",
  ])
    assert(siteText.includes(required), `index.html: missing ${required}`);
});
s.check("TC-D02", () => {
  assert.equal(new Set(tcIds).size, tcIds.length);
  assert.deepEqual(
    [...new Set(manifest.map((c) => c.id))].sort(),
    [...tcIds].sort(),
  );
  const ownership = JSON.parse(
    readFileSync("tests/fixtures/implementation-map.json", "utf8"),
  );
  const required = [
    "001",
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
    "092",
    "093",
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
s.check("TC-D04", () => {
  const source = JSON.parse(readFileSync("src/catalog.json", "utf8"));
  const oracle = JSON.parse(
    readFileSync("tests/fixtures/catalog.json", "utf8"),
  );
  assert.equal(JSON.stringify(K.CATALOG), JSON.stringify(source));
  assert.equal(JSON.stringify(K.CATALOG), JSON.stringify(oracle));
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
registerGateCheck(s);
s.check("TC-D07", () => {
  const cfg = readFileSync("playwright.config.mjs", "utf8");
  for (const engine of ["chromium", "firefox", "webkit"])
    assert(cfg.includes(engine));
  assert(cfg.includes("retries:0") || cfg.includes("retries: 0"));
  for (const path of ["tests/e2e/app.spec.mjs", "tests/e2e/site.spec.mjs"])
    assert(!/\.skip\s*\(/.test(readFileSync(path, "utf8")));
});
s.check("public-boundary-and-secrets", () => {
  const allowed = new Set([
    ".gitattributes",
    ".gitignore",
    ".github/workflows/audit.yml",
    "CHANGELOG.md",
    htmlName,
    "LICENSE",
    "README.md",
    "index.html",
    "docs/verification.md",
    "package.json",
    "package-lock.json",
    "playwright.config.mjs",
    ...[
      "app.js",
      "catalog.json",
      "core.js",
      "shell.html",
      "style.css",
      "view.js",
      "teaching.js",
      "language.js",
      "language.json",
      "written.js",
    ].map((name) => `src/${name}`),
    ...[
      "artifact",
      "aggregate-evidence",
      "audit-catalog",
      "audit-release",
      "audit-single-html",
      "build",
      "coverage",
      "independent-math-oracle",
      "lint",
      "lint-gate",
      "load-inline-core",
      "manifest",
      "release-gate",
      "report",
      "review-gallery",
      "run-unit",
      "test-reporter",
      "visual-diff",
    ].map((name) => `scripts/${name}.mjs`),
    ...[
      "e2e/app.spec.mjs",
      "e2e/site.spec.mjs",
      "e2e/usability.spec.mjs",
      "e2e/teaching.spec.mjs",
      "evidence/visual-review.json",
      "fixtures/catalog.json",
      "fixtures/implementation-map.json",
      "fixtures/representatives.mjs",
      "fixtures/support-navigation.mjs",
      "fixtures/written-oracle.mjs",
      "fixtures/v0.2.4-backup.json",
      "property/domain-contracts.mjs",
      "property/generators.mjs",
      "unit/core.mjs",
      "unit/pedagogy.mjs",
    ].map((name) => `tests/${name}`),
  ]);
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  assert.deepEqual(
    [...tracked].sort(),
    [...allowed].sort(),
    "Public tracked-file allowlist mismatch",
  );
  for (const path of tracked) {
    const content = readFileSync(path, "utf8");
    assert(
      !/SAIEduLab\/(?:Kazohe2|Kazohe-dev)/.test(content),
      `${path}: old or private repository dependency`,
    );
    assert(
      !/gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/.test(
        content,
      ),
      `${path}: secret pattern`,
    );
  }
  assert(!/localStorage\.clear\s*\(/.test(html));
});
s.check("versioned-product-contract", () => {
  assertCurrentArtifact();
  assert.equal(K.APP_VERSION, appVersion);
  assert.equal(filename("12.3.45"), "Kazohe_12_3_45.html");
  assert.throws(() => filename("0.2"));
  assert.throws(() => filename("../0.2.3"));
  assert.throws(() => assertCurrentArtifact([htmlName, "Kazohe.html"]));
  assert.throws(() => assertCurrentArtifact([htmlName, filename("99.0.0")]));
  assert.throws(() => assertCurrentArtifact([filename("99.0.0")]));
  assertCurrentArtifact([htmlName, "index.html", "src/shell.html"]);
});
s.done();
