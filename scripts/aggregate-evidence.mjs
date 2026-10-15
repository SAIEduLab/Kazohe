import { appVersion } from "./artifact.mjs";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hash, report, expectedExecution, readReports } from "./report.mjs";
import { validateEvidence } from "./release-gate.mjs";
import { manifest } from "./manifest.mjs";
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
export function collectEvidence(inputs, expected = expectedExecution()) {
  const sameExecution = (r) =>
    assert.deepEqual(r.execution, expected, `${r.suite}: execution mismatch`);
  inputs = inputs.filter((i) => i.result?.suite);
  const reports = {};
  for (const name of names) {
    const matches = inputs.filter((i) => i.result.suite === name);
    assert.equal(matches.length, 1, `Expected exactly one ${name} report`);
    const r = matches[0].result;
    assert.equal(r.htmlSha256, hash, `${name}: HTML mismatch`);
    assert.equal(r.commit, expected.runCommit);
    sameExecution(r);
    assert.equal(r.appVersion, appVersion);
    assert.equal(r.status, "PASS");
    reports[name] = r;
  }
  const browserReports = inputs.filter((i) => i.result.suite === "e2e");
  assert.equal(browserReports.length, 3, "Three browser shards required");
  const seen = new Set(),
    cases = [];
  for (const { result: r } of browserReports) {
    assert.equal(r.htmlSha256, hash);
    assert.equal(r.commit, expected.runCommit);
    sameExecution(r);
    assert.equal(r.appVersion, appVersion);
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
  reports.e2e = {
    ...browserReports[0].result,
    cases,
    runnerStatus: "passed",
    engines: [...seen],
    aggregatedFrom: browserReports.map((i) => i.path),
  };
  validateEvidence(reports, hash, manifest, expected);
  return reports;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const reports = collectEvidence(
      readReports(process.argv[2] || ".artifacts"),
    );
    mkdirSync("reports", { recursive: true });
    for (const [name, result] of Object.entries(reports))
      writeFileSync(`reports/${name}.json`, JSON.stringify(result, null, 2));
    report("aggregate", [
      { id: "automatic-evidence", method: "aggregate", status: "PASS" },
    ]);
    console.log(
      "Collected current-HTML evidence from math, three browser engines and image comparison.",
    );
  } catch (error) {
    report("aggregate", [
      {
        id: "automatic-evidence",
        method: "aggregate",
        status: "FAIL",
        actual: error.stack,
      },
    ]);
    console.error(error);
    process.exitCode = 1;
  }
}
