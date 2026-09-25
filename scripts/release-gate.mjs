export function validateEvidence(reports, hash, manifest) {
  const required = [
    "lint",
    "catalog",
    "unit",
    "coverage",
    "property",
    "pedagogy",
    "single-html",
    "e2e",
    "visual-diff",
  ];
  for (const suite of required) {
    const r = reports[suite];
    if (
      !r ||
      r.status !== "PASS" ||
      r.htmlSha256 !== hash ||
      r.appVersion !== "0.2" ||
      !r.cases?.length ||
      r.cases.some((c) => c.status !== "PASS")
    )
      throw Error(`Invalid or missing suite: ${suite}`);
  }
  for (const c of manifest.filter(
    (c) => !["visual", "device"].includes(c.method),
  )) {
    const suite = c.method === "browser" ? "e2e" : c.method;
    const rows = reports[suite]?.cases.filter(
      (r) => r.id === c.id && r.status === "PASS",
    );
    if (!rows?.length) throw Error(`Missing case: ${c.id}/${c.method}`);
    if (c.method === "browser")
      for (const engine of ["chromium", "firefox", "webkit"])
        if (!rows.some((r) => r.browser === engine))
          throw Error(`Missing browser: ${c.id}/${engine}`);
  }
  const counts = reports.property.generatorCounts;
  if (
    Object.keys(counts || {}).length !== 101 ||
    Object.values(counts).some(
      (x) => x.count < 1000 || !Object.keys(x.buckets).length,
    )
  )
    throw Error("Generator coverage missing");
  if (
    reports["visual-diff"].comparisons?.length !== 16 ||
    !reports["visual-diff"].baseCommit
  )
    throw Error("Base/candidate image evidence missing");
  if (Object.keys(reports.pedagogy.generatorCoverage || {}).length !== 101)
    throw Error("Learning explanation coverage missing");
  return true;
}
