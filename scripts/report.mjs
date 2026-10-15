import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appVersion, artifactAt } from "./artifact.mjs";
import { html } from "./load-inline-core.mjs";
export const hash = createHash("sha256").update(html).digest("hex");
function gitHead() {
  return execFileSync(
    "git",
    [
      "-c",
      `safe.directory=${process.cwd().replaceAll("\\", "/")}`,
      "rev-parse",
      "HEAD",
    ],
    { encoding: "utf8" },
  ).trim();
}
export function expectedExecution() {
  const checkout = gitHead();
  const runCommit = process.env.GITHUB_SHA || checkout;
  if (process.env.GITHUB_ACTIONS === "true" && checkout !== runCommit)
    throw Error("Checked-out commit differs from the Actions run SHA");
  const headCommit = process.env.AUDIT_HEAD_SHA || checkout;
  const headHtml = artifactAt(headCommit).html;
  const headHtmlSha256 = createHash("sha256").update(headHtml).digest("hex");
  if (headHtmlSha256 !== hash)
    throw Error("PR head HTML differs from tested HTML");
  return {
    repository: process.env.GITHUB_REPOSITORY || null,
    runId: process.env.GITHUB_RUN_ID || null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
    event: process.env.GITHUB_EVENT_NAME || null,
    runCommit,
    headCommit,
    headHtmlSha256,
  };
}
export function report(suite, cases, extra = {}) {
  const execution = expectedExecution();
  const result = {
    suite,
    appVersion,
    htmlSha256: hash,
    commit: execution.runCommit,
    execution,
    environment: { node: process.version, browser: null },
    cases,
    status: cases.every((c) => c.status === "PASS") ? "PASS" : "FAIL",
    ...extra,
  };
  mkdirSync("reports", { recursive: true });
  writeFileSync(`reports/${suite}.json`, JSON.stringify(result, null, 2));
  return result;
}
export function suite(name) {
  const cases = [];
  return {
    cases,
    check(id, fn) {
      try {
        const actual = fn();
        cases.push({
          id,
          method: name,
          status: "PASS",
          expected: "assertions satisfied",
          actual: actual ?? "assertions satisfied",
          evidence: `reports/${name}.json`,
        });
      } catch (e) {
        cases.push({
          id,
          method: name,
          status: "FAIL",
          actual: e.stack,
          evidence: `reports/${name}.json`,
        });
        console.error(id, e);
      }
    },
    done(extra = {}) {
      const r = report(name, cases, extra);
      console.log(
        `${name}: ${cases.filter((c) => c.status === "PASS").length}/${cases.length} PASS`,
      );
      if (r.status !== "PASS") process.exitCode = 1;
      return r;
    },
  };
}

// A navigation aid over the reports, never a substitute for the release gate.
export const machineSuites = [
  "lint",
  "catalog",
  "unit",
  "coverage",
  "property",
  "pedagogy",
  "single-html",
];
export function summaryRows(inputs, expected, names) {
  return names.map((name) => {
    const matches = inputs.filter((i) => basename(i.path, ".json") === name);
    if (!matches.length)
      return { name, status: "NOT_RUN", detail: "Missing report" };
    const paths = matches.map((i) => i.path).join(", ");
    if (matches.length !== 1)
      return { name, status: "FAIL", detail: `Duplicate reports: ${paths}` };
    const r = matches[0].result;
    const engine = name.startsWith("e2e-") ? name.slice(4) : null;
    if (
      !r ||
      r.suite !== (engine ? "e2e" : name) ||
      r.appVersion !== appVersion ||
      r.htmlSha256 !== hash ||
      r.commit !== expected.runCommit ||
      JSON.stringify(r.execution) !== JSON.stringify(expected) ||
      !Array.isArray(r.cases) ||
      !r.cases.length ||
      r.cases.some(
        (c) => !c?.id || !["PASS", "FAIL", "NOT_RUN"].includes(c.status),
      ) ||
      (engine && r.cases.some((c) => c.browser !== engine))
    )
      return {
        name,
        status: "FAIL",
        detail: `Invalid or mismatched evidence: ${paths}`,
      };
    const failed = r.cases.filter((c) => c.status !== "PASS");
    const status =
      r.status === "PASS" &&
      !failed.length &&
      (!engine || r.runnerStatus === "passed")
        ? "PASS"
        : "FAIL";
    const details = failed
      .slice(0, 8)
      .map(
        (c) =>
          `${c.id}: ${c.status}${c.actual ? ` (${String(c.actual).slice(0, 180)})` : ""}`,
      );
    if (failed.length > 8) details.push(`and ${failed.length - 8} more`);
    if (engine && r.runnerStatus !== "passed")
      details.push(`runner: ${r.runnerStatus}`);
    return { name, status, detail: [paths, ...details].join("; ") };
  });
}
export function executionSummary(
  inputs,
  expected,
  names,
  jobStatus = "unknown",
) {
  const cell = (value) => String(value ?? "local").replace(/[\r\n|`<>]/g, " ");
  const run =
    expected.repository && expected.runId
      ? `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${expected.repository}/actions/runs/${expected.runId}/attempts/${expected.runAttempt}`
      : null;
  return [
    "## Audit reports",
    `Repository: ${cell(expected.repository)} · run: ${cell(expected.runId)} · attempt: ${cell(expected.runAttempt)} · job: ${cell(jobStatus)}`,
    `Checkout SHA: \`${cell(expected.runCommit)}\``,
    `Head SHA: \`${cell(expected.headCommit)}\``,
    `HTML SHA-256: \`${hash}\``,
    "",
    "| Suite | Status | Report / failing ID |",
    "| --- | --- | --- |",
    ...summaryRows(inputs, expected, names).map(
      (r) => `| ${cell(r.name)} | ${r.status} | ${cell(r.detail)} |`,
    ),
    "",
    ...(run ? [`[Logs](${run}) · [Artifacts](${run}#artifacts)`] : []),
    "Reported results only. Job results and aggregate/release validation determine acceptance; missing reports are NOT_RUN.",
    "Manual visual review / physical devices: NOT_RUN unless separately verified.",
    "",
  ].join("\n");
}
export function readReports(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return readReports(path);
    if (!path.endsWith(".json")) return [];
    try {
      return [{ path, result: JSON.parse(readFileSync(path, "utf8")) }];
    } catch {
      return [{ path, result: null }];
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [flag, group, engine] = process.argv.slice(2);
  if (flag !== "--summary")
    throw Error("Expected --summary math|browser|visual|aggregate");
  const groups = {
    math: machineSuites,
    browser: [`e2e-${engine}`],
    visual: ["visual-diff"],
    aggregate: [
      ...machineSuites,
      "e2e-chromium",
      "e2e-firefox",
      "e2e-webkit",
      "visual-diff",
      "aggregate",
      "release",
    ],
  };
  if (
    !groups[group] ||
    (group === "browser" && !["chromium", "firefox", "webkit"].includes(engine))
  )
    throw Error("Invalid summary group or browser");
  const inputs =
    group === "aggregate"
      ? [
          ...readReports(".artifacts"),
          ...readReports("reports").filter((i) =>
            ["aggregate.json", "release.json"].includes(basename(i.path)),
          ),
        ]
      : readReports("reports");
  const markdown = executionSummary(
    inputs,
    expectedExecution(),
    groups[group],
    process.env.AUDIT_JOB_STATUS,
  );
  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/summary.md", markdown);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  console.log(markdown);
}
