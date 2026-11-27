/* SPDX-License-Identifier: MIT */
// Strict zero-`any` TypeScript checker for Kazohe's product modules (tsconfig.json: strict,
// erasable syntax only). Enforces zero compiler errors and zero unchecked escapes:
//   - pinned tsconfig.json options (no extends, no weakened/extra options, no unincluded .ts/.d.ts)
//   - explicit `any`, expressions/values of type `any` or `holdsAny`
//   - library `any` fields passed uncast to non-`any` targets
//   - library `any` callback params narrowed without `unknown`
//   - String.prototype.replace / replaceAll replacer param type mismatches
//   - @ts-ignore / @ts-expect-error / @ts-nocheck
//   - `as unknown as T` and multi-step casts (`x as A as B`)
//   - `!` non-null claim on always-null/undefined/void
//   - casts or type guards to `never` or types holding `never`
//   - type guards or casts to type parameters (`x is T`, `asserts x is T`, `x as T`)
//   - `{}` / `[]` literal casts claiming missing properties
//   - top-level names hiding browser/JS globals
//   - `.d.ts` declaring global values the page may not have
//   - DOM global references inside `#kazohe-core` modules
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let typescript = null;
const loadTypeScript = () => (typescript ??= require("typescript"));

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const PINNED_OPTIONS = Object.freeze({
  target: "es2023",
  lib: ["es2023", "dom", "dom.iterable"],
  module: "esnext",
  moduleResolution: "bundler",
  moduleDetection: "force",
  allowImportingTsExtensions: true,
  verbatimModuleSyntax: true,
  erasableSyntaxOnly: true,
  resolveJsonModule: true,
  noEmit: true,
  strict: true,
  noImplicitOverride: true,
  noFallthroughCasesInSwitch: true,
  types: [],
});

const CONFIG_KEYS = new Set([
  "compilerOptions",
  "include",
  "exclude",
  "files",
  "compileOnSave",
]);

const ALLOWED_GLOBAL_VALUE_DECLS = new Set([
  "clearTimeout",
  "clearInterval",
  "parseFloat",
]);

// Runtime globals explicitly injected into #kazohe-core's VM context (load-inline-core.mjs).
const CORE_ALLOWED_DOM_GLOBALS = new Set(["TextEncoder", "structuredClone"]);

const ITERATOR_TYPES = new Set([
  "Iterable",
  "Iterator",
  "IterableIterator",
  "IteratorObject",
  "AsyncIterable",
  "AsyncIterator",
  "AsyncIterableIterator",
  "AsyncIteratorObject",
  "Generator",
  "AsyncGenerator",
]);

export function tsconfigFindings(raw) {
  const findings = [],
    given = raw?.compilerOptions ?? {},
    add = (text) =>
      findings.push({
        file: "tsconfig.json",
        line: 1,
        kind: "compiler options other than the pinned ones",
        text,
      });
  for (const key of Object.keys(raw ?? {}))
    if (!CONFIG_KEYS.has(key)) add(key);
  for (const key of new Set([
    ...Object.keys(PINNED_OPTIONS),
    ...Object.keys(given),
  ]))
    if (JSON.stringify(given[key]) !== JSON.stringify(PINNED_OPTIONS[key]))
      add(key + ": " + JSON.stringify(given[key] ?? null));
  return findings;
}

function listWorkspaceTsFiles(root, files) {
  const found = new Set();
  const scan = (dir) => {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = dir + "/" + entry.name;
      if (entry.isDirectory()) scan(rel);
      else if (rel.endsWith(".ts")) found.add(rel);
    }
  };
  scan("src/ts");
  scan("src/types");
  for (const f of Object.keys(files))
    if (
      (f.startsWith("src/ts/") || f.startsWith("src/types/")) &&
      f.endsWith(".ts")
    )
      found.add(f);
  return [...found].sort();
}

