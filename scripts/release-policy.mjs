// Release policy AST check over product scripts (#kazohe-core and #kazohe-app),
// audit scripts/tests, TC/gate IDs, and tracked file names.
// Ensures APP_VERSION / PRODUCT_RELEASE is declared once as a single semver literal,
// never copied or used for runtime branching, and rejects version-derived or past-process
// identifiers while preserving the documented v0.2 save-format contract.
import { createRequire } from "node:module";
import { htmlName } from "./artifact.mjs";

const require = createRequire(import.meta.url);
const { parse } = require("@babel/parser");

const RELEASE_CONSTANTS = new Set(["APP_VERSION", "PRODUCT_RELEASE"]);

// Legitimate save-format compatibility fixtures whose filenames include a historical format tag.
export const ALLOWED_CONTRACT_FIXTURES = Object.freeze([
  "tests/fixtures/v0.2.4-backup.json",
]);

const releaseName = (name) =>
  /(?:^|[a-z_$])(?:V(?:ersion)?|Release)[_-]?\d/.test(name) ||
  /(?:^|[_$])(?:version|release)[_-]?\d/i.test(name) ||
  /(?:^|[_$])v(?:[_-]\d|\d{2,}|\d[_-]\d)/i.test(name) ||
  /^(?:run|test|verify|validate|check)[A-Za-z_$]*\d{2,3}(?:Tests?|Suite)$/i.test(
    name,
  );

export const versionDerivedName =
  /^(?:[A-Z]{1,12}\d{2,3}-|\d{2,3} [A-Za-z]|run[A-Za-z]+\d{2,3}Tests$)|(?:^|[-_:])(?:v|version|release)[-_]?\d{1,4}(?:$|[-_:.])/i;

export const pastProcessName =
  /repair[-_ ]?\d|phase[-_ ]?\d|dev[-_ ]?session|follow[-_ ]?up|new[-_ ]?contracts?|(?:format|runtime)[-_]?v?\d|(?<![0-9a-z])(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}(?![0-9a-z])/i;

export function functionalNameIssue(name) {
  if (typeof name !== "string" || !name) return "missing name";
  if (versionDerivedName.test(name)) return "version-derived name";
  if (pastProcessName.test(name)) return "past-process name";
  return null;
}

export const functionalNameIssues = (kind, names) =>
  names.flatMap((name) => {
    const issue = functionalNameIssue(name);
    return issue ? [`${kind} uses a ${issue}: ${name}`] : [];
  });

export const fileNameSegments = (file) =>
  file.split("/").map((segment) => segment.replace(/(.)\.[^.]+$/, "$1"));

export function fileNameIssues(
  files,
  allowedFixtures = ALLOWED_CONTRACT_FIXTURES,
) {
  const allowed = new Set(allowedFixtures);
  const issues = [];
  for (const file of files) {
    if (allowed.has(file)) continue;
    // The current versioned product HTML filename itself is governed by artifact.mjs.
    if (/^Kazohe_\d+_\d+_\d+\.html$/.test(file)) continue;
    for (const seg of fileNameSegments(file)) {
      const issue = functionalNameIssue(seg);
      if (issue) issues.push(`tracked file ${file} uses a ${issue}: ${seg}`);
    }
  }
  return issues;
}

const staticText = (node) =>
  node?.type === "TemplateLiteral"
    ? node.expressions.length
      ? undefined
      : node.quasis[0].value.cooked
    : node?.value;

const keyOf = (node) =>
  node?.computed ? staticText(node.property) : node?.property?.name;

const propertyKey = (node) =>
  node?.computed ? staticText(node.key) : (node?.key?.name ?? node?.key?.value);

const locOf = (node) =>
  `${node.loc?.start.line ?? "?"}:${node.loc?.start.column ?? "?"}`;

const isFunction = (node) =>
  /Function(?:Declaration|Expression)$|ArrowFunctionExpression|ObjectMethod|ClassMethod|ClassPrivateMethod/.test(
    node?.type || "",
  );

function walk(node, visit, parents = []) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") {
    visit(node, parents);
    parents = [...parents, node];
  }
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "loc" ||
      key === "start" ||
      key === "end" ||
      key === "extra" ||
      key === "tokens" ||
      key === "comments"
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit, parents);
    } else if (value && typeof value === "object") {
      walk(value, visit, parents);
    }
  }
}

