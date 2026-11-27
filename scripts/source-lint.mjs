// ESLint over the product scripts (#kazohe-core and #kazohe-app), mapped back to
// src/ts/<file>:<line> via productScript's lineMap. noInlineConfig is enforced so no
// inline disable comment can silence a rule, and LINT_PROBES proves every rule fires.
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Core script runs in both the browser and Node's VM (load-inline-core.mjs) with no DOM.
export const CORE_LINT_GLOBALS = Object.freeze([
  "TextEncoder",
  "structuredClone",
  "globalThis",
]);

// The four top-level namespaces #kazohe-core exposes to #kazohe-app.
export const CORE_EXPORTS = Object.freeze([
  "KZ",
  "KZLanguage",
  "KZWritten",
  "KZTeaching",
]);

// Closed list of browser globals #kazohe-app may reference. A name outside this list
// is rejected even if browsers provide it, catching renamed or misspelled locals.
export const LINT_GLOBALS = Object.freeze([
  "AudioContext",
  "Blob",
  "CSS",
  "Element",
  "Event",
  "File",
  "HTMLButtonElement",
  "HTMLDetailsElement",
  "HTMLDialogElement",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLOptionElement",
  "HTMLSelectElement",
  "HTMLTextAreaElement",
  "KeyboardEvent",
  "Node",
  "PointerEvent",
  "TextEncoder",
  "URL",
  "cancelAnimationFrame",
  "clearInterval",
  "clearTimeout",
  "document",
  "getComputedStyle",
  "globalThis",
  "localStorage",
  "matchMedia",
  "performance",
  "requestAnimationFrame",
  "setInterval",
  "setTimeout",
  "structuredClone",
  "window",
]);

export const LINT_RULES = Object.freeze({
  "no-undef": "error",
  "no-redeclare": "error",
  "no-dupe-keys": "error",
  "no-duplicate-case": "error",
  "no-unreachable": "error",
  "no-self-assign": "error",
  "no-self-compare": "error",
  "no-dupe-else-if": "error",
  "no-fallthrough": "error",
  "no-loss-of-precision": "error",
  "no-constant-condition": "error",
  "no-unsafe-finally": "error",
  "no-sparse-arrays": "error",
  "array-callback-return": "error",
  "no-unmodified-loop-condition": "error",
  "no-constant-binary-expression": "error",
  "no-unreachable-loop": "error",
  "no-useless-catch": "error",
  "no-empty": ["error", { allowEmptyCatch: true }],
  eqeqeq: ["error", "always", { null: "ignore" }],
  "no-use-before-define": [
    "error",
    { functions: false, classes: false, variables: false },
  ],
  "no-unused-vars": [
    "error",
    { args: "none", caughtErrors: "none", ignoreRestSiblings: true },
  ],
  "unicorn/no-unsafe-string-replacement": "error",
  "sonarjs/no-identical-functions": "error",
  "sonarjs/no-all-duplicated-branches": "error",
  "sonarjs/no-identical-conditions": "error",
  "sonarjs/no-identical-expressions": "error",
  "sonarjs/no-element-overwrite": "error",
  "sonarjs/no-unused-collection": "error",
  "sonarjs/no-use-of-empty-return-value": "error",
  "sonarjs/no-redundant-jump": "error",
});

// One minimal probe per rule that the rule must refuse, proving the rule is active.
export const LINT_PROBES = Object.freeze({
  "no-undef": "renamedAway();",
  "no-redeclare": "var twice = 1; var twice = 2;",
  "no-dupe-keys": "void ({ key: 1, key: 2 });",
  "no-duplicate-case":
    "switch (globalThis.x) { case 1: break; case 1: break; }",
  "no-unreachable": "function early() { return 1; early(); }",
  "no-self-assign": "let same = 1; same = same;",
  "no-self-compare": "if (globalThis.x === globalThis.x) void 0;",
  "no-dupe-else-if":
    "if (globalThis.a) void 0; else if (globalThis.a) void 1;",
  "no-fallthrough":
    "switch (globalThis.x) { case 1: globalThis.f(); case 2: break; }",
  "no-loss-of-precision": "void 9007199254740993;",
  "no-constant-condition": "if (true) void 0;",
  "no-unsafe-finally":
    "function late() { try { return 1; } finally { return 2; } } late();",
  "no-sparse-arrays": "void [1, , 2];",
  "array-callback-return": "globalThis.list.map((item) => { void item; });",
  "no-unmodified-loop-condition":
    "let going = true; while (going) globalThis.f();",
  "no-constant-binary-expression": "if (!globalThis.x == null) void 0;",
  "no-unreachable-loop":
    "for (const item of globalThis.list) { void item; break; }",
  "no-useless-catch": "try { globalThis.f(); } catch (error) { throw error; }",
  "no-empty": "if (globalThis.x) {}",
  eqeqeq: "if (globalThis.x == 1) void 0;",
  "no-use-before-define": "{ void later; const later = 1; }",
  "no-unused-vars": "function keep() { const unused = 1; } keep();",
  "unicorn/no-unsafe-string-replacement":
    "globalThis.text.replace('a', globalThis.name);",
  "sonarjs/no-identical-functions":
    "function one(v) {\n  const a = v + 1;\n  const b = a * 2;\n  return b - 3;\n}\nfunction two(v) {\n  const a = v + 1;\n  const b = a * 2;\n  return b - 3;\n}\none(1); two(1);",
  "sonarjs/no-all-duplicated-branches": "void (globalThis.x ? 1 : 1);",
  "sonarjs/no-identical-conditions":
    "if (globalThis.a) globalThis.f(); else if (globalThis.b) globalThis.g(); else if (globalThis.a) globalThis.h();",
  "sonarjs/no-identical-expressions": "void (globalThis.a && globalThis.a);",
  "sonarjs/no-element-overwrite":
    "const cells = []; cells[0] = 1; cells[0] = 2; globalThis.f(cells);",
  "sonarjs/no-unused-collection":
    "function collect() { const seen = new Set(); seen.add(1); } collect();",
  "sonarjs/no-use-of-empty-return-value":
    "function nothing() { globalThis.f(); }\nconst got = nothing();\nglobalThis.f(got);",
  "sonarjs/no-redundant-jump":
    "function tidy() { globalThis.f(); return; } tidy();",
});