export function typeProgram(root, files = {}) {
  const ts = loadTypeScript(),
    rel = (file) => path.relative(root, file).split(path.sep).join("/");
  const read = (file) =>
    Object.hasOwn(files, rel(file)) ? files[rel(file)] : ts.sys.readFile(file);
  const exists = (file) =>
    Object.hasOwn(files, rel(file)) || ts.sys.fileExists(file);
  const config = ts.readConfigFile(path.join(root, "tsconfig.json"), read);
  if (config.error)
    throw Error(
      "tsconfig.json: " +
        ts.flattenDiagnosticMessageText(config.error.messageText, " "),
    );
  const slash = (file) => file.replace(/\\/g, "/");
  const readDirectory = (dir, ...rest) => {
    const under = slash(dir).replace(/\/$/, "") + "/";
    const extra = Object.keys(files)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => slash(path.join(root, f)))
      .filter((f) => f.startsWith(under));
    return [
      ...new Set([...ts.sys.readDirectory(dir, ...rest).map(slash), ...extra]),
    ];
  };
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    { ...ts.sys, readFile: read, fileExists: exists, readDirectory },
    root,
  );
  if (parsed.errors.length)
    throw Error(
      "tsconfig.json: " +
        parsed.errors
          .map((e) => ts.flattenDiagnosticMessageText(e.messageText, " "))
          .join("; "),
    );
  const host = ts.createCompilerHost(parsed.options);
  host.readFile = read;
  host.fileExists = exists;
  return {
    program: ts.createProgram({
      rootNames: parsed.fileNames,
      options: parsed.options,
      host,
    }),
    rel,
    config: config.config,
  };
}

