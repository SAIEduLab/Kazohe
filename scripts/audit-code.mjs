// Checks over the audit and test code itself: refusal reasons, waits by time,
// timer-only sleep promises, raw reads of product source/HTML as text, and ESLint.
// Baseline tables are shrink-only; refusal reasons have zero tolerance.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { refusedWith } from "./refusal.mjs";

const require = createRequire(import.meta.url);
const { parse } = require("@babel/parser");

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skip = new Set([
  "loc",
  "start",
  "end",
  "extra",
  "leadingComments",
  "trailingComments",
  "innerComments",
]);

const walk = (node, visit) => {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (skip.has(key)) continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((x) => walk(x, visit));
    else if (v && typeof v.type === "string") walk(v, visit);
  }
};

const walkWith = (node, visit, parents = []) => {
  if (!node || typeof node.type !== "string") return;
  visit(node, parents);
  const inner = [...parents, node];
  for (const key of Object.keys(node)) {
    if (skip.has(key)) continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((x) => walkWith(x, visit, inner));
    else if (v && typeof v.type === "string") walkWith(v, visit, inner);
  }
};

const walkUp = (node, visit, up = []) => {
  if (!node || typeof node.type !== "string") return;
  visit(node, up);
  const next = [node, ...up];
  for (const key of Object.keys(node)) {
    if (skip.has(key)) continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((x) => walkUp(x, visit, next));
    else if (v && typeof v.type === "string") walkUp(v, visit, next);
  }
};

const syntax = (text) =>
  parse(text, {
    sourceType: "unambiguous",
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    errorRecovery: true,
  });

const scopeKinds =
  /^(?:Program|BlockStatement|For(?:Of|In)?Statement|CatchClause|SwitchStatement|(?:Arrow)?Function(?:Declaration|Expression)|ObjectMethod|ClassMethod)$/;

const patternIds = (target, out = []) => {
  if (!target) return out;
  if (target.type === "Identifier") out.push(target);
  else if (target.type === "ArrayPattern")
    target.elements.forEach((e) => patternIds(e, out));
  else if (target.type === "ObjectPattern")
    target.properties.forEach((p) =>
      patternIds(p.type === "RestElement" ? p.argument : p.value, out),
    );
  else if (target.type === "AssignmentPattern") patternIds(target.left, out);
  else if (target.type === "RestElement") patternIds(target.argument, out);
  else if (target.type === "VariableDeclaration")
    target.declarations.forEach((d) => patternIds(d.id, out));
  return out;
};

