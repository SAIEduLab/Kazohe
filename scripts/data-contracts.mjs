/* SPDX-License-Identifier: MIT */
// Verifies that the literal unions in src/types/contracts.d.ts match src/catalog.json,
// src/language.json, and the runtime answer/backup checks in #kazohe-core.
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { listSources, readSource } from "./product-script.mjs";

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const contractsFile = "src/types/contracts.d.ts";

function extractUnionLiterals(ts, sf, typeName) {
  const decl = sf.statements.find(
    (s) => ts.isTypeAliasDeclaration(s) && s.name.text === typeName,
  );
  if (!decl) throw Error(contractsFile + ": missing type alias " + typeName);
  const items = [];
  const collect = (node) => {
    if (ts.isUnionTypeNode(node)) {
      for (const t of node.types) collect(t);
    } else if (ts.isLiteralTypeNode(node)) {
      if (ts.isStringLiteral(node.literal)) items.push(node.literal.text);
      else if (ts.isNumericLiteral(node.literal))
        items.push(Number(node.literal.text));
      else
        throw Error(
          contractsFile +
            ": unexpected literal in " +
            typeName +
            ": " +
            node.getText(sf),
        );
    } else {
      throw Error(
        contractsFile +
          ": non-literal member in " +
          typeName +
          ": " +
          node.getText(sf),
      );
    }
  };
  collect(decl.type);
  return items;
}

function stringArrayElements(ts, node) {
  if (!node || !ts.isArrayLiteralExpression(node)) return null;
  const out = [];
  for (const el of node.elements) {
    if (!ts.isStringLiteral(el)) return null;
    out.push(el.text);
  }
  return out;
}

// Extract the backup schema key arrays enforced by validateBackup (top-level keys, settings keys,
// and metrics counter keys) and the answerSpec.type values handled by normalizeInput.
function extractCoreSchemaContracts(ts, coreSources) {
  let backupTop = null,
    backupSettings = null,
    metricsCounters = null;
  const answerKinds = new Set();

  for (const [file, text] of Object.entries(coreSources)) {
    const sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const constArrays = new Map();
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) {
          const arr = stringArrayElements(ts, d.initializer);
          if (arr) constArrays.set(d.name.text, arr);
        }
      }
    }
    const resolveArray = (expr) =>
      stringArrayElements(ts, expr) ??
      (ts.isIdentifier(expr) ? (constArrays.get(expr.text) ?? null) : null);

    const walkValidateBackup = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "only" &&
        node.arguments.length === 2
      ) {
        const arr = resolveArray(node.arguments[1]);
        if (arr) {
          if (arr.includes("format") && arr.includes("practiceCheckpoint"))
            backupTop = arr;
          else if (arr.includes("onboarded") && arr.includes("config"))
            backupSettings = arr;
        }
      }
      if (ts.isForOfStatement(node)) {
        const arr = resolveArray(node.expression);
        if (arr && arr.includes("displayN") && arr.includes("learningUnansweredCount"))
          metricsCounters = arr;
      }
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        ts.isArrayLiteralExpression(node.initializer)
      ) {
        const arr = stringArrayElements(ts, node.initializer);
        if (arr) {
          if (
            !backupTop &&
            arr.includes("format") &&
            arr.includes("practiceCheckpoint")
          )
            backupTop = arr;
          if (
            !backupSettings &&
            arr.includes("onboarded") &&
            arr.includes("config")
          )
            backupSettings = arr;
          if (
            !metricsCounters &&
            arr.includes("displayN") &&
            arr.includes("learningUnansweredCount")
          )
            metricsCounters = arr;
        }
      }
      ts.forEachChild(node, walkValidateBackup);
    };

    const walkNormalizeInput = (node) => {
      if (
        ts.isBinaryExpression(node) &&
        (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
          node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)
      ) {
        const pairs = [
          [node.left, node.right],
          [node.right, node.left],
        ];
        for (const [a, b] of pairs) {
          if (
            ts.isPropertyAccessExpression(a) &&
            a.name.text === "type" &&
            ts.isIdentifier(a.expression) &&
            a.expression.text === "spec" &&
            ts.isStringLiteral(b)
          )
            answerKinds.add(b.text);
        }
      }
      if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression)) {
        const sw = node.parent?.parent;
        if (
          sw &&
          ts.isSwitchStatement(sw) &&
          ts.isPropertyAccessExpression(sw.expression) &&
          sw.expression.name.text === "type" &&
          ts.isIdentifier(sw.expression.expression) &&
          sw.expression.expression.text === "spec"
        )
          answerKinds.add(node.expression.text);
      }
      ts.forEachChild(node, walkNormalizeInput);
    };

    const visit = (node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === "validateBackup")
        walkValidateBackup(node);
      if (ts.isFunctionDeclaration(node) && node.name?.text === "normalizeInput")
        walkNormalizeInput(node);
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return {
    backupTop,
    backupSettings,
    metricsCounters,
    answerKinds: [...answerKinds],
  };
}