export function typeCheck(root = repositoryRoot, files = {}) {
  const ts = loadTypeScript(),
    { program, rel, config } = typeProgram(root, files),
    checker = program.getTypeChecker();
  const at = (sf, pos) => ({
    file: rel(sf.fileName),
    line: sf.getLineAndCharacterOfPosition(pos).line + 1,
  });
  const errors = ts.getPreEmitDiagnostics(program).map((d) => ({
    ...(d.file ? at(d.file, d.start ?? 0) : { file: "tsconfig.json", line: 0 }),
    code: d.code,
    message: ts.flattenDiagnosticMessageText(d.messageText, " "),
  }));
  const anys = tsconfigFindings(config);
  const own = program
    .getSourceFiles()
    .filter(
      (sf) =>
        !rel(sf.fileName).startsWith("..") &&
        !sf.fileName.includes("/node_modules/"),
    );
  const ownSet = new Set(own.map((sf) => rel(sf.fileName)));
  for (const expected of listWorkspaceTsFiles(root, files)) {
    if (!ownSet.has(expected))
      anys.push({
        file: "tsconfig.json",
        line: 1,
        kind: "a TypeScript file missing from tsconfig include",
        text: expected,
      });
  }
  const isCoreFile = (file) => /^src\/ts\/0\d-.*\.ts$/.test(file);

  for (const sf of own) {
    const file = rel(sf.fileName);
    const add = (node, kind) =>
      anys.push({
        ...at(sf, node.getStart(sf)),
        kind,
        text: node.getText(sf).replace(/\s+/g, " ").slice(0, 80),
      });
    const isAny = (node) =>
      !!(checker.getTypeAtLocation(node).flags & ts.TypeFlags.Any);
    const holdsAny = (type, depth = 0) => {
      if (depth > 3) return false;
      if (type.flags & ts.TypeFlags.Any) return depth > 0;
      if (type.isUnionOrIntersection())
        return type.types.some((t) => holdsAny(t, depth + 1));
      if (
        type.flags & ts.TypeFlags.Object &&
        type.objectFlags & ts.ObjectFlags.Reference
      )
        return checker
          .getTypeArguments(type)
          .slice(
            0,
            ITERATOR_TYPES.has(type.target?.symbol?.name) ? 1 : undefined,
          )
          .some((t) => holdsAny(t, depth + 1));
      return false;
    };
    const through = (node) =>
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node) ||
      ts.isCallExpression(node) ||
      ts.isNewExpression(node) ||
      ts.isAwaitExpression(node)
        ? node.expression
        : null;

    if (
      sf.isDeclarationFile &&
      file.startsWith("src/types/") &&
      !ts.isExternalModule(sf)
    )
      for (const statement of sf.statements)
        for (const name of ts.isFunctionDeclaration(statement) && statement.name
          ? [statement.name]
          : ts.isVariableStatement(statement)
            ? statement.declarationList.declarations
                .map((d) => d.name)
                .filter(ts.isIdentifier)
            : [])
          if (!ALLOWED_GLOBAL_VALUE_DECLS.has(name.text))
            anys.push({
              ...at(sf, name.getStart(sf)),
              kind: "a global value declared that the page may not have",
              text: name.text,
            });

    for (const m of sf
      .getFullText()
      .matchAll(/@ts-(?:ignore|expect-error|nocheck)\b/g))
      anys.push({
        ...at(sf, m.index),
        kind: "checking turned off",
        text: m[0],
      });

    if (!sf.isDeclarationFile && file.startsWith("src/ts/"))
      for (const statement of sf.statements)
        for (const name of topLevelNames(ts, statement))
          if (
            checker.resolveName(name.text, undefined, ts.SymbolFlags.Value, false)
          )
            add(name, "a top-level name that hides a global");

    const nothing = (type) =>
      !!(
        type.flags &
        (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)
      ) ||
      (type.isUnion() && type.types.every(nothing));
    const castStep = (n) =>
      ts.isAsExpression(n) ||
      ts.isSatisfiesExpression(n) ||
      ts.isNonNullExpression(n) ||
      ts.isParenthesizedExpression(n);
    const castStart = (n) => {
      let e = n.expression;
      while (castStep(e)) e = e.expression;
      return e;
    };
    const innerCasts = (n) => {
      const types = [];
      for (let e = n.expression; castStep(e); e = e.expression)
        if (ts.isAsExpression(e)) types.push(e.type);
      return types;
    };
    const holdsNever = (type, depth = 0) => {
      if (type.flags & ts.TypeFlags.Never) return true;
      if (depth > 3) return false;
      if (type.isUnionOrIntersection())
        return type.types.some((t) => holdsNever(t, depth + 1));
      if (!(type.flags & ts.TypeFlags.Object)) return false;
      if (type.objectFlags & ts.ObjectFlags.Reference)
        return checker
          .getTypeArguments(type)
          .some((t) => holdsNever(t, depth + 1));
      if (
        !(
          type.objectFlags &
          (ts.ObjectFlags.Anonymous | ts.ObjectFlags.Mapped)
        )
      )
        return false;
      return (
        checker
          .getPropertiesOfType(type)
          .some(
            (p) =>
              !(p.flags & ts.SymbolFlags.Optional) &&
              holdsNever(checker.getTypeOfSymbol(p), depth + 1),
          ) ||
        checker
          .getIndexInfosOfType(type)
          .some((info) => holdsNever(info.type, depth + 1)) ||
        type
          .getCallSignatures()
          .some((s) => holdsNever(s.getReturnType(), depth + 1))
      );
    };
    const lastStep = (n) => {
      let p = n.parent;
      while (ts.isParenthesizedExpression(p)) p = p.parent;
      return !(
        ts.isAsExpression(p) ||
        ts.isSatisfiesExpression(p) ||
        ts.isNonNullExpression(p)
      );
    };
    const isDomOnlyGlobal = (node) => {
      if (!ts.isIdentifier(node) || !isValueExpression(ts, node)) return false;
      if (CORE_ALLOWED_DOM_GLOBALS.has(node.text)) return false;
      const sym = checker.getSymbolAtLocation(node);
      if (!sym?.declarations?.length) return false;
      return sym.declarations.every((d) =>
        /lib\.dom(?:\.iterable)?\.d\.ts$/.test(
          d.getSourceFile().fileName.replace(/\\/g, "/"),
        ),
      );
    };

    const visit = (node) => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) add(node, "any written");
      else if (ts.isAsExpression(node) && !lastStep(node)) {
        /* judged at the last step */
      } else if (
        ts.isNonNullExpression(node) &&
        nothing(checker.getTypeAtLocation(node.expression))
      )
        add(node, "a non-null claim of nothing");
      else if (
        ts.isAsExpression(node) &&
        node.type.kind !== ts.SyntaxKind.UnknownKeyword &&
        innerCasts(node).some((t) => t.kind === ts.SyntaxKind.UnknownKeyword)
      )
        add(node, "a cast through unknown");
      else if (
        ts.isAsExpression(node) &&
        !ts.isConstTypeReference(node.type) &&
        innerCasts(node).some((t) => !ts.isConstTypeReference(t))
      )
        add(node, "a cast in steps");
      else if (
        ts.isAsExpression(node) &&
        node.type.kind !== ts.SyntaxKind.UnknownKeyword &&
        !ts.isConstTypeReference(node.type) &&
        (ts.isObjectLiteralExpression(castStart(node)) ||
          ts.isArrayLiteralExpression(castStart(node))) &&
        !checker.isTypeAssignableTo(
          checker.getTypeAtLocation(castStart(node)),
          checker.getTypeFromTypeNode(node.type),
        ) &&
        lacksProperties(ts, checker, castStart(node), node.type)
      )
        add(node, "a literal cast to a type");
      else if (
        !sf.isDeclarationFile &&
        isValueExpression(ts, node) &&
        isAny(node) &&
        !(through(node) && isAny(through(node)))
      )
        add(node, "a value of type any");
      else if (
        !sf.isDeclarationFile &&
        (ts.isNewExpression(node) ||
          ts.isCallExpression(node) ||
          ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node)) &&
        !isAny(node) &&
        holdsAny(checker.getTypeAtLocation(node)) &&
        !(through(node) && isAny(through(node)))
      )
        add(node, "a value whose type holds any");

      if (
        !sf.isDeclarationFile &&
        isCoreFile(file) &&
        isDomOnlyGlobal(node)
      )
        add(node, "a DOM global used in #kazohe-core");

      if (
        ts.isAsExpression(node) &&
        !ts.isConstTypeReference(node.type) &&
        holdsNever(checker.getTypeFromTypeNode(node.type))
      )
        add(node, "a cast to never");
      if (
        ts.isTypePredicateNode(node) &&
        node.type &&
        holdsNever(checker.getTypeFromTypeNode(node.type))
      )
        add(node, "a type guard to never");
      if (
        ts.isTypePredicateNode(node) &&
        node.type &&
        checker.getTypeFromTypeNode(node.type).flags &
          ts.TypeFlags.TypeParameter
      )
        add(node, "a type guard to a type parameter");
      if (
        ts.isAsExpression(node) &&
        checker.getTypeFromTypeNode(node.type).flags &
          ts.TypeFlags.TypeParameter
      )
        add(node, "a cast to a type parameter");

      if (
        !sf.isDeclarationFile &&
        ts.isExpression(node) &&
        !ts.isParenthesizedExpression(node.parent) &&
        !castContext(ts, node)
      ) {
        const target = checker.getContextualType(node),
          source =
            target && !(target.flags & ts.TypeFlags.Any)
              ? checker.getTypeAtLocation(node)
              : null;
        if (
          source &&
          !(source.flags & ts.TypeFlags.Any) &&
          anyFieldsGiven(ts, checker, source, target).length
        )
          add(node, "an any field given to a type");
      }

      const isReplace = (call) =>
        ts.isCallExpression(call) &&
        ts.isPropertyAccessExpression(call.expression) &&
        ["replace", "replaceAll"].includes(call.expression.name.text) &&
        call.arguments.length === 2;
      if (isReplace(node) && functionOf(ts, checker, node.arguments[1]))
        for (const param of replacerIssues(
          ts,
          checker,
          node.arguments[0],
          functionOf(ts, checker, node.arguments[1]),
        ))
          add(param, "a replacer parameter typed as what replace does not give");

      const givenAny = (fn, signature) =>
        fn.parameters.forEach((param, i) => {
          const given =
            param.type &&
            !param.dotDotDotToken &&
            signature?.parameters[i] &&
            checker.getTypeOfSymbolAtLocation(signature.parameters[i], fn);
          if (!given || !(given.flags & ts.TypeFlags.Any || holdsAny(given)))
            return;
          if (
            checker.typeToString(checker.getTypeFromTypeNode(param.type)) !==
            checker.typeToString(given).replace(/\bany\b/g, "unknown")
          )
            add(param, "a parameter typed narrower than the any it is given");
        });
      if (
        !sf.isDeclarationFile &&
        (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
        !(isReplace(node.parent) && node.parent.arguments[1] === node)
      )
        givenAny(
          node,
          checker
            .getContextualType(node)
            ?.getNonNullableType()
            .getCallSignatures()[0],
        );
      if (!sf.isDeclarationFile && ts.isCallExpression(node) && !isReplace(node))
        for (const arg of node.arguments)
          if (ts.isIdentifier(arg) && functionOf(ts, checker, arg))
            givenAny(
              functionOf(ts, checker, arg),
              checker
                .getContextualType(arg)
                ?.getNonNullableType()
                .getCallSignatures()[0],
            );

      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { files: own.map((sf) => rel(sf.fileName)), errors, anys };
}

