// Consistency of the product's own vocabulary: dispatch values, DOM references,
// unwritten properties, shown-text branching, diagnostic codes, and child glossary.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parse } = require("@babel/parser");

// Dispatch values: every string literal compared against these dispatch properties
// (x.kind === 'V', switch (x.kind) { case 'V': }, ['V'].includes(x.kind)) must also
// occur somewhere else in the product where something produces it.
export const DISPATCH_PROPERTIES = Object.freeze([
  "kind",
  "type",
  "mode",
  "op",
  "screen",
  "status",
  "answerKind",
  "writtenRule",
  "domain",
  "method",
  "state",
  "role",
  "action",
]);

// External/browser values compared against dispatch properties that nothing in the
// product writes. Stale allowances (no longer needed) fail the check.
export const DISPATCH_ALLOWED = Object.freeze([]);

const SKIP_KEYS = new Set([
  "loc",
  "start",
  "end",
  "extra",
  "leadingComments",
  "trailingComments",
  "innerComments",
]);

function visit(node, fn) {
  if (!node || typeof node.type !== "string") return;
  fn(node);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) visit(child, fn);
    } else if (value && typeof value.type === "string") {
      visit(value, fn);
    }
  }
}

function parseScript(text) {
  return parse(text, {
    sourceType: "script",
    allowReturnOutsideFunction: true,
  });
}

export function dispatchValues(text, properties = DISPATCH_PROPERTIES) {
  const ast = parseScript(text);
  const names = new Set(properties);
  const compared = new Map();
  const comparing = new Set();
  const written = new Set();
  const propOf = (n) =>
    (n?.type === "MemberExpression" || n?.type === "OptionalMemberExpression") &&
    !n.computed &&
    names.has(n.property.name)
      ? n.property.name
      : null;
  const compare = (name, literal) => {
    const key = `${name}\u0000${literal.value}`;
    if (!compared.has(key)) {
      compared.set(key, {
        property: name,
        value: literal.value,
        at: literal.start,
      });
    }
    comparing.add(literal);
  };
  visit(ast.program, (n) => {
    if (
      n.type === "BinaryExpression" &&
      ["===", "!==", "==", "!="].includes(n.operator)
    ) {
      if (propOf(n.left) && n.right.type === "StringLiteral") {
        compare(propOf(n.left), n.right);
      }
      if (propOf(n.right) && n.left.type === "StringLiteral") {
        compare(propOf(n.right), n.left);
      }
    }
    if (n.type === "SwitchStatement" && propOf(n.discriminant)) {
      for (const c of n.cases) {
        if (c.test?.type === "StringLiteral") {
          compare(propOf(n.discriminant), c.test);
        }
      }
    }
    if (
      n.type === "CallExpression" &&
      n.callee.type === "MemberExpression" &&
      !n.callee.computed &&
      n.callee.property.name === "includes" &&
      n.callee.object.type === "ArrayExpression" &&
      propOf(n.arguments[0])
    ) {
      for (const e of n.callee.object.elements) {
        if (e?.type === "StringLiteral") {
          compare(propOf(n.arguments[0]), e);
        }
      }
    }
  });
  visit(ast.program, (n) => {
    if (n.type === "StringLiteral" && !comparing.has(n)) {
      written.add(n.value);
    }
    if (n.type === "TemplateLiteral" && !n.expressions.length) {
      written.add(n.quasis[0].value.cooked);
    }
  });
  return { compared: [...compared.values()], written };
}

export function dispatchValueIssues(text, allowed = DISPATCH_ALLOWED) {
  const { compared, written } = dispatchValues(text);
  const allowedKey = new Set(allowed.map((a) => `${a.property}\u0000${a.value}`));
  const lineOf = (at) => text.slice(0, at).split("\n").length;
  const unwritten = compared.filter((c) => !written.has(c.value));
  const issues = unwritten
    .filter((c) => !allowedKey.has(`${c.property}\u0000${c.value}`))
    .map(
      (c) =>
        `${c.property} === '${c.value}' (product line ${lineOf(c.at)}) is compared but nothing in the product writes '${c.value}'`,
    );
  const used = new Set(unwritten.map((c) => `${c.property}\u0000${c.value}`));
  for (const a of allowed) {
    if (!used.has(`${a.property}\u0000${a.value}`)) {
      issues.push(
        `allowance ${a.property} '${a.value}' matches nothing now; remove it`,
      );
    }
  }
  return issues;
}

// DOM references: every #id looked up and every data-* attribute read by the product
// must be given in src/shell.html or written by the product itself.
const kebab = (name) =>
  "data-" + name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