function scopeNames() {
  const declared = new WeakMap();
  const ids = new WeakMap();
  const own = (scope) => {
    if (declared.has(scope)) return declared.get(scope);
    const names = new Set();
    const add = (target) =>
      patternIds(target).forEach((id) => names.add(id.name));
    const lexical = (d) => d.type === "VariableDeclaration" && d.kind !== "var";
    if (scope.type === "Program" || /Function|Method/.test(scope.type)) {
      const hoist = (n) => {
        if (
          !n ||
          typeof n.type !== "string" ||
          (n !== scope && /Function|Method/.test(n.type))
        )
          return;
        if (n.type === "VariableDeclaration" && n.kind === "var") add(n);
        for (const key of Object.keys(n)) {
          if (skip.has(key)) continue;
          const v = n[key];
          if (Array.isArray(v)) v.forEach(hoist);
          else if (v && typeof v.type === "string") hoist(v);
        }
      };
      hoist(scope.type === "Program" ? scope : scope.body);
    }
    const statements =
      scope.type === "Program" || scope.type === "BlockStatement"
        ? scope.body
        : scope.type === "SwitchStatement"
          ? scope.cases.flatMap((c) => c.consequent)
          : [];
    for (const s of statements) {
      if (lexical(s)) add(s);
      if (
        (s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") &&
        s.id
      )
        names.add(s.id.name);
      if (s.type === "ExportNamedDeclaration" && s.declaration) {
        if (s.declaration.type === "VariableDeclaration") {
          if (lexical(s.declaration)) add(s.declaration);
        } else if (s.declaration.id) names.add(s.declaration.id.name);
      }
    }
    if (scope.type === "ForStatement" && scope.init && lexical(scope.init))
      add(scope.init);
    if (
      (scope.type === "ForOfStatement" || scope.type === "ForInStatement") &&
      lexical(scope.left)
    )
      add(scope.left);
    if (scope.type === "CatchClause") add(scope.param);
    if (scope.params) scope.params.forEach(add);
    if (scope.type === "FunctionExpression" && scope.id)
      names.add(scope.id.name);
    declared.set(scope, names);
    return names;
  };
  let next = 0;
  return (name, parents) => {
    for (let i = parents.length - 1; i >= 0; i--) {
      if (scopeKinds.test(parents[i].type) && own(parents[i]).has(name)) {
        if (!ids.has(parents[i])) ids.set(parents[i], next++);
        return ids.get(parents[i]) + ":" + name;
      }
    }
    return "global:" + name;
  };
}

const calleeOf = (n) =>
  n.type === "CallExpression" || n.type === "OptionalCallExpression"
    ? n.callee
    : null;

// 1. Waits by time (waitForTimeout and timers/promises sleeps).
export const WAIT_BASELINE = Object.freeze({});

export function timeWaits(text) {
  let count = 0;
  const program = syntax(text).program;
  const keyOf = scopeNames();
  const sleeps = new Set();
  const name = (n) =>
    n.type === "Identifier"
      ? n.name
      : n.type === "StringLiteral"
        ? n.value
        : n.type === "TemplateLiteral" && !n.expressions.length
          ? n.quasis[0].value.cooked
          : null;
  const member = (n) =>
    n.type === "MemberExpression" || n.type === "OptionalMemberExpression"
      ? n.computed
        ? name(n.property)
        : n.property.name
      : null;
  const timers = (source) => /^(?:node:)?timers\/promises$/.test(source ?? "");

  walkWith(program, (n, parents) => {
    if (n.type === "ImportDeclaration" && timers(n.source.value)) {
      for (const s of n.specifiers) {
        if (
          s.type !== "ImportSpecifier" ||
          ["setTimeout", "setInterval", "scheduler"].includes(name(s.imported))
        )
          sleeps.add(keyOf(s.local.name, parents));
      }
    }
    if (
      n.type === "VariableDeclarator" &&
      n.init &&
      calleeOf(n.init)?.type === "Identifier" &&
      n.init.callee.name === "require" &&
      timers(n.init.arguments[0]?.value)
    ) {
      for (const id of patternIds(n.id)) sleeps.add(keyOf(id.name, parents));
    }
  });
  walk(program, (n) => {
    if (member(n) === "waitForTimeout") count++;
    if (n.type === "ObjectPattern") {
      count += n.properties.filter(
        (p) => p.type === "ObjectProperty" && name(p.key) === "waitForTimeout",
      ).length;
    }
  });
  walkWith(program, (n, parents) => {
    if (calleeOf(n)?.type === "Identifier" && sleeps.has(keyOf(n.callee.name, parents)))
      count++;
    else if (
      calleeOf(n) &&
      member(calleeOf(n)) &&
      calleeOf(n).object?.type === "Identifier" &&
      sleeps.has(keyOf(calleeOf(n).object.name, parents))
    )
      count++;
  });
  return count;
}

export function timeWaitIssues(texts, baseline = WAIT_BASELINE) {
  const issues = [];
  for (const [file, text] of Object.entries(texts).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const count = timeWaits(text);
    const allowed = baseline[file] ?? 0;
    if (count > allowed)
      issues.push(
        `${file} waits by time ${count} times (at most ${allowed}); wait for a state instead`,
      );
    else if (count < allowed)
      issues.push(
        `${file} waits by time ${count} times now; lower its WAIT_BASELINE entry to ${count}`,
      );
  }
  for (const file of Object.keys(baseline)) {
    if (!Object.hasOwn(texts, file))
      issues.push(`${file} is in WAIT_BASELINE but no longer exists; remove it`);
  }
  return issues;
}

// 2. Timer-only sleep promises (new Promise(r => setTimeout(r, ms))).
export const TIMER_PROMISE_COUNTS = Object.freeze({});

export function timerPromises(text) {
  let count = 0;
  const program = syntax(text).program;
  const keyOf = scopeNames();
  const helpers = new Set();
  const inHelpers = new Set();
  const calleeName = (c) =>
    c.type === "Identifier"
      ? c.name
      : (c.type === "MemberExpression" ||
            c.type === "OptionalMemberExpression") &&
          !c.computed
        ? c.property.name
        : null;
  const only = (body) =>
    body.type === "BlockStatement"
      ? body.body.length === 1 && body.body[0].type === "ExpressionStatement"
        ? body.body[0].expression
        : null
      : body.type === "ExpressionStatement"
        ? body.expression
        : body;
  const timerPromise = (n) => {
    if (
      n.type !== "NewExpression" ||
      n.callee.type !== "Identifier" ||
      n.callee.name !== "Promise"
    )
      return false;
    const executor = n.arguments[0];
    if (
      !executor ||
      !/Function/.test(executor.type) ||
      !executor.params.length ||
      executor.params[0].type !== "Identifier"
    )
      return false;
    const resolve = executor.params[0].name;
    const call = only(executor.body);
    const timer = call && calleeOf(call);
    if (!timer || !["setTimeout", "setInterval"].includes(calleeName(timer)))
      return false;
    const done = call.arguments[0];
    if (done?.type === "Identifier") return done.name === resolve;
    const inner = done && /Function/.test(done.type) ? only(done.body) : null;
    return (
      !!inner &&
      calleeOf(inner)?.type === "Identifier" &&
      inner.callee.name === resolve &&
      !inner.arguments.length
    );
  };
  const polled = (parents) => {
    const loop = parents.findLast((p) => p.type === "WhileStatement");
    return (
      !!loop &&
      only(loop.body)?.type === "AwaitExpression" &&
      parents.includes(only(loop.body))
    );
  };
  walkWith(program, (n, parents) => {
    const fn =
      n.type === "VariableDeclarator" &&
      n.id.type === "Identifier" &&
      n.init &&
      /Function/.test(n.init.type)
        ? n.init
        : n.type === "FunctionDeclaration" && n.id
          ? n
          : null;
    if (!fn) return;
    const body =
      fn.body.type !== "BlockStatement"
        ? fn.body
        : fn.body.body.length === 1 && fn.body.body[0].type === "ReturnStatement"
          ? fn.body.body[0].argument
          : null;
    const made =
      body &&
      (timerPromise(body)
        ? body
        : calleeOf(body) &&
            body.arguments.length === 1 &&
            /Function/.test(body.arguments[0].type) &&
            timerPromise(body.arguments[0].body)
          ? body.arguments[0].body
          : null);
    if (made) {
      helpers.add(keyOf(n.id.name, parents));
      inHelpers.add(made);
    }
  });
  walkWith(program, (n, parents) => {
    if (timerPromise(n) && !inHelpers.has(n) && !polled(parents)) count++;
    else if (
      calleeOf(n)?.type === "Identifier" &&
      helpers.has(keyOf(n.callee.name, parents)) &&
      !polled(parents)
    )
      count++;
  });
  return count;
}

export function timerPromiseIssues(texts, counts = TIMER_PROMISE_COUNTS) {
  const issues = [];
  for (const [file, text] of Object.entries(texts).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const count = timerPromises(text);
    const table = counts[file] ?? 0;
    if (count > table)
      issues.push(
        `${file} has ${count} promises that end only on a timer (TIMER_PROMISE_COUNTS has ${table}); wait for a state instead`,
      );
    else if (count < table)
      issues.push(
        `${file} has ${count} promises that end only on a timer now; lower its TIMER_PROMISE_COUNTS entry to ${count}`,
      );
  }
  for (const file of Object.keys(counts)) {
    if (!Object.hasOwn(texts, file))
      issues.push(
        `${file} is in TIMER_PROMISE_COUNTS but no longer exists; remove it`,
      );
  }
  return issues;
}

// 3. Raw reads of src/ or product HTML as text (shrink-only).
export const SOURCE_READ_BASELINE = Object.freeze({
  "scripts/artifact.mjs": 1,
  "scripts/build.mjs": 11,
  "scripts/lint.mjs": 1,
  "scripts/load-inline-core.mjs": 1,
});
export const SCOPED_SOURCE_READS = Object.freeze({});
export const PRODUCT_COPY_READS = Object.freeze({});

const readers = new Set([
  "readFileSync",
  "readFile",
  "read",
  "text",
  "readText",
]);
const productPath = (value) =>
  /^src\//.test(value) ||
  value === "Kazohe.html" ||
  /^Kazohe_\d+_\d+_\d+\.html$/.test(value);
const productPathNames = new Set(["htmlName", "htmlPath"]);
const readerCall = (n) =>
  n.type === "CallExpression" &&
  readers.has(
    n.callee.type === "Identifier" ? n.callee.name : n.callee.property?.name,
  );
const pathCalls = new Set([
  "join",
  "resolve",
  "normalize",
  "readdirSync",
  "readdir",
  "find",
  "filter",
  "sort",
  "slice",
  "concat",
  "at",
  "flat",
  "toSorted",
  "reverse",
  "filename",
]);
const pathCall = (call) =>
  pathCalls.has(
    call.callee.type === "Identifier"
      ? call.callee.name
      : call.callee.property?.name,
  );

function oldReadSites(text) {
  const sites = [];
  const program = syntax(text).program;
  const names = new Set();
  const naming = (node) => {
    let named = false;
    walk(node, (x) => {
      if (x.type === "StringLiteral" && productPath(x.value)) named = true;
      if (
        x.type === "TemplateLiteral" &&
        productPath(x.quasis[0].value.cooked)
      )
        named = true;
      if (x.type === "Identifier" && productPathNames.has(x.name)) named = true;
      if (x.type === "Identifier" && names.has(x.name)) named = true;
    });
    return named;
  };
  for (let pass = 0; pass < 2; pass++) {
    walk(program, (n) => {
      if (
        n.type === "VariableDeclarator" &&
        n.id.type === "Identifier" &&
        n.init &&
        !readerCall(n.init) &&
        naming(n.init)
      )
        names.add(n.id.name);
    });
  }
  walk(program, (n) => {
    if (readerCall(n) && n.arguments.some(naming)) sites.push(n.start);
  });
  return sites;
}

function scopedReadSites(text, { copies = false } = {}) {
  const sites = [];
  const program = syntax(text).program;
  const named = new Set();
  const keyOf = scopeNames();
  const literal = (x) =>
    x.type === "StringLiteral"
      ? x.value
      : x.type === "TemplateLiteral" && !x.expressions.length
        ? x.quasis[0].value.cooked
        : null;
  const joined = (x) => {
    if (
      x.type !== "CallExpression" ||
      !["join", "resolve"].includes(
        x.callee.type === "Identifier"
          ? x.callee.name
          : x.callee.property?.name,
      )
    )
      return false;
    const parts = x.arguments.map(literal);
    return (
      parts.some((part, i) => part === "src" && i < parts.length - 1) ||
      productPath(parts.filter((part) => part !== null).join("/"))
    );
  };
  const isFunction = (x) => /Function|ObjectMethod|ClassMethod/.test(x.type);
  const naming = (node, parents, loose = true) => {
    let found = false;
    walkWith(
      node,
      (x, within) => {
        if (!loose && within.slice(parents.length).some(isFunction)) return;
        if (x.type === "StringLiteral" && productPath(x.value)) found = true;
        if (
          x.type === "TemplateLiteral" &&
          (productPath(x.quasis[0].value.cooked) ||
            x.quasis.some((q, i) => i > 0 && /^\/src\//.test(q.value.cooked)))
        )
          found = true;
        if (joined(x)) found = true;
        if (x.type === "Identifier" && productPathNames.has(x.name))
          found = true;
        if (
          x.type === "Identifier" &&
          named.has(keyOf(x.name, within)) &&
          (loose ||
            within
              .slice(parents.length)
              .every(
                (p, i, inner) =>
                  !(
                    p.type === "CallExpression" || p.type === "NewExpression"
                  ) ||
                  pathCall(p) ||
                  !p.arguments.includes(inner[i + 1] ?? x),
              ))
        )
          found = true;
      },
      parents,
    );
    return found;
  };
  const written = (n, parents) => {
    if (!copies || n.type !== "CallExpression") return [];
    const calleeName = n.callee.name ?? n.callee.property?.name;
    const inner = [...parents, n];
    if (
      ["copyFileSync", "copyFile", "cpSync", "cp"].includes(calleeName) &&
      n.arguments[0] &&
      n.arguments[1]?.type === "Identifier" &&
      naming(n.arguments[0], inner)
    )
      return [n.arguments[1]];
    return [];
  };
  for (let size = -1; size !== named.size; ) {
    size = named.size;
    walkWith(program, (n, parents) => {
      for (const id of written(n, parents)) named.add(keyOf(id.name, parents));
      const [target, value, at] =
        n.type === "VariableDeclarator"
          ? [n.id, n.init, parents]
          : n.type === "AssignmentExpression" && n.operator === "="
            ? [n.left, n.right, parents]
            : n.type === "ForOfStatement"
              ? [n.left, n.right, [...parents, n]]
              : [null, null, null];
      const plain =
        n.type === "VariableDeclarator" && n.id.type === "Identifier";
      if (
        target &&
        value &&
        !readerCall(value) &&
        (plain || !isFunction(value)) &&
        naming(value, [...parents, n], plain)
      ) {
        for (const id of patternIds(target)) named.add(keyOf(id.name, at));
      }
    });
  }
  walkWith(program, (n, parents) => {
    if (readerCall(n) && n.arguments.some((a) => naming(a, [...parents, n])))
      sites.push(n.start);
  });
  return sites;
}

export const productSourceReads = (text) => oldReadSites(text).length;
export const scopedSourceReads = (text) => {
  const counted = new Set(oldReadSites(text));
  return scopedReadSites(text).filter((at) => !counted.has(at)).length;
};
export const productCopyReads = (text) => {
  const counted = new Set([...oldReadSites(text), ...scopedReadSites(text)]);
  return scopedReadSites(text, { copies: true }).filter(
    (at) => !counted.has(at),
  ).length;
};

export function sourceReadIssues(texts, baseline = SOURCE_READ_BASELINE) {
  const issues = [];
  for (const [file, text] of Object.entries(texts).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const count = productSourceReads(text);
    const allowed = baseline[file] ?? 0;
    if (count > allowed)
      issues.push(
        `${file} reads the product source as text ${count} times (at most ${allowed}); take it from a shared reader instead`,
      );
    else if (count < allowed)
      issues.push(
        `${file} reads the product source as text ${count} times now; lower its SOURCE_READ_BASELINE entry to ${count}`,
      );
  }
  for (const file of Object.keys(baseline)) {
    if (!Object.hasOwn(texts, file))
      issues.push(
        `${file} is in SOURCE_READ_BASELINE but no longer exists; remove it`,
      );
  }
  return issues;
}

export function scopedReadIssues(texts, counts = SCOPED_SOURCE_READS) {
  const issues = [];
  for (const [file, text] of Object.entries(texts).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const count = scopedSourceReads(text);
    const table = counts[file] ?? 0;
    if (count > table)
      issues.push(
        `${file} reads the product source as text, seen by scope, ${count} times (SCOPED_SOURCE_READS has ${table}); take it from a shared reader instead`,
      );
    else if (count < table)
      issues.push(
        `${file} reads the product source as text, seen by scope, ${count} times now; lower its SCOPED_SOURCE_READS entry to ${count}`,
      );
  }
  for (const file of Object.keys(counts)) {
    if (!Object.hasOwn(texts, file))
      issues.push(
        `${file} is in SCOPED_SOURCE_READS but no longer exists; remove it`,
      );
  }
  return issues;
}

export function copyReadIssues(texts, counts = PRODUCT_COPY_READS) {
  const issues = [];
  for (const [file, text] of Object.entries(texts).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const count = productCopyReads(text);
    const table = counts[file] ?? 0;
    if (count > table)
      issues.push(
        `${file} reads a copy of the product as text ${count} times (PRODUCT_COPY_READS has ${table}); take it from a shared reader instead`,
      );
    else if (count < table)
      issues.push(
        `${file} reads a copy of the product as text ${count} times now; lower its PRODUCT_COPY_READS entry to ${count}`,
      );
  }
  for (const file of Object.keys(counts)) {
    if (!Object.hasOwn(texts, file))
      issues.push(
        `${file} is in PRODUCT_COPY_READS but no longer exists; remove it`,
      );
  }
  return issues;
}

// 4. ESLint over audit and test code (no-undef, no-unused-vars, sonarjs/no-identical-functions).
export const auditLintRules = Object.freeze({
  "no-undef": "error",
  "no-unused-vars": ["error", { ignoreRestSiblings: true, caughtErrors: "none" }],
  "sonarjs/no-identical-functions": "error",
});

export const LINT_BASELINE = Object.freeze({});

export const auditCodeFile = (file) =>
  /^(?:scripts|tests)\/.+\.(?:mjs|cjs|js)$/.test(file);

let lintEngine;
function auditEslint(root) {
  if (lintEngine) return lintEngine;
  const { ESLint } = require("eslint");
  const sonarjs = require("eslint-plugin-sonarjs");
  const globals = require("globals");
  const known = {
    ...globals.node,
    ...globals.browser,
    KZ: "readonly",
    KZTeaching: "readonly",
    KZLanguage: "readonly",
    KZWritten: "readonly",
    axe: "readonly",
  };
  const options = (sourceType) => ({
    ecmaVersion: "latest",
    sourceType,
    globals: known,
  });
  lintEngine = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      { files: ["**/*.mjs"], languageOptions: options("module") },
      { files: ["**/*.cjs"], languageOptions: options("commonjs") },
      { files: ["**/*.js"], languageOptions: options("script") },
      {
        plugins: { sonarjs: sonarjs.default ?? sonarjs },
        linterOptions: {
          noInlineConfig: true,
          reportUnusedDisableDirectives: "off",
        },
        rules: auditLintRules,
      },
    ],
  });
  return lintEngine;
}

