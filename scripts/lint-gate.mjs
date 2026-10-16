import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appVersion } from "./artifact.mjs";
import { K } from "./load-inline-core.mjs";
import {
  hash,
  summaryRows,
  executionSummary,
  expectedExecution,
} from "./report.mjs";
import { collectEvidence } from "./aggregate-evidence.mjs";
import { manifest } from "./manifest.mjs";
import { validateEvidence, validManualProvenance } from "./release-gate.mjs";

// TC-D06: the acceptance gate must reject forged, missing or mismatched evidence.
export function registerGateCheck(s) {
  s.check("TC-D06", () => {
    assert.throws(() => validateEvidence({}, hash, manifest));
    const execution = expectedExecution();
    const environment = Object.fromEntries(
      ["GITHUB_ACTIONS", "GITHUB_SHA", "AUDIT_HEAD_SHA"].map((key) => [
        key,
        process.env[key],
      ]),
    );
    try {
      process.env.GITHUB_ACTIONS = "true";
      process.env.GITHUB_SHA = "0".repeat(40);
      assert.throws(() => expectedExecution(), /Checked-out commit differs/);
      process.env.GITHUB_SHA = execution.runCommit;
      process.env.AUDIT_HEAD_SHA = "0".repeat(40);
      assert.throws(() =>
        execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            "import { expectedExecution } from './scripts/report.mjs'; expectedExecution();",
          ],
          { stdio: "pipe" },
        ),
      );
    } finally {
      for (const [key, value] of Object.entries(environment))
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    const fixture = {
      repository: "SAIEduLab/Kazohe",
      runId: "123",
      runAttempt: "1",
      event: "pull_request",
      runCommit: "a".repeat(40),
      headCommit: "b".repeat(40),
      headHtmlSha256: hash,
    };
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
        suite: name,
        status: "PASS",
        htmlSha256: hash,
        appVersion,
        commit: fixture.runCommit,
        execution: { ...fixture },
        cases: [
          {
            id: "control",
            title: "control",
            browser: "chromium",
            status: "PASS",
          },
        ],
      };
    for (const c of manifest.filter(
      (c) => !["visual", "device"].includes(c.method),
    )) {
      const name = c.method === "browser" ? "e2e" : c.method;
      for (const browser of c.method === "browser"
        ? ["chromium", "firefox", "webkit"]
        : [null])
        sample[name].cases.push({
          id: c.id,
          browser,
          title: `${c.id}/${browser}`,
          status: "PASS",
        });
    }
    sample.e2e.runnerStatus = "passed";
    sample.coverage.linePercent = 90;
    sample.coverage.branchPercent = 90;
    sample.property.generatorCounts = Object.fromEntries(
      K.CATALOG.map((c) => [c.id, { count: 1000, buckets: { control: 1000 } }]),
    );
    sample.pedagogy.generatorCoverage = Object.fromEntries(
      K.CATALOG.map((c) => [c.id, { count: 40 }]),
    );
    sample["visual-diff"].baseCommit = "c".repeat(40);
    sample["visual-diff"].baseHtmlSha256 = hash;
    sample["visual-diff"].candidateHtmlSha256 = hash;
    sample["visual-diff"].visualApproval = "NOT_RUN";
    sample["visual-diff"].comparisons = [390, 1366].flatMap((width) =>
      [
        "welcome",
        "menu",
        "G1-C03",
        "G2-C02",
        "G3-C02",
        "G3-C07",
        "G4-C12",
        "G5-N08",
        "G6-C05",
      ].map((id) => ({ id, width, changedPixels: 0 })),
    );
    assert(validateEvidence(sample, hash, manifest, fixture));
    const inputsFor = (reports) => [
      ...Object.entries(reports)
        .filter(([name]) => name !== "e2e")
        .map(([name, result]) => ({ path: `artifacts/${name}.json`, result })),
      ...["chromium", "firefox", "webkit"].map((browser) => ({
        path: `artifacts/e2e-${browser}.json`,
        result: {
          ...reports.e2e,
          cases: reports.e2e.cases.filter((c) => c.browser === browser),
        },
      })),
    ];
    const inputs = inputsFor(sample);
    assert(collectEvidence(inputs, fixture));
    const names = inputs.map((i) => i.path.split("/").at(-1).slice(0, -5));
    assert(
      summaryRows(inputs, fixture, names).every((r) => r.status === "PASS"),
    );
    const markdown = executionSummary(inputs, fixture, names, "success");
    for (const value of [
      fixture.repository,
      fixture.runCommit,
      fixture.headCommit,
      hash,
      "run: 123",
      "attempt: 1",
      "[Logs]",
      "[Artifacts]",
      "NOT_RUN",
    ])
      assert(markdown.includes(value), value);
    assert.equal(summaryRows([], fixture, ["unit"])[0].status, "NOT_RUN");
    for (const patch of [
      { commit: fixture.headCommit },
      { htmlSha256: "different HTML" },
      ...[
        { repository: "other/repo" },
        { runId: "old run" },
        { runAttempt: "2" },
        { headCommit: "d".repeat(40) },
        { headHtmlSha256: "different HTML" },
      ].map((change) => ({ execution: { ...fixture, ...change } })),
    ]) {
      const different = inputs.map((i) =>
        i.result.suite === "unit"
          ? { ...i, result: { ...i.result, ...patch } }
          : i,
      );
      assert.equal(summaryRows(different, fixture, ["unit"])[0].status, "FAIL");
      assert.throws(() => collectEvidence(different, fixture));
    }
    for (const badInputs of [
      [...inputs, inputs.find((i) => i.result.suite === "unit")],
      inputs.map((i) =>
        i.result.suite === "unit" ? { ...i, result: null } : i,
      ),
      inputs.map((i) =>
        i.result.suite === "unit"
          ? { ...i, result: { ...i.result, cases: [] } }
          : i,
      ),
      inputs.map((i) =>
        i.result.suite === "unit"
          ? {
              ...i,
              result: {
                ...i.result,
                cases: [
                  {
                    id: "exception",
                    status: "FAIL",
                    actual: "exception | <error>\nstack",
                  },
                ],
              },
            }
          : i,
      ),
      inputs.map((i) =>
        i.result.suite === "unit"
          ? {
              ...i,
              result: {
                ...i.result,
                cases: [{ id: "skipped", status: "NOT_RUN" }],
              },
            }
          : i,
      ),
    ]) {
      assert.equal(summaryRows(badInputs, fixture, ["unit"])[0].status, "FAIL");
      assert.throws(() => collectEvidence(badInputs, fixture));
    }
    const timedOut = inputs.map((i) =>
      i.path.endsWith("e2e-firefox.json")
        ? { ...i, result: { ...i.result, runnerStatus: "timedout" } }
        : i,
    );
    assert.equal(
      summaryRows(timedOut, fixture, ["e2e-firefox"])[0].status,
      "FAIL",
    );
    assert.throws(() => collectEvidence(timedOut, fixture));
    const failedGate = [
      {
        path: "reports/aggregate.json",
        result: {
          ...sample.unit,
          suite: "aggregate",
          cases: [
            {
              id: "automatic-evidence",
              status: "FAIL",
              actual: "Missing case: TC-M01/unit",
            },
          ],
          status: "FAIL",
        },
      },
    ];
    assert(
      executionSummary(failedGate, fixture, ["aggregate"], "failure").includes(
        "TC-M01/unit",
      ),
    );
    const reviewed = {
      htmlSha256: hash,
      targetRepository: "SAIEduLab/Kazohe",
      targetCommit: "c".repeat(40),
      reviewedRunId: "123",
    };
    const hasHtml = () => true;
    assert(validManualProvenance(reviewed, hash, fixture, hasHtml));
    for (const invalid of [
      { ...reviewed, targetRepository: "other/repo" },
      { ...reviewed, targetCommit: "d".repeat(40) },
      { ...reviewed, reviewedRunId: null },
      { ...reviewed, htmlSha256: "other" },
    ])
      assert(
        !validManualProvenance(
          invalid,
          hash,
          fixture,
          (commit) => commit === reviewed.targetCommit,
        ),
      );
    assert(!validManualProvenance(reviewed, hash, fixture, () => false));
    for (const mutate of [
      (r) => {
        delete r.unit;
      },
      (r) => {
        r.unit.htmlSha256 = "different HTML";
      },
      (r) => {
        r.unit.commit = fixture.headCommit;
      },
      (r) => {
        r.unit.execution.runId = "old run";
      },
      (r) => {
        r.unit.execution.repository = "other/repo";
      },
      (r) => {
        r.unit.cases[1].status = "NOT_RUN";
      },
      (r) => {
        r.unit.cases = r.unit.cases.filter((c) => c.id !== "TC-M01");
      },
      (r) => {
        r.unit.cases.push(structuredClone(r.unit.cases[1]));
      },
      (r) => {
        r.e2e.cases = r.e2e.cases.filter((c) => c.browser !== "firefox");
      },
      (r) => {
        r.e2e.cases.push(structuredClone(r.e2e.cases[1]));
      },
      (r) => {
        r.e2e.runnerStatus = "failed";
      },
      (r) => {
        r.property.generatorCounts["G1-N01"].count = 999;
      },
      (r) => {
        r.pedagogy.generatorCoverage["G1-N01"].count = 39;
      },
      (r) => {
        r.coverage.branchPercent = 89.9;
      },
      (r) => {
        r["visual-diff"].baseCommit = fixture.runCommit;
      },
      (r) => {
        r["visual-diff"].comparisons.pop();
      },
      (r) => {
        r["visual-diff"].comparisons[1] = r["visual-diff"].comparisons[0];
      },
    ]) {
      const invalid = structuredClone(sample);
      mutate(invalid);
      assert.throws(() => validateEvidence(invalid, hash, manifest, fixture));
      assert.throws(() => collectEvidence(inputsFor(invalid), fixture));
    }
  });
}
