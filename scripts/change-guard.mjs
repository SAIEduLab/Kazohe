// Pull-request change guard for Kazohe.
// Compares the merge base with head across version rules, audit identity (TC IDs,
// manifest entries, gate checks, SHA pins), AST assertion counts, token-level
// rewritten test lines, shrink-only baselines, and confined behaviour snapshots.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { parse } from "acorn";
import {
  boundedSnapshot,
  behaviourDifferences,
  behaviourIssues,
  intendedChangesFile,
  normalizedCoreScript,
  productScriptsOf,
  runLimited,
} from "./behaviour-snapshot.mjs";
import { assertionCounts, weakenedFiles } from "./assertion-counts.mjs";

const behaviourCache = new Map();
const countCache = new Map();

export const guardReportSchema = "kazohe-change-guard-v1";
export const auditChangesFile = "tests/manifests/intended-audit-changes.json";
export const auditChangesSchema = "kazohe-intended-audit-changes-v1";
export const guardLimitMs = 180000;

export const allowanceCategories = Object.freeze([
  "unnamed-code",
  "clone-allowance",
  "shown-text-allowance",
  "wait-allowance",
  "source-read-allowance",
  "lint-allowance",
]);
export const identityCategories = Object.freeze([
  "tc",
  "manifest-entry",
  "gate-case",
  "pin",
]);
export const testScriptPattern = /^tests\/.*\.(?:m|c)?js$/;

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const isProductHtml = (name) =>
  name === "Kazohe.html" || /^Kazohe_\d+_\d+_\d+\.html$/.test(name);
const productFileFor = (version) =>
  `Kazohe_${version.replaceAll(".", "_")}.html`;
const pinPattern =
  /(?<![0-9A-Za-z])(?:[0-9a-f]{64}|[0-9a-f]{40})(?![0-9A-Za-z])/g;
const pinExcludedFiles = new Set([
  auditChangesFile,
  intendedChangesFile,
  "tests/evidence/visual-review.json",
]);
const guardFiles = [
  "scripts/change-guard.mjs",
  "scripts/behaviour-snapshot.mjs",
  "scripts/assertion-counts.mjs",
];

function cleanGitEnv() {
  const env = { ...process.env };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
  ])
    delete env[key];
  return env;
}

export function git(repo, args, input) {
  return cp.execFileSync("git", ["-C", repo, ...args], {
    input,
    env: cleanGitEnv(),
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: guardLimitMs,
  });
}

const gitText = (repo, args) => git(repo, args).toString("utf8").trim();

function optionalObject(repo, spec) {
  try {
    return gitText(repo, ["rev-parse", "--verify", "--quiet", spec]);
  } catch {
    return null;
  }
}

export function treeEntries(repo, commit, ...prefixes) {
  const existing = prefixes.filter((p) =>
    optionalObject(repo, `${commit}:${p}`),
  );
  if (!existing.length) return [];
  return git(repo, [
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    commit,
    "--",
    ...existing,
  ])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      const [mode, type, oid] = line.slice(0, tab).split(" ");
      return { mode, type, oid, path: line.slice(tab + 1) };
    });
}

export function readBlobs(repo, oids) {
  const unique = [...new Set(oids)];
  const blobs = new Map();
  if (!unique.length) return blobs;
  const out = git(repo, ["cat-file", "--batch"], unique.join("\n") + "\n");
  let at = 0;
  for (const oid of unique) {
    const newline = out.indexOf(10, at);
    const [got, type, size] = out
      .subarray(at, newline)
      .toString("utf8")
      .split(" ");
    assert.equal(got, oid, "object order");
    assert.equal(type, "blob", "object " + oid + " is not a readable blob");
    const start = newline + 1;
    const end = start + Number(size);
    blobs.set(oid, out.subarray(start, end));
    at = end + 1;
  }
  return blobs;
}

function materialize(repo, commit, workDir) {
  const scriptsTree = optionalObject(repo, commit + ":scripts");
  assert.ok(scriptsTree, "commit " + commit + " has no scripts directory");
  const testsTree = optionalObject(repo, commit + ":tests") ?? "none";
  const key = scriptsTree.slice(0, 12) + "-" + testsTree.slice(0, 12);
  const dir = path.join(workDir, key);
  const entries = treeEntries(
    repo,
    commit,
    "scripts",
    "tests",
    ".github/workflows",
  ).filter((e) => e.type === "blob");
  const blobs = readBlobs(
    repo,
    entries.map((e) => e.oid),
  );
  if (!fs.existsSync(dir)) {
    const partial = dir + ".partial." + process.pid;
    fs.rmSync(partial, { recursive: true, force: true });
    fs.mkdirSync(partial, { recursive: true });
    for (const e of entries) {
      assert.ok(
        e.mode !== "120000",
        "symbolic link in the audit tree: " + e.path,
      );
      if (
        !e.path.startsWith("scripts/") &&
        !e.path.startsWith("tests/unit/")
      )
        continue;
      const file = path.join(partial, ...e.path.split("/"));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, blobs.get(e.oid));
    }
    try {
      fs.renameSync(partial, dir);
    } catch {
      fs.rmSync(partial, { recursive: true, force: true });
    }
  }
  return { dir, entries, blobs };
}

