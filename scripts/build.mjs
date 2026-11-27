/* SPDX-License-Identifier: MIT */
// Builds the single-file Kazohe product HTML from src/.
//   node scripts/build.mjs          write Kazohe_<major>_<minor>_<patch>.html and stamp docs
//   node scripts/build.mjs --check  fail unless committed HTML and stamped files match src/
//
// The sources are TypeScript modules under src/ts/ plus src/style.css, src/catalog.json,
// src/language.json, and src/shell.html. The product keeps two inline scripts:
//   - <script id="kazohe-core"> containing <!-- @core ts/... --> modules
//   - <script id="kazohe-app">  containing <!-- @include ts/... --> modules
// The pinned TypeScript compiler is used for its parser only; types are erased syntactically.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  appVersion,
  filename,
  isProductHtml,
  assertCurrentArtifact,
} from "./artifact.mjs";

const require = createRequire(import.meta.url);
let typescript = null;
export const loadTypeScript = () => (typescript ??= require("typescript"));

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const templatePath = "src/shell.html";
export const sourceDirectories = ["src/ts"];
export const styleFile = "src/style.css";
export const dataFiles = Object.freeze([
  "src/catalog.json",
  "src/language.json",
]);
export const CORE_EXPORTS = Object.freeze([
  "KZLanguage",
  "KZWritten",
  "KZ",
  "KZTeaching",
]);
export const STAMPED_FILES = Object.freeze([
  "index.html",
  "README.md",
  "docs/verification.md",
  "tests/fixtures/implementation-map.json",
]);