export async function auditLintCounts(root, texts) {
  const counts = {};
  const details = {};
  const engine = auditEslint(root);
  for (const [file, text] of Object.entries(texts)) {
    if (!auditCodeFile(file)) continue;
    const [result] = await engine.lintText(text, {
      filePath: path.join(root, file),
    });
    for (const m of result.messages) {
      if (m.ruleId === "no-undef" && /^'__\w+' is not defined/.test(m.message))
        continue;
      const rule = m.ruleId ?? "parse";
      (counts[file] ??= {})[rule] = (counts[file][rule] ?? 0) + 1;
      (details[file] ??= []).push(`${file}:${m.line} [${rule}] ${m.message}`);
    }
  }
  return { counts, details };
}

export function auditLintIssues(counts, texts, baseline = LINT_BASELINE, details = {}) {
  const issues = [];
  for (const file of Object.keys(texts).filter(auditCodeFile).sort()) {
    const got = counts[file] ?? {};
    const allowed = baseline[file] ?? {};
    for (const rule of [
      ...new Set([...Object.keys(got), ...Object.keys(allowed)]),
    ].sort()) {
      const count = got[rule] ?? 0;
      const limit = allowed[rule] ?? 0;
      if (count > limit) {
        const extra = (details[file] ?? []).slice(0, 5).join("; ");
        issues.push(
          `${file} has ${count} ${rule} findings (at most ${limit})${extra ? `: ${extra}` : ""}`,
        );
      } else if (count < limit) {
        issues.push(
          `${file} has ${count} ${rule} findings now; lower its LINT_BASELINE entry to ${count}`,
        );
      }
    }
  }
  for (const file of Object.keys(baseline)) {
    if (!Object.hasOwn(texts, file))
      issues.push(`${file} is in LINT_BASELINE but no longer exists; remove it`);
  }
  return issues;
}