function compareSets(label, actualList, expectedList, issues) {
  const actual = new Set(actualList),
    expected = new Set(expectedList);
  if (actual.size !== actualList.length)
    issues.push(label + ": duplicate literal in contracts.d.ts");
  const missing = [...expected].filter((x) => !actual.has(x));
  const extra = [...actual].filter((x) => !expected.has(x));
  if (missing.length)
    issues.push(label + ": missing in contracts.d.ts: " + missing.join(", "));
  if (extra.length)
    issues.push(label + ": extra in contracts.d.ts: " + extra.join(", "));
}

export function verifyDataContracts({
  contractsText,
  catalog,
  language,
  coreSources = null,
}) {
  const ts = require("typescript");
  const sf = ts.createSourceFile(
    contractsFile,
    contractsText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const issues = [];

  const challengeIds = extractUnionLiterals(ts, sf, "ChallengeId");
  const grades = extractUnionLiterals(ts, sf, "Grade");
  const domains = extractUnionLiterals(ts, sf, "Domain");
  const timeClasses = extractUnionLiterals(ts, sf, "TimeClass");
  const sourceCodes = extractUnionLiterals(ts, sf, "SourceCode");
  const answerKinds = extractUnionLiterals(ts, sf, "AnswerKind");
  const backupTopKeys = extractUnionLiterals(ts, sf, "BackupTopKey");
  const backupSettingsKeys = extractUnionLiterals(ts, sf, "BackupSettingsKey");
  const metricsCounterKeys = extractUnionLiterals(ts, sf, "MetricsCounterKey");

  compareSets(
    "ChallengeId",
    challengeIds,
    catalog.map((c) => c.id),
    issues,
  );
  compareSets(
    "Grade (catalog)",
    grades,
    [...new Set(catalog.map((c) => c.grade))],
    issues,
  );
  compareSets(
    "Grade (language.json allocations)",
    grades,
    Array.from({ length: language.allocations.length }, (_, i) => i + 1),
    issues,
  );
  compareSets(
    "Grade (language.json counts)",
    grades,
    Array.from({ length: language.source.counts.length }, (_, i) => i + 1),
    issues,
  );
  compareSets(
    "Domain",
    domains,
    [...new Set(catalog.map((c) => c.category))],
    issues,
  );
  compareSets(
    "TimeClass",
    timeClasses,
    [...new Set(catalog.map((c) => c.timeClass))],
    issues,
  );
  compareSets(
    "SourceCode",
    sourceCodes,
    [...new Set(catalog.flatMap((c) => c.sourceCodes))],
    issues,
  );

  if (coreSources) {
    const extracted = extractCoreSchemaContracts(ts, coreSources);
    if (!extracted.answerKinds.length)
      issues.push("AnswerKind: could not locate normalizeInput spec.type checks");
    else compareSets("AnswerKind", answerKinds, extracted.answerKinds, issues);

    if (!extracted.backupTop)
      issues.push("BackupTopKey: could not locate validateBackup top-level keys");
    else compareSets("BackupTopKey", backupTopKeys, extracted.backupTop, issues);

    if (!extracted.backupSettings)
      issues.push(
        "BackupSettingsKey: could not locate validateBackup settings keys",
      );
    else
      compareSets(
        "BackupSettingsKey",
        backupSettingsKeys,
        extracted.backupSettings,
        issues,
      );

    if (!extracted.metricsCounters)
      issues.push(
        "MetricsCounterKey: could not locate validateBackup metrics counter keys",
      );
    else
      compareSets(
        "MetricsCounterKey",
        metricsCounterKeys,
        extracted.metricsCounters,
        issues,
      );
  }
  return { issues };
}

export function loadRepositoryContracts(root = repositoryRoot) {
  const coreSources = {};
  for (const file of listSources("src/ts", root))
    if (/^src\/ts\/0\d-.*\.ts$/.test(file))
      coreSources[file] = readSource(file, root);
  return {
    contractsText: readSource(contractsFile, root),
    catalog: JSON.parse(readSource("src/catalog.json", root)),
    language: JSON.parse(readSource("src/language.json", root)),
    coreSources: Object.keys(coreSources).length > 1 ? coreSources : null,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { issues } = verifyDataContracts(loadRepositoryContracts());
  if (issues.length) {
    for (const line of issues) console.error(line);
    process.exitCode = 1;
  } else {
    console.log("data-contracts PASS");
  }
}
