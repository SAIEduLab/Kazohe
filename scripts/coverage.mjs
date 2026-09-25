import inspector from "node:inspector";
import { writeFileSync, mkdirSync } from "node:fs";
const session = new inspector.Session();
session.connect();
const post = (method, params = {}) =>
  new Promise((resolve, reject) =>
    session.post(method, params, (error, result) =>
      error ? reject(error) : resolve(result),
    ),
  );
await post("Profiler.enable");
await post("Profiler.startPreciseCoverage", {
  callCount: true,
  detailed: true,
});
await import("../tests/unit/core.mjs");
const { result } = await post("Profiler.takePreciseCoverage");
await post("Profiler.stopPreciseCoverage");
session.disconnect();
const { coreSource } = await import("./load-inline-core.mjs");
const script = result.find((s) => s.url.endsWith("Kazohe.html"));
if (!script) throw Error("Distribution core coverage missing");
// The gate covers all numerical, grading, scoring, metrics, clock and save code.
const names = [
  "gcd",
  "lcm",
  "rat",
  "number",
  "calc",
  "cmp",
  "decimal",
  "decimalPlaces",
  "format",
  "roundExact",
  "normalizeInput",
  "judge",
  "scoreCorrect",
  "normalizeConfig",
  "createRun",
  "present",
  "finish",
  "reduceRun",
  "deriveMetrics",
  "runMetrics",
  "eligibility",
  "evaluateFallback",
  "bestKey",
  "emptySave",
  "checkpoint",
  "applyResult",
  "recommendConfig",
  "clearScores",
  "validateBackup",
  "storageAdapter",
];
const selected = script.functions.filter((f) => names.includes(f.functionName));
const allRanges = script.functions.flatMap((f) => f.ranges);
let lines = 0,
  coveredLines = 0,
  branches = 0,
  coveredBranches = 0;
const details = [];
for (const f of selected) {
  const root = f.ranges[0],
    nested = allRanges.filter(
      (r) => r.startOffset >= root.startOffset && r.endOffset <= root.endOffset,
    );
  let fl = 0,
    fc = 0;
  let offset = root.startOffset;
  for (const line of coreSource
    .slice(root.startOffset, root.endOffset)
    .split("\n")) {
    const pos = offset + Math.max(0, line.search(/\S/));
    offset += line.length + 1;
    if (!line.trim() || /^\s*\/\//.test(line)) continue;
    fl++;
    const ranges = nested
      .filter((r) => r.startOffset <= pos && pos < r.endOffset)
      .sort(
        (a, b) => a.endOffset - a.startOffset - (b.endOffset - b.startOffset),
      );
    if ((ranges[0]?.count || 0) > 0) fc++;
  }
  const fb = f.ranges.slice(1);
  lines += fl;
  coveredLines += fc;
  branches += fb.length;
  coveredBranches += fb.filter((r) => r.count > 0).length;
  details.push({
    function: f.functionName,
    lines: fl,
    coveredLines: fc,
    branches: fb.length,
    coveredBranches: fb.filter((r) => r.count > 0).length,
  });
}
const linePercent = (coveredLines / lines) * 100,
  branchPercent = (coveredBranches / branches) * 100;
const { report } = await import("./report.mjs");
const pass = linePercent >= 90 && branchPercent >= 90;
report(
  "coverage",
  [
    {
      id: "core-coverage",
      method: "unit",
      status: pass ? "PASS" : "FAIL",
      expected: "lines >= 90%, branches >= 90%",
      actual: { linePercent, branchPercent },
      evidence: "reports/coverage.json",
    },
  ],
  { details, linePercent, branchPercent },
);
mkdirSync("coverage", { recursive: true });
writeFileSync("coverage/core-v8.json", JSON.stringify(script));
console.log({ linePercent, branchPercent });
if (!pass) process.exitCode = 1;