function isReference(node, parent) {
  if (!parent) return true;
  if (parent.type === "VariableDeclarator" && parent.id === node) return false;
  if (
    (parent.type === "FunctionDeclaration" ||
      parent.type === "FunctionExpression" ||
      parent.type === "ClassDeclaration" ||
      parent.type === "ClassExpression") &&
    parent.id === node
  ) {
    return false;
  }
  if (isFunction(parent) && parent.params?.includes(node)) return false;
  if (
    (parent.type === "ObjectProperty" ||
      parent.type === "ObjectMethod" ||
      parent.type === "ClassMethod") &&
    parent.key === node &&
    !parent.computed
  ) {
    return false;
  }
  if (
    (parent.type === "MemberExpression" ||
      parent.type === "OptionalMemberExpression") &&
    parent.property === node &&
    !parent.computed
  ) {
    return false;
  }
  return true;
}

function isNamedIdentifier(node, parent) {
  if (
    (parent?.type === "ObjectProperty" ||
      parent?.type === "ObjectMethod" ||
      parent?.type === "ClassMethod") &&
    parent.key === node &&
    !parent.computed
  ) {
    return false;
  }
  if (
    (parent?.type === "MemberExpression" ||
      parent?.type === "OptionalMemberExpression") &&
    parent.property === node &&
    !parent.computed
  ) {
    return false;
  }
  return true;
}

export function extractProductScripts(html) {
  const scripts = [];
  for (const m of html.matchAll(
    /<script(?:\s+id="([^"]+)")?[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    scripts.push({ id: m[1] || `script-${scripts.length}`, source: m[2] });
  }
  if (!scripts.length) throw new Error("product HTML script missing");
  return scripts;
}

function parsed(source, sourceType = "unambiguous") {
  return parse(source, {
    sourceType,
    allowReturnOutsideFunction: false,
    errorRecovery: false,
  });
}

