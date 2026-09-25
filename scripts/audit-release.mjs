import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { hash, report, expectedExecution } from "./report.mjs";
import { manifest } from "./manifest.mjs";
import { validateEvidence, validManualProvenance } from "./release-gate.mjs";
const machineOnly = process.argv.includes("--machine-only"),
  reports = {},
  cases = [];
for (const s of [
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
  if (existsSync(`reports/${s}.json`))
    reports[s] = JSON.parse(readFileSync(`reports/${s}.json`, "utf8"));
try {
  validateEvidence(reports, hash, manifest, expectedExecution());
  cases.push({ id: "automatic-evidence", method: "aggregate", status: "PASS" });
} catch (e) {
  cases.push({
    id: "automatic-evidence",
    method: "aggregate",
    status: "FAIL",
    actual: e.message,
  });
}
function matchingHtmlCommit(commit, currentHash) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"]);
    const html = execFileSync("git", ["show", `${commit}:Kazohe.html`], {
      maxBuffer: 20 * 1024 * 1024,
    });
    return createHash("sha256").update(html).digest("hex") === currentHash;
  } catch {
    return false;
  }
}
let manualStatus = "NOT_RUN";
let manualEvidenceProvenance = "NOT_RUN";
if (!machineOnly) {
  const file = "tests/evidence/visual-review.json",
    review = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  const provenance = validManualProvenance(
    review, hash, expectedExecution(), matchingHtmlCommit,
  );
  manualEvidenceProvenance = provenance ? "PASS" : "NOT_RUN";
  for (const c of manifest.filter((c) =>
    ["visual", "device"].includes(c.method),
  )) {
    const found =
      provenance &&
      review?.cases.find(
        (r) =>
          r.id === c.id &&
          r.method === c.method &&
          r.status === "PASS" &&
          r.reviewer &&
          r.environment &&
          r.evidence?.length,
      );
    cases.push(found || { ...c, status: "NOT_RUN" });
  }
  manualStatus = cases
    .filter((c) => ["visual", "device"].includes(c.method))
    .every((c) => c.status === "PASS")
    ? "PASS"
    : "NOT_RUN";
}
const result = report("release", cases, {
  machineOnly,
  manualStatus,
  manualEvidenceProvenance,
  releaseReady:
    !machineOnly &&
    manualStatus === "PASS" &&
    cases.every((c) => c.status === "PASS"),
});
console.log(
  JSON.stringify({
    status: result.status,
    manualStatus,
    releaseReady: result.releaseReady,
  }),
);
if (result.status !== "PASS") process.exitCode = 1;
