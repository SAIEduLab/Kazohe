import { K } from "./load-inline-core.mjs";
import { expectedExecution } from "./report.mjs";

export function validateEvidence(reports, hash, manifest, expected = expectedExecution()) {
  const required = [
    "lint", "catalog", "unit", "coverage", "property", "pedagogy",
    "single-html", "e2e", "visual-diff",
  ];
  if (!/^[0-9a-f]{40}$/.test(expected.runCommit) ||
      !/^[0-9a-f]{40}$/.test(expected.headCommit))
    throw Error("Invalid execution commit");
  for (const name of required) {
    const r = reports[name];
    if (!r || r.suite !== name || r.status !== "PASS" ||
        r.htmlSha256 !== hash || r.appVersion !== "0.2" ||
        r.commit !== expected.runCommit ||
      r.execution?.headHtmlSha256 !== hash ||
        JSON.stringify(r.execution) !== JSON.stringify(expected) ||
        !r.cases?.length || r.cases.some(c => c.status !== "PASS"))
      throw Error(`Invalid or missing suite: ${name}`);
    const seen = new Set();
    for (const c of r.cases) {
      const identity = name === "e2e"
        ? `${c.browser}/${c.id}/${c.title}`
        : c.id;
      if (!c.id || (name === "e2e" && (!c.title || !c.browser)) ||
          seen.has(identity))
        throw Error(`Duplicate or invalid result: ${name}/${identity}`);
      seen.add(identity);
    }
  }
  for (const c of manifest.filter(c => !["visual", "device"].includes(c.method))) {
    const name = c.method === "browser" ? "e2e" : c.method;
    const rows = reports[name].cases.filter(r => r.id === c.id && r.status === "PASS");
    if (!rows.length) throw Error(`Missing case: ${c.id}/${c.method}`);
    if (c.method === "browser")
      for (const engine of ["chromium", "firefox", "webkit"])
        if (!rows.some(r => r.browser === engine))
          throw Error(`Missing browser: ${c.id}/${engine}`);
  }
  if (reports.e2e.runnerStatus !== "passed")
    throw Error("Browser runner did not pass");
  const ids = K.CATALOG.map(c => c.id);
  const counts = reports.property.generatorCounts;
  if (!counts || ids.length !== 101 ||
      Object.keys(counts).length !== ids.length ||
      ids.some(id => counts[id]?.count < 1000 ||
        !counts[id].buckets || !Object.keys(counts[id].buckets).length))
    throw Error("Generator coverage missing");
  const pedagogy = reports.pedagogy.generatorCoverage;
  if (!pedagogy || Object.keys(pedagogy).length !== ids.length ||
      ids.some(id => pedagogy[id]?.count < 40))
    throw Error("Learning explanation coverage missing");
  const coverage = reports.coverage;
  if (!(coverage.linePercent >= 90 && coverage.branchPercent >= 90))
    throw Error("Core coverage below threshold");
  const visual = reports["visual-diff"];
  if (!/^[0-9a-f]{40}$/.test(visual.baseCommit) ||
      visual.baseCommit === expected.runCommit ||
      visual.baseCommit === expected.headCommit ||
      !/^[0-9a-f]{64}$/.test(visual.baseHtmlSha256) ||
      visual.candidateHtmlSha256 !== hash ||
      visual.visualApproval !== "NOT_RUN" ||
      visual.comparisons?.length !== 16 ||
      new Set(visual.comparisons.map(c => `${c.id}/${c.width}`)).size !== 16 ||
      visual.comparisons.some(c =>
        !["menu", "G1-C03", "G2-C02", "G3-C02", "G3-C07",
          "G4-C12", "G5-N08", "G6-C05"].includes(c.id) ||
        ![390, 1366].includes(c.width) ||
        !Number.isFinite(c.changedPixels) || c.changedPixels < 0))
    throw Error("Base/candidate image evidence missing or invalid");
  return true;
}

export function validManualProvenance(review, hash, execution, matchingHtmlCommit) {
  if (!review || review.htmlSha256 !== hash ||
      review.targetRepository !== "SAIEduLab/Kazohe" ||
      (execution.repository && review.targetRepository !== execution.repository) ||
      !/^[0-9a-f]{40}$/.test(review.targetCommit || "") ||
      !/^[0-9]+$/.test(String(review.reviewedRunId)) ||
      typeof matchingHtmlCommit !== "function")
    return false;
  try {
    return matchingHtmlCommit(review.targetCommit, hash) === true;
  } catch {
    return false;
  }
}