const includeLine = /^<!-- @(include|core) ([a-z0-9.][a-z0-9/._-]*) -->$/;
const directiveWord = /@(?:include|core)\b/;
const releaseLine = /^ {2}const APP_VERSION = ["'](\d+\.\d+\.\d+)["'];$/m;
const indentUnit = "  ";

const readText = (root) => (file) =>
  fs.readFileSync(path.join(root, file), "utf8");
const listFiles = (root) => (dir) =>
  fs
    .readdirSync(path.join(root, dir))
    .sort()
    .map((name) => dir + "/" + name);

function requireLines(text, file) {
  if (!text.endsWith("\n") || text.includes("\r"))
    throw Error(file + ": expected LF-terminated text");
}

const lineIndex = (starts) => (at) => {
  let lo = 0,
    hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

function bindingNames(ts, name) {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((e) =>
    ts.isOmittedExpression(e) ? [] : bindingNames(ts, e.name),
  );
}

const hasModifier = (node, kind) =>
  !!node.modifiers?.some((m) => m.kind === kind);
const parseModule = (ts, text, file) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const resolveImport = (from, specifier) =>
  path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
const typeFile = (file) => /^src\/types\/[a-z0-9][a-z0-9.-]*\.d\.ts$/.test(file);

function isJsonWithClause(ts, node) {
  const attrs = node.attributes;
  if (!attrs || attrs.token !== ts.SyntaxKind.WithKeyword) return false;
  if (attrs.elements.length !== 1) return false;
  const [el] = attrs.elements;
  const key = ts.isIdentifier(el.name)
    ? el.name.text
    : ts.isStringLiteral(el.name)
      ? el.name.text
      : null;
  return (
    key === "type" &&
    ts.isStringLiteral(el.value) &&
    el.value.text === "json"
  );
}

// Compile one TypeScript module to erased JavaScript for embedding into the product script.
export function compileModule(text, file, { resolveJson } = {}) {
  requireLines(text, file);
  if (/[\u2028\u2029]/.test(text))
    throw Error(
      file +
        ": U+2028 and U+2029 end lines for the parser but not for the line map: write them as \\u2028 and \\u2029",
    );
  const ts = loadTypeScript(),
    K = ts.SyntaxKind;
  const source = parseModule(ts, text, file);
  const parseErrors = source.parseDiagnostics || [];
  if (parseErrors.length) {
    const d = parseErrors[0],
      { line, character } = source.getLineAndCharacterOfPosition(d.start);
    throw Error(
      file +
        ":" +
        (line + 1) +
        ":" +
        (character + 1) +
        ": " +
        ts.flattenDiagnosticMessageText(d.messageText, " "),
    );
  }
  const lineOfNode = (node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const refuse = (node, what) => {
    throw Error(file + ":" + lineOfNode(node) + ": " + what);
  };
  const edits = [],
    imports = [],
    jsonImports = [],
    exported = [],
    declared = [];
  const remove = (start, end) => {
    if (end > start) edits.push({ start, end, text: "" });
  };
  const replace = (start, end, replacement) => {
    edits.push({ start, end, text: replacement });
  };
  const removeStatement = (node) => {
    const start = node.getStart(source),
      end = node.getEnd();
    let lineStart = start;
    while (
      lineStart > 0 &&
      (text[lineStart - 1] === " " || text[lineStart - 1] === "\t")
    )
      lineStart--;
    let lineEnd = end;
    while (
      lineEnd < text.length &&
      (text[lineEnd] === " " || text[lineEnd] === "\t")
    )
      lineEnd++;
    if (
      (lineStart === 0 || text[lineStart - 1] === "\n") &&
      text[lineEnd] === "\n"
    )
      remove(lineStart, lineEnd + 1);
    else remove(start, end);
  };
  const removeAnnotation = (typeNode) => {
    let colon = typeNode.getFullStart() - 1;
    while (colon >= 0 && /\s/.test(text[colon])) colon--;
    if (text[colon] !== ":")
      refuse(typeNode, 'expected ":" before a type annotation');
    remove(colon, typeNode.getEnd());
  };
  const removeToken = (token) => {
    if (token) remove(token.getStart(source), token.getEnd());
  };
  const removeAngles = (list) => {
    if (!list?.length) return;
    let open = list.pos - 1;
    while (open >= 0 && text[open] !== "<") open--;
    let close = list.end;
    while (close < text.length && text[close] !== ">") close++;
    remove(open, close + 1);
  };
  const removeKeyword = (modifier) => {
    let end = modifier.getEnd();
    while (text[end] === " ") end++;
    remove(modifier.getStart(source), end);
  };
  const classMemberModifiers = [
    K.PrivateKeyword,
    K.ProtectedKeyword,
    K.PublicKeyword,
    K.ReadonlyKeyword,
    K.OverrideKeyword,
  ];
  const eraseModifiers = (node, topLevel) => {
    for (const modifier of node.modifiers || []) {
      if (modifier.kind === K.ExportKeyword && topLevel)
        removeKeyword(modifier);
      else if (
        classMemberModifiers.includes(modifier.kind) &&
        (ts.isClassElement(node) || ts.isParameter(node))
      ) {
        if (ts.isParameter(node))
          refuse(node, "parameter properties do not erase to JavaScript");
        removeKeyword(modifier);
      } else if (
        modifier.kind === K.AsyncKeyword ||
        modifier.kind === K.StaticKeyword
      ) {
        /* JavaScript */
      } else if (
        modifier.kind === K.ConstKeyword &&
        ts.isTypeParameterDeclaration(node)
      ) {
        /* inside a removed list */
      } else if (modifier.kind === K.DefaultKeyword)
        refuse(
          node,
          "default exports are not used (export the declaration by its name)",
        );
      else if (modifier.kind === K.Decorator)
        refuse(node, "decorators are not used");
      else
        refuse(
          node,
          "the modifier " +
            ts.tokenToString(modifier.kind) +
            " does not erase to JavaScript",
        );
    }
  };
  const visit = (node, topLevel) => {
    switch (node.kind) {
      case K.ImportDeclaration: {
        if (!topLevel) refuse(node, "an import inside a block");
        const clause = node.importClause;
        if (!clause) refuse(node, "an import without names");
        const specifier = node.moduleSpecifier.text;
        if (specifier.endsWith(".json")) {
          if (clause.isTypeOnly)
            refuse(node, "JSON data imports are value imports");
          if (!clause.name || clause.namedBindings)
            refuse(
              node,
              'JSON data imports use a default binding only (import data from "../catalog.json" with { type: "json" };)',
            );
          if (!isJsonWithClause(ts, node))
            refuse(node, 'JSON data imports require `with { type: "json" }`');
          const target = resolveImport(file, specifier);
          if (!dataFiles.includes(target))
            refuse(
              node,
              "JSON import outside " + dataFiles.join(" or ") + ": " + specifier,
            );
          const name = clause.name.text;
          jsonImports.push({ from: specifier, target, line: lineOfNode(node), name });
          declared.push(name);
          let payload = "null";
          if (resolveJson) {
            const raw = resolveJson(target);
            requireLines(raw, target);
            if (/[\u2028\u2029]/.test(raw))
              throw Error(target + ": contains U+2028 or U+2029");
            payload = JSON.stringify(JSON.parse(raw));
          }
          replace(node.getStart(source), node.getEnd(), `const ${name} = ${payload};`);
          return;
        }
        if (clause.name) refuse(node, "default imports are not used");
        const bindings = clause.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings))
          refuse(node, "only named imports ({a, b}) are used");
        const names = bindings.elements.map((element) => {
          if (element.propertyName)
            refuse(
              element,
              "an import renames " +
                element.propertyName.text +
                "; import it by its own name",
            );
          return {
            name: element.name.text,
            typeOnly: clause.isTypeOnly || element.isTypeOnly,
          };
        });
        imports.push({ from: specifier, line: lineOfNode(node), names });
        removeStatement(node);
        return;
      }
      case K.ExportDeclaration:
        refuse(
          node,
          "export lists and re-exports are not used (export the declaration itself)",
        );
      case K.ExportAssignment:
        refuse(node, "export default and export = are not used");
      case K.ImportEqualsDeclaration:
        refuse(node, "import = is not used");
      case K.EnumDeclaration:
        refuse(
          node,
          "enum does not erase to JavaScript (use a union of literals)",
        );
      case K.ModuleDeclaration:
        refuse(
          node,
          "namespace and module declarations do not erase to JavaScript",
        );
      case K.Decorator:
        refuse(node, "decorators are not used");
      case K.TypeAssertionExpression:
        refuse(node, "use `value as Type`, not `<Type>value`");
      case K.InterfaceDeclaration:
      case K.TypeAliasDeclaration:
        if (
          !ts.isSourceFile(node.parent) &&
          !ts.isBlock(node.parent) &&
          !ts.isModuleBlock(node.parent)
        )
          refuse(
            node,
            "a type declared where a block is not written does not erase",
          );
        if (topLevel && hasModifier(node, K.ExportKeyword))
          exported.push({ name: node.name.text, type: true });
        removeStatement(node);
        return;
      case K.FunctionDeclaration:
      case K.MethodDeclaration:
      case K.Constructor:
      case K.GetAccessor:
      case K.SetAccessor:
        if (hasModifier(node, K.AbstractKeyword))
          refuse(node, "abstract members are not used");
        if (hasModifier(node, K.DeclareKeyword))
          refuse(
            node,
            '"declare" makes no value: import the value from the module that makes it',
          );
        if (!node.body) {
          removeStatement(node);
          return;
        }
        if (
          ts.isMethodDeclaration(node) &&
          node.questionToken &&
          ts.isObjectLiteralExpression(node.parent)
        )
          refuse(node, "an optional method in an object is not JavaScript");
        break;
      case K.PropertyDeclaration:
        if (hasModifier(node, K.DeclareKeyword)) {
          removeStatement(node);
          return;
        }
        if (hasModifier(node, K.AbstractKeyword))
          refuse(node, "abstract members are not used");
        if (hasModifier(node, K.AccessorKeyword))
          refuse(node, "accessor fields are not used");
        if (!node.initializer && !ts.isPrivateIdentifier(node.name))
          refuse(
            node,
            "a class field without a value becomes a property the class did not have: give it a value or write `declare`",
          );
        break;
      case K.IndexSignature:
        removeStatement(node);
        return;
      case K.VariableStatement:
        if (hasModifier(node, K.DeclareKeyword))
          refuse(
            node,
            '"declare" makes no value: import the value from the module that makes it',
          );
        break;
      case K.ClassDeclaration:
        if (hasModifier(node, K.DeclareKeyword))
          refuse(
            node,
            '"declare" makes no value: import the value from the module that makes it',
          );
        if (hasModifier(node, K.AbstractKeyword))
          refuse(node, "abstract classes are not used");
        break;
      case K.HeritageClause:
        if (node.token === K.ImplementsKeyword) {
          let start = node.getStart(source);
          while (start > 0 && text[start - 1] === " ") start--;
          remove(start, node.getEnd());
          return;
        }
        break;
      case K.AsExpression:
      case K.SatisfiesExpression:
        visit(node.expression, false);
        remove(node.expression.getEnd(), node.getEnd());
        return;
      case K.NonNullExpression:
        visit(node.expression, false);
        remove(node.getEnd() - 1, node.getEnd());
        return;
      case K.ExpressionWithTypeArguments:
        removeAngles(node.typeArguments);
        visit(node.expression, false);
        return;
      case K.ParenthesizedExpression: {
        let inner = node.expression;
        if (!ts.isAsExpression(inner) && !ts.isSatisfiesExpression(inner))
          break;
        while (
          ts.isAsExpression(inner) ||
          ts.isSatisfiesExpression(inner) ||
          ts.isNonNullExpression(inner)
        )
          inner = inner.expression;
        const parent = node.parent,
          optionalNext =
            (ts.isPropertyAccessExpression(parent) ||
              ts.isElementAccessExpression(parent) ||
              ts.isCallExpression(parent)) &&
            parent.expression === node &&
            !!parent.questionDotToken;
        const chain =
          ts.isIdentifier(inner) ||
          inner.kind === K.ThisKeyword ||
          ((ts.isPropertyAccessExpression(inner) ||
            ts.isElementAccessExpression(inner) ||
            ts.isCallExpression(inner)) &&
            (!ts.isOptionalChain(inner) || optionalNext));
        let link = inner;
        while (
          ts.isPropertyAccessExpression(link) ||
          ts.isElementAccessExpression(link) ||
          ts.isNonNullExpression(link)
        )
          link = link.expression;
        const newCallee =
          ts.isNewExpression(node.parent) &&
          node.parent.expression === node &&
          (ts.isCallExpression(inner) || ts.isCallExpression(link));
        const open = node.getStart(source),
          close = node.getEnd() - 1;
        if (
          chain &&
          !newCallee &&
          !/[\w$]/.test(text[open - 1] || "") &&
          !/[\w$]/.test(text[close + 1] || "") &&
          !text.slice(open, close).includes("\n")
        ) {
          remove(open, open + 1);
          remove(close, close + 1);
        }
        break;
      }
      case K.ArrowFunction: {
        const [only] = node.parameters;
        if (
          node.parameters.length === 1 &&
          !node.typeParameters &&
          ts.isIdentifier(only.name) &&
          only.type &&
          !only.initializer &&
          !only.dotDotDotToken &&
          !only.questionToken
        ) {
          let open = only.getStart(source) - 1;
          while (open >= 0 && /\s/.test(text[open])) open--;
          let close = only.getEnd();
          while (close < text.length && /\s/.test(text[close])) close++;
          if (
            text[open] === "(" &&
            text[close] === ")" &&
            !/[\w$]/.test(text[open - 1] || "")
          ) {
            remove(open, open + 1);
            remove(close, close + 1);
          }
        }
        break;
      }
      case K.Parameter:
        if (ts.isIdentifier(node.name) && node.name.text === "this") {
          const params = node.parent.parameters,
            next = params[params.indexOf(node) + 1];
          let end = next ? next.getStart(source) : node.getEnd();
          if (!next) while (end < text.length && text[end] !== ")") end++;
          remove(node.getStart(source), end);
          return;
        }
        break;
    }
    if (ts.canHaveModifiers(node) && node.modifiers)
      eraseModifiers(node, topLevel);
    if (node.typeParameters) removeAngles(node.typeParameters);
    if (
      (ts.isCallExpression(node) ||
        ts.isNewExpression(node) ||
        ts.isTaggedTemplateExpression(node)) &&
      node.typeArguments
    )
      removeAngles(node.typeArguments);
    if (
      node.type &&
      !ts.isTypeNode(node) &&
      (ts.isParameter(node) ||
        ts.isVariableDeclaration(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isFunctionLike(node))
    )
      removeAnnotation(node.type);
    if (
      (ts.isParameter(node) ||
        ts.isPropertyDeclaration(node) ||
        (ts.isMethodDeclaration(node) && ts.isClassLike(node.parent))) &&
      node.questionToken
    )
      removeToken(node.questionToken);
    if (ts.isVariableDeclaration(node) && node.exclamationToken)
      removeToken(node.exclamationToken);
    if (ts.isPropertyDeclaration(node) && node.exclamationToken)
      refuse(node, "a field declared with ! has no value: write `declare`");
    ts.forEachChild(node, (child) => {
      if (
        (ts.isTypeNode(child) && !ts.isExpressionWithTypeArguments(child)) ||
        ts.isTypeParameterDeclaration(child)
      )
        return;
      visit(child, false);
    });
  };
  for (const statement of source.statements) {
    if (
      hasModifier(statement, K.ExportKeyword) &&
      !ts.isInterfaceDeclaration(statement) &&
      !ts.isTypeAliasDeclaration(statement)
    ) {
      if (
        (ts.isFunctionDeclaration(statement) && statement.body) ||
        ts.isClassDeclaration(statement)
      )
        exported.push({ name: statement.name.text });
      else if (ts.isVariableStatement(statement))
        for (const d of statement.declarationList.declarations)
          for (const name of bindingNames(ts, d.name)) exported.push({ name });
    }
    if (!hasModifier(statement, K.DeclareKeyword)) {
      if (
        (ts.isFunctionDeclaration(statement) && statement.body) ||
        ts.isClassDeclaration(statement)
      )
        declared.push(statement.name.text);
      else if (ts.isVariableStatement(statement)) {
        if (
          !(
            statement.declarationList.flags &
            (ts.NodeFlags.Const | ts.NodeFlags.Let)
          )
        )
          refuse(
            statement,
            "var is not used at the top level (use const or let)",
          );
        for (const d of statement.declarationList.declarations)
          declared.push(...bindingNames(ts, d.name));
      }
    }
    visit(statement, true);
  }
  const ending = [
    K.ExpressionStatement,
    K.VariableStatement,
    K.ReturnStatement,
    K.ThrowStatement,
    K.BreakStatement,
    K.ContinueStatement,
    K.DoStatement,
    K.ImportDeclaration,
    K.PropertyDeclaration,
  ];
  const semicolons = (node) => {
    if (
      ending.includes(node.kind) &&
      node.getLastToken(source)?.kind !== K.SemicolonToken
    )
      refuse(node, 'end the statement with ";"');
    ts.forEachChild(node, semicolons);
  };
  semicolons(source);
  const starts = source.getLineStarts(),
    inLiteral = new Set();
  const markLiterals = (node) => {
    const parts =
      ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)
        ? [node]
        : ts.isTemplateExpression(node)
          ? [node.head, ...node.templateSpans.map((s) => s.literal)]
          : [];
    for (const part of parts)
      for (let i = part.getStart(source); i < part.getEnd() - 1; i++)
        if (text[i] === "\n") inLiteral.add(i + 1);
    ts.forEachChild(node, markLiterals);
  };
  markLiterals(source);
  const removed = edits.filter((e) => e.end > e.start && e.text === "");
  for (const start of starts)
    if (
      start < text.length &&
      text[start] !== "\n" &&
      !inLiteral.has(start) &&
      !removed.some((e) => e.start <= start && e.end > text.indexOf("\n", start))
    )
      edits.push({ start, end: start, text: indentUnit });
  edits.sort(
    (a, b) => a.start - b.start || a.end - a.start - (b.end - b.start),
  );
  const sourceLine = lineIndex(starts);
  let out = "",
    at = 0,
    fresh = true,
    origin = 1;
  const lines = [];
  const write = (piece, from) => {
    if (!piece) return;
    for (let i = 0; i < piece.length; i++) {
      if (fresh) {
        origin = sourceLine(from + i) + 1;
        fresh = false;
      }
      out += piece[i];
      if (piece[i] === "\n") {
        lines.push(origin);
        fresh = true;
      }
    }
  };
  for (const edit of edits) {
    if (edit.start < at) {
      if (edit.end <= at) continue;
      throw Error(file + ": overlapping edits at offset " + edit.start);
    }
    write(text.slice(at, edit.start), at);
    write(edit.text, edit.start);
    at = edit.end;
  }
  write(text.slice(at), at);
  return { text: out, lines, imports, jsonImports, exported, declared };
}

function templateIncludes(template) {
  const out = [];
  let place = null;
  for (const rawLine of template.split("\n")) {
    const line = rawLine.trim();
    if (/^<style(?:\s[^>]*)?>$/.test(line)) place = "style";
    else if (/^<script\s+id="kazohe-core"(?:\s[^>]*)?>$/.test(line))
      place = "kazohe-core";
    else if (/^<script\s+id="kazohe-app"(?:\s[^>]*)?>$/.test(line))
      place = "kazohe-app";
    else if (/^<script(?:\s[^>]*)?>$/.test(line)) place = "script";
    else if (line === "</script>" || line === "</style>") place = null;
    const m = rawLine.match(includeLine);
    if (!m) {
      if (directiveWord.test(rawLine))
        throw Error(templatePath + ": malformed directive: " + rawLine);
      continue;
    }
    out.push({
      kind: m[1],
      written: m[2],
      target: path.posix.normalize("src/" + m[2]),
      place,
    });
  }
  return out;
}

export function buildProduct({
  root = repositoryRoot,
  read = readText(root),
  list = listFiles(root),
} = {}) {
  const template = read(templatePath);
  requireLines(template, templatePath);
  const includes = templateIncludes(template),
    used = new Set();
  for (const { kind, target, written, place } of includes) {
    const allowedDir =
      sourceDirectories.includes(path.posix.dirname(target)) &&
      !written.endsWith("/");
    if (!allowedDir && target !== styleFile)
      throw Error(
        templatePath +
          ": include outside " +
          sourceDirectories.join(" or ") +
          " and " +
          styleFile +
          ": " +
          written,
      );
    if (used.has(target))
      throw Error(templatePath + ": included twice: " + target);
    if (path.posix.relative("src", target) !== written)
      throw Error(
        templatePath + ": include alias: " + written + " names " + target,
      );
    if (place === "style") {
      if (target !== styleFile || kind !== "include")
        throw Error(
          templatePath +
            ": " +
            written +
            ": <style> includes style.css with @include",
        );
    } else if (place === "kazohe-core") {
      if (!target.endsWith(".ts") || kind !== "core")
        throw Error(
          templatePath +
            ": " +
            written +
            ": #kazohe-core includes .ts modules with @core",
        );
    } else if (place === "kazohe-app") {
      if (!target.endsWith(".ts") || kind !== "include")
        throw Error(
          templatePath +
            ": " +
            written +
            ": #kazohe-app includes .ts modules with @include",
        );
    } else {
      throw Error(
        templatePath +
          ": " +
          written +
          ": directive outside <style>, #kazohe-core, or #kazohe-app",
      );
    }
    used.add(target);
  }
  const unused = [...sourceDirectories.flatMap(list), styleFile].filter(
    (file) => !used.has(file),
  );
  if (unused.length)
    throw Error("source files not included: " + unused.join(", "));
  const modules = new Map(),
    usedData = new Set();
  for (const { kind, target } of includes) {
    if (!target.endsWith(".ts")) continue;
    const text = read(target);
    const compiled = compileModule(text, target, { resolveJson: read });
    for (const j of compiled.jsonImports) {
      if (kind !== "core")
        throw Error(
          target + ":" + j.line + ": JSON data imports belong in @core modules",
        );
      usedData.add(j.target);
    }
    modules.set(target, { kind, ...compiled });
  }
  for (const dataFile of dataFiles)
    if (!usedData.has(dataFile))
      throw Error("data file not imported: " + dataFile);
  for (const [file, m] of modules) {
    for (const imp of m.imports) {
      if (!imp.from.startsWith("."))
        throw Error(
          file +
            ":" +
            imp.line +
            ": import from " +
            imp.from +
            ": only the product's own modules",
        );
      const target = resolveImport(file, imp.from);
      if (typeFile(target)) {
        if (imp.names.some((n) => !n.typeOnly))
          throw Error(
            file +
              ":" +
              imp.line +
              ": " +
              target +
              " holds types only: import from it with `import type`",
          );
        try {
          read(target);
        } catch {
          throw Error(
            file +
              ":" +
              imp.line +
              ": import from " +
              imp.from +
              ", which does not exist",
          );
        }
        continue;
      }
      if (!modules.has(target))
        throw Error(
          file +
            ":" +
            imp.line +
            ": import from " +
            imp.from +
            ", which the product does not include",
        );
      const into = modules.get(target);
      for (const { name, typeOnly } of imp.names) {
        const value = into.exported.some((x) => x.name === name && !x.type),
          type = into.exported.some((x) => x.name === name && x.type);
        if (!value && !type)
          throw Error(
            file + ":" + imp.line + ": " + target + " exports no " + name,
          );
        if (!typeOnly && value) {
          if (m.kind === "core" && into.kind !== "core")
            throw Error(
              file +
                ":" +
                imp.line +
                ": @core module imports " +
                name +
                " from non-@core module " +
                target,
            );
          if (
            m.kind === "include" &&
            into.kind === "core" &&
            !CORE_EXPORTS.includes(name)
          )
            throw Error(
              file +
                ":" +
                imp.line +
                ": #kazohe-app may only value-import " +
                CORE_EXPORTS.join(", ") +
                " from @core (got " +
                name +
                ")",
            );
        }
      }
    }
  }
  const coreOwner = new Map(),
    appOwner = new Map();
  for (const [file, m] of modules) {
    const owner = m.kind === "core" ? coreOwner : appOwner;
    for (const name of m.declared) {
      if (owner.has(name))
        throw Error(
          "top-level name " +
            name +
            " is declared by both " +
            owner.get(name) +
            " and " +
            file,
        );
      if (m.kind === "include" && CORE_EXPORTS.includes(name))
        throw Error(
          file + ": #kazohe-app cannot redeclare core export " + name,
        );
      owner.set(name, file);
    }
  }
  for (const name of CORE_EXPORTS)
    if (!coreOwner.has(name))
      throw Error("#kazohe-core does not declare required export " + name);

  let html = "",
    coreScript = "",
    appScript = "",
    inScript = null;
  const coreLines = [],
    appLines = [],
    sources = [templatePath, ...dataFiles];
  const emit = (file, text, lines) => {
    html += text;
    if (inScript === "core") {
      coreScript += text;
      for (const line of lines) coreLines.push({ file, line });
    } else if (inScript === "app") {
      appScript += text;
      for (const line of lines) appLines.push({ file, line });
    }
  };
  template
    .slice(0, -1)
    .split("\n")
    .forEach((row, i) => {
      const trimmed = row.trim();
      if (trimmed === "</script>") inScript = null;
      const m = row.match(includeLine);
      if (!m) {
        emit(templatePath, row + "\n", [i + 1]);
        if (/^<script\s+id="kazohe-core"(?:\s[^>]*)?>$/.test(trimmed))
          inScript = "core";
        else if (/^<script\s+id="kazohe-app"(?:\s[^>]*)?>$/.test(trimmed))
          inScript = "app";
        return;
      }
      const target = path.posix.normalize("src/" + m[2]);
      sources.push(target);
      if (target.endsWith(".css")) {
        const css = read(target);
        requireLines(css, target);
        emit(
          target,
          css,
          css
            .slice(0, -1)
            .split("\n")
            .map((_, k) => k + 1),
        );
        return;
      }
      const mod = modules.get(target);
      emit(target, mod.text, mod.lines);
    });

  const release = coreScript.match(releaseLine);
  if (!release) throw Error("APP_VERSION not found in #kazohe-core");
  const version = release[1];
  html = html.replaceAll("__KAZOHE_VERSION__", version);
  if (html.includes("__KAZOHE_VERSION__"))
    throw Error("unsubstituted __KAZOHE_VERSION__");

  for (const [label, script] of [
    ["#kazohe-core", coreScript],
    ["#kazohe-app", appScript],
  ]) {
    if (/<\/script/i.test(script))
      throw Error(
        label + ' holds "</script", which would end the script in the page',
      );
    try {
      new vm.Script(script, { filename: label + ".js" });
    } catch (error) {
      throw Error(label + " does not parse: " + error.message);
    }
  }
  return {
    version,
    file: filename(version),
    html,
    sources,
    coreScript,
    coreLines,
    appScript,
    appLines,
    coreModules: [...modules.entries()]
      .filter(([, m]) => m.kind === "core")
      .map(([f]) => f),
    appModules: [...modules.entries()]
      .filter(([, m]) => m.kind === "include")
      .map(([f]) => f),
  };
}

export function stampReleaseText(text, version = appVersion) {
  const name = filename(version);
  return text
    .replace(/Kazohe(?:_\d+_\d+_\d+)?\.html/g, name)
    .replace(
      /<!-- APP_VERSION -->.*?<!-- \/APP_VERSION -->/g,
      `<!-- APP_VERSION -->${version}<!-- /APP_VERSION -->`,
    );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const built = buildProduct();
  if (built.version !== appVersion)
    throw Error(
      `APP_VERSION (${built.version}) differs from package.json version (${appVersion})`,
    );
  const htmlName = built.file;
  const read = (p) => fs.readFileSync(path.join(repositoryRoot, p), "utf8");
  if (process.argv.includes("--check")) {
    assertCurrentArtifact();
    if (read(htmlName) !== built.html)
      throw Error(
        `${htmlName} differs from the local sources. Run npm run build.`,
      );
    for (const filePath of STAMPED_FILES)
      if (read(filePath) !== stampReleaseText(read(filePath), built.version))
        throw Error(`${filePath}: stale product reference`);
    console.log("Embedded HTML matches sources.");
  } else {
    fs.writeFileSync(path.join(repositoryRoot, htmlName), built.html);
    for (const name of fs.readdirSync(repositoryRoot))
      if (isProductHtml(name) && name !== htmlName)
        fs.unlinkSync(path.join(repositoryRoot, name));
    for (const filePath of STAMPED_FILES)
      fs.writeFileSync(
        path.join(repositoryRoot, filePath),
        stampReleaseText(read(filePath), built.version),
      );
    assertCurrentArtifact();
    console.log("Built " + htmlName);
  }
}
