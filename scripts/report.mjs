import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { html } from "./load-inline-core.mjs";
export const hash = createHash("sha256").update(html).digest("hex");
function gitHead() {
  return execFileSync(
    "git",
    ["-c", `safe.directory=${process.cwd().replaceAll("\\", "/")}`, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
}
export function expectedExecution() {
  const checkout = gitHead();
  const runCommit = process.env.GITHUB_SHA || checkout;
  if (process.env.GITHUB_ACTIONS === "true" && checkout !== runCommit)
    throw Error("Checked-out commit differs from the Actions run SHA");
  const headCommit = process.env.AUDIT_HEAD_SHA || checkout;
  const headHtml = execFileSync("git", ["show", `${headCommit}:Kazohe.html`], {
    encoding: "utf8", maxBuffer: 20 * 1024 * 1024,
  });
  const headHtmlSha256 = createHash("sha256").update(headHtml).digest("hex");
  if (headHtmlSha256 !== hash) throw Error("PR head HTML differs from tested HTML");
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
    appVersion: "0.2",
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
