import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hash, report, expectedExecution } from "./report.mjs";
const root = process.argv[2] || ".artifacts";
const expected = expectedExecution();
const sameExecution = (r) => assert.deepEqual(r.execution, expected, `${r.suite}: execution mismatch`);
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}
const names = [
  "lint",
  "catalog",
  "unit",
  "coverage",
  "property",
  "pedagogy",
  "single-html",
  "visual-diff",
];
const inputs = files(root)
  .filter((p) => p.endsWith(".json"))
  .flatMap((p) => {
    try {
      const r = JSON.parse(readFileSync(p, "utf8"));
      return r.suite ? [{ path: p, result: r }] : [];
    } catch {
      return [];
    }
  });
mkdirSync("reports", { recursive: true });
for (const name of names) {
  const matches = inputs.filter((i) => i.result.suite === name);
  assert.equal(matches.length, 1, `Expected exactly one ${name} report`);
  const r = matches[0].result;
  assert.equal(r.htmlSha256, hash, `${name}: HTML mismatch`);
  assert.equal(r.commit, expected.runCommit);
  sameExecution(r);
  assert.equal(r.appVersion, "0.2");
  assert.equal(r.status, "PASS");
  writeFileSync(`reports/${name}.json`, JSON.stringify(r, null, 2));
}
const browserReports = inputs.filter((i) => i.result.suite === "e2e");
assert.equal(browserReports.length, 3, "Three browser shards required");
const seen = new Set(),
  cases = [];
for (const { result: r } of browserReports) {
  assert.equal(r.htmlSha256, hash);
  assert.equal(r.commit, expected.runCommit);
  sameExecution(r);
  assert.equal(r.appVersion, "0.2");
  assert.equal(r.status, "PASS");
  assert.equal(r.runnerStatus, "passed");
  assert(r.cases.length);
  const engines = new Set(r.cases.map((c) => c.browser));
  assert.equal(engines.size, 1);
  const [engine] = engines;
  assert(["chromium", "firefox", "webkit"].includes(engine));
  assert(!seen.has(engine));
  seen.add(engine);
  cases.push(...r.cases);
}
report("e2e", cases, {
  runnerStatus: "passed",
  engines: [...seen],
  aggregatedFrom: browserReports.map((i) => i.path),
});
console.log(
  "Collected current-HTML evidence from math, three browser engines and image comparison.",
);