function castContext(ts, node) {
  let p = node.parent;
  while (ts.isParenthesizedExpression(p)) p = p.parent;
  return ts.isAsExpression(p);
}

function anyFieldsGiven(ts, checker, source, target) {
  const members = (t) => (t.isUnion() ? t.types : [t]),
    any = (t) => !!(t.flags & ts.TypeFlags.Any),
    found = new Set();
  for (const s of members(source)) {
    if (!(s.flags & ts.TypeFlags.Object)) continue;
    const into = members(target).filter(
      (t) => t.flags & ts.TypeFlags.Object && checker.isTypeAssignableTo(s, t),
    );
    for (const p of checker.getPropertiesOfType(s)) {
      if (p.flags & ts.SymbolFlags.Method || !any(checker.getTypeOfSymbol(p)))
        continue;
      const fields = into.map((t) => checker.getPropertyOfType(t, p.name));
      if (
        fields.length &&
        fields.every((q) => q && !any(checker.getTypeOfSymbol(q)))
      )
        found.add(p.name);
    }
  }
  return [...found];
}

function functionOf(ts, checker, node) {
  while (node && ts.isParenthesizedExpression(node)) node = node.expression;
  if (node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)))
    return node;
  const declaration =
    node && ts.isIdentifier(node)
      ? checker.getSymbolAtLocation(node)?.valueDeclaration
      : null;
  if (
    declaration &&
    ts.isFunctionDeclaration(declaration) &&
    declaration.body
  )
    return declaration;
  let value =
    declaration && ts.isVariableDeclaration(declaration)
      ? declaration.initializer
      : null;
  while (value && ts.isParenthesizedExpression(value)) value = value.expression;
  return value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
    ? value
    : null;
}