const SELECTOR_METHODS = new Set([
  "querySelector",
  "querySelectorAll",
  "closest",
  "matches",
]);

export function domReferences(text, html) {
  const ast = parseScript(text);
  const ids = { given: new Set(), used: new Map() };
  const data = { given: new Set(), used: new Map() };
  const use = (map, name, at) => {
    if (!map.has(name)) map.set(name, at);
  };
  const markup = (value) => {
    for (const m of value.matchAll(
      /(?:^|[\s"'<])id\s*=\s*["']?([A-Za-z][\w-]*)/g,
    )) {
      ids.given.add(m[1]);
    }
    for (const m of value.matchAll(/(?:^|[\s"'<])(data-[a-z][\w-]*)\s*=/g)) {
      data.given.add(m[1]);
    }
  };
  const selector = (value, at) => {
    for (const m of value.matchAll(/#([A-Za-z][\w-]*)/g)) {
      use(ids.used, m[1], at);
    }
    for (const m of value.matchAll(/\[(data-[a-z][\w-]*)/g)) {
      use(data.used, m[1], at);
    }
  };
  const literal = (n) =>
    n?.type === "StringLiteral"
      ? n.value
      : n?.type === "TemplateLiteral" && !n.expressions.length
        ? n.quasis[0].value.cooked
        : null;
  const memberNamed = (n, name) =>
    (n?.type === "MemberExpression" || n?.type === "OptionalMemberExpression") &&
    !n.computed &&
    n.property.name === name;
  const assigned = new Set();
  visit(ast.program, (n) => {
    if (n.type === "AssignmentExpression") {
      assigned.add(n.left);
      if (memberNamed(n.left, "id") && literal(n.right)) {
        ids.given.add(literal(n.right));
      }
      if (
        (n.left.type === "MemberExpression" ||
          n.left.type === "OptionalMemberExpression") &&
        memberNamed(n.left.object, "dataset") &&
        !n.left.computed
      ) {
        data.given.add(kebab(n.left.property.name));
      }
    }
    if (
      n.type === "ObjectProperty" &&
      !n.computed &&
      (n.key.name === "id" || n.key.value === "id") &&
      literal(n.value)
    ) {
      ids.given.add(literal(n.value));
    }
    if (
      n.type === "ObjectProperty" &&
      !n.computed &&
      n.key.type === "StringLiteral" &&
      n.key.value.startsWith("data-")
    ) {
      data.given.add(n.key.value);
    }
    if (n.type === "ObjectProperty" && n.computed) {
      visit(n.key, (k) => {
        if (k.type === "StringLiteral" && k.value.startsWith("data-")) {
          data.given.add(k.value);
        }
      });
    }
    if (
      n.type === "CallExpression" &&
      n.callee.type === "MemberExpression" &&
      !n.callee.computed
    ) {
      const method = n.callee.property.name;
      const first = literal(n.arguments[0]);
      if (method === "setAttribute" && first === "id" && literal(n.arguments[1])) {
        ids.given.add(literal(n.arguments[1]));
      }
      if (method === "setAttribute" && first?.startsWith("data-")) {
        data.given.add(first);
      }
      if (
        ["getAttribute", "hasAttribute"].includes(method) &&
        first?.startsWith("data-")
      ) {
        use(data.used, first, n.start);
      }
      if (method === "getElementById" && first) {
        use(ids.used, first, n.start);
      }
      if (SELECTOR_METHODS.has(method) && first) {
        selector(first, n.start);
      }
      if (
        method === "assign" &&
        n.callee.object.name === "Object" &&
        memberNamed(n.arguments[0], "dataset") &&
        n.arguments[1]?.type === "ObjectExpression"
      ) {
        for (const p of n.arguments[1].properties) {
          if (p.type === "ObjectProperty" && !p.computed) {
            data.given.add(kebab(p.key.name ?? String(p.key.value)));
          }
        }
      }
    }
    if (n.type === "StringLiteral") markup(n.value);
    if (n.type === "TemplateLiteral") {
      for (const q of n.quasis) markup(q.value.cooked ?? "");
    }
  });
  visit(ast.program, (n) => {
    if (
      (n.type === "MemberExpression" || n.type === "OptionalMemberExpression") &&
      memberNamed(n.object, "dataset") &&
      !n.computed &&
      !assigned.has(n)
    ) {
      use(data.used, kebab(n.property.name), n.start);
    }
  });
  for (const m of html.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)) {
    ids.given.add(m[1]);
  }
  for (const m of html.matchAll(/\s(data-[a-z][\w-]*)\s*=/g)) {
    data.given.add(m[1]);
  }
  return { ids, data };
}

export function domReferenceIssues(text, html) {
  const { ids, data } = domReferences(text, html);
  const lineOf = (at) => text.slice(0, at).split("\n").length;
  const issues = [];
  for (const [id, at] of ids.used) {
    if (!ids.given.has(id)) {
      issues.push(
        `element id ${id} is looked up (product line ${lineOf(at)}) but neither the page nor the product gives it`,
      );
    }
  }
  for (const [name, at] of data.used) {
    if (!data.given.has(name)) {
      issues.push(
        `${name} is read (product line ${lineOf(at)}) but neither the page nor the product writes it`,
      );
    }
  }
  return issues;
}

// Properties read and never written: every x.prop / x?.prop read in the product must
// be written in the product, present in src/catalog.json or src/language.json, or
// defined in pinned TypeScript ECMAScript/DOM .d.ts libs.
export const UNWRITTEN_ALLOWED = Object.freeze([
  {
    name: "__KAZOHE_TEST__",
    reason: "E2E test configuration hook injected on window by browser tests",
  },
  {
    name: "fixedQuestion",
    reason: "test-hook option on window.__KAZOHE_TEST__ for deterministic E2E setup",
  },
  {
    name: "initialConfig",
    reason: "test-hook option on window.__KAZOHE_TEST__ for initial E2E config",
  },
  {
    name: "webkitAudioContext",
    reason: "legacy Safari AudioContext constructor absent from modern TypeScript DOM libs",
  },
]);

export function platformNames() {
  const libDir = path.join(
    path.dirname(require.resolve("typescript/package.json")),
    "lib",
  );
  const names = new Set();
  for (const file of fs
    .readdirSync(libDir)
    .filter((n) =>
      /^lib\.(?:dom|es5|es20\d\d|esnext|webworker|scripthost|decorators)[\w.]*\.d\.ts$/.test(
        n,
      ),
    )) {
    const text = fs.readFileSync(path.join(libDir, file), "utf8");
    for (const m of text.matchAll(
      /^\s+(?:readonly\s+)?(?:get\s+|set\s+)?["']?([A-Za-z_$][\w$]*)["']?\??\s*[:(<]/gm,
    )) {
      names.add(m[1]);
    }
    for (const m of text.matchAll(
      /^declare\s+(?:var|function|const|let)\s+([A-Za-z_$][\w$]*)/gm,
    )) {
      names.add(m[1]);
    }
  }
  return names;
}

export function jsonObjectKeys(...values) {
  const keys = new Set();
  const walk = (v) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    for (const [k, child] of Object.entries(v)) {
      keys.add(k);
      walk(child);
    }
  };
  for (const value of values) walk(value);
  return keys;
}

export function unwrittenReads(text, extraGiven = []) {
  const ast = parseScript(text);
  const targets = new Set();
  const given = new Set(extraGiven);
  const reads = new Map();
  const target = (p) => {
    if (!p) return;
    if (
      (p.type === "MemberExpression" || p.type === "OptionalMemberExpression") &&
      !p.computed
    ) {
      targets.add(p);
    }
    if (p.type === "ObjectPattern") {
      for (const q of p.properties) target(q.value ?? q.argument);
    }
    if (p.type === "ArrayPattern") {
      for (const q of p.elements) target(q);
    }
    if (p.type === "AssignmentPattern") target(p.left);
  };
  visit(ast.program, (n) => {
    if (n.type === "AssignmentExpression") target(n.left);
    if (n.type === "UpdateExpression") target(n.argument);
    if (
      [
        "ObjectProperty",
        "ObjectMethod",
        "ClassMethod",
        "ClassProperty",
        "ClassPrivateProperty",
      ].includes(n.type) &&
      !n.computed
    ) {
      given.add(n.key.name ?? String(n.key.value));
    }
    if (n.type === "StringLiteral") given.add(n.value);
    const pieces =
      n.type === "StringLiteral"
        ? [n.value]
        : n.type === "TemplateLiteral"
          ? n.quasis.map((q) => q.value.cooked ?? "")
          : [];
    for (const piece of pieces) {
      for (const m of piece.matchAll(/data-([a-z0-9]+(?:-[a-z0-9]+)*)/g)) {
        given.add(m[1].replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()));
      }
    }
  });
  visit(ast.program, (n) => {
    if (
      (n.type !== "MemberExpression" && n.type !== "OptionalMemberExpression") ||
      n.computed ||
      n.property.type !== "Identifier"
    ) {
      return;
    }
    if (targets.has(n)) given.add(n.property.name);
    else if (!reads.has(n.property.name)) reads.set(n.property.name, n.property.start);
  });
  return Object.fromEntries([...reads].filter(([name]) => !given.has(name)));
}

export function unwrittenIssues(reads, platform, allowed = UNWRITTEN_ALLOWED) {
  const issues = [];
  const allowedNames = new Set(allowed.map((a) => a.name));
  for (const name of Object.keys(reads).sort()) {
    if (!platform.has(name) && !allowedNames.has(name)) {
      issues.push(
        `the product reads .${name} but nothing in it writes ${name}, and the platform does not provide it`,
      );
    }
  }
  for (const { name } of allowed) {
    if (!Object.hasOwn(reads, name) || platform.has(name)) {
      issues.push(
        `allowance ${name} is stale: the product no longer reads it without writing it; remove it`,
      );
    }
  }
  return issues;
}

// Shown text as state: logic that reads textContent / innerText and compares it
// decides by wording. SHOWN_TEXT_BASELINE is shrink-only (0 when clean).
const isMember = (n) =>
  (n?.type === "MemberExpression" || n?.type === "OptionalMemberExpression") &&
  !n.computed;
const isShownProperty = (n) =>
  isMember(n) && ["textContent", "innerText"].includes(n.property.name);
const TEXT_KEEPING = new Set(["trim", "trimStart", "trimEnd", "normalize"]);
const FUNCTION_SCOPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);

export function shownTextReads(text, fileOf) {
  const ast = parseScript(text);
  const out = [];
  const note = (n) =>
    out.push({
      file: fileOf(n.start),
      source: text.slice(n.start, n.end).replace(/\s+/g, " "),
    });
  const walk = (n, outer) => {
    if (!n || typeof n.type !== "string") return;
    const scope = FUNCTION_SCOPES.has(n.type)
      ? { names: new Set(), outer }
      : outer;
    const shown = (e) => {
      if (isShownProperty(e)) return true;
      if (
        (e?.type === "CallExpression" ||
          e?.type === "OptionalCallExpression") &&
        isMember(e.callee) &&
        TEXT_KEEPING.has(e.callee.property.name)
      ) {
        return shown(e.callee.object);
      }
      if (e?.type === "Identifier") {
        for (let s = scope; s; s = s.outer) {
          if (s.names.has(e.name)) return true;
        }
      }
      if (e?.type === "ConditionalExpression") {
        return shown(e.consequent) || shown(e.alternate);
      }
      if (e?.type === "LogicalExpression") {
        return shown(e.left) || shown(e.right);
      }
      return false;
    };
    if (
      n.type === "VariableDeclarator" &&
      n.id.type === "Identifier" &&
      shown(n.init)
    ) {
      scope.names.add(n.id.name);
    }
    if (
      n.type === "AssignmentExpression" &&
      n.operator === "=" &&
      n.left.type === "Identifier" &&
      shown(n.right)
    ) {
      scope.names.add(n.left.name);
    }
    if (
      n.type === "BinaryExpression" &&
      ["===", "!==", "==", "!="].includes(n.operator) &&
      (shown(n.left) || shown(n.right))
    ) {
      note(n);
    }
    if (
      (n.type === "CallExpression" || n.type === "OptionalCallExpression") &&
      isMember(n.callee) &&
      ["includes", "startsWith", "endsWith", "indexOf", "match", "test"].includes(
        n.callee.property.name,
      ) &&
      (shown(n.callee.object) || n.arguments.some(shown))
    ) {
      note(n);
    }
    if (n.type === "SwitchStatement" && shown(n.discriminant)) {
      note(n.discriminant);
    }
    for (const key of Object.keys(n)) {
      if (SKIP_KEYS.has(key)) continue;
      const value = n[key];
      if (Array.isArray(value)) {
        for (const child of value) walk(child, scope);
      } else if (value && typeof value.type === "string") {
        walk(value, scope);
      }
    }
  };
  walk(ast.program, { names: new Set(), outer: null });
  return out;
}

export function shownTextIssues(reads, baseline = SHOWN_TEXT_BASELINE) {
  const key = (r) => `${r.file}\u0000${r.source}`;
  const listed = new Set(baseline.map(key));
  const found = new Set(reads.map(key));
  const issues = [];
  for (const r of reads) {
    if (!listed.has(key(r))) {
      issues.push(`${r.file} decides by shown text: ${r.source}`);
    }
  }
  for (const b of baseline) {
    if (!found.has(key(b))) {
      issues.push(
        `baseline shown-text read in ${b.file} is gone; remove it: ${b.source}`,
      );
    }
  }
  return issues;
}

export const SHOWN_TEXT_BASELINE = Object.freeze([]);

// Diagnostic / error codes raised by the product: every static Error(...) message
// thrown by the product and every static diagnostic reason literal should be named
// by tests/. UNNAMED_CODES is shrink-only: any newly named or dropped entry fails.
export const UNNAMED_CODES = Object.freeze([
  "Borrow underflow",
  "Catalog entry is invalid",
  "Catalog fallbackParent is invalid",
  "Catalog prerequisite is invalid",
  "Catalog sourceCode is invalid",
  "Teaching borrow underflow",
  "筆算の式をたしかめてね。",
]);

const staticString = (node) =>
  node?.type === "StringLiteral"
    ? node.value
    : node?.type === "TemplateLiteral" && !node.expressions.length
      ? node.quasis[0].value.cooked
      : null;

export function productCodes(text) {
  const ast = parseScript(text);
  const codes = new Set();
  visit(ast.program, (n) => {
    if (n.type === "ThrowStatement") {
      const arg = n.argument;
      const isError =
        (arg?.type === "CallExpression" || arg?.type === "NewExpression") &&
        arg.callee?.type === "Identifier" &&
        /(?:Error)$/.test(arg.callee.name);
      if (isError) {
        const msg = staticString(arg.arguments[0]);
        if (msg) codes.add(msg);
      }
    }
    if (
      n.type === "ObjectProperty" &&
      !n.computed &&
      ["reason", "endReason"].includes(n.key.name ?? n.key.value)
    ) {
      const val = staticString(n.value);
      if (val) codes.add(val);
    }
  });
  return codes;
}

export function namedCodes(codes, texts) {
  const named = new Set();
  const joined = texts.join("\n");
  for (const code of codes) {
    if (joined.includes(code)) named.add(code);
  }
  return named;
}

export function diagnosticCodeIssues(codes, named, unnamed = UNNAMED_CODES) {
  const issues = [];
  const listed = new Set(unnamed);
  for (const code of [...codes].sort()) {
    if (!named.has(code) && !listed.has(code)) {
      issues.push(`the product raises "${code}" but no test file names it`);
    }
  }
  for (const code of unnamed) {
    if (!codes.has(code)) {
      issues.push(
        `"${code}" is listed as unnamed but the product no longer has it; remove it`,
      );
    } else if (named.has(code)) {
      issues.push(
        `"${code}" is listed as unnamed but a test file names it now; remove it`,
      );
    }
  }
  return issues;
}

// Child-facing glossary: one consistent word per idea in child-facing UI strings and markup.
export const childGlossaryBanned = Object.freeze([
  ["スコア", /スコア/, "Score（低学年は「とくてん」）"],
  ["インポート", /インポート/, "JSONを読みこむ"],
  ["エクスポート", /エクスポート/, "JSONに書き出す"],
  ["リセット", /リセット/, "クリア／すべて初期化"],
  ["キャンセル", /キャンセル/, "やめる"],
  ["リトライ", /リトライ/, "もういちど"],
  ["エラー", /エラー/, "たしかめ／案内文"],
  ["コンボ数", /コンボ数/, "コンボ"],
  ["ステージ", /ステージ/, "チャレンジ"],
  ["自動保存", /自動保存/, "記録を保存"],
]);

export const childGlossaryNotScreenText = Object.freeze([]);

const stripNonMarkup = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "");

function scriptStrings(text) {
  const ast = parseScript(text);
  const out = [];
  visit(ast.program, (n) => {
    if (n.type === "StringLiteral") {
      out.push({ at: n.start, text: n.value });
    } else if (n.type === "TemplateElement") {
      out.push({ at: n.start, text: n.value.cooked ?? n.value.raw });
    }
  });
  return out.sort((a, b) => a.at - b.at);
}

// files: [{ file, kind: 'product' | 'html' | 'script', text }]
export function childGlossaryIssues(files, banned = childGlossaryBanned) {
  const issues = [];
  const scan = (file, text) => {
    if (childGlossaryNotScreenText.includes(text)) return;
    for (const [word, re] of banned) {
      const m = text.match(new RegExp(`.{0,24}${re.source}.{0,24}`, "u"));
      if (m) issues.push({ file, word, text: m[0] });
    }
  };
  for (const { file, kind, text } of files) {
    if (kind === "product") {
      scan(file, stripNonMarkup(text));
      for (const m of text.matchAll(
        /<script\b[^>]*>([\s\S]*?)<\/script>/g,
      )) {
        for (const s of scriptStrings(m[1])) scan(file, s.text);
      }
    } else if (kind === "script") {
      for (const s of scriptStrings(text)) scan(file, s.text);
    } else {
      scan(file, stripNonMarkup(text));
    }
  }
  return issues;
}
