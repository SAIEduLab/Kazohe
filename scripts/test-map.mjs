// Maps source modules to the test suites whose runs execute lines of those modules,
// using Node V8 inspector precise coverage and productScript's piece/line mapping.
// Usage:
//   node scripts/test-map.mjs <src/ts/file.ts> [more files...]
//   node scripts/test-map.mjs --changed <base commit>
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import assert from "node:assert/strict";
import inspector from "node:inspector/promises";
import { pathToFileURL } from "node:url";
import { htmlName } from "./artifact.mjs";
import {
  htmlPath,
  coreSource,
  K,
  Teaching,
  Language,
  Written,
} from "./load-inline-core.mjs";
import { rawAnswer } from "./independent-math-oracle.mjs";

export const TEST_SUITES = Object.freeze([
  "unit",
  "pedagogy",
  "property",
  "format-compatibility",
]);

const DEFAULT_APP_FILES = Object.freeze([
  "src/ts/10-view.ts",
  "src/ts/11-app-helpers.ts",
  "src/ts/12-app-menu.ts",
  "src/ts/13-app-main.ts",
]);

// Compute byte spans [start, end] inside #kazohe-core's V8 source for each requested file.
// Applies offsetDelta = Math.max(0, coreSource.indexOf(coreText)) so spans align with
// V8 Profiler range offsets even when <script id="kazohe-core"> has leading whitespace.
export function coreSpansForFiles(
  files,
  { corePieces, coreText = "", source = coreSource } = {},
) {
  const target = new Set(files.map((f) => f.replaceAll("\\", "/")));
  if (!Array.isArray(corePieces)) return [];
  const offsetDelta = coreText ? Math.max(0, source.indexOf(coreText)) : 0;
  return corePieces
    .filter((p) => target.has(p.label.replaceAll("\\", "/")))
    .map((p) => [p.start + offsetDelta, p.end + offsetDelta]);
}

function defaultSuiteRunners() {
  return {
    unit: async () => {
      K.gcd(48, 18);
      K.lcm(12, 18);
      const q = K.generate(
        "G4-C07",
        { remainder: "none" },
        K.createGenerator(20260925),
      );
      const parsed = K.normalizeInput(q.answerSpec, rawAnswer(q));
      K.judge(q, parsed);
      const run = K.createRun(
        { selectedIds: ["G4-C07"], mode: "practice", quantity: 10 },
        98765,
        0,
      );
      K.reduceRun(
        run,
        {
          type: "SUBMIT",
          questionId: run.currentQuestion.questionId,
          raw: rawAnswer(run.currentQuestion),
        },
        1000,
      );
      const saved = K.emptySave();
      K.validateBackup(JSON.stringify(saved));
      Written.classify(q);
      Language.audit("筆算の答え", 1);
    },
    pedagogy: async () => {
      const g = K.createGenerator(20260925);
      for (const id of ["G1-C03", "G2-C05", "G4-C07", "G5-C03", "G6-C01"]) {
        const q = K.generate(id, {}, g);
        K.buildHint(q);
        Teaching.steps(q);
        Teaching.explain(q);
        Language.readable(K.buildHint(q), 2);
      }
    },
    property: async () => {
      for (const c of K.CATALOG) {
        const g = K.createGenerator(20260925);
        const q = K.generate(c.id, {}, g);
        K.validateQuestion(c, q);
        K.judge(q, K.normalizeInput(q.answerSpec, rawAnswer(q)));
        for (const d of K.domains(c.id).slice(0, 1)) {
          K.atRank(d, 0n);
        }
      }
    },
    "format-compatibility": async () => {
      const { runFormatCompatibilityChecks } = await import(
        "../tests/unit/format-compatibility.mjs"
      );
      runFormatCompatibilityChecks();
    },
  };
}

// Returns { files, suites, appFiles, product }: suites whose execution hit at least one
// byte offset in the requested files, plus any requested files belonging to #kazohe-app.
export async function testMap(
  files,
  {
    corePieces = null,
    coreText = "",
    appPieces = null,
    runners = defaultSuiteRunners(),
  } = {},
) {
  const normalized = files.map((f) => f.replaceAll("\\", "/"));
  const spans = coreSpansForFiles(normalized, { corePieces, coreText });
  const appLabels = new Set(
    Array.isArray(appPieces)
      ? appPieces.map((p) => p.label.replaceAll("\\", "/"))
      : DEFAULT_APP_FILES,
  );
  const appFiles = normalized.filter((f) => appLabels.has(f));
  const suites = [];

  if (spans.length) {
    const targetUrls = new Set([htmlPath, pathToFileURL(htmlPath).href]);
    const session = new inspector.Session();
    session.connect();
    try {
      await session.post("Profiler.enable");
      for (const [name, run] of Object.entries(runners)) {
        await session.post("Profiler.startPreciseCoverage", {
          callCount: true,
          detailed: true,
        });
        await run();
        const { result } = await session.post("Profiler.takePreciseCoverage");
        await session.post("Profiler.stopPreciseCoverage");
        const hit = result
          .filter((s) => targetUrls.has(s.url))
          .some((entry) =>
            entry.functions.some((f) =>
              f.ranges.some(
                (r) =>
                  r.count > 0 &&
                  spans.some(([s, e]) => r.startOffset >= s && r.startOffset < e),
              ),
            ),
          );
        if (hit) suites.push(name);
      }
    } finally {
      session.disconnect();
    }
  }
  if (appFiles.length) suites.push("e2e");
  return { files: normalized, suites, appFiles, product: htmlName };
}

async function resolveCoreAndAppPieces() {
  const productScriptPath = path.resolve("scripts/product-script.mjs");
  if (!fs.existsSync(productScriptPath)) return {};
  const mod = await import(pathToFileURL(productScriptPath).href);
  if (typeof mod.productScript !== "function") return {};
  const script = mod.productScript();
  return {
    corePieces: script.core?.pieces ?? script.pieces ?? null,
    coreText: script.core?.text ?? script.text ?? "",
    appPieces: script.app?.pieces ?? null,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  assert.ok(
    args.length && (args[0] !== "--changed" || args.length === 2),
    "usage: node scripts/test-map.mjs <src file>... | --changed <base commit>",
  );
  const files =
    args[0] === "--changed"
      ? cp
          .execFileSync(
            "git",
            ["diff", "--name-only", args[1], "--", "src/ts"],
            { encoding: "utf8" },
          )
          .split("\n")
          .filter((f) => f.endsWith(".ts"))
      : args;
  const pieces = await resolveCoreAndAppPieces();
  const map = await testMap(files, pieces);
  console.log(`Files: ${map.files.join(", ") || "(none)"}`);
  for (const name of map.suites) console.log(`suite ${name}`);
  if (!map.suites.length) console.log("no matching suites");
}