function nameIssues(ast, file, { callablesOnly = false } = {}) {
  const issues = [];
  walk(ast, (node, parents) => {
    const parent = parents.at(-1);
    let name;
    if (
      (node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression") &&
      node.id
    ) {
      name = node.id.name;
    } else if (
      ["ObjectMethod", "ClassMethod", "ClassPrivateMethod"].includes(node.type)
    ) {
      name = propertyKey(node);
    } else if (
      node.type === "VariableDeclarator" &&
      /FunctionExpression|ArrowFunctionExpression/.test(node.init?.type || "")
    ) {
      name = node.id?.name;
    } else if (
      node.type === "ObjectProperty" &&
      /FunctionExpression|ArrowFunctionExpression/.test(node.value?.type || "")
    ) {
      name = propertyKey(node);
    } else if (
      node.type === "AssignmentExpression" &&
      /FunctionExpression|ArrowFunctionExpression/.test(node.right?.type || "")
    ) {
      name =
        node.left?.type === "MemberExpression"
          ? keyOf(node.left)
          : node.left?.name;
    } else if (
      !callablesOnly &&
      node.type === "Identifier" &&
      isNamedIdentifier(node, parent)
    ) {
      name = node.name;
    }
    if (!name) return;
    if (releaseName(name)) {
      issues.push(`${file}:${locOf(node)} release-derived identifier ${name}`);
    } else if (pastProcessName.test(name)) {
      issues.push(`${file}:${locOf(node)} past-process identifier ${name}`);
    }
  });
  return issues;
}

// Check whether an ObjectProperty { APP_VERSION } / { PRODUCT_RELEASE } sits inside
// the public API export object (KZ = Object.freeze({ ... }) or return Object.freeze({ ... })).
function isPublicExportProperty(node, parents) {
  const parent = parents.at(-1);
  if (parent?.type !== "ObjectProperty" || parent.value !== node) return false;
  const key = propertyKey(parent);
  if (!RELEASE_CONSTANTS.has(key)) return false;
  const obj = parents.at(-2);
  if (obj?.type !== "ObjectExpression") return false;
  const owner = parents.at(-3);
  if (
    owner?.type === "CallExpression" &&
    owner.callee?.type === "MemberExpression" &&
    owner.callee.object?.name === "Object" &&
    owner.callee.property?.name === "freeze"
  ) {
    const freezeParent = parents.at(-4);
    return (
      freezeParent?.type === "ReturnStatement" ||
      (freezeParent?.type === "VariableDeclarator" &&
        freezeParent.id?.name === "KZ")
    );
  }
  return (
    owner?.type === "VariableDeclarator" && owner.id?.name === "KZ"
  );
}

function productScriptIssues(asts, productLabel) {
  const issues = [];
  let releaseDeclaration = 0;
  for (const { id, ast } of asts) {
    const label = `${productLabel}#${id}`;
    const report = (node, message) =>
      issues.push(`${label}:${locOf(node)} ${message}`);
    walk(ast, (node, parents) => {
      const parent = parents.at(-1);
      if (
        node.type === "VariableDeclarator" &&
        RELEASE_CONSTANTS.has(node.id?.name)
      ) {
        releaseDeclaration++;
        const value = staticText(node.init);
        if (
          parent?.type !== "VariableDeclaration" ||
          parent.kind !== "const" ||
          node.init?.type !== "StringLiteral" ||
          !/^\d+\.\d+\.\d+$/.test(value ?? "")
        ) {
          report(
            node,
            `${node.id.name} must be a single const x.y.z release literal`,
          );
        }
      }
      if (
        (node.type === "StringLiteral" || node.type === "TemplateLiteral") &&
        /^\d+\.\d+\.\d+$/.test(staticText(node) ?? "") &&
        !(
          parent?.type === "VariableDeclarator" &&
          RELEASE_CONSTANTS.has(parent.id?.name) &&
          parent.init === node
        )
      ) {
        report(node, "copied release literal outside APP_VERSION");
      }
      if (
        node.type === "Identifier" &&
        RELEASE_CONSTANTS.has(node.name) &&
        isReference(node, parent) &&
        !isPublicExportProperty(node, parents)
      ) {
        report(
          node,
          `${node.name} must not be read, compared, or branched on at runtime`,
        );
      }
      if (
        (node.type === "MemberExpression" ||
          node.type === "OptionalMemberExpression") &&
        RELEASE_CONSTANTS.has(keyOf(node))
      ) {
        report(
          node,
          `${keyOf(node)} cannot be read back through a property access`,
        );
      }
      if (node.type === "ObjectPattern") {
        for (const prop of node.properties) {
          if (RELEASE_CONSTANTS.has(propertyKey(prop))) {
            report(
              prop,
              `${propertyKey(prop)} cannot be read through destructuring`,
            );
          }
        }
      }
    });
  }
  if (releaseDeclaration !== 1) {
    issues.push(
      `${productLabel}: expected one APP_VERSION/PRODUCT_RELEASE declaration, found ${releaseDeclaration}`,
    );
  }
  return issues;
}

export function releasePolicyIssues(
  html,
  {
    auditSources = [],
    tcIds = [],
    gateIds = [],
    trackedFiles = [],
    productLabel = htmlName,
  } = {},
) {
  const issues = [];
  let scripts;
  try {
    scripts = extractProductScripts(html);
  } catch (error) {
    return [`${productLabel}: ${error.message}`];
  }
  const asts = [];
  for (const { id, source } of scripts) {
    try {
      const ast = parsed(source, "script");
      asts.push({ id, ast });
      issues.push(...nameIssues(ast, `${productLabel}#${id}`));
    } catch (error) {
      issues.push(`${productLabel}#${id}: parse failed: ${error.message}`);
    }
  }
  if (asts.length === scripts.length) {
    issues.push(...productScriptIssues(asts, productLabel));
  }
  for (const { file, source } of auditSources) {
    try {
      issues.push(...nameIssues(parsed(source), file, { callablesOnly: true }));
    } catch (error) {
      issues.push(`${file}: parse failed: ${error.message}`);
    }
  }
  issues.push(
    ...functionalNameIssues("TC ID", tcIds),
    ...functionalNameIssues("gate ID", gateIds),
    ...fileNameIssues(trackedFiles),
  );
  return issues;
}

export function assertReleasePolicy(html, options = {}) {
  const issues = releasePolicyIssues(html, options);
  if (issues.length) {
    throw new Error("Release policy:\n" + issues.join("\n"));
  }
}