function replacerIssues(ts, checker, pattern, replacer) {
  const groups = ts.isRegularExpressionLiteral(pattern)
    ? regexGroups(pattern.text.slice(1, pattern.text.lastIndexOf("/")))
    : ts.isStringLiteralLike(pattern)
      ? []
      : null;
  const holds = (param, flag) => {
    const t = checker.getTypeFromTypeNode(param.type);
    return (t.isUnion() ? t.types : [t]).some((m) => m.flags & flag);
  };
  const text = ts.TypeFlags.StringLike,
    number = ts.TypeFlags.NumberLike,
    none = ts.TypeFlags.Undefined;
  return replacer.parameters.filter((param, i) => {
    if (!param.type || param.dotDotDotToken) return false;
    if (i === 0) return !holds(param, text);
    if (!groups) return !holds(param, text) && !holds(param, number);
    if (i <= groups.length)
      return (
        !holds(param, text) || (groups[i - 1].optional && !holds(param, none))
      );
    if (i === groups.length + 1) return !holds(param, number);
    if (i === groups.length + 2) return !holds(param, text);
    return !(i === groups.length + 3 && /\(\?<(?![=!])/.test(pattern.text));
  });
}

function regexGroups(source) {
  const groups = [],
    open = [{ alt: false, own: null }];
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "[") {
      for (i++; i < source.length && source[i] !== "]"; i++)
        if (source[i] === "\\") i++;
      continue;
    }
    if (c === "(") {
      const capturing =
        source[i + 1] !== "?" ||
        (source[i + 2] === "<" && !"=!".includes(source[i + 3]));
      const group = capturing ? { optional: false } : null;
      if (group) groups.push(group);
      open.push({ alt: false, own: group, inner: groups.length });
    } else if (c === "|") open.at(-1).alt = true;
    else if (c === ")" && open.length > 1) {
      const level = open.pop(),
        next = source.slice(i + 1);
      const quantified = /^(?:[?*]|\{0[,}])/.test(next);
      for (const g of groups.slice(level.inner - (level.own ? 1 : 0)))
        if (quantified || (level.alt && g !== level.own)) g.optional = true;
    }
  }
  if (open[0].alt) for (const g of groups) g.optional = true;
  return groups;
}