function parseModuleAst(text) {
  return parse(text, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowHashBang: true,
  });
}

function extractSuiteChecks(file, text) {
  let ast;
  try {
    ast = parseModuleAst(text);
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
  const base = path.basename(file, path.extname(file));
  const found = [];
  const skipKeys = new Set(["start", "end", "loc", "raw"]);
  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    if (
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      !node.callee.computed &&
      node.callee.property.type === "Identifier" &&
      (node.callee.property.name === "check" ||
        node.callee.property.name === "checkAsync") &&
      node.arguments.length >= 2
    ) {
      const arg = node.arguments[0];
      if (arg.type === "Literal" && typeof arg.value === "string") {
        found.push(`${base}/${arg.value}`);
      } else if (
        arg.type === "TemplateLiteral" &&
        arg.expressions.length === 0
      ) {
        found.push(`${base}/${arg.quasis[0].value.cooked}`);
      }
    }
    for (const key of Object.keys(node)) {
      if (skipKeys.has(key)) continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === "string") visit(v);
    }
  };
  visit(ast);
  return found;
}

// Reads exported literal baselines from scripts/ without executing module code.
export function treeAllowances(dir) {
  const literalValue = (node) => {
    if (!node) throw new Error("an allowance is not a literal");
    if (
      node.type === "Literal" &&
      (typeof node.value === "string" ||
        typeof node.value === "number" ||
        typeof node.value === "boolean")
    )
      return node.value;
    if (node.type === "TemplateLiteral" && node.expressions.length === 0)
      return node.quasis[0].value.cooked;
    if (node.type === "ArrayExpression") return node.elements.map(literalValue);
    if (node.type === "ObjectExpression")
      return Object.fromEntries(
        node.properties.map((p) => {
          if (
            p.type !== "Property" ||
            p.kind !== "init" ||
            p.computed ||
            !(
              p.key.type === "Identifier" ||
              (p.key.type === "Literal" && typeof p.key.value === "string")
            )
          )
            throw new Error("an allowance is not a literal");
          return [p.key.name ?? p.key.value, literalValue(p.value)];
        }),
      );
    if (
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      !node.callee.computed &&
      node.callee.object.type === "Identifier" &&
      node.callee.object.name === "Object" &&
      node.callee.property.type === "Identifier" &&
      node.callee.property.name === "freeze" &&
      node.arguments.length === 1
    )
      return literalValue(node.arguments[0]);
    throw new Error("an allowance is not a literal");
  };

  const scriptsDir = path.join(dir, "scripts");
  const scriptFiles = fs.existsSync(scriptsDir)
    ? fs
        .readdirSync(scriptsDir)
        .filter((f) => /\.(?:m|c)?js$/.test(f))
        .sort()
        .map((f) => path.join(scriptsDir, f))
    : [];

  const exportsByName = new Map();
  const wanted = new Set([
    "UNNAMED_CODES",
    "CLONE_BASELINE",
    "SHOWN_TEXT_BASELINE",
    "WAIT_BASELINE",
    "SOURCE_READ_BASELINE",
    "LINT_BASELINE",
  ]);
  for (const file of scriptFiles) {
    const text = fs.readFileSync(file, "utf8");
    let hasWanted = false;
    for (const name of wanted) {
      if (text.includes(name)) {
        hasWanted = true;
        break;
      }
    }
    if (!hasWanted) continue;
    const ast = parseModuleAst(text);
    for (const stmt of ast.body) {
      if (
        stmt.type === "ExportNamedDeclaration" &&
        stmt.declaration?.type === "VariableDeclaration"
      ) {
        for (const decl of stmt.declaration.declarations) {
          if (decl.id.type === "Identifier" && wanted.has(decl.id.name)) {
            exportsByName.set(decl.id.name, literalValue(decl.init));
          }
        }
      }
    }
  }

  const units = (key, n) =>
    Array.from(
      { length: Number.isSafeInteger(n) && n > 0 ? n : 0 },
      (_, i) => `${key}#${i + 1}`,
    );
  const counts = (obj) =>
    Object.entries(obj || {}).flatMap(([file, n]) => units(file, n));
  const lintItems = (obj) =>
    Object.entries(obj || {}).flatMap(([file, rules]) =>
      typeof rules === "number"
        ? units(file, rules)
        : Object.entries(rules || {}).flatMap(([rule, n]) =>
            units(`${file}|${rule}`, n),
          ),
    );

  return {
    "unnamed-code": (exportsByName.get("UNNAMED_CODES") || []).map(String),
    "clone-allowance": (exportsByName.get("CLONE_BASELINE") || []).map((e) =>
      typeof e === "string" ? e : String(e?.id),
    ),
    "shown-text-allowance": (
      exportsByName.get("SHOWN_TEXT_BASELINE") || []
    ).map((e) => (typeof e === "string" ? e : `${e?.file}|${e?.source}`)),
    "wait-allowance": counts(exportsByName.get("WAIT_BASELINE")),
    "source-read-allowance": counts(exportsByName.get("SOURCE_READ_BASELINE")),
    "lint-allowance": lintItems(exportsByName.get("LINT_BASELINE")),
  };
}