// 5. Refusals without a reason (ZERO tolerance, no baseline).
const assertModule = (value) =>
  typeof value === "string" && /^(?:node:)?assert(?:\/strict)?$/.test(value);
const refusalModule = (value) =>
  typeof value === "string" && /(?:^|\/)refusal\.(?:mjs|cjs)$/.test(value);
const scopeTypes = new Set([
  "Program",
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "BlockStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "CatchClause",
  "StaticBlock",
]);
const functionTypes = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
]);
const anyErrorTexts = [
  "",
  "q",
  "Error",
  "TypeError: q",
  "AssertionError [ERR_ASSERTION]: q",
  "undefined",
  "null",
];

function fixedRun(source) {
  let best = 0;
  let run = 0;
  for (let i = 0; i < source.length; i++) {
    let c = source[i];
    let fixed = false;
    if (c === "\\") {
      const n = source[i + 1] ?? "";
      i++;
      fixed = !/[dDwWsSbBpPu0-9xckn]/.test(n) || n === "n";
      if (n === "p" || n === "P" || n === "u" || n === "x" || n === "c") {
        if (source[i + 1] === "{") i = source.indexOf("}", i);
      }
    } else if (c === "[") {
      const end = source.indexOf("]", i + 1);
      i = end < 0 ? source.length : end;
    } else if ("^$.|()?*+{}".includes(c)) {
      if (c === "{") {
        const end = source.indexOf("}", i);
        i = end < 0 ? source.length : end;
      }
      if ("?*{".includes(c) && run) run--;
      best = Math.max(best, run);
      run = 0;
      continue;
    } else fixed = true;
    const q = source[i + 1];
    if (fixed && !(q === "?" || q === "*" || q === "{")) {
      run++;
      best = Math.max(best, run);
    } else {
      best = Math.max(best, run);
      run = 0;
    }
  }
  return best;
}

const sayingNothing = (source, flags) => {
  let re;
  try {
    re = new RegExp(source, flags);
  } catch (error) {
    return error instanceof SyntaxError;
  }
  return (
    anyErrorTexts.some((t) => {
      re.lastIndex = 0;
      return re.test(t);
    }) || fixedRun(source) < 4
  );
};

const patternNames = (pattern, keys = [], out = []) => {
  if (!pattern) return out;
  if (pattern.type === "Identifier") out.push([pattern.name, keys]);
  else if (pattern.type === "AssignmentPattern")
    patternNames(pattern.left, keys, out);
  else if (pattern.type === "RestElement")
    patternNames(pattern.argument, [...keys, null], out);
  else if (pattern.type === "ArrayPattern")
    pattern.elements.forEach((e, i) => patternNames(e, [...keys, i], out));
  else if (pattern.type === "ObjectPattern") {
    for (const p of pattern.properties) {
      if (p.type === "RestElement")
        patternNames(p.argument, [...keys, null], out);
      else
        patternNames(
          p.value,
          [
            ...keys,
            p.computed
              ? p.key.type === "StringLiteral"
                ? p.key.value
                : null
              : (p.key.name ?? p.key.value),
          ],
          out,
        );
    }
  }
  return out;
};

const nearestScope = (up) => up.find((n) => scopeTypes.has(n.type));
const nearestFunctionScope = (up) =>
  up.find((n) => functionTypes.has(n.type) || n.type === "Program");

