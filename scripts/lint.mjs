import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
});
s.check("TC-D02", () => {
  const expected = [
    ...[["M", 70], ["G", 18], ["S", 14], ["F", 30],
        ["T", 16], ["P", 28], ["B", 18], ["U", 12], ["E", 8]]
      .flatMap(([group, count]) =>
        Array.from({ length: count }, (_, i) =>
          `TC-${group}${String(i + 1).padStart(2, "0")}`)),
    ...["01", "02", "04", "05", "06", "07"].map(n => `TC-D${n}`),
  ];
  assert.deepEqual([...tcIds].sort(), expected.sort());
  assert.equal(new Set(tcIds).size, expected.length);
  assert.equal(new Set(manifest.map(c => c.id)).size, expected.length);
  assert.deepEqual([...new Set(manifest.map(c => c.id))].sort(), expected);
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
  const oracle = JSON.parse(readFileSync("tests/fixtures/catalog.json", "utf8"));
  assert.deepEqual(K.CATALOG, source);
  assert.deepEqual(K.CATALOG, oracle);
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
  const fixture = {
    repository: "SAIEduLab/Kazohe", runId: "123", runAttempt: "1",
    event: "pull_request", runCommit: "a".repeat(40), headCommit: "b".repeat(40),
    headHtmlSha256: hash,
  };
  const sample = {};
  for (const name of [
    "lint", "catalog", "unit", "coverage", "property", "pedagogy",
    "single-html", "e2e", "visual-diff",
  ])
    sample[name] = {
      suite: name, status: "PASS", htmlSha256: hash, appVersion: "0.2",
      commit: fixture.runCommit, execution: { ...fixture },
      cases: [{
        id: "control", title: "control", browser: "chromium", status: "PASS",
      }],
    };
  for (const c of manifest.filter(c => !["visual", "device"].includes(c.method))) {
    const name = c.method === "browser" ? "e2e" : c.method;
    for (const browser of c.method === "browser"
      ? ["chromium", "firefox", "webkit"] : [null])
      sample[name].cases.push({
        id: c.id, browser, title: `${c.id}/${browser}`, status: "PASS",
      });
  }
  sample.e2e.runnerStatus = "passed";
  sample.coverage.linePercent = 90;
  sample.coverage.branchPercent = 90;
  sample.property.generatorCounts = Object.fromEntries(
    K.CATALOG.map(c => [c.id, { count: 1000, buckets: { control: 1000 } }]),
  );
  sample.pedagogy.generatorCoverage = Object.fromEntries(
    K.CATALOG.map(c => [c.id, { count: 40 }]),
  );
  sample["visual-diff"].baseCommit = "c".repeat(40);
  sample["visual-diff"].baseHtmlSha256 = hash;
  sample["visual-diff"].candidateHtmlSha256 = hash;
  sample["visual-diff"].visualApproval = "NOT_RUN";
  sample["visual-diff"].comparisons = [390, 1366].flatMap(width =>
    ["menu", "G1-C03", "G2-C02", "G3-C02", "G3-C07",
      "G4-C12", "G5-N08", "G6-C05"].map(id =>
      ({ id, width, changedPixels: 0 })));
  assert(validateEvidence(sample, hash, manifest, fixture));
  for (const mutate of [
    r => { delete r.unit; },
    r => { r.unit.htmlSha256 = "different HTML"; },
    r => { r.unit.commit = fixture.headCommit; },
    r => { r.unit.execution.runId = "old run"; },
    r => { r.unit.execution.repository = "other/repo"; },
    r => { r.unit.cases[1].status = "NOT_RUN"; },
    r => { r.unit.cases = r.unit.cases.filter(c => c.id !== "TC-M01"); },
    r => { r.unit.cases.push(structuredClone(r.unit.cases[1])); },
    r => { r.e2e.cases = r.e2e.cases.filter(c => c.browser !== "firefox"); },
    r => { r.e2e.cases.push(structuredClone(r.e2e.cases[1])); },
    r => { r.e2e.runnerStatus = "failed"; },
    r => { r.property.generatorCounts["G1-N01"].count = 999; },
    r => { r.pedagogy.generatorCoverage["G1-N01"].count = 39; },
    r => { r.coverage.branchPercent = 89.9; },
    r => { r["visual-diff"].baseCommit = fixture.runCommit; },
    r => { r["visual-diff"].comparisons.pop(); },
    r => { r["visual-diff"].comparisons[1] = r["visual-diff"].comparisons[0]; },
  ]) {
    const invalid = structuredClone(sample);
    mutate(invalid);
    assert.throws(() => validateEvidence(invalid, hash, manifest, fixture));
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
  const allowed = new Set([
    ".gitattributes", ".gitignore", ".github/workflows/audit.yml",
    "CHANGELOG.md", "Kazohe.html", "LICENSE", "README.md",
    "docs/verification.md", "package.json", "package-lock.json",
    "playwright.config.mjs",
    ...["app.js", "catalog.json", "core.js", "shell.html", "style.css", "view.js"]
      .map(name => `src/${name}`),
    ...["aggregate-evidence", "audit-catalog", "audit-release",
      "audit-single-html", "build", "coverage", "independent-math-oracle",
      "lint", "load-inline-core", "manifest", "release-gate", "report",
      "review-gallery", "run-unit", "test-reporter", "visual-diff"]
      .map(name => `scripts/${name}.mjs`),
    ...["e2e/app.spec.mjs", "e2e/usability.spec.mjs",
      "evidence/visual-review.json", "fixtures/catalog.json",
      "fixtures/implementation-map.json", "fixtures/representatives.mjs",
      "fixtures/tc-ids.json", "property/domain-contracts.mjs",
      "property/generators.mjs", "unit/core.mjs", "unit/pedagogy.mjs"]
      .map(name => `tests/${name}`),
  ]);
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0").filter(Boolean);
  assert.deepEqual([...tracked].sort(), [...allowed].sort(),
    "Public tracked-file allowlist mismatch");
  for (const path of tracked) {
    const content = readFileSync(path, "utf8");
    assert(!/SAIEduLab\/(?:Kazohe2|Kazohe-dev)/.test(content),
      `${path}: old or private repository dependency`);
    assert(!/gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/.test(content),
      `${path}: secret pattern`);
  }
  assert(!/localStorage\.clear\s*\(/.test(html));
});
s.done();