const engines = new Map();

function createEngine(root, kind) {
  const key = `${root}\u0000${kind}`;
  if (engines.has(key)) return engines.get(key);
  const { ESLint } = require("eslint");
  const unicorn = require("eslint-plugin-unicorn");
  const sonarjs = require("eslint-plugin-sonarjs");
  const globalNames =
    kind === "core"
      ? CORE_LINT_GLOBALS
      : [...CORE_EXPORTS, ...LINT_GLOBALS];
  const engine = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.js"],
        languageOptions: {
          ecmaVersion: 2024,
          sourceType: "script",
          globals: Object.fromEntries(
            [...new Set(globalNames)].map((name) => [name, "readonly"]),
          ),
        },
        plugins: {
          unicorn: unicorn.default ?? unicorn,
          sonarjs: sonarjs.default ?? sonarjs,
        },
        linterOptions: {
          noInlineConfig: true,
          reportUnusedDisableDirectives: "off",
        },
        rules: LINT_RULES,
      },
    ],
  });
  engines.set(key, engine);
  return engine;
}

export async function lintText(root, text, { kind = "app" } = {}) {
  const filename = kind === "core" ? "kazohe-core.js" : "kazohe-app.js";
  const [result] = await createEngine(root, kind).lintText(text, {
    filePath: path.join(root, filename),
  });
  return result.messages;
}

// Lints #kazohe-core with core-only globals and verifies that the four core exports
// (KZ, KZLanguage, KZWritten, KZTeaching) are declared without loosening no-unused-vars.
export async function lintCoreScript(root, text) {
  const suffix = `\nvoid [${CORE_EXPORTS.join(", ")}];\n`;
  return lintText(root, text + suffix, { kind: "core" });
}

export async function lintAppScript(root, text) {
  return lintText(root, text, { kind: "app" });
}

// Maps each ESLint message back to "<src file>:<line> <rule> <message>" via lineMap.
export function lintFindings(messages, { lines } = {}) {
  return messages.map((m) => {
    const where = Array.isArray(lines) ? lines[m.line - 1] : null;
    const at = where ? `${where.file}:${where.line}` : `product:${m.line}`;
    return `${at} ${m.ruleId ?? "parse"} ${m.message}`;
  });
}

// Proves every rule in LINT_RULES refuses its LINT_PROBES snippet.
export async function verifyLintProbes(root) {
  const issues = [];
  const ruleKeys = Object.keys(LINT_RULES).sort();
  const probeKeys = Object.keys(LINT_PROBES).sort();
  if (JSON.stringify(ruleKeys) !== JSON.stringify(probeKeys)) {
    issues.push(
      `LINT_PROBES keys differ from LINT_RULES: missing=${ruleKeys.filter((k) => !probeKeys.includes(k)).join(",")}; extra=${probeKeys.filter((k) => !ruleKeys.includes(k)).join(",")}`,
    );
  }
  const results = await Promise.all(
    Object.entries(LINT_PROBES).map(async ([rule, probe]) => [
      rule,
      await lintText(root, probe, { kind: "core" }),
    ]),
  );
  for (const [rule, messages] of results) {
    if (!messages.some((m) => m.ruleId === rule)) {
      issues.push(
        `rule ${rule} did not refuse its probe (got: ${messages.map((m) => m.ruleId ?? "parse").join(", ") || "none"})`,
      );
    }
  }
  return issues;
}
