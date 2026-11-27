// Static contract for .github/workflows/*.yml, script npm package coverage,
// and .github/CODEOWNERS guard ownership. Uses a strict YAML subset parser;
// anything outside the subset is rejected rather than guessed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { builtinModules, createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { refusedWith } from "./refusal.mjs";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let babelParser;
const parseJs = (text) =>
  (babelParser ??= require("@babel/parser")).parse(text, {
    sourceType: "unambiguous",
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
  });

const yamlError = (line, message) => new Error(`line ${line}: ${message}`);
const keyPattern = /^([A-Za-z_][A-Za-z0-9_.-]*):(?: (.*))?$/;
const isItem = (text) => text === "-" || text.startsWith("- ");

function parseQuoted(text, line) {
  const quote = text[0];
  let value = "";
  let i = 1;
  let closed = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") {
      if (c === "'") {
        if (text[i + 1] === "'") {
          value += "'";
          i++;
          continue;
        }
        closed = true;
        break;
      }
      value += c;
    } else {
      if (c === "\\") {
        const n = text[++i];
        const map = { "\\": "\\", '"': '"', n: "\n" };
        if (!Object.hasOwn(map, n)) throw yamlError(line, "unsupported escape");
        value += map[n];
        continue;
      }
      if (c === '"') {
        closed = true;
        break;
      }
      value += c;
    }
  }
  if (!closed) throw yamlError(line, "unterminated quoted scalar");
  const rest = text.slice(i + 1).trim();
  if (rest && !rest.startsWith("#"))
    throw yamlError(line, "text after quoted scalar");
  return value;
}

