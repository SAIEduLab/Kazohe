// Audit reachability inventory: every tracked file under scripts/ and tests/
// must be reached from package.json scripts, .github/workflows/*.yml, or
// docs/verification.md via AST imports/spawns/data references (never comments
// or inventory allowlists).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { trackedFiles } from "./doc-links.mjs";
import { refusedWith } from "./refusal.mjs";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let parser;
const parseJs = (text) =>
  (parser ??= require("@babel/parser")).parse(text, {
    sourceType: "unambiguous",
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    errorRecovery: false,
  });

export const inInventoryScope = (file) =>
  file.startsWith("scripts/") || file.startsWith("tests/");

export const documentRoots = Object.freeze(["docs/verification.md"]);

// Observer scripts list or describe files without executing them: only their
// module imports/requires count as edges, never string literals.
export const inventoryObservers = Object.freeze([
  "scripts/audit-inventory.mjs",
  "scripts/audit-code.mjs",
  "scripts/doc-links.mjs",
]);

export const computedLoaders = Object.freeze([
  {
    source: "playwright.config.mjs",
    runtime: "playwright.config.mjs",
    signature: 'testDir: "tests/e2e"',
    targets: (_text, _read, tracked) =>
      [...tracked].filter((f) => /^tests\/e2e\/[^/]+\.spec\.mjs$/.test(f)),
  },
]);

const executable = (file) => /\.(?:mjs|cjs|js)$/.test(file);
const isWorkflow = (file) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file);
const posix = (value) =>
  path.posix
    .normalize(value.replaceAll("\\", "/"))
    .replace(/^\.\//, "")
    .replace(/(.)\/$/, "$1");

function walkAst(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkAst(child, visit);
    return;
  }
  if (typeof node.type === "string") visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (
      [
        "loc",
        "start",
        "end",
        "extra",
        "comments",
        "leadingComments",
        "trailingComments",
        "innerComments",
      ].includes(key)
    )
      continue;
    walkAst(value, visit);
  }
}

function scriptLiterals(text, { modulesOnly = false } = {}) {
  const literals = [];
  const specifier = (node) => {
    if (node?.type === "StringLiteral") literals.push(node.value);
  };
  walkAst(parseJs(text), (node) => {
    if (modulesOnly) {
      if (
        [
          "ImportDeclaration",
          "ExportNamedDeclaration",
          "ExportAllDeclaration",
        ].includes(node.type)
      )
        specifier(node.source);
      else if (
        node.type === "CallExpression" &&
        (node.callee?.type === "Import" || node.callee?.name === "require")
      )
        specifier(node.arguments[0]);
      else if (node.type === "ImportExpression") specifier(node.source);
    } else if (node.type === "StringLiteral") literals.push(node.value);
    else if (
      node.type === "TemplateElement" &&
      typeof node.value?.cooked === "string"
    )
      literals.push(node.value.cooked);
  });
  return literals;
}

function jsonLiterals(text) {
  const literals = [];
  const visit = (value) => {
    if (typeof value === "string") literals.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        literals.push(key);
        visit(child);
      }
    }
  };
  visit(JSON.parse(text));
  return literals;
}

const markdownLinks = (text) =>
  [...text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)].map((m) => m[1]);
const markdownDocPaths = (text) =>
  [...text.matchAll(/(?:^|[^\w./-])((?:docs|scripts|tests)\/[\w./-]+\.md)(?![\w/-])/g)].map(
    (m) => m[1],
  );