function bindings(program) {
  const scopes = new Map();
  const bind = (scope, name, binding) => {
    if (!scopes.has(scope)) scopes.set(scope, new Map());
    scopes.get(scope).set(name, binding);
  };
  walkUp(program, (n, up) => {
    if (n.type === "ImportDeclaration") {
      for (const s of n.specifiers) {
        bind(program, s.local.name, {
          kind: "import",
          source: n.source.value,
          imported:
            s.type === "ImportSpecifier"
              ? (s.imported.name ?? s.imported.value)
              : "*",
        });
      }
    }
    if (n.type === "VariableDeclaration") {
      const scope =
        n.kind === "var" ? nearestFunctionScope(up) : nearestScope(up);
      for (const d of n.declarations) {
        for (const [name, keys] of patternNames(d.id))
          bind(scope, name, { kind: "value", init: d.init, keys, up });
      }
    }
    if (n.type === "FunctionDeclaration" && n.id)
      bind(nearestScope(up) ?? program, n.id.name, {
        kind: "function",
        node: n,
        up,
      });
    if (functionTypes.has(n.type)) {
      for (const p of n.params) {
        for (const [name] of patternNames(p)) bind(n, name, { kind: "param" });
      }
    }
    if (n.type === "CatchClause" && n.param) {
      for (const [name] of patternNames(n.param))
        bind(n, name, { kind: "param" });
    }
    if (n.type === "ClassDeclaration" && n.id)
      bind(nearestScope(up) ?? program, n.id.name, { kind: "class" });
  });
  return (name, up) => {
    for (const scope of up) {
      const b = scopes.get(scope)?.get(name);
      if (b) return b;
    }
    return undefined;
  };
}

const propertyName = (member) =>
  member.computed
    ? member.property.type === "StringLiteral"
      ? member.property.value
      : member.property.type === "NumericLiteral"
        ? member.property.value
        : member.property.type === "TemplateLiteral" &&
            !member.property.expressions.length
          ? member.property.quasis[0].value.cooked
          : null
    : member.property.name;
const isMember = (n) =>
  n.type === "MemberExpression" || n.type === "OptionalMemberExpression";
const isCall = (n) =>
  n.type === "CallExpression" || n.type === "OptionalCallExpression";
const strip = (n) => {
  while (
    n &&
    (n.type === "ParenthesizedExpression" ||
      n.type === "TSAsExpression" ||
      n.type === "SequenceExpression")
  )
    n = n.type === "SequenceExpression" ? n.expressions.at(-1) : n.expression;
  return n;
};

function assertValue(node, up, resolve, depth = 0, keys = []) {
  node = strip(node);
  if (!node || depth > 16) return null;
  const step = (value, key) =>
    key === null || key === undefined
      ? null
      : value === "assert"
        ? key === "strict" || key === "default"
          ? "assert"
          : ["throws", "rejects", "fail"].includes(key)
            ? key
            : null
        : value === "refusal"
          ? key === "refusedWith" || key === "refusedAs"
            ? key
            : null
          : null;
  const take = (value) => keys.reduce((v, k) => step(v, k), value);
  if (node.type === "ArrayExpression" || node.type === "ObjectExpression") {
    if (!keys.length) return null;
    const [key, ...rest] = keys;
    const item =
      node.type === "ArrayExpression"
        ? typeof key === "number"
          ? node.elements[key]
          : null
        : node.properties.find(
            (p) =>
              p.type === "ObjectProperty" &&
              !p.computed &&
              (p.key.name ?? p.key.value) === key,
          )?.value;
    return item ? assertValue(item, up, resolve, depth + 1, rest) : null;
  }
  if (node.type === "Identifier") {
    const b = resolve(node.name, up);
    if (!b) return null;
    if (b.kind === "import") {
      return take(
        assertModule(b.source)
          ? b.imported === "*" || b.imported === "default"
            ? "assert"
            : step("assert", b.imported)
          : refusalModule(b.source)
            ? b.imported === "*" || b.imported === "default"
              ? "refusal"
              : step("refusal", b.imported)
            : null,
      );
    }
    if (b.kind !== "value" || !b.init) return null;
    return assertValue(b.init, b.up, resolve, depth + 1, [...b.keys, ...keys]);
  }
  if (
    isCall(node) &&
    node.callee.type === "Identifier" &&
    node.callee.name === "require"
  ) {
    return take(
      assertModule(node.arguments[0]?.value)
        ? "assert"
        : refusalModule(node.arguments[0]?.value)
          ? "refusal"
          : null,
    );
  }
  if (
    isCall(node) &&
    isMember(node.callee) &&
    propertyName(node.callee) === "bind" &&
    !keys.length
  )
    return assertValue(node.callee.object, up, resolve, depth + 1);
  if (isMember(node)) {
    if (!node.computed && node.property.name === "assert") return take("assert");
    return assertValue(node.object, up, resolve, depth + 1, [
      propertyName(node) ?? null,
      ...keys,
    ]);
  }
  if (
    node.type === "AwaitExpression" &&
    isCall(node.argument) &&
    node.argument.callee.type === "Import"
  )
    return take(assertModule(node.argument.arguments[0]?.value) ? "assert" : null);
  return null;
}

const constant = (n) => {
  n = strip(n);
  if (!n) return true;
  if (
    [
      "BooleanLiteral",
      "NumericLiteral",
      "StringLiteral",
      "NullLiteral",
      "RegExpLiteral",
      "BigIntLiteral",
    ].includes(n.type)
  )
    return true;
  if (n.type === "Identifier" && n.name === "undefined") return true;
  if (n.type === "TemplateLiteral") return n.expressions.every(constant);
  if (n.type === "UnaryExpression") return constant(n.argument);
  if (n.type === "ObjectExpression")
    return n.properties.every(
      (p) => p.type === "ObjectProperty" && !p.computed && constant(p.value),
    );
  if (n.type === "ArrayExpression")
    return n.elements.every((e) => !e || constant(e));
  return false;
};

const truthyConstant = (n) => {
  n = strip(n);
  if (!n) return false;
  if (n.type === "BooleanLiteral") return n.value;
  if (n.type === "NumericLiteral") return n.value !== 0;
  if (n.type === "StringLiteral") return n.value !== "";
  if (n.type === "UnaryExpression" && n.operator === "!")
    return falsyConstant(n.argument);
  if (n.type === "LogicalExpression" && n.operator === "||")
    return truthyConstant(n.left) || truthyConstant(n.right);
  if (n.type === "ConditionalExpression")
    return truthyConstant(n.consequent) && truthyConstant(n.alternate);
  return false;
};