function parsePlain(text, line) {
  const at = text.search(/\s#/);
  const value = (at < 0 ? text : text.slice(0, at)).trim();
  if (
    /^[&*!%@`{}?>|#,\]]/.test(value) ||
    value.startsWith("<<") ||
    value.startsWith("- ")
  )
    throw yamlError(line, "unsupported YAML construct: " + value.slice(0, 24));
  if (/: |:$/.test(value))
    throw yamlError(line, "ambiguous plain scalar: " + value.slice(0, 24));
  return value;
}

function parseScalar(raw, line) {
  const text = raw.trim();
  if (text[0] === "'" || text[0] === '"') return parseQuoted(text, line);
  if (text[0] === "[") {
    const at = text.lastIndexOf("]");
    if (at < 0) throw yamlError(line, "unterminated flow sequence");
    const rest = text.slice(at + 1).trim();
    if (rest && !rest.startsWith("#"))
      throw yamlError(line, "text after flow sequence");
    const inner = text.slice(1, at).trim();
    if (/[[\]{}]/.test(inner)) throw yamlError(line, "nested flow collection");
    return inner === ""
      ? []
      : inner.split(",").map((item) => {
          if (!item.trim()) throw yamlError(line, "empty flow item");
          return parseScalar(item, line);
        });
  }
  return parsePlain(text, line);
}

// Strict YAML subset parser supporting block mappings, block sequences, flow
// sequences of scalars, quoted/plain scalars, comments, and literal block
// scalars (|). Rejects BOM, tabs, anchors, aliases, tags, merge keys, flow
// mappings, folded/chomped block scalars, duplicate keys, and directives.
export function parseWorkflowYaml(text) {
  if (text.charCodeAt(0) === 0xfeff) throw yamlError(1, "byte order mark");
  const raw = text.replace(/\r\n/g, "\n").split("\n");
  raw.forEach((l, n) => {
    if (l.includes("\t")) throw yamlError(n + 1, "tab character");
  });
  const lines = raw.map((l, n) => ({
    no: n + 1,
    indent: l.length - l.trimStart().length,
    text: l.trim(),
    raw: l,
  }));
  for (const l of lines) {
    if (/^(---|\.\.\.)(\s|$)|^%/.test(l.text) && l.indent === 0)
      throw yamlError(l.no, "document marker or directive");
  }
  let i = 0;
  const skipLines = () => {
    while (
      i < lines.length &&
      (lines[i].text === "" || lines[i].text.startsWith("#"))
    )
      i++;
  };
  function blockScalar(parentIndent) {
    const out = [];
    let contentIndent = null;
    while (i < lines.length) {
      const l = lines[i];
      if (l.text === "") {
        out.push("");
        i++;
        continue;
      }
      if (l.indent <= parentIndent) break;
      contentIndent ??= l.indent;
      if (l.indent < contentIndent)
        throw yamlError(l.no, "block scalar indentation");
      out.push(l.raw.slice(contentIndent));
      i++;
    }
    while (out.length && out.at(-1) === "") out.pop();
    if (!out.length)
      throw yamlError(lines[Math.max(0, i - 1)].no, "empty block scalar");
    return out.join("\n") + "\n";
  }
  function parseValue(rest, line, indent) {
    const t = (rest ?? "").trim();
    if (t === "" || t.startsWith("#")) {
      i++;
      skipLines();
      return i < lines.length && lines[i].indent > indent
        ? parseNode(lines[i].indent)
        : null;
    }
    if (t === "|" || t.startsWith("| #")) {
      i++;
      return blockScalar(indent);
    }
    if (/^[|>]/.test(t))
      throw yamlError(
        line,
        "only plain literal block scalars (|) are supported",
      );
    i++;
    return parseScalar(t, line);
  }
  function parseMapping(indent) {
    const out = {};
    for (skipLines(); i < lines.length; skipLines()) {
      const l = lines[i];
      if (l.indent < indent) break;
      if (l.indent > indent) throw yamlError(l.no, "unexpected indentation");
      if (isItem(l.text))
        throw yamlError(l.no, "sequence item where a mapping key was expected");
      const m = keyPattern.exec(l.text);
      if (!m)
        throw yamlError(
          l.no,
          "unsupported mapping entry: " + l.text.slice(0, 30),
        );
      if (Object.hasOwn(out, m[1]))
        throw yamlError(l.no, "duplicate key " + m[1]);
      if (m[1] === "__proto__") throw yamlError(l.no, "reserved key");
      out[m[1]] = parseValue(m[2], l.no, indent);
    }
    return out;
  }
  function parseSequence(indent) {
    const out = [];
    for (skipLines(); i < lines.length; skipLines()) {
      const l = lines[i];
      if (l.indent < indent) break;
      if (l.indent > indent) throw yamlError(l.no, "unexpected indentation");
      if (!isItem(l.text))
        throw yamlError(l.no, "mapping key where a sequence item was expected");
      const after = l.text.slice(1);
      const item = after.trim();
      if (item === "" || item.startsWith("#")) {
        i++;
        skipLines();
        out.push(
          i < lines.length && lines[i].indent > indent
            ? parseNode(lines[i].indent)
            : null,
        );
        continue;
      }
      if (keyPattern.test(item)) {
        const keyIndent = l.indent + 1 + (after.length - after.trimStart().length);
        lines[i] = { ...l, indent: keyIndent, text: item };
        out.push(parseMapping(keyIndent));
        continue;
      }
      i++;
      out.push(parseScalar(item, l.no));
    }
    return out;
  }
  function parseNode(indent) {
    skipLines();
    return isItem(lines[i].text)
      ? parseSequence(indent)
      : parseMapping(indent);
  }
  skipLines();
  if (i >= lines.length) throw yamlError(1, "empty workflow");
  if (lines[i].indent !== 0 || isItem(lines[i].text))
    throw yamlError(lines[i].no, "a workflow is a mapping at column 0");
  const doc = parseMapping(0);
  skipLines();
  if (i < lines.length) throw yamlError(lines[i].no, "unparsed content");
  return doc;
}

export const workflowActionPins = Object.freeze({
  "actions/checkout@v6": "d23441a48e516b6c34aea4fa41551a30e30af803",
  "actions/setup-node@v6": "249970729cb0ef3589644e2896645e5dc5ba9c38",
  "actions/upload-artifact@v7": "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  "actions/download-artifact@v8": "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
});

export const workflowNodeVersion = "24";

export const allowedCancelExpressions = new Set([
  "${{ github.event_name == 'pull_request' }}",
  "${{ github.event_name == 'pull_request' || github.event_name == 'pull_request_target' }}",
  "false",
]);

const pinnedActionTag = (uses) =>
  Object.keys(workflowActionPins).find(
    (named) => uses === named.split("@")[0] + "@" + workflowActionPins[named],
  ) ?? null;

const builtin = new Set(builtinModules);
const packageName = (spec) =>
  spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
const astSkip = new Set([
  "loc",
  "start",
  "end",
  "extra",
  "leadingComments",
  "trailingComments",
  "innerComments",
]);
const launchers = new Set([
  "spawn",
  "spawnSync",
  "execFile",
  "execFileSync",
  "fork",
]);
const scriptFilePattern = /\.(?:mjs|cjs|js)$/;

// Variable-path launches declared explicitly when static AST cannot infer a literal path.
export function declaredLaunches(root = rootDir) {
  return {
    "scripts/lint-gate.mjs": () => ["scripts/report.mjs"],
    "scripts/change-guard.mjs": () => {
      const files = [
        "scripts/behaviour-snapshot.mjs",
        "scripts/assertion-counts.mjs",
        "scripts/manifest.mjs",
        "scripts/audit-code.mjs",
        "scripts/artifact.mjs",
        "tests/manifests/intended-audit-changes.json",
        "tests/manifests/intended-behaviour-changes.json",
      ];
      return files.filter((f) => fs.existsSync(path.join(root, f)));
    },
  };
}

// Computes the npm packages and repository files transitively loaded or launched by a script.
export function scriptReach(root, file, declared = declaredLaunches(root)) {
  const packages = new Set();
  const seen = new Set();
  const queue = [path.resolve(root, file)];
  while (queue.length) {
    const at = queue.pop();
    if (seen.has(at)) continue;
    if (!fs.existsSync(at)) continue;
    if (at.endsWith(".json")) {
      seen.add(at);
      continue;
    }
    seen.add(at);
    const text = fs.readFileSync(at, "utf8");
    const relative = path.relative(root, at).replaceAll("\\", "/");
    let ast;
    try {
      ast = parseJs(text);
    } catch (error) {
      throw new Error(`${relative}: ${error.message}`);
    }
    const found = (spec) => {
      if (typeof spec !== "string" || spec.startsWith("node:") || builtin.has(spec))
        return;
      if (spec.startsWith(".")) {
        queue.push(path.resolve(path.dirname(at), spec));
        return;
      }
      packages.add(packageName(spec));
    };
    const srcOf = (n) => text.slice(n.start, n.end);
    const child = (n, script) => {
      if (script?.type === "StringLiteral") {
        if (scriptFilePattern.test(script.value))
          queue.push(path.resolve(root, script.value));
        return;
      }
      if (
        script &&
        /^(?:import\.meta\.filename|fileURLToPath\(import\.meta\.url\)|__filename)$/.test(
          srcOf(script),
        )
      )
        return;
      const last =
        script?.type === "CallExpression" &&
        /(?:^|\.)(?:path\.)?(?:join|resolve)$/.test(srcOf(script.callee))
          ? script.arguments.at(-1)
          : null;
      if (last?.type === "StringLiteral" && scriptFilePattern.test(last.value)) {
        queue.push(path.resolve(root, last.value));
        return;
      }
      if (Object.hasOwn(declared, relative)) {
        for (const s of declared[relative]()) queue.push(path.resolve(root, s));
      }
    };
    const makesRequire = (n) =>
      n?.type === "CallExpression" && /(?:^|\.)createRequire$/.test(srcOf(n.callee));
    const requires = new Set(["require"]);
    const collectRequires = (n) => {
      if (!n || typeof n.type !== "string") return;
      if (
        n.type === "VariableDeclarator" &&
        n.id.type === "Identifier" &&
        makesRequire(n.init)
      )
        requires.add(n.id.name);
      for (const key of Object.keys(n)) {
        if (astSkip.has(key)) continue;
        const v = n[key];
        if (Array.isArray(v)) v.forEach(collectRequires);
        else if (v && typeof v.type === "string") collectRequires(v);
      }
    };
    collectRequires(ast.program);
    const visit = (n) => {
      if (!n || typeof n.type !== "string") return;
      if (
        [
          "ImportDeclaration",
          "ExportNamedDeclaration",
          "ExportAllDeclaration",
        ].includes(n.type)
      )
        found(n.source?.value);
      if (
        n.type === "CallExpression" &&
        n.arguments[0]?.type === "StringLiteral" &&
        ((n.callee.type === "Identifier" && requires.has(n.callee.name)) ||
          makesRequire(n.callee))
      )
        found(n.arguments[0].value);
      if (
        (n.type === "ImportExpression" &&
          n.source?.type === "StringLiteral") ||
        (n.type === "CallExpression" &&
          n.callee.type === "Import" &&
          n.arguments[0]?.type === "StringLiteral")
      )
        found((n.source ?? n.arguments[0]).value);
      else if (
        n.type === "ImportExpression" ||
        (n.type === "CallExpression" && n.callee.type === "Import")
      )
        child(n, null);
      const calleeName =
        n.type === "CallExpression"
          ? n.callee.type === "MemberExpression"
            ? n.callee.property.name
            : n.callee.type === "Identifier"
              ? n.callee.name
              : null
          : null;
      if (launchers.has(calleeName)) {
        const [first, list] = n.arguments;
        if (calleeName === "fork") child(n, first);
        else if (first && srcOf(first) === "process.execPath") {
          const arg0 =
            list?.type === "ArrayExpression" ? list.elements[0] : list;
          child(n, arg0);
        } else if (first?.type === "Identifier") {
          child(n, null);
        }
      }
      // Also capture explicit JSON manifests loaded via scripts/change-guard.mjs
      if (
        relative === "scripts/change-guard.mjs" &&
        Object.hasOwn(declared, relative)
      ) {
        for (const s of declared[relative]()) queue.push(path.resolve(root, s));
      }
      for (const key of Object.keys(n)) {
        if (astSkip.has(key)) continue;
        const v = n[key];
        if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v.type === "string") visit(v);
      }
    };
    visit(ast.program);
  }
  return {
    packages,
    files: [...seen]
      .map((at) => path.relative(root, at).replaceAll("\\", "/"))
      .sort(),
  };
}

// Validate raw `# vX` comment on every `uses: owner/name@<sha>` line.
function actionCommentIssues(file, text) {
  const issues = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  lines.forEach((line, idx) => {
    const m = /^\s*(?:-\s+)?uses:\s+(\S+)(.*)$/.exec(line);
    if (!m) return;
    const uses = m[1].replace(/^['"]|['"]$/g, "");
    const tail = m[2].trim();
    const named = pinnedActionTag(uses);
    if (!named) return;
    const expectedMajor = named.split("@")[1];
    const comment = /^#\s*(v\d+(?:\.\d+\.\d+)?)\b/.exec(tail);
    if (!comment) {
      issues.push({
        rule: "action-comment",
        file,
        where: `line ${idx + 1}`,
        detail: `${uses} must carry a # ${expectedMajor} tag comment`,
      });
    } else if (
      comment[1] !== expectedMajor &&
      !comment[1].startsWith(expectedMajor + ".")
    ) {
      issues.push({
        rule: "action-comment",
        file,
        where: `line ${idx + 1}`,
        detail: `${uses} comment ${comment[1]} does not match ${expectedMajor}`,
      });
    }
  });
  return issues;
}

const allowedWorkflows = Object.freeze(["audit.yml", "change-guard.yml"]);

// files: { "audit.yml": text, ... }
export function workflowIssues(
  files,
  {
    packageJson = null,
    scriptPackages = null,
    expectedWorkflows = allowedWorkflows,
  } = {},
) {
  const issues = [];
  const issue = (rule, file, where, detail) =>
    issues.push({ rule, file, where, detail });
  const names = Object.keys(files).sort();
  for (const f of names) {
    if (!expectedWorkflows.includes(f))
      issue("workflow-set", f, "file", "undeclared workflow file");
  }
  for (const f of expectedWorkflows) {
    if (!names.includes(f))
      issue("workflow-set", f, "file", "missing workflow file");
  }

  const installedDeps = packageJson
    ? {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {}),
      }
    : null;
  if (installedDeps) {
    for (const [dep, ver] of Object.entries(installedDeps)) {
      if (!/^\d+\.\d+\.\d+$/.test(ver)) {
        issue(
          "package-pins",
          "package.json",
          dep,
          `dependency ${dep} must be exact-pinned (got ${ver})`,
        );
      }
    }
  }
  const npmScripts = packageJson?.scripts || {};

  for (const file of names.filter((f) => expectedWorkflows.includes(f))) {
    let doc;
    try {
      doc = parseWorkflowYaml(files[file]);
    } catch (error) {
      issue("yaml", file, "text", error.message);
      continue;
    }
    issues.push(...actionCommentIssues(file, files[file]));

    if (
      !doc.permissions ||
      typeof doc.permissions !== "object" ||
      doc.permissions.contents !== "read" ||
      Object.values(doc.permissions).some((v) => v !== "read")
    ) {
      issue(
        "permissions",
        file,
        "permissions",
        "workflow permissions must be read-only (contents: read)",
      );
    }

    const c = doc.concurrency;
    if (!c || typeof c !== "object") {
      issue("concurrency", file, "concurrency", "missing concurrency block");
    } else {
      if (!c.group || typeof c.group !== "string")
        issue("concurrency", file, "concurrency.group", "missing concurrency group");
      if (!allowedCancelExpressions.has(String(c["cancel-in-progress"] ?? ""))) {
        issue(
          "concurrency",
          file,
          "concurrency.cancel-in-progress",
          "cancel-in-progress must never cancel main runs (use github.event_name == 'pull_request')",
        );
      }
    }

    const jobs =
      doc.jobs && typeof doc.jobs === "object" && !Array.isArray(doc.jobs)
        ? doc.jobs
        : {};
    if (!Object.keys(jobs).length)
      issue("jobs", file, "jobs", "workflow has no jobs");

    for (const [jobId, job] of Object.entries(jobs)) {
      if (!job || typeof job !== "object") {
        issue("jobs", file, jobId, "invalid job definition");
        continue;
      }
      if (Object.hasOwn(job, "continue-on-error"))
        issue("continue-on-error", file, jobId, "job must not continue-on-error");
      if (!/^[1-9][0-9]*$/.test(String(job["timeout-minutes"] ?? ""))) {
        issue(
          "timeout",
          file,
          `${jobId}.timeout-minutes`,
          "every job needs a positive integer timeout-minutes",
        );
      }
      if (
        job.permissions !== undefined &&
        (!job.permissions ||
          typeof job.permissions !== "object" ||
          Object.values(job.permissions).some((v) => v !== "read"))
      ) {
        issue(
          "permissions",
          file,
          `${jobId}.permissions`,
          "job permissions must be read-only",
        );
      }
      const steps = Array.isArray(job.steps) ? job.steps : [];
      if (!steps.length) issue("jobs", file, `${jobId}.steps`, "job has no steps");

      let nodeSetUp = false;
      let depsInstalled = false;

      steps.forEach((step, idx) => {
        const at = `${jobId}.steps[${idx}]`;
        if (!step || typeof step !== "object" || Array.isArray(step)) {
          issue("step-keys", file, at, "step must be a mapping");
          return;
        }
        if (Object.hasOwn(step, "continue-on-error"))
          issue("continue-on-error", file, at, "step must not continue-on-error");
        if ((step.uses === undefined) === (step.run === undefined)) {
          issue("step-keys", file, at, "step must have exactly one of uses or run");
          return;
        }
        if (step.uses !== undefined) {
          const named = pinnedActionTag(step.uses);
          if (!named) {
            issue(
              "actions",
              file,
              at,
              `action not pinned to an approved commit SHA: ${step.uses}`,
            );
            return;
          }
          if (named === "actions/checkout@v6") {
            if (step.with?.["persist-credentials"] !== "false") {
              issue(
                "checkout",
                file,
                at,
                "actions/checkout must set persist-credentials: false",
              );
            }
          }
          if (named === "actions/setup-node@v6") {
            if (String(step.with?.["node-version"] ?? "") !== workflowNodeVersion) {
              issue(
                "node-version",
                file,
                at,
                `actions/setup-node must use node-version "${workflowNodeVersion}"`,
              );
            }
            nodeSetUp = true;
          }
          if (named === "actions/upload-artifact@v7") {
            if (String(step.with?.["retention-days"] ?? "") !== "3") {
              issue(
                "artifact",
                file,
                at,
                "actions/upload-artifact must set retention-days: 3",
              );
            }
            if (step.with?.["if-no-files-found"] !== "error") {
              issue(
                "artifact",
                file,
                at,
                "actions/upload-artifact must set if-no-files-found: error",
              );
            }
          }
          return;
        }

        const runText = String(step.run);
        for (const rawLine of runText.split("\n")) {
          const line = rawLine.trim();
          if (!line || line.startsWith("#")) continue;
          if (/^(?:node|npm|npx)\b/.test(line) && !nodeSetUp) {
            issue(
              "node-version",
              file,
              at,
              `command "${line}" runs before actions/setup-node sets up Node ${workflowNodeVersion}`,
            );
          }
          if (/^npm\s+ci\b/.test(line)) {
            if (!/\s--ignore-scripts\b/.test(line)) {
              issue(
                "npm-ignore-scripts",
                file,
                at,
                "npm ci must pass --ignore-scripts",
              );
            }
            depsInstalled = true;
          }
          if (/^npm\s+install\b/.test(line) && !/\s--ignore-scripts\b/.test(line)) {
            issue(
              "npm-ignore-scripts",
              file,
              at,
              "npm install must pass --ignore-scripts",
            );
          }

          if (scriptPackages && installedDeps) {
            const launched = [];
            const directNode = /^node\s+((?:scripts|tests)\/\S+\.(?:mjs|cjs|js))\b/.exec(
              line,
            );
            if (directNode) launched.push(directNode[1]);
            const npmRun = /^npm\s+run\s+([A-Za-z0-9:_-]+)/.exec(line);
            if (npmRun && npmScripts[npmRun[1]]) {
              const targetCmd = npmScripts[npmRun[1]];
              const scriptMatch = /\bnode\s+((?:scripts|tests)\/\S+\.(?:mjs|cjs|js))\b/.exec(
                targetCmd,
              );
              if (scriptMatch) launched.push(scriptMatch[1]);
              if (/\bplaywright\s+test\b/.test(targetCmd))
                launched.push("playwright.config.mjs");
            }
            for (const script of launched) {
              const pkgs = [...scriptPackages(script)];
              if (pkgs.length && !depsInstalled) {
                issue(
                  "packages",
                  file,
                  at,
                  `${script} loads ${pkgs.join(", ")} before npm ci --ignore-scripts`,
                );
              }
              for (const pkg of pkgs) {
                if (!Object.hasOwn(installedDeps, pkg)) {
                  issue(
                    "packages",
                    file,
                    at,
                    `${script} imports "${pkg}", which is not declared in package.json`,
                  );
                }
              }
            }
          }
        }
      });
    }
  }
  return issues;
}

export const GUARD_WORKFLOWS = Object.freeze(["change-guard.yml"]);

// Returns repository files required to be owned by .github/CODEOWNERS that are
// missing an explicit `/path @SAIEduLab` entry.
export function unownedGuardFiles(files, ownersText, reach) {
  const listed = new Set();
  for (const rawLine of ownersText.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts[0].startsWith("/") && parts.slice(1).includes("@SAIEduLab")) {
      listed.add(parts[0].slice(1));
    }
  }
  const guardScripts = GUARD_WORKFLOWS.flatMap((name) =>
    [...(files[name] ?? "").matchAll(/^\s*(?:-\s+)?run:.*\bnode\s+((?:scripts|tests)\/\S+\.(?:mjs|cjs|js))/gm)].map(
      (m) => m[1],
    ),
  );
  // Also catch multiline `run: |` blocks in guard workflows
  for (const name of GUARD_WORKFLOWS) {
    for (const m of (files[name] ?? "").matchAll(
      /^\s*node\s+((?:scripts|tests)\/\S+\.(?:mjs|cjs|js))\b/gm,
    )) {
      if (!guardScripts.includes(m[1])) guardScripts.push(m[1]);
    }
  }
  if (!guardScripts.length)
    throw new Error("the guard workflow runs no node script");

  const guarded = new Set([
    ".github/CODEOWNERS",
    ...Object.keys(files).map((name) => `.github/workflows/${name}`),
    ...guardScripts.flatMap((script) => reach(script)),
  ]);
  return [...guarded].filter((file) => !listed.has(file)).sort();
}

export function runWorkflowContractNegativeControls() {
  // 1. YAML subset negative controls
  for (const [label, badYaml, reason] of [
    ["BOM", "\uFEFFname: test\n", /byte order mark/],
    ["tab", "name:\tbad\n", /tab character/],
    ["duplicate key", "name: a\nname: b\n", /duplicate key/],
    ["anchor", "a: &ref x\n", /unsupported YAML construct/],
    ["folded block", "run: >\n  echo hi\n", /only plain literal block scalars/],
    ["document marker", "---\nname: a\n", /document marker/],
  ]) {
    assert.throws(
      () => parseWorkflowYaml(badYaml),
      refusedWith({ message: reason }),
      `YAML parser must reject ${label}`,
    );
  }

  const validAudit = [
    "name: Kazohe audit",
    "on:",
    "  push:",
    "    branches: [main]",
    "  pull_request:",
    "permissions:",
    "  contents: read",
    "concurrency:",
    "  group: kazohe-audit-${{ github.workflow }}-${{ github.ref }}",
    "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    "jobs:",
    "  math:",
    "    runs-on: ubuntu-24.04",
    "    timeout-minutes: 25",
    "    steps:",
    `      - uses: actions/checkout@${workflowActionPins["actions/checkout@v6"]} # v6`,
    "        with:",
    "          persist-credentials: false",
    `      - uses: actions/setup-node@${workflowActionPins["actions/setup-node@v6"]} # v6`,
    "        with:",
    '          node-version: "24"',
    "      - run: npm ci --ignore-scripts",
    "      - run: node scripts/lint.mjs",
    `      - uses: actions/upload-artifact@${workflowActionPins["actions/upload-artifact@v7"]} # v7`,
    "        with:",
    "          name: evidence",
    "          path: reports/",
    "          if-no-files-found: error",
    "          retention-days: 3",
  ].join("\n");

  const validGuard = [
    "name: Change guard",
    "on:",
    "  pull_request_target:",
    "    branches: [main]",
    "permissions:",
    "  contents: read",
    "concurrency:",
    "  group: change-guard-${{ github.event.pull_request.number || github.run_id }}",
    "  cancel-in-progress: ${{ github.event_name == 'pull_request' || github.event_name == 'pull_request_target' }}",
    "jobs:",
    "  guard:",
    "    runs-on: ubuntu-24.04",
    "    timeout-minutes: 30",
    "    steps:",
    `      - uses: actions/checkout@${workflowActionPins["actions/checkout@v6"]} # v6`,
    "        with:",
    "          persist-credentials: false",
    `      - uses: actions/setup-node@${workflowActionPins["actions/setup-node@v6"]} # v6`,
    "        with:",
    '          node-version: "24"',
    "      - run: npm ci --ignore-scripts",
    "      - run: node scripts/change-guard.mjs base head reports/cg.json",
  ].join("\n");

  const fakePkg = {
    scripts: { lint: "node scripts/lint.mjs" },
    devDependencies: { acorn: "8.15.0" },
  };
  const fakePkgs = (script) =>
    script === "scripts/lint.mjs" ? new Set(["acorn"]) : new Set();

  assert.deepEqual(
    workflowIssues(
      { "audit.yml": validAudit, "change-guard.yml": validGuard },
      { packageJson: fakePkg, scriptPackages: fakePkgs },
    ),
    [],
    "Valid synthetic workflows must pass",
  );

  // 2. Contract violation probes
  const probe = (mutate, expectedRule) => {
    const wf = { "audit.yml": validAudit, "change-guard.yml": validGuard };
    const pkg = structuredClone(fakePkg);
    let pkgs = fakePkgs;
    mutate(wf, pkg, (fn) => {
      pkgs = fn;
    });
    const found = workflowIssues(wf, {
      packageJson: pkg,
      scriptPackages: pkgs,
    });
    assert(
      found.some((i) => i.rule === expectedRule),
      `Expected rule "${expectedRule}", got ${JSON.stringify(found)}`,
    );
  };

  probe((wf) => {
    wf["audit.yml"] = wf["audit.yml"].replace(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
      "cancel-in-progress: true",
    );
  }, "concurrency");

  probe((wf) => {
    wf["audit.yml"] = wf["audit.yml"].replace(
      `actions/checkout@${workflowActionPins["actions/checkout@v6"]} # v6`,
      "actions/checkout@v6 # v6",
    );
  }, "actions");

  probe((wf) => {
    wf["audit.yml"] = wf["audit.yml"].replace(" # v6", "");
  }, "action-comment");

  probe((wf) => {
    wf["audit.yml"] = wf["audit.yml"].replace(
      "npm ci --ignore-scripts",
      "npm ci",
    );
  }, "npm-ignore-scripts");

  probe((wf) => {
    wf["audit.yml"] = wf["audit.yml"].replace(
      "persist-credentials: false",
      "fetch-depth: 1",
    );
  }, "checkout");

  probe((wf) => {
    wf["audit.yml"] = wf["audit.yml"].replace("timeout-minutes: 25", "");
  }, "timeout");

  probe((wf) => {
    wf["audit.yml"] = wf["audit.yml"].replace(
      "timeout-minutes: 25",
      "timeout-minutes: 25\n    continue-on-error: true",
    );
  }, "continue-on-error");

  probe((wf) => {
    wf["audit.yml"] = wf["audit.yml"].replace(
      "retention-days: 3",
      "retention-days: 7",
    );
  }, "artifact");

  probe((wf) => {
    wf["audit.yml"] = wf["audit.yml"].replace(
      'node-version: "24"',
      'node-version: "20"',
    );
  }, "node-version");

  probe((wf) => {
    wf["audit.yml"] = wf["audit.yml"].replace(
      "      - uses: actions/setup-node@",
      "      - run: node scripts/artifact.mjs\n      - uses: actions/setup-node@",
    );
  }, "node-version");

  probe((_wf, _pkg, setPkgs) => {
    setPkgs(() => new Set(["acorn", "uninstalled-pkg"]));
  }, "packages");

  // 3. CODEOWNERS negative control
  const reach = () => ["scripts/change-guard.mjs", "scripts/behaviour-snapshot.mjs"];
  const fullOwners = [
    "/.github/CODEOWNERS @SAIEduLab",
    "/.github/workflows/audit.yml @SAIEduLab",
    "/.github/workflows/change-guard.yml @SAIEduLab",
    "/scripts/change-guard.mjs @SAIEduLab",
    "/scripts/behaviour-snapshot.mjs @SAIEduLab",
  ].join("\n");
  assert.deepEqual(
    unownedGuardFiles(
      { "audit.yml": validAudit, "change-guard.yml": validGuard },
      fullOwners,
      reach,
    ),
    [],
  );
  const missingOne = fullOwners.replace("/scripts/behaviour-snapshot.mjs @SAIEduLab", "");
  assert.deepEqual(
    unownedGuardFiles(
      { "audit.yml": validAudit, "change-guard.yml": validGuard },
      missingOne,
      reach,
    ),
    ["scripts/behaviour-snapshot.mjs"],
  );
}

export function verifyWorkflowContract(root = rootDir) {
  runWorkflowContractNegativeControls();
  const wfDir = path.join(root, ".github/workflows");
  const files = {};
  for (const name of fs.readdirSync(wfDir).sort()) {
    if (/\.ya?ml$/.test(name))
      files[name] = fs.readFileSync(path.join(wfDir, name), "utf8");
  }
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const declared = declaredLaunches(root);
  const reachCache = new Map();
  const reach = (script) => {
    if (!reachCache.has(script))
      reachCache.set(script, scriptReach(root, script, declared));
    return reachCache.get(script);
  };
  const issues = workflowIssues(files, {
    packageJson: pkg,
    scriptPackages: (script) => reach(script).packages,
  });
  assert.deepEqual(
    issues,
    [],
    `Workflow contract violations:\n${issues.map((i) => `${i.file} (${i.where}) [${i.rule}]: ${i.detail}`).join("\n")}`,
  );
  const codeownersPath = path.join(root, ".github/CODEOWNERS");
  assert(fs.existsSync(codeownersPath), "Missing .github/CODEOWNERS");
  const ownersText = fs.readFileSync(codeownersPath, "utf8");
  const unowned = unownedGuardFiles(files, ownersText, (s) => reach(s).files);
  assert.deepEqual(
    unowned,
    [],
    `Unowned guard/workflow files missing from .github/CODEOWNERS:\n${unowned.join("\n")}`,
  );
  return { workflows: Object.keys(files).length, unowned: 0 };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const result = verifyWorkflowContract();
  console.log(
    `workflow-contract: ${result.workflows} workflows, ${result.unowned} unowned guard files PASS`,
  );
}
