import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { html } from "./load-inline-core.mjs";
export const hash = createHash("sha256").update(html).digest("hex");
export function report(suite, cases, extra = {}) {
  let commit = "unavailable";
  try {
    commit = execFileSync(
      "git",
      [
        "-c",
        `safe.directory=${process.cwd().replaceAll("\\", "/")}`,
        "rev-parse",
        "HEAD",
      ],
      { encoding: "utf8" },
    ).trim();
  } catch {}
  const result = {
    suite,
    appVersion: "0.2",
    htmlSha256: hash,
    commit,
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