// Evaluates the tree's own contracts in a confined child process.
export async function identitySets(dir) {
  const manifestPath = path.join(dir, "scripts", "manifest.mjs");
  const manifestMod = fs.existsSync(manifestPath)
    ? await import(pathToFileURL(manifestPath).href)
    : null;
  const tc = Array.isArray(manifestMod?.tcIds) ? [...manifestMod.tcIds] : [];
  const manifestEntry = Array.isArray(manifestMod?.manifest)
    ? manifestMod.manifest.map((entry) => `${entry.id}/${entry.method}`)
    : [];
  const gateCase = [
    ...(Array.isArray(manifestMod?.gateCaseIds) ? manifestMod.gateCaseIds : []),
    ...(Array.isArray(manifestMod?.gateCheckIds)
      ? manifestMod.gateCheckIds
      : []),
  ];
  for (const rel of ["scripts", "tests/unit"]) {
    const scanDir = path.join(dir, ...rel.split("/"));
    if (!fs.existsSync(scanDir)) continue;
    for (const name of fs.readdirSync(scanDir).sort()) {
      if (!name.endsWith(".mjs")) continue;
      const full = path.join(scanDir, name);
      if (!fs.statSync(full).isFile()) continue;
      gateCase.push(...extractSuiteChecks(name, fs.readFileSync(full, "utf8")));
    }
  }
  return {
    sets: {
      tc,
      "manifest-entry": manifestEntry,
      "gate-case": [...new Set(gateCase)].sort(),
    },
    allowances: treeAllowances(dir),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
  process.argv[2] === "--identity"
) {
  fs.writeFileSync(
    process.argv[4],
    JSON.stringify(await identitySets(process.argv[3])),
  );
  process.exit(0);
}

export async function treeIdentity(repo, commit, workDir) {
  const { dir, entries, blobs } = materialize(repo, commit, workDir);
  const answer = path.join(workDir, `identity-${commit}-${process.pid}.json`);
  let sets;
  let allowances;
  try {
    runLimited(
      [fileURLToPath(import.meta.url), "--identity", dir, answer],
      guardLimitMs,
      "the contracts of " + commit,
      [answer],
    );
    if (!fs.existsSync(answer))
      throw new Error(
        "the contracts of " + commit + " ended without an answer",
      );
    ({ sets, allowances } = JSON.parse(fs.readFileSync(answer, "utf8")));
  } finally {
    fs.rmSync(answer, { force: true });
  }

  const pins = new Map();
  for (const e of entries) {
    if (pinExcludedFiles.has(e.path)) continue;
    const bytes = blobs.get(e.oid);
    if (bytes.includes(0)) continue;
    for (const [value] of bytes.toString("utf8").matchAll(pinPattern)) {
      pins.set(value, [...new Set([...(pins.get(value) || []), e.path])]);
    }
  }
  sets.pin = [...pins.keys()];

  const pkgOid = optionalObject(repo, commit + ":package.json");
  assert.ok(pkgOid, "commit " + commit + " lacks package.json");
  const pkg = JSON.parse(
    readBlobs(repo, [pkgOid]).get(pkgOid).toString("utf8"),
  );
  assert.ok(
    typeof pkg?.version === "string" && versionPattern.test(pkg.version),
    "commit " + commit + " has invalid package.json version",
  );
  const version = pkg.version;
  const productFile = productFileFor(version);
  const rootNames = gitText(repo, ["ls-tree", "--name-only", commit])
    .split("\n")
    .filter(Boolean);
  const products = rootNames.filter(isProductHtml).sort();
  const product = optionalObject(repo, `${commit}:${productFile}`);
  return {
    commit,
    sets,
    allowances,
    pins,
    version,
    productFile,
    products,
    product,
    source: optionalObject(repo, commit + ":src"),
  };
}

export function nextPatch(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

export function versionAfter(a, b) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

function resolveCommits(repo, base, head) {
  const baseCommit = gitText(repo, [
    "rev-parse",
    "--verify",
    base + "^{commit}",
  ]);
  const headCommit = gitText(repo, [
    "rev-parse",
    "--verify",
    head + "^{commit}",
  ]);
  let mergeBase;
  try {
    mergeBase = gitText(repo, ["merge-base", baseCommit, headCommit]);
  } catch {
    throw new Error(
      "no merge base between " + baseCommit + " and " + headCommit,
    );
  }
  return { base: baseCommit, head: headCommit, mergeBase };
}

// Tokenizes JS source into per-line canonical token JSON arrays, ignoring whitespace
// and comments while preserving exact text of strings, templates, and regexes.
export function scriptTokenLines(script, options = { sourceType: "script" }) {
  const tokens = [];
  const parseOpts = {
    ecmaVersion: "latest",
    sourceType: options.sourceType ?? "script",
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowHashBang: true,
    onToken: tokens,
  };
  if (options.sourceType === "unambiguous") {
    let parsed = false;
    let lastError = null;
    for (const mode of ["module", "script"]) {
      tokens.length = 0;
      try {
        parse(script, { ...parseOpts, sourceType: mode });
        parsed = true;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!parsed) throw lastError;
  } else {
    parse(script, parseOpts);
  }

  const lines = script.split("\n").map(() => []);
  const starts = [0];
  for (let i = 0; i < script.length; i++)
    if (script.charCodeAt(i) === 10) starts.push(i + 1);
  const lineAt = (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  for (const t of tokens) {
    if (t.type?.label === "eof" || t.end <= t.start) continue;
    lines[lineAt(t.start)].push(script.slice(t.start, t.end));
  }
  return lines.map((row) => (row.length ? JSON.stringify(row) : ""));
}

function diffSingleScript(beforeBlock, afterBlock, afterHtmlLines) {
  if (!beforeBlock && !afterBlock) return [];
  const a = beforeBlock ? scriptTokenLines(beforeBlock.script) : [];
  const b = afterBlock ? scriptTokenLines(afterBlock.script) : [];
  if (!afterBlock) return [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kazohe-lines-"));
  let out;
  try {
    const fa = path.join(dir, "base.txt");
    const fb = path.join(dir, "head.txt");
    fs.writeFileSync(fa, a.join("\n") + "\n");
    fs.writeFileSync(fb, b.join("\n") + "\n");
    const r = cp.spawnSync(
      "git",
      [
        "diff",
        "--no-index",
        "--no-color",
        "--no-ext-diff",
        "-U0",
        "--",
        fa,
        fb,
      ],
      {
        encoding: "utf8",
        env: cleanGitEnv(),
        maxBuffer: 512 * 1024 * 1024,
        timeout: guardLimitMs,
      },
    );
    if (r.status !== 0 && r.status !== 1)
      throw new Error(
        "the comparison of the products failed: " +
          (r.error?.message || r.stderr),
      );
    out = r.stdout;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const added = [];
  const removed = new Map();
  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  let at = 0;
  let inHunk = false;
  for (const row of out.split("\n")) {
    const hunk = row.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      at = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (row.startsWith("-")) bump(removed, row.slice(1));
    else if (row.startsWith("+")) {
      added.push([at, row.slice(1)]);
      at++;
    }
  }
  const inBase = new Map();
  for (const text of a) bump(inBase, text);
  const allowance = new Map(
    [...removed].filter(([text, n]) => inBase.get(text) === n),
  );
  const changed = [];
  for (const [scriptLine, tokens] of added) {
    if (!tokens) continue;
    const left = allowance.get(tokens) ?? 0;
    if (left > 0) {
      allowance.set(tokens, left - 1);
      continue;
    }
    const line = afterBlock.firstLine + scriptLine - 1;
    changed.push([line, afterHtmlLines[line - 1] ?? ""]);
  }
  return changed;
}

// Returns [[lineNumber, lineText], ...] of changed token lines across product scripts.
export function changedScriptLines(beforeHtml, afterHtml) {
  const before = productScriptsOf(beforeHtml);
  const after = productScriptsOf(afterHtml);
  const afterHtmlLines = String(afterHtml ?? "").split("\n");
  return [
    ...diffSingleScript(before.core, after.core, afterHtmlLines),
    ...diffSingleScript(before.app, after.app, afterHtmlLines),
  ];
}

function testScriptLines(script) {
  try {
    return scriptTokenLines(script, { sourceType: "unambiguous" });
  } catch {
    return script
      .split("\n")
      .map((line) => (line.trim() ? "text:" + line.trim() : ""));
  }
}

function scriptTexts(...scripts) {
  const bytes = scripts.map((s) =>
    typeof s === "string" ? Buffer.from(s, "utf8") : s,
  );
  const texts = bytes.map((b) => b.toString("utf8"));
  return texts.every((t, i) => Buffer.from(t, "utf8").equals(bytes[i]))
    ? texts
    : bytes.map((b) => b.toString("latin1"));
}

const rewrittenCells = 1 << 24;

// Token-level LCS diff returning base 1-based line numbers rewritten, deleted, or reordered.
export function rewrittenLines(before, after) {
  const [was, now] = scriptTexts(before, after);
  const at = [];
  const base = [];
  testScriptLines(was).forEach((text, i) => {
    if (text) {
      at.push(i + 1);
      base.push(text);
    }
  });
  const head = testScriptLines(now).filter(Boolean);
  let next = 0;
  for (const text of head)
    if (next < base.length && text === base[next]) next++;
  if (next === base.length) return [];
  let start = 0;
  let baseEnd = base.length;
  let headEnd = head.length;
  while (start < baseEnd && start < headEnd && base[start] === head[start])
    start++;
  while (
    baseEnd > start &&
    headEnd > start &&
    base[baseEnd - 1] === head[headEnd - 1]
  ) {
    baseEnd--;
    headEnd--;
  }
  const n = baseEnd - start;
  const m = headEnd - start;
  const width = m + 1;
  if ((n + 1) * width > rewrittenCells) return at.slice(start, baseEnd);
  const common = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      common[i * width + j] =
        base[start + i] === head[start + j]
          ? common[(i + 1) * width + j + 1] + 1
          : Math.max(common[(i + 1) * width + j], common[i * width + j + 1]);
    }
  }
  const gone = [];
  for (let i = 0, j = 0; i < n; ) {
    if (j < m && base[start + i] === head[start + j]) {
      i++;
      j++;
    } else if (
      j >= m ||
      common[(i + 1) * width + j] >= common[i * width + j + 1]
    ) {
      gone.push(at[start + i]);
      i++;
    } else {
      j++;
    }
  }
  return gone;
}

function guardCode(repo, commits) {
  const here = guardFiles.map((file) =>
    git(
      repo,
      ["hash-object", "--path=" + file, "--stdin"],
      fs.readFileSync(new URL("../" + file, import.meta.url)),
    )
      .toString("utf8")
      .trim(),
  );
  const same = (commit) =>
    guardFiles.every(
      (file, i) => optionalObject(repo, `${commit}:${file}`) === here[i],
    );
  return { base: same(commits.base), head: same(commits.head) };
}

export function auditChangeIssues(items, baseRecord, headRecord, grown = []) {
  const read = (record, list) => {
    if (!record) return [];
    if (
      typeof record !== "object" ||
      Array.isArray(record) ||
      (record.schema !== undefined && record.schema !== auditChangesSchema) ||
      !Array.isArray(record.changes) ||
      (record.allowances !== undefined && !Array.isArray(record.allowances))
    )
      throw new Error(auditChangesFile + " has the wrong shape");
    for (const key of Object.keys(record)) {
      if (!["schema", "changes", "allowances"].includes(key))
        throw new Error(auditChangesFile + " has the wrong shape");
    }
    for (const c of [...record.changes, ...(record.allowances ?? [])]) {
      if (
        typeof c?.change !== "string" ||
        c.change.trim().length === 0 ||
        typeof c?.reason !== "string" ||
        c.reason.trim().length < 10
      )
        throw new Error(
          auditChangesFile + ": each entry names a change and a reason",
        );
    }
    return record[list] ?? [];
  };
  const key = (c) => c.change + "\u0000" + c.reason;
  const added = (list) => {
    const before = new Set(read(baseRecord, list).map(key));
    return read(headRecord, list).filter((c) => !before.has(key(c)));
  };
  const changes = added("changes");
  const allowances = added("allowances");
  const recorded = new Set(changes.map((c) => c.change));
  const allowed = new Set(allowances.map((c) => c.change));
  const issues = [];
  for (const item of items)
    if (!recorded.has(item))
      issues.push(
        "the audit change " +
          item +
          " is not recorded with a reason in " +
          auditChangesFile,
      );
  for (const item of grown)
    if (!allowed.has(item))
      issues.push(
        "the audit change " +
          item +
          " is not recorded with a reason in the allowances of " +
          auditChangesFile,
      );
  for (const c of changes)
    if (!items.includes(c.change))
      issues.push(
        auditChangesFile +
          " records " +
          c.change +
          ", but this change does not make it",
      );
  for (const c of allowances)
    if (!grown.includes(c.change))
      issues.push(
        auditChangesFile +
          " records the allowance " +
          c.change +
          ", but this change does not grow it",
      );
  return {
    issues,
    recorded: [
      ...changes.filter((c) => items.includes(c.change)),
      ...allowances.filter((c) => grown.includes(c.change)),
    ].map((c) => ({ change: c.change, reason: c.reason })),
  };
}

export function guardStatus(report) {
  return !report.errors.length &&
    !report.versionIssues.length &&
    !report.releaseIssues.length &&
    !report.behaviourIssues.length &&
    !report.auditChangeIssues.length
    ? "PASS"
    : "FAIL";
}

const emptyReport = (base, head) => ({
  schema: guardReportSchema,
  status: "FAIL",
  base,
  head,
  mergeBase: null,
  guardCode: null,
  identitySizes: null,
  removed: {},
  grown: {},
  pinFiles: {},
  version: null,
  versionIssues: [],
  releaseIssues: [],
  changedScriptLines: { count: 0, lines: [] },
  behaviour: null,
  behaviourIssues: [],
  weakened: [],
  rewritten: [],
  auditChanges: [],
  auditChangeIssues: [],
  errors: [],
});

export async function changeGuard({
  repo,
  base,
  head,
  workDir,
  limitMs = guardLimitMs,
}) {
  const report = emptyReport(base, head);
  const ownDir = !workDir;
  workDir ??= fs.mkdtempSync(path.join(os.tmpdir(), "kazohe-guard-"));
  try {
    const commits = resolveCommits(repo, base, head);
    const { mergeBase, head: headCommit } = Object.assign(report, commits);
    report.guardCode = guardCode(repo, commits);
    const before = await treeIdentity(repo, mergeBase, workDir);
    const after = await treeIdentity(repo, headCommit, workDir);

    if (
      JSON.stringify(after.products) !== JSON.stringify([after.productFile])
    ) {
      report.releaseIssues.push(
        `exactly one product HTML, ${after.productFile}, must exist; found ${after.products.join(", ") || "none"}`,
      );
    }
    if (!before.product) {
      report.errors.push(
        `commit ${mergeBase} lacks expected product HTML ${before.productFile}`,
      );
    }

    report.identitySizes = {};
    for (const category of identityCategories) {
      const kept = new Set(after.sets[category]);
      const removed = [...new Set(before.sets[category])].filter(
        (id) => !kept.has(id),
      );
      report.identitySizes[category] = {
        base: new Set(before.sets[category]).size,
        head: kept.size,
      };
      if (removed.length) report.removed[category] = removed;
    }
    for (const value of report.removed.pin || [])
      report.pinFiles[value] = before.pins.get(value);

    for (const category of allowanceCategories) {
      const had = new Set(before.allowances[category]);
      const grown = [...new Set(after.allowances[category])].filter(
        (item) => !had.has(item),
      );
      if (grown.length) report.grown[category] = grown;
    }

    const productChanged =
      before.source !== after.source || before.product !== after.product;

    if (productChanged && before.product && after.product) {
      const objects = readBlobs(repo, [before.product, after.product]);
      const baseHtml = objects.get(before.product).toString("utf8");
      const headHtml = objects.get(after.product).toString("utf8");
      const lineDiffs = changedScriptLines(baseHtml, headHtml);
      report.changedScriptLines = {
        count: lineDiffs.length,
        lines: lineDiffs,
      };

      const baseNorm = normalizedCoreScript(baseHtml);
      const headNorm = normalizedCoreScript(headHtml);
      let differences = [];
      let caseCount = 0;
      if (baseNorm !== null && baseNorm === headNorm) {
        differences = [];
      } else {
        const controller = new AbortController();
        const started = [];
        const runSnap = (blobOid, htmlText) => {
          if (behaviourCache.has(blobOid))
            return Promise.resolve(behaviourCache.get(blobOid));
          const p = boundedSnapshot(htmlText, limitMs, controller.signal).then(
            (res) => {
              behaviourCache.set(blobOid, res);
              return res;
            },
          );
          started.push(p);
          return p;
        };
        const pair = Promise.all([
          runSnap(before.product, baseHtml),
          runSnap(after.product, headHtml),
        ]);
        pair.catch(() => {});
        try {
          const [baseSnap, headSnap] = await pair;
          caseCount = new Set([
            ...Object.keys(baseSnap),
            ...Object.keys(headSnap),
          ]).size;
          differences = behaviourDifferences(baseSnap, headSnap);
        } finally {
          controller.abort();
          await Promise.allSettled(started);
        }
      }
      const readBehaviourRecord = (commit) => {
        const oid = optionalObject(repo, commit + ":" + intendedChangesFile);
        return oid
          ? JSON.parse(readBlobs(repo, [oid]).get(oid).toString("utf8"))
          : null;
      };
      const { issues, intended } = behaviourIssues(
        differences,
        readBehaviourRecord(mergeBase),
        readBehaviourRecord(headCommit),
      );
      report.behaviour = {
        cases: caseCount,
        differences,
        intended: intended.map((c) => ({ case: c.case, reason: c.reason })),
      };
      report.behaviourIssues = issues;
    }

    const counts = (commit) => {
      const sOid = optionalObject(repo, commit + ":scripts") ?? "none";
      const tOid = optionalObject(repo, commit + ":tests") ?? "none";
      const key = `${sOid}:${tOid}`;
      if (!countCache.has(key)) {
        const entries = treeEntries(repo, commit, "scripts", "tests").filter(
          (e) => e.type === "blob" && /\.(?:m|c)?js$/.test(e.path),
        );
        const blobs = readBlobs(
          repo,
          entries.map((e) => e.oid),
        );
        const byFile = new Map(entries.map((e) => [e.path, e.oid]));
        countCache.set(
          key,
          assertionCounts(
            entries.map((e) => e.path),
            (file) => blobs.get(byFile.get(file)).toString("utf8"),
          ),
        );
      }
      return countCache.get(key);
    };
    report.weakened = weakenedFiles(counts(mergeBase), counts(headCommit));

    if (productChanged) {
      const testScripts = (commit) =>
        new Map(
          treeEntries(repo, commit, "tests")
            .filter((e) => e.type === "blob" && testScriptPattern.test(e.path))
            .map((e) => [e.path, e.oid]),
        );
      const was = testScripts(mergeBase);
      const now = testScripts(headCommit);
      const differing = [...was].filter(([file, oid]) => now.get(file) !== oid);
      const blobs = readBlobs(
        repo,
        differing
          .flatMap(([file, oid]) => [oid, now.get(file)])
          .filter(Boolean),
      );
      report.rewritten = differing
        .map(([file, oid]) => ({
          file,
          lines: rewrittenLines(
            blobs.get(oid),
            now.has(file) ? blobs.get(now.get(file)) : Buffer.alloc(0),
          ),
        }))
        .filter((r) => r.lines.length > 0);
    }

    const expected = productChanged
      ? nextPatch(before.version)
      : before.version;
    report.version = {
      base: before.version,
      head: after.version,
      expected,
      productChanged,
    };
    if (!productChanged && after.version !== expected) {
      report.versionIssues.push(
        `the product and src/ are unchanged: the product version must stay ${before.version}, found ${after.version}`,
      );
    } else if (productChanged && !versionAfter(after.version, before.version)) {
      report.versionIssues.push(
        `the product or src/ changed: the head product version must be ${expected} (one patch after ${before.version}), found ${after.version}`,
      );
    } else if (productChanged && after.version !== expected) {
      report.version.beyondPatch = true;
    }

    const auditRecord = (commit) => {
      const oid = optionalObject(repo, commit + ":" + auditChangesFile);
      return oid
        ? JSON.parse(readBlobs(repo, [oid]).get(oid).toString("utf8"))
        : null;
    };

    const less = [
      ...Object.entries(report.removed)
        .filter(([category]) => category !== "pin")
        .flatMap(([category, ids]) => ids.map((id) => `${category}:${id}`)),
      ...report.weakened.map(
        (w) => `fewer-checks:${w.slice(0, w.indexOf(": "))}`,
      ),
    ];
    const grown = Object.entries(report.grown).flatMap(([category, items]) =>
      items.map((item) => `${category}:${item}`),
    );
    const items = [
      ...less,
      ...(report.removed.pin || []).map((id) => `pin:${id}`),
      ...report.rewritten.map((r) => `rewritten-test:${r.file}`),
      ...(report.version.beyondPatch ? [`version:${after.version}`] : []),
    ];

    const audited = auditChangeIssues(
      items,
      auditRecord(mergeBase),
      auditRecord(headCommit),
      grown,
    );
    report.auditChanges = audited.recorded;
    report.auditChangeIssues = audited.issues;

    if (productChanged) {
      for (const c of audited.recorded) {
        if (less.includes(c.change)) {
          report.auditChangeIssues.push(
            `the audit change ${c.change} checks less, and this change also changes src/ or the product: record it in a change of the audit alone`,
          );
        }
      }
    }
  } catch (error) {
    report.errors.push(error.message);
  } finally {
    if (ownDir) fs.rmSync(workDir, { recursive: true, force: true });
  }
  report.status = guardStatus(report);
  return report;
}

export function formatGuardReport(report) {
  const lines = [
    "### Audit change guard: " + report.status,
    "",
    `Merge base \`${report.mergeBase}\` -> head \`${report.head}\``,
  ];
  if (report.guardCode) {
    lines.push(
      "Guard code: " +
        (report.guardCode.base
          ? "the base's"
          : report.guardCode.head
            ? "the head's own (this run shows how the change judges itself; the run with the base's guard judges it)"
            : "neither the base's nor the head's"),
    );
  }
  if (report.version) {
    lines.push(
      `Product version: ${report.version.base} -> ${report.version.head}` +
        (report.version.productChanged
          ? " (product or src/ changed)"
          : " (product and src/ unchanged)"),
    );
  }
  lines.push(
    `Changed product script lines: ${report.changedScriptLines?.count ?? 0}`,
  );
  if (report.behaviour) {
    lines.push(
      `Behaviour: ${report.behaviour.differences.length} of ${report.behaviour.cases} snapshot cases differ from the base product`,
    );
  }
  for (const message of [
    ...report.errors,
    ...report.versionIssues,
    ...report.releaseIssues,
    ...report.behaviourIssues,
    ...report.auditChangeIssues,
  ])
    lines.push("- " + message);

  const removed = Object.entries(report.removed);
  const intended = report.behaviour?.intended ?? [];
  const grown = Object.entries(report.grown || {});
  if (
    removed.length ||
    grown.length ||
    intended.length ||
    report.weakened.length ||
    report.rewritten.length ||
    report.version?.beyondPatch
  ) {
    lines.push("", "For the owner to read before the merge:");
    const why = (change) => {
      const r = report.auditChanges.find((c) => c.change === change);
      return r ? ": " + r.reason : "";
    };
    if (report.version?.beyondPatch) {
      lines.push(
        `- the product version ${report.version.head} is raised past the next patch ${report.version.expected}` +
          why("version:" + report.version.head),
      );
    }
    for (const [category, ids] of removed) {
      for (const id of ids) {
        lines.push(
          "- " +
            (category === "pin"
              ? `changed or removed pin ${id} (${report.pinFiles[id].join(", ")})`
              : `removed ${category} ${id}`) +
            why(`${category}:${id}`),
        );
      }
    }
    for (const [category, items] of grown) {
      for (const item of items) {
        lines.push(
          `- a new ${category} entry ${item}` + why(`${category}:${item}`),
        );
      }
    }
    for (const change of intended) {
      lines.push(`- changed behaviour of ${change.case}: ${change.reason}`);
    }
    for (const file of report.weakened) {
      lines.push(
        `- fewer checks in ${file}` +
          why("fewer-checks:" + file.slice(0, file.indexOf(": "))),
      );
    }
    for (const { file, lines: gone } of report.rewritten) {
      lines.push(
        `- rewritten, removed or reordered lines in ${file} (${gone.length} of the base: ${gone.slice(0, 10).join(", ")}${gone.length > 10 ? ", …" : ""})` +
          why("rewritten-test:" + file),
      );
    }
  }
  return lines.join("\n");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
  process.argv[2] !== "--identity"
) {
  const [base, head, output] = process.argv.slice(2);
  assert.ok(
    base && head && output,
    "usage: change-guard.mjs <baseSha> <headSha> <report.json>",
  );
  const repo = path.resolve(import.meta.dirname, "..");
  const report = await changeGuard({ repo, base, head });
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  const summary = formatGuardReport(report);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  if (report.status !== "PASS") process.exitCode = 1;
}