function topLevelNames(ts, statement) {
  if (
    (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
    statement.name
  )
    return [statement.name];
  if (!ts.isVariableStatement(statement)) return [];
  const names = [],
    bind = (n) => {
      if (ts.isIdentifier(n)) names.push(n);
      else
        for (const e of n.elements)
          if (!ts.isOmittedExpression(e)) bind(e.name);
    };
  for (const d of statement.declarationList.declarations) bind(d.name);
  return names;
}

function lacksProperties(ts, checker, literal, typeNode) {
  if (
    !ts.isObjectLiteralExpression(literal) ||
    literal.properties.some((p) => ts.isSpreadAssignment(p))
  )
    return true;
  const written = new Set(
    literal.properties.map((p) =>
      (p.name && ts.isIdentifier(p.name)) ||
      (p.name && ts.isStringLiteral(p.name))
        ? p.name.text
        : null,
    ),
  );
  const target = checker.getTypeFromTypeNode(typeNode),
    members = target.isUnion() ? target.types : [target];
  return !members.some((member) =>
    checker
      .getPropertiesOfType(member)
      .every((p) => p.flags & ts.SymbolFlags.Optional || written.has(p.name)),
  );
}

function isValueExpression(ts, node) {
  if (
    ts.isCallExpression(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node) ||
    ts.isNewExpression(node) ||
    ts.isAwaitExpression(node)
  )
    return true;
  if (!ts.isIdentifier(node)) return false;
  const parent = node.parent;
  if (ts.isTypeNode(parent)) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node)
    return false;
  if (
    ts.isTypeReferenceNode(parent) ||
    ts.isQualifiedName(parent) ||
    ts.isTypeQueryNode(parent) ||
    ts.isImportSpecifier(parent) ||
    ts.isLabeledStatement(parent) ||
    ts.isBreakOrContinueStatement(parent)
  )
    return false;
  if (
    "name" in parent &&
    parent.name === node &&
    !ts.isShorthandPropertyAssignment(parent)
  )
    return false;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  return true;
}

export function typeIssues({ errors, anys }) {
  return [
    ...errors.map(
      (e) => e.file + ":" + e.line + " TS" + e.code + " " + e.message,
    ),
    ...anys.map((a) => a.file + ":" + a.line + " " + a.kind + ": " + a.text),
  ];
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = typeCheck(repositoryRoot);
  const issues = typeIssues(result);
  if (issues.length) {
    for (const line of issues) console.error(line);
    process.exitCode = 1;
  } else {
    console.log(
      "type-check PASS (" + result.files.length + " files, 0 errors, 0 findings)",
    );
  }
}
