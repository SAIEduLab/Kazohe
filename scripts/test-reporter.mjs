import { report } from "./report.mjs";
export default class Reporter {
  cases = [];
  onTestEnd(test, result) {
    if (result.status !== "passed")
      for (const error of result.errors) console.error(error.message);
    const ids = [...test.title.matchAll(/TC-[A-Z]\d+/g)].map((x) => x[0]);
    for (const id of ids)
      this.cases.push({
        id,
        method: "browser",
        browser: test.parent.project().name,
        status:
          result.status === "passed"
            ? "PASS"
            : result.status === "skipped"
              ? "NOT_RUN"
              : "FAIL",
        expected: "browser assertions satisfied",
        actual: result.errors.length
          ? result.errors.map((e) => e.message)
          : result.status,
        evidence: result.attachments.map((a) => a.path || a.name),
      });
  }
  onEnd(result) {
    report(process.env.E2E_REPORT_NAME || "e2e", this.cases, {
      suite: "e2e",
      runnerStatus: result.status,
    });
  }
}