const workflowPaths = (text) =>
  [...text.matchAll(/(?:^|[\s"'=])((?:scripts|tests)\/[\w./-]+)/gm)].map(
    (m) => m[1],
  );

function directoriesOf(files) {
  const dirs = new Set([""]);
  for (const file of files) {
    let dir = path.posix.dirname(file);
    while (dir !== "." && !dirs.has(dir)) {
      dirs.add(dir);
      dir = path.posix.dirname(dir);
    }
  }
  return dirs;
}

const usable = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 300 &&
  !/[\n\0]/.test(value) &&
  !value.includes("://");

function literalTargets(file, literals, files, dirs) {
  const candidates = [
    ...new Set(literals.filter(usable).map((l) => l.replaceAll("\\", "/"))),
  ];
  const contexts = new Set(["", path.posix.dirname(file)]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const literal of candidates) {
      for (const context of [...contexts]) {
        const dir = posix(path.posix.join(context, literal));
        if (dir !== "." && dirs.has(dir) && !contexts.has(dir)) {
          contexts.add(dir);
          changed = true;
        }
      }
    }
  }
  const targets = new Set();
  for (const literal of candidates) {
    for (const context of contexts) {
      const target = posix(path.posix.join(context, literal));
      if (files.has(target)) targets.add(target);
      else if (literal.startsWith(".") && files.has(target + ".mjs"))
        targets.add(target + ".mjs");
    }
  }
  return [...targets];
}

export function fileReferences(file, text, files, dirs = directoriesOf(files)) {
  const observer = inventoryObservers.includes(file);
  if (executable(file))
    return literalTargets(
      file,
      scriptLiterals(text, { modulesOnly: observer }),
      files,
      dirs,
    );
  if (observer) return [];
  // Data reaches data and documents only; code runs only from code, package.json, workflows, or loaders.
  if (file.endsWith(".json"))
    return literalTargets(file, jsonLiterals(text), files, dirs).filter(
      (target) => !executable(target),
    );
  // Documents reach only linked/named markdown documents, never scripts.
  if (file.endsWith(".md"))
    return [
      ...new Set([
        ...markdownLinks(text).map((link) =>
          posix(path.posix.join(path.posix.dirname(file), link)),
        ),
        ...markdownDocPaths(text).map(posix),
      ]),
    ].filter((target) => target.endsWith(".md") && files.has(target));
  if (isWorkflow(file))
    return [...new Set(workflowPaths(text).map(posix))].filter((target) =>
      files.has(target),
    );
  return [];
}

export function entryPoints({ files, packageScripts }) {
  const roots = [];
  const add = (kind, file) => {
    if (files.has(file)) roots.push({ kind, file });
  };
  for (const file of documentRoots) add("document", file);
  for (const file of files) if (isWorkflow(file)) add("workflow", file);
  for (const [name, command] of Object.entries(packageScripts || {})) {
    const tokens = String(command).split(/\s+/);
    for (const token of tokens) {
      const cleaned = posix(token.replace(/^["']|["']$/g, ""));
      add(`npm:${name}`, cleaned);
    }
    if (/\bplaywright\s+test\b/.test(command))
      add(`npm:${name}`, "playwright.config.mjs");
  }
  return roots;
}

export function auditInventory({ files, read, packageScripts }) {
  const tracked = new Set(files);
  const dirs = directoriesOf(tracked);
  const parent = new Map();
  const queue = [];
  const issues = [];
  const visit = (file, from) => {
    if (!parent.has(file)) {
      parent.set(file, from);
      queue.push(file);
    }
  };
  for (const root of entryPoints({ files: tracked, packageScripts }))
    visit(root.file, root.kind);
  while (queue.length) {
    const file = queue.shift();
    let text;
    try {
      text = read(file);
    } catch (error) {
      issues.push(`${file}: unreadable: ${error.message}`);
      continue;
    }
    try {
      for (const target of fileReferences(file, text, tracked, dirs))
        visit(target, file);
    } catch (error) {
      issues.push(`${file}: references could not be read: ${error.message}`);
    }
    for (const loader of computedLoaders) {
      if (loader.runtime === file && !text.includes(loader.signature)) {
        issues.push(
          `${file}: runtime loader changed; ${loader.source} no longer matches ${loader.signature}`,
        );
      }
      if (loader.source === file) {
        try {
          for (const target of loader.targets(text, read, tracked)) {
            if (tracked.has(target)) visit(target, file);
            else issues.push(`${file}: loads missing ${target}`);
          }
        } catch (error) {
          issues.push(`${file}: computed loader failed: ${error.message}`);
        }
      }
    }
  }
  const scoped = [...tracked].filter(inInventoryScope).sort();
  return {
    scoped,
    unreachable: scoped.filter((file) => !parent.has(file)),
    issues,
    reachedFrom: Object.fromEntries(
      scoped
        .filter((file) => parent.has(file))
        .map((file) => [file, parent.get(file)]),
    ),
  };
}

export function assertAuditInventory(result) {
  assert.deepEqual(
    result.issues,
    [],
    "audit inventory could not be read:\n" + result.issues.join("\n"),
  );
  assert.deepEqual(
    result.unreachable,
    [],
    "tracked audit/test files unreachable from every entry point:\n" +
      result.unreachable.join("\n"),
  );
  return result;
}

export function runAuditInventoryNegativeControls() {
  const imp = (target) => `import ${JSON.stringify(target)};\n`;
  const baseTree = () => ({
    ".github/workflows/audit.yml":
      "jobs:\n  test:\n    steps:\n      - run: node scripts/wf-step.mjs\n",
    "docs/verification.md": "See [guide](extra.md).\n",
    "docs/extra.md": "Extra doc.\n",
    "playwright.config.mjs":
      'export default { testDir: "tests/e2e", reporter: [["./scripts/reporter.mjs"]] };\n',
    "scripts/lint.mjs":
      imp("./helper.mjs") +
      imp("./doc-links.mjs") +
      'fs.readFileSync("tests/fixtures/data.json");\n',
    "scripts/helper.mjs": "export const ok = 1;\n",
    "scripts/doc-links.mjs":
      'export const list = ["scripts/orphan.mjs", "tests/orphan.json"];\n',
    "scripts/wf-step.mjs": "export const w = 1;\n",
    "scripts/reporter.mjs": "export default class R {}\n",
    "tests/fixtures/data.json": JSON.stringify({
      nested: "tests/fixtures/nested.json",
    }),
    "tests/fixtures/nested.json": "{}",
    "tests/e2e/app.spec.mjs": "export {};\n",
  });
  const baseScripts = () => ({
    lint: "node scripts/lint.mjs",
    "test:e2e": "playwright test",
  });
  const run = ({
    tree = baseTree(),
    packageScripts = baseScripts(),
    unreadable = [],
  } = {}) =>
    auditInventory({
      files: Object.keys(tree),
      read: (file) => {
        if (unreadable.includes(file) || !(file in tree))
          throw new Error("ENOENT " + file);
        return tree[file];
      },
      packageScripts,
    });
  const edit = (mutate) => {
    const tree = baseTree();
    mutate(tree);
    return run({ tree });
  };
  const rejects = (result, { unreachable = [], issue } = {}) => {
    assert.throws(
      () => assertAuditInventory(result),
      refusedWith({
        code: "ERR_ASSERTION",
        message: issue
          ? /^audit inventory could not be read:/
          : /^tracked audit\/test files unreachable from every entry point:/,
      }),
    );
    assert.deepEqual(result.unreachable, unreachable);
    if (issue)
      assert(
        result.issues.length > 0 &&
          result.issues.every((text) => text.includes(issue)),
        JSON.stringify(result.issues),
      );
    else assert.deepEqual(result.issues, []);
  };

  // Valid synthetic tree passes
  const valid = assertAuditInventory(run());
  assert.deepEqual(
    valid.scoped,
    Object.keys(baseTree()).filter(inInventoryScope).sort(),
  );

  // Orphan file
  rejects(
    edit((t) => {
      t["scripts/orphan.mjs"] = "export {};\n";
    }),
    { unreachable: ["scripts/orphan.mjs"] },
  );

  // Orphan chain
  rejects(
    edit((t) => {
      t["scripts/orphan.mjs"] = imp("./orphan-helper.mjs");
      t["scripts/orphan-helper.mjs"] = "export {};\n";
    }),
    { unreachable: ["scripts/orphan-helper.mjs", "scripts/orphan.mjs"] },
  );

  // Inventory observer listing only does NOT reach a file
  rejects(
    edit((t) => {
      t["scripts/orphan.mjs"] = "export {};\n";
      t["tests/orphan.json"] = "{}";
    }),
    { unreachable: ["scripts/orphan.mjs", "tests/orphan.json"] },
  );

  // Comment mention only does NOT reach a file
  rejects(
    edit((t) => {
      t["scripts/orphan.mjs"] = "export {};\n";
      t["scripts/lint.mjs"] +=
        "// runs 'scripts/orphan.mjs'\n/* scripts/orphan.mjs */\n";
    }),
    { unreachable: ["scripts/orphan.mjs"] },
  );

  // Data file naming code does NOT reach code
  rejects(
    edit((t) => {
      t["scripts/orphan.mjs"] = "export {};\n";
      t["tests/fixtures/data.json"] = JSON.stringify({
        nested: "tests/fixtures/nested.json",
        runner: "scripts/orphan.mjs",
      });
    }),
    { unreachable: ["scripts/orphan.mjs"] },
  );

  // Document naming a script does NOT reach the script
  rejects(
    edit((t) => {
      t["scripts/orphan.mjs"] = "export {};\n";
      t["docs/verification.md"] +=
        "Run `node scripts/orphan.mjs` or [it](../scripts/orphan.mjs).\n";
    }),
    { unreachable: ["scripts/orphan.mjs"] },
  );

  // Removing package.json script makes its target unreachable
  rejects(run({ packageScripts: { "test:e2e": "playwright test" } }), {
    unreachable: [
      "scripts/doc-links.mjs",
      "scripts/helper.mjs",
      "scripts/lint.mjs",
      "tests/fixtures/data.json",
      "tests/fixtures/nested.json",
    ],
  });

  // Removing workflow command makes its target unreachable
  rejects(
    edit((t) => {
      t[".github/workflows/audit.yml"] = "jobs:\n  test:\n    steps: []\n";
    }),
    { unreachable: ["scripts/wf-step.mjs"] },
  );

  // Changed runtime loader signature fails
  rejects(
    edit((t) => {
      t["playwright.config.mjs"] =
        'export default { testDir: "tests/other", reporter: [["./scripts/reporter.mjs"]] };\n';
    }),
    { issue: "playwright.config.mjs: runtime loader changed" },
  );

  // Unparsable script fails
  rejects(
    edit((t) => {
      t["scripts/helper.mjs"] = "export const broken = ;\n";
    }),
    { issue: "scripts/helper.mjs: references could not be read" },
  );

  // Unreadable leaf fails
  rejects(run({ unreadable: ["scripts/helper.mjs"] }), {
    issue: "scripts/helper.mjs: unreadable",
  });

  // Missing git checkout fails
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kazohe-inv-"));
  try {
    assert.throws(
      () => trackedFiles(dir),
      refusedWith({ message: /tracked-file check needs a git checkout/ }),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function verifyAuditInventory(root = rootDir) {
  runAuditInventoryNegativeControls();
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const result = auditInventory({
    files: trackedFiles(root),
    read: (file) => fs.readFileSync(path.join(root, file), "utf8"),
    packageScripts: pkg.scripts || {},
  });
  assertAuditInventory(result);
  return { reached: result.scoped.length };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const result = verifyAuditInventory();
  console.log(`audit-inventory: ${result.reached} audit/test files reached PASS`);
}