const falsyConstant = (n) => {
  n = strip(n);
  if (!n) return false;
  if (n.type === "BooleanLiteral") return !n.value;
  if (n.type === "NumericLiteral") return n.value === 0;
  if (n.type === "StringLiteral") return n.value === "";
  if (
    n.type === "NullLiteral" ||
    (n.type === "Identifier" && n.name === "undefined")
  )
    return true;
  if (n.type === "UnaryExpression" && n.operator === "!")
    return truthyConstant(n.argument);
  if (n.type === "UnaryExpression" && n.operator === "void") return true;
  return false;
};

function readsError(body, names) {
  let read = false;
  walkUp(body, (x, up) => {
    if (read || x.type !== "Identifier" || !names.has(x.name)) return;
    const parent = up[0];
    if (!parent) return;
    if (isMember(parent) && parent.object === x) read = true;
    else if (
      parent.type === "AwaitExpression" &&
      up[1] &&
      isMember(up[1]) &&
      up[1].object === parent
    )
      read = true;
    else if (
      parent.type === "ThrowStatement" ||
      (parent.type === "ObjectProperty" && parent.value === x) ||
      parent.type === "ArrayExpression"
    )
      read = true;
    else if (
      isCall(parent) &&
      parent.arguments.includes(x) &&
      !(
        isMember(parent.callee) &&
        ["push", "unshift", "add", "set"].includes(propertyName(parent.callee))
      ) &&
      !(
        parent.callee.type === "Identifier" &&
        ["Boolean", "String", "ok", "assert"].includes(parent.callee.name)
      ) &&
      !(isMember(parent.callee) && propertyName(parent.callee) === "ok")
    )
      read = true;
    else if (
      parent.type === "BinaryExpression" &&
      ["===", "!==", "==", "!="].includes(parent.operator) &&
      !constant(parent.left === x ? parent.right : parent.left)
    )
      read = true;
    else if (
      parent.type === "BinaryExpression" &&
      parent.operator === "instanceof" &&
      parent.left === x &&
      !(parent.right.type === "Identifier" && parent.right.name === "Error")
    )
      read = true;
  });
  return read;
}

const paramNames = (fn) =>
  new Set(fn.params.flatMap((p) => patternNames(p).map(([name]) => name)));

function testsTheError(fn) {
  const names = paramNames(fn);
  if (!names.size || !readsError(fn.body, names)) return false;
  if (fn.body.type !== "BlockStatement") return !truthyConstant(fn.body);
  const returns = [];
  walk(fn.body, (x) => {
    if (x.type === "ReturnStatement") returns.push(x);
  });
  return returns.length > 0 && !returns.every((r) => truthyConstant(r.argument));
}

const sayingNothingField = (p) =>
  p.type !== "ObjectProperty" ||
  (p.value.type === "RegExpLiteral" &&
    sayingNothing(p.value.pattern, p.value.flags)) ||
  (p.value.type === "Identifier" && p.value.name === "undefined") ||
  ((p.key.name ?? p.key.value) === "name" &&
    p.value.type === "StringLiteral" &&
    p.value.value === "Error");

function namesAReason(node, up, resolve, depth = 0) {
  node = strip(node);
  if (!node || depth > 12) return false;
  if (node.type === "RegExpLiteral")
    return !sayingNothing(node.pattern, node.flags);
  if (
    (node.type === "NewExpression" || node.type === "CallExpression") &&
    node.callee.type === "Identifier" &&
    node.callee.name === "RegExp"
  ) {
    const [source, flags] = node.arguments;
    if (source?.type === "StringLiteral")
      return !sayingNothing(
        source.value,
        flags?.type === "StringLiteral" ? flags.value : "",
      );
    const written = [];
    walk(source, (x) => {
      if (x.type === "StringLiteral") written.push(x.value);
      if (x.type === "TemplateElement") written.push(x.value.cooked);
    });
    return written.some((w) => fixedRun(w) >= 4);
  }
  if (isCall(node)) {
    const helper = assertValue(node.callee, up, resolve);
    if (helper === "refusedAs") {
      const site = node.arguments[0];
      const written = [];
      walk(site, (x) => {
        if (x.type === "StringLiteral") written.push(x.value);
        if (x.type === "TemplateElement") written.push(x.value.cooked);
      });
      return !!site && written.join("").length > 0;
    }
    if (helper === "refusedWith") {
      return (
        node.arguments[0]?.type === "ObjectExpression" &&
        node.arguments[0].properties.some(
          (p) =>
            p.type === "ObjectProperty" &&
            ["code", "message"].includes(p.key.name ?? p.key.value) &&
            !sayingNothingField(p),
        )
      );
    }
    return false;
  }
  if (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression"
  )
    return testsTheError(node);
  if (node.type === "ObjectExpression")
    return node.properties.some((p) => !sayingNothingField(p));
  if (node.type === "ConditionalExpression")
    return (
      namesAReason(node.consequent, up, resolve, depth + 1) &&
      namesAReason(node.alternate, up, resolve, depth + 1)
    );
  if (node.type === "Identifier") {
    const b = resolve(node.name, up);
    if (b?.kind === "function") return testsTheError(b.node);
    return (
      b?.kind === "value" &&
      b.keys.length === 0 &&
      namesAReason(b.init, b.up, resolve, depth + 1)
    );
  }
  return false;
}

function acceptsAnyError(handler, tryBlock, up, resolve) {
  const names = new Set(
    handler.param ? patternNames(handler.param).map(([name]) => name) : [],
  );
  const fn = up.find(
    (x) => functionTypes.has(x.type) || x.type === "Program",
  );
  const kept = new Set();
  walk(handler.body, (x) => {
    if (
      x.type === "AssignmentExpression" &&
      x.right.type === "Identifier" &&
      names.has(x.right.name) &&
      x.left.type === "Identifier"
    )
      kept.add(x.left.name);
  });
  const keptRead = kept.size > 0 && readsError(fn, kept);
  let rethrows = false;
  walk(handler.body, (x) => {
    if (x.type === "ThrowStatement") rethrows = true;
  });
  if (rethrows) return false;
  if (names.size && readsError(handler.body, names) && !(kept.size && !keptRead))
    return false;
  if (kept.size && !keptRead) return true;
  const body = handler.body.body;
  if (body.length === 0) {
    let failing = false;
    if (tryBlock) {
      walkUp(tryBlock, (x, xup) => {
        if (
          isCall(x) &&
          assertValue(x.callee, [...xup, ...up], resolve) === "fail"
        )
          failing = true;
        if (x.type === "ThrowStatement") failing = true;
      });
    }
    return failing;
  }
  let takes = false;
  walk(handler.body, (x) => {
    if (
      x.type === "ReturnStatement" &&
      x.argument &&
      constant(x.argument) &&
      !falsyConstant(x.argument)
    )
      takes = true;
    if (
      x.type === "AssignmentExpression" &&
      x.operator === "=" &&
      constant(x.right) &&
      !falsyConstant(x.right)
    )
      takes = true;
    if (
      x.type === "UpdateExpression" ||
      (x.type === "AssignmentExpression" && ["+=", "-="].includes(x.operator))
    )
      takes = true;
    if (
      isCall(x) &&
      isMember(x.callee) &&
      ["push", "add", "unshift"].includes(propertyName(x.callee)) &&
      x.arguments.every(constant)
    )
      takes = true;
  });
  return takes;
}

const loosePromiseHandler = (fn, up = []) => {
  fn = strip(fn);
  if (
    !fn ||
    !(
      fn.type === "ArrowFunctionExpression" || fn.type === "FunctionExpression"
    )
  )
    return false;
  const names = paramNames(fn);
  if (names.size && readsError(fn.body, names)) return false;
  const holder = up.find(
    (x) => x.type === "VariableDeclarator" && x.id.type === "Identifier",
  );
  if (
    holder &&
    fn.body.type === "Identifier" &&
    names.has(fn.body.name) &&
    readsError(
      up.find((x) => functionTypes.has(x.type) || x.type === "Program"),
      new Set([holder.id.name]),
    )
  )
    return false;
  const answers = [];
  if (fn.body.type !== "BlockStatement") answers.push(fn.body);
  else {
    walk(fn.body, (x) => {
      if (x.type === "ReturnStatement") answers.push(x.argument);
    });
  }
  if (
    fn.body.type === "BlockStatement" &&
    fn.body.body.some((s) => s.type === "ThrowStatement")
  )
    return false;
  return (
    !answers.length ||
    answers.some(
      (a) =>
        !(
          a &&
          falsyConstant(a) &&
          !(a.type === "Identifier" && a.name === "undefined")
        ),
    )
  );
};

const answerUsed = (up) => {
  const [p, q] = up;
  if (!p) return false;
  if (
    p.type === "ArrowFunctionExpression" &&
    q &&
    isCall(q) &&
    q.arguments.includes(p)
  )
    return false;
  if (
    p.type === "ExpressionStatement" ||
    (p.type === "UnaryExpression" && p.operator === "void")
  )
    return false;
  if (p.type === "AwaitExpression" && q?.type === "ExpressionStatement")
    return false;
  return true;
};

const failsOnPurpose = (fn) => {
  fn = strip(fn);
  if (
    !fn ||
    !(
      fn.type === "ArrowFunctionExpression" || fn.type === "FunctionExpression"
    )
  )
    return fn?.type === "Identifier" && /^fail/i.test(fn.name);
  let fails = false;
  walk(fn.body, (x) => {
    if (x.type === "ThrowStatement") fails = true;
    if (isCall(x) && isMember(x.callee) && propertyName(x.callee) === "fail")
      fails = true;
  });
  return fails;
};

export function reasonlessRefusals(text) {
  const program = syntax(text).program;
  const resolve = bindings(program);
  const found = [];
  const reasonAt = (n, index, up) => {
    const a = n.arguments[index];
    return a && a.type !== "SpreadElement" && namesAReason(a, up, resolve);
  };
  walkUp(program, (n, up) => {
    if (isCall(n)) {
      const what = assertValue(n.callee, up, resolve);
      if ((what === "throws" || what === "rejects") && !reasonAt(n, 1, up))
        found.push(n.loc.start.line);
      if (
        isMember(n.callee) &&
        ["call", "apply"].includes(propertyName(n.callee)) &&
        ["throws", "rejects"].includes(assertValue(n.callee.object, up, resolve))
      ) {
        const ok =
          propertyName(n.callee) === "call"
            ? reasonAt(n, 2, up)
            : n.arguments[1]?.type === "ArrayExpression" &&
              n.arguments[1].elements[1] &&
              namesAReason(n.arguments[1].elements[1], up, resolve);
        if (!ok) found.push(n.loc.start.line);
      }
      if (
        isMember(n.callee) &&
        !n.callee.computed &&
        n.callee.object.type === "Identifier" &&
        n.callee.object.name === "Reflect" &&
        n.callee.property.name === "apply" &&
        ["throws", "rejects"].includes(assertValue(n.arguments[0], up, resolve))
      ) {
        const list = n.arguments[2];
        if (
          !(
            list?.type === "ArrayExpression" &&
            list.elements[1] &&
            namesAReason(list.elements[1], up, resolve)
          )
        )
          found.push(n.loc.start.line);
      }
      if (
        isMember(n.callee) &&
        ((propertyName(n.callee) === "then" &&
          n.arguments.length > 1 &&
          loosePromiseHandler(n.arguments[1], up) &&
          (answerUsed(up) || failsOnPurpose(n.arguments[0]))) ||
          (propertyName(n.callee) === "catch" &&
            loosePromiseHandler(n.arguments[0], up) &&
            answerUsed(up)))
      )
        found.push(n.loc.start.line);
    }
    if (
      n.type === "TryStatement" &&
      n.handler &&
      acceptsAnyError(n.handler, n.block, [n.handler, n, ...up], resolve)
    )
      found.push(n.handler.loc.start.line);
    if (
      n.type === "BinaryExpression" &&
      ["===", "!=="].includes(n.operator) &&
      [n.left, n.right].some(
        (s) => s.type === "StringLiteral" && s.value === "rejected",
      ) &&
      [n.left, n.right].some((s) => isMember(s) && propertyName(s) === "status")
    ) {
      const fn = up.find(
        (x) => functionTypes.has(x.type) || x.type === "Program",
      );
      let reasonRead = false;
      walk(fn, (x) => {
        if (isMember(x) && propertyName(x) === "reason") reasonRead = true;
      });
      if (!reasonRead) found.push(n.loc.start.line);
    }
  });
  return found.sort((a, b) => a - b);
}

export function refusalReasonIssues(texts) {
  const issues = [];
  for (const [file, text] of Object.entries(texts).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    for (const line of reasonlessRefusals(text)) {
      issues.push(
        `${file}:${line} refuses without a reason; give assert.throws / assert.rejects the pattern, test or fields of the error it expects`,
      );
    }
  }
  return issues;
}

const crashOnly = /^\^?\(\?:(?:Type\|Reference\|Range|Type\|Reference)[^)]*\)Error\$?$/;
export function refusalHelperCopies(texts) {
  const issues = [];
  for (const [file, text] of Object.entries(texts).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (file === "scripts/refusal.mjs") continue;
    walk(syntax(text).program, (n) => {
      const name =
        n.type === "VariableDeclarator" && n.id.type === "Identifier"
          ? n.id.name
          : n.type === "FunctionDeclaration"
            ? n.id?.name
            : null;
      if (name && /^refused(?:NotCrashed|As|With)$/.test(name)) {
        issues.push(
          `${file}:${n.loc.start.line} defines its own ${name}; take it from scripts/refusal.mjs`,
        );
      }
      if (n.type === "RegExpLiteral" && crashOnly.test(n.pattern)) {
        issues.push(
          `${file}:${n.loc.start.line} rules out only the crash classes; take refusedWith from scripts/refusal.mjs`,
        );
      }
    });
  }
  return issues;
}

// Collect all scripts/*.mjs and tests/**/*.{mjs,cjs,js} files from disk.
export function collectAuditCodeTexts(root = rootDir) {
  const texts = {};
  const walkDir = (rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walkDir(child);
      else if (auditCodeFile(child))
        texts[child] = fs.readFileSync(path.join(root, child), "utf8");
    }
  };
  walkDir("scripts");
  walkDir("tests");
  return texts;
}

// Negative control probes verifying every rule detects its target anti-pattern.
export async function runAuditCodeNegativeControls(root = rootDir) {
  // 1. AUDIT-REFUSAL-REASONS probes
  const refusalProbes = [
    ["bare throws", "import assert from 'node:assert/strict'; assert.throws(() => f());"],
    ["bare rejects", "import assert from 'node:assert/strict'; await assert.rejects(f());"],
    ["string message only", "import assert from 'node:assert/strict'; assert.throws(() => f(), 'should fail');"],
    ["wildcard regex", "import assert from 'node:assert/strict'; assert.throws(() => f(), /./);"],
    ["generic Error regex", "import assert from 'node:assert/strict'; assert.throws(() => f(), /Error/);"],
    ["short regex", "import assert from 'node:assert/strict'; assert.throws(() => f(), /bad/);"],
    ["trivial function", "import assert from 'node:assert/strict'; assert.throws(() => f(), () => true);"],
    ["unused error param function", "import assert from 'node:assert/strict'; assert.throws(() => f(), (e) => Boolean(e));"],
    ["empty object", "import assert from 'node:assert/strict'; assert.throws(() => f(), {});"],
    ["error-ignoring try/catch", "let ok = false; try { f(); } catch { ok = true; }"],
    ["error-ignoring then", "const failed = await p.then(() => false, () => true);"],
    ["allSettled status only", "const r = await Promise.allSettled([p]); if (r[0].status === 'rejected') ok();"],
  ];
  for (const [label, code] of refusalProbes) {
    assert(
      reasonlessRefusals(code).length > 0,
      `AUDIT-REFUSAL-REASONS probe must trigger: ${label}`,
    );
  }
  // Valid refusal passes
  assert.deepEqual(
    reasonlessRefusals(
      "import assert from 'node:assert/strict'; import { refusedWith } from './refusal.mjs'; assert.throws(() => f(), refusedWith({ message: /invalid input/ }));",
    ),
    [],
  );
  // refusedWith itself rejects missing fields and crash classes
  assert.throws(
    () => refusedWith({}),
    refusedWith({ message: /refusedWith needs the code or the message/ }),
  );
  assert.throws(
    () => refusedWith({ name: "TypeError", message: /cannot read/ }),
    refusedWith({ message: /a crash is not a refusal: TypeError/ }),
  );
  // Duplicate local helper probe
  assert(
    refusalHelperCopies({
      "scripts/fake.mjs": "function refusedWith() { return () => true; }",
    }).length > 0,
    "AUDIT-REFUSAL-HELPERS probe must detect local refusedWith copy",
  );

  // 2. AUDIT-TIME-WAITS probes
  for (const [label, code] of [
    ["direct waitForTimeout", "await page.waitForTimeout(100);"],
    ["optional waitForTimeout", "await page?.waitForTimeout(100);"],
    ["computed waitForTimeout", "await page['waitForTimeout'](100);"],
    ["destructured waitForTimeout", "const { waitForTimeout } = page;"],
    ["timers/promises", "import { setTimeout } from 'node:timers/promises'; await setTimeout(50);"],
  ]) {
    assert(
      timeWaits(code) > 0,
      `AUDIT-TIME-WAITS probe must trigger: ${label}`,
    );
  }
  assert(
    timeWaitIssues({ "tests/x.mjs": "await page.waitForTimeout(10);" }, {}).length > 0,
    "timeWaitIssues must reject unbaselined wait",
  );

  // 3. AUDIT-TIMER-PROMISES probes
  assert(
    timerPromises("await new Promise((r) => setTimeout(r, 50));") === 1,
    "AUDIT-TIMER-PROMISES probe must detect direct timer promise",
  );
  assert(
    timerPromises("const sleep = (ms) => new Promise((r) => setTimeout(() => r(), ms)); await sleep(10);") === 1,
    "AUDIT-TIMER-PROMISES probe must detect helper call",
  );
  assert(
    timerPromises("while (!ready) await new Promise((r) => setTimeout(r, 10));") === 0,
    "polled while loop should be allowed",
  );

  // 4. AUDIT-SOURCE-READS probes
  assert(
    productSourceReads("readFileSync('src/core.js', 'utf8');") === 1,
    "AUDIT-SOURCE-READS probe must detect direct src/ read",
  );
  assert(
    productSourceReads("readFileSync('Kazohe_0_2_6.html', 'utf8');") === 1,
    "AUDIT-SOURCE-READS probe must detect product HTML read",
  );
  assert(
    scopedSourceReads("const p = path.join(root, 'src', 'app.js'); readFileSync(p, 'utf8');") === 1,
    "AUDIT-SOURCE-READS probe must detect path.join src/ read",
  );

  // 5. AUDIT-LINT probes
  const lintProbeTexts = {
    "tests/probe-undef.mjs": "export const x = unknownIdentifier123;\n",
    "tests/probe-unused.mjs": "const unusedVar123 = 1;\nexport const y = 2;\n",
    "tests/probe-identical.mjs":
      "export function a(x) {\n  const y = x + 1;\n  const z = y * 2;\n  return z - 3;\n}\n" +
      "export function b(x) {\n  const y = x + 1;\n  const z = y * 2;\n  return z - 3;\n}\n",
  };
  const { counts: probeCounts } = await auditLintCounts(root, lintProbeTexts);
  assert.equal(probeCounts["tests/probe-undef.mjs"]?.["no-undef"], 1);
  assert.equal(probeCounts["tests/probe-unused.mjs"]?.["no-unused-vars"], 1);
  assert.equal(
    probeCounts["tests/probe-identical.mjs"]?.["sonarjs/no-identical-functions"],
    1,
  );
}

export async function verifyAuditCode(root = rootDir) {
  await runAuditCodeNegativeControls(root);
  const texts = collectAuditCodeTexts(root);
  const { counts, details } = await auditLintCounts(root, texts);
  const issues = [
    ...refusalReasonIssues(texts),
    ...refusalHelperCopies(texts),
    ...timeWaitIssues(texts),
    ...timerPromiseIssues(texts),
    ...sourceReadIssues(texts),
    ...scopedReadIssues(texts),
    ...copyReadIssues(texts),
    ...auditLintIssues(counts, texts, LINT_BASELINE, details),
  ];
  assert.deepEqual(
    issues,
    [],
    `Audit code checks failed:\n${issues.join("\n")}`,
  );
  return { files: Object.keys(texts).length };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const result = await verifyAuditCode();
  console.log(`audit-code: ${result.files} files PASS`);
}
