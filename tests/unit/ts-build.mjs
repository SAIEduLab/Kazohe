/* SPDX-License-Identifier: MIT */
// Positive and negative controls for TypeScript config, type-erasure build, reverse line map,
// zero-`any` type checker, DOM page types, and data contract verification.
import assert from "node:assert/strict";
import fs from "node:fs";
import nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseJS } from "acorn";
import {
  buildProduct,
  compileModule,
  repositoryRoot,
} from "../../scripts/build.mjs";
import {
  productScript,
  lineMap,
  SOURCE_SIZE_LINES,
  sourceSizes,
  readSource,
  listSources,
} from "../../scripts/product-script.mjs";
import {
  PINNED_OPTIONS,
  tsconfigFindings,
  typeCheck,
  typeIssues,
} from "../../scripts/type-check.mjs";
import { pageTypes, repositoryPage } from "../../scripts/page-types.mjs";
import {
  verifyDataContracts,
  loadRepositoryContracts,
} from "../../scripts/data-contracts.mjs";
import { html as committedHtml } from "../../scripts/load-inline-core.mjs";
import { refusedWith } from "../../scripts/refusal.mjs";

const stripped = (text) =>
  nodeModule.stripTypeScriptTypes(text, { mode: "strip" });

function stripLocations(node) {
  if (Array.isArray(node)) return node.map(stripLocations);
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end" || key === "loc" || key === "raw")
      continue;
    out[key] = stripLocations(node[key]);
  }
  return out;
}

const programOf = (text) =>
  JSON.stringify(
    stripLocations(parseJS(text, { ecmaVersion: "latest", sourceType: "script" })),
    (_key, value) => (typeof value === "bigint" ? `${value}n` : value),
  );

function syntheticProject(overrides = {}) {
  const baseFiles = {
    "src/shell.html": [
      "<!doctype html>",
      '<html lang="ja">',
      "  <head>",
      "    <title>かぞへ v__KAZOHE_VERSION__</title>",
      "    <style>",
      "<!-- @include style.css -->",
      "    </style>",
      "  </head>",
      "  <body>",
      '    <main id="app"></main>',
      '    <script id="kazohe-core">',
      "const { KZLanguage, KZWritten, KZ, KZTeaching } = (() => {",
      '"use strict";',
      "<!-- @core ts/00-prelude.ts -->",
      "<!-- @core ts/01-core.ts -->",
      "return { KZLanguage, KZWritten, KZ, KZTeaching };",
      "})();",
      "    </script>",
      '    <script id="kazohe-app">',
      "(() => {",
      '"use strict";',
      "<!-- @include ts/10-app.ts -->",
      "})();",
      "    </script>",
      "  </body>",
      "</html>",
      "",
    ].join("\n"),
    "src/style.css": "body { margin: 0; }\n",
    "src/catalog.json": '[{"id":"G1-N01"}]\n',
    "src/language.json": '{"allocations":["一"],"readings":{}}\n',
    "src/ts/00-prelude.ts": [
      'import catalogJson from "../catalog.json" with { type: "json" };',
      'export const APP_VERSION = "0.2.7";',
      "export const CATALOG = catalogJson;",
      "",
    ].join("\n"),
    "src/ts/01-core.ts": [
      'import languageJson from "../language.json" with { type: "json" };',
      'import { APP_VERSION, CATALOG } from "./00-prelude.ts";',
      "export const KZLanguage = Object.freeze({ data: languageJson });",
      "export const KZWritten = Object.freeze({ ids: [] });",
      "export const KZTeaching = Object.freeze({ steps: (x: number): number => x });",
      "export const KZ = Object.freeze({ APP_VERSION, CATALOG });",
      "",
    ].join("\n"),
    "src/ts/10-app.ts": [
      'import { KZ, KZLanguage, KZWritten, KZTeaching } from "./01-core.ts";',
      "const summary = [KZ.APP_VERSION, KZLanguage.data, KZWritten.ids, KZTeaching.steps(1)];",
      "void summary;",
      "",
    ].join("\n"),
    ...overrides,
  };
  const read = (file) => {
    if (!Object.hasOwn(baseFiles, file)) throw Error("ENOENT: " + file);
    return baseFiles[file];
  };
  const list = (dir) =>
    Object.keys(baseFiles)
      .filter((f) => path.posix.dirname(f) === dir)
      .sort();
  return { read, list, files: baseFiles };
}

export function runTsBuildTests(check) {
  const typedSample = [
    'import type { ChallengeId } from "../types/contracts.d.ts";',
    "export interface Point { x: number; y: number; }",
    "export function size(value: string): number;",
    "export function size(value: string | readonly unknown[]): number {",
    "  return value.length;",
    "}",
    "export function first<T>(items: readonly T[], fallback?: T): T | undefined {",
    "  return (items[0] as T | undefined) ?? fallback!;",
    "}",
    "export class Counter implements Point {",
    "  declare x: number;",
    "  #count: number = 0;",
    "  protected readonly y: number = 1;",
    "  add(this: Counter, n: number): number { return this.#count += n * this.y; }",
    "}",
    "export const pick = <K extends keyof Point,>(p: Point, k: K): Point[K] => p[k];",
    "export const label = (id: ChallengeId): string => id;",
    "export const table = { a: 1 } satisfies Record<string, number>;",
    "",
  ].join("\n");

  check("ts-erase-matches-node", () => {
    const realModules = listSources("src/ts", repositoryRoot).filter((f) =>
      f.endsWith(".ts"),
    );
    assert.ok(realModules.length >= 1, "at least one .ts module exists");
    for (const file of realModules) {
      const text = readSource(file, repositoryRoot);
      assert.equal(
        programOf(compileModule(stripped(text), file).text),
        programOf(compileModule(text, file).text),
        file + ": erased AST must match Node stripTypeScriptTypes",
      );
    }
    assert.equal(
      programOf(compileModule(stripped(typedSample), "src/ts/sample.ts").text),
      programOf(compileModule(typedSample, "src/ts/sample.ts").text),
      "typedSample must match Node stripTypeScriptTypes",
    );
    const edgeSamples = [
      "export const later = async(x: number) => x;\n",
      "export function maker() { return(x: number) => x; }\n",
      "export const made = (o: { f(): { C: new () => object } }) => new (o.f().C as new () => object)();\n",
      "export const plain = (o: { C: new () => object }) => new (o.C as new () => object)();\n",
      'import catalogJson from "../catalog.json" with { type: "json" };\nexport const n: number = catalogJson.length;\n',
    ];
    for (const [i, sample] of edgeSamples.entries())
      assert.equal(
        programOf(compileModule(stripped(sample), "src/ts/edge.ts").text),
        programOf(compileModule(sample, "src/ts/edge.ts").text),
        "edge sample " + i,
      );
  });

  check("ts-reject-erase-mismatch", () => {
    const ours = compileModule(typedSample, "src/ts/sample.ts").text;
    assert.ok(ours.includes("this.#count += n * this.y"));
    assert.notEqual(
      programOf(compileModule(stripped(typedSample), "src/ts/sample.ts").text),
      programOf(ours.replace("this.#count += n * this.y", "this.#count += n")),
      "altered output must not match Node stripped AST",
    );
  });

  check("ts-reject-unerasable-syntax", () => {
    const compileBad = (code) => () => compileModule(code, "src/ts/bad.ts");
    assert.throws(
      compileBad("enum E { A = 1 }\n"),
      refusedWith({ message: /enum does not erase/ }),
    );
    assert.throws(
      compileBad("namespace N { export const x = 1; }\n"),
      refusedWith({ message: /namespace and module declarations/ }),
    );
    assert.throws(
      compileBad("class C { constructor(public x: number) {} }\n"),
      refusedWith({ message: /parameter properties do not erase/ }),
    );
    assert.throws(
      compileBad("@dec\nclass C {}\n"),
      refusedWith({ message: /decorators are not used/ }),
    );
    assert.throws(
      compileBad("const x = <number>1;\n"),
      refusedWith({ message: /use `value as Type`/ }),
    );
    assert.throws(
      compileBad("declare const x: number;\n"),
      refusedWith({ message: /"declare" makes no value/ }),
    );
    assert.throws(
      compileBad("declare function f(): void;\n"),
      refusedWith({ message: /"declare" makes no value/ }),
    );
    assert.throws(
      compileBad("class C { x: number; }\n"),
      refusedWith({ message: /class field without a value/ }),
    );
    assert.throws(
      compileBad("class C { #x!: number; }\n"),
      refusedWith({ message: /field declared with !/ }),
    );
    assert.throws(
      compileBad("const o = { f?() {} };\n"),
      refusedWith({ message: /optional method in an object/ }),
    );
    assert.throws(
      compileBad("var x = 1;\n"),
      refusedWith({ message: /var is not used at the top level/ }),
    );
    assert.throws(
      compileBad("const x = 1\n"),
      refusedWith({ message: /end the statement with ";"/ }),
    );
    assert.throws(
      compileBad("const s = 'a\u2028b';\n"),
      refusedWith({ message: /U\+2028 and U\+2029/ }),
    );
    assert.throws(
      compileBad("export default 1;\n"),
      refusedWith({ message: /export default/ }),
    );
    assert.throws(
      compileBad("export { x };\n"),
      refusedWith({ message: /export lists and re-exports/ }),
    );
    assert.throws(
      compileBad('import x from "./a.ts";\n'),
      refusedWith({ message: /default imports are not used/ }),
    );
    assert.throws(
      compileBad('import { a as b } from "./a.ts";\n'),
      refusedWith({ message: /an import renames/ }),
    );
    assert.throws(
      compileBad('import data from "../catalog.json";\n'),
      refusedWith({ message: /with \{ type: "json" \}/ }),
    );
    assert.throws(
      compileBad('import data from "../other.json" with { type: "json" };\n'),
      refusedWith({ message: /JSON import outside/ }),
    );
    assert.throws(
      compileBad("if (true) type T = number;\n"),
      refusedWith({ message: /where a block is not written/ }),
    );
  });

  check("ts-build-and-line-map", () => {
    const proj = syntheticProject();
    const ps = productScript(proj.read, proj.list);
    assert.equal(ps.built.version, "0.2.7");
    assert.equal(ps.built.file, "Kazohe_0_2_7.html");
    assert.ok(ps.built.html.includes("かぞへ v0.2.7"));
    assert.ok(!ps.built.html.includes("__KAZOHE_VERSION__"));

    const coreMap = lineMap(ps.core);
    const verOffset = ps.core.text.indexOf('const APP_VERSION = "0.2.7";');
    assert.ok(verOffset >= 0);
    assert.deepEqual(coreMap(verOffset), ["src/ts/00-prelude.ts", 2]);

    const appMap = lineMap(ps.app);
    const sumOffset = ps.app.text.indexOf("const summary =");
    assert.ok(sumOffset >= 0);
    assert.deepEqual(appMap(sumOffset), ["src/ts/10-app.ts", 2]);

    // Real repository productScript() + committed HTML character-exact verification
    const real = productScript();
    assert.equal(
      real.pieces.map((p) => real.text.slice(p.start, p.end)).join(""),
      real.text,
      "pieces must cover combined product script with 0 gaps",
    );
    const committedCore = committedHtml.match(
      /<script id="kazohe-core">\n([\s\S]*?) *<\/script>/,
    )?.[1];
    const committedApp = committedHtml.match(
      /<script id="kazohe-app">\n([\s\S]*?) *<\/script>/,
    )?.[1];
    assert.equal(
      real.core.text,
      committedCore,
      "productScript().core.text must match committed #kazohe-core body character-for-character",
    );
    assert.equal(
      real.app.text,
      committedApp,
      "productScript().app.text must match committed #kazohe-app body character-for-character",
    );
    const realCoreMap = lineMap(real.core);
    const realAppMap = lineMap(real.app);
    for (const [scriptObj, mapper, needle] of [
      [real.core, realCoreMap, "function validateBackup("],
      [real.core, realCoreMap, "function classify("],
      [real.app, realAppMap, "function render("],
      [real.app, realAppMap, "function divisionHook("],
    ]) {
      const idx = scriptObj.text.indexOf(needle);
      assert.ok(idx >= 0, "anchor present in built script: " + needle);
      const mapped = mapper(idx);
      assert.ok(mapped, "lineMap resolves anchor: " + needle);
      const [file, line] = mapped;
      const srcLine = readSource(file, repositoryRoot).split("\n")[line - 1];
      assert.ok(
        srcLine.includes(needle.replace("(", "")),
        `${file}:${line} must match anchor "${needle}", got: ${srcLine}`,
      );
    }

    // Check SOURCE-SIZE helper (positive and >2000-line negative control)
    const sizes = sourceSizes(proj.read, ["src/ts/00-prelude.ts"]);
    assert.equal(sizes[0].lines, 3);
    assert.ok(sizes[0].lines <= SOURCE_SIZE_LINES);
    const oversized = sourceSizes(
      () => "export const x = 1;\n".repeat(SOURCE_SIZE_LINES + 1),
      ["src/ts/99-too-big.ts"],
    );
    assert.ok(
      oversized.some((x) => x.lines > SOURCE_SIZE_LINES),
      "sourceSizes must detect modules exceeding SOURCE_SIZE_LINES",
    );
  });

  check("ts-reject-build-boundaries", () => {
    const base = syntheticProject().files;

    // Duplicate include
    assert.throws(
      () =>
        buildProduct(
          syntheticProject({
            "src/shell.html": base["src/shell.html"].replace(
              "<!-- @include ts/10-app.ts -->",
              "<!-- @include ts/10-app.ts -->\n<!-- @include ts/10-app.ts -->",
            ),
          }),
        ),
      refusedWith({ message: /included twice/ }),
    );

    // Unincluded source file
    assert.throws(
      () =>
        buildProduct(
          syntheticProject({
            "src/ts/99-orphan.ts": "export const orphan = 1;\n",
          }),
        ),
      refusedWith({ message: /source files not included/ }),
    );

    // Malformed directive
    assert.throws(
      () =>
        buildProduct(
          syntheticProject({
            "src/shell.html": base["src/shell.html"].replace(
              "<!-- @include ts/10-app.ts -->",
              "<!-- @include ts/10-app.ts -->\n<!-- @include bad --> extra",
            ),
          }),
        ),
      refusedWith({ message: /malformed directive/ }),
    );

    // Alias include
    assert.throws(
      () =>
        buildProduct(
          syntheticProject({
            "src/shell.html": base["src/shell.html"].replace(
              "<!-- @include ts/10-app.ts -->",
              "<!-- @include ./ts/10-app.ts -->",
            ),
          }),
        ),
      refusedWith({ message: /include alias/ }),
    );

    // Wrong tag placement (@include in #kazohe-core)
    assert.throws(
      () =>
        buildProduct(
          syntheticProject({
            "src/shell.html": base["src/shell.html"].replace(
              "<!-- @core ts/01-core.ts -->",
              "<!-- @include ts/01-core.ts -->",
            ),
          }),
        ),
      refusedWith({ message: /#kazohe-core includes \.ts modules with @core/ }),
    );

    // @core importing non-@core module
    assert.throws(
      () =>
        buildProduct(
          syntheticProject({
            "src/ts/01-core.ts":
              'import { helper } from "./10-app.ts";\nvoid helper;\n' +
              base["src/ts/01-core.ts"],
            "src/ts/10-app.ts":
              "export const helper = 1;\n" + base["src/ts/10-app.ts"],
          }),
        ),
      refusedWith({ message: /@core module imports helper from non-@core/ }),
    );

    // #kazohe-app importing internal @core symbol outside CORE_EXPORTS
    assert.throws(
      () =>
        buildProduct(
          syntheticProject({
            "src/ts/10-app.ts":
              'import { CATALOG } from "./00-prelude.ts";\nvoid CATALOG;\n' +
              base["src/ts/10-app.ts"],
          }),
        ),
      refusedWith({ message: /#kazohe-app may only value-import/ }),
    );

    // Duplicate top-level name in #kazohe-core
    assert.throws(
      () =>
        buildProduct(
          syntheticProject({
            "src/ts/01-core.ts":
              "const APP_VERSION = 'x';\nvoid APP_VERSION;\n" +
              base["src/ts/01-core.ts"],
          }),
        ),
      refusedWith({ message: /top-level name APP_VERSION is declared by both/ }),
    );

    // </script inside module string
    assert.throws(
      () =>
        buildProduct(
          syntheticProject({
            "src/ts/10-app.ts":
              'const bad = "</script>";\nvoid bad;\n' + base["src/ts/10-app.ts"],
          }),
        ),
      refusedWith({ message: /holds "<\/script"/ }),
    );
  });

  check("ts-type-check-pinned-options", () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, "tsconfig.json"), "utf8"),
    );
    assert.deepEqual(tsconfigFindings(raw), []);
    assert.ok(
      tsconfigFindings({
        ...raw,
        extends: "./other.json",
      }).some((f) => f.text === "extends"),
      "must reject extends",
    );
    assert.ok(
      tsconfigFindings({
        ...raw,
        compilerOptions: { ...PINNED_OPTIONS, strict: false },
      }).some((f) => f.text.startsWith("strict:")),
      "must reject strict: false",
    );
    assert.ok(
      tsconfigFindings({
        ...raw,
        compilerOptions: { ...PINNED_OPTIONS, skipLibCheck: true },
      }).some((f) => f.text.startsWith("skipLibCheck:")),
      "must reject extra skipLibCheck",
    );
  });

  check("ts-type-check-negative-controls", () => {
    const probe = (code, file = "src/ts/99-probe.ts") =>
      typeCheck(repositoryRoot, { [file]: code });

    const expectKind = (code, kind, file = "src/ts/99-probe.ts") => {
      const res = probe(code, file);
      assert.ok(
        res.anys.some((a) => a.kind === kind),
        `expected finding "${kind}" for:\n${code}\ngot: ${JSON.stringify(typeIssues(res))}`,
      );
    };

    expectKind("export const x: any = 1;\n", "any written");
    expectKind(
      "export const d = Object.getOwnPropertyDescriptor({}, 'a')?.value;\n",
      "a value of type any",
    );
    expectKind("export const m = new Map();\n", "a value whose type holds any");
    expectKind(
      "// @ts-ignore\nexport const x = 1;\n",
      "checking turned off",
    );
    expectKind(
      "// @ts-expect-error\nexport const x = 1;\n",
      "checking turned off",
    );
    expectKind(
      "// @ts-nocheck\nexport const x = 1;\n",
      "checking turned off",
    );
    expectKind(
      "export const x = 1 as unknown as string;\n",
      "a cast through unknown",
    );
    expectKind(
      "export const x = (1 as number | string) as string;\n",
      "a cast in steps",
    );
    expectKind(
      "export const x = undefined!;\n",
      "a non-null claim of nothing",
    );
    expectKind("export const x = (1 as never);\n", "a cast to never");
    expectKind(
      "export const x = ([] as never[]);\n",
      "a cast to never",
    );
    expectKind(
      "export function g(v: unknown): v is never { return false; }\n",
      "a type guard to never",
    );
    expectKind(
      "export function g<T>(v: unknown): v is T { return Boolean(v); }\n",
      "a type guard to a type parameter",
    );
    expectKind(
      "export function c<T>(v: unknown): T { return v as T; }\n",
      "a cast to a type parameter",
    );
    expectKind(
      "export const x = {} as { a: number };\n",
      "a literal cast to a type",
    );
    expectKind(
      "export const x = [] as [number];\n",
      "a literal cast to a type",
    );
    expectKind(
      "export const screen = 'menu';\n",
      "a top-level name that hides a global",
    );
    expectKind(
      "export const performance = 1;\n",
      "a top-level name that hides a global",
    );
    expectKind(
      "export const bad = 'ab'.replace(/a/, (_m: string, badNum: string) => badNum);\n",
      "a replacer parameter typed as what replace does not give",
    );
    expectKind(
      "export const s = JSON.stringify({ a: 1 }, (_k: string, v: string) => v);\n",
      "a parameter typed narrower than the any it is given",
    );
    expectKind(
      "interface Target { value?: string; }\nexport function f(d: PropertyDescriptor): Target { return d; }\n",
      "an any field given to a type",
    );
    expectKind(
      "export const el = document.getElementById('app');\n",
      "a DOM global used in #kazohe-core",
      "src/ts/09-core-probe.ts",
    );
    expectKind(
      "declare const mysteryGlobal: number;\n",
      "a global value declared that the page may not have",
      "src/types/bad-global.d.ts",
    );

    // Unincluded .ts file detection
    const rawCfg = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, "tsconfig.json"), "utf8"),
    );
    const badCfg = JSON.stringify({
      ...rawCfg,
      include: ["src/types/*.d.ts"],
    });
    const missingRes = typeCheck(repositoryRoot, { "tsconfig.json": badCfg });
    assert.ok(
      missingRes.anys.some(
        (a) => a.kind === "a TypeScript file missing from tsconfig include",
      ),
      "must report unincluded src/ts/*.ts files",
    );
  });

  check("ts-page-types-positive-and-negative", () => {
    const { html, sources } = repositoryPage(repositoryRoot);
    const generated = pageTypes(html, sources);
    const committed = readSource("src/types/page.d.ts", repositoryRoot);
    assert.equal(generated, committed);

    assert.throws(
      () => pageTypes('<div id="a"></div><div id="a"></div>', {}, []),
      refusedWith({ message: /two elements have the id a/ }),
    );
    assert.throws(
      () => pageTypes('<bogus id="x"></bogus>', {}, []),
      refusedWith({ message: /is no element of HTML/ }),
    );
    assert.throws(
      () =>
        pageTypes(
          '<div id="a"></div>',
          { "src/ts/10-x.ts": 'const n = $("#missing");\n' },
          [],
        ),
      refusedWith({
        message: /finds nothing in the page and is not in MADE_BY_SCRIPT/,
      }),
    );
    assert.throws(
      () =>
        pageTypes(
          '<div class="item"></div><div class="item"></div>',
          { "src/ts/10-x.ts": 'const n = $(".item");\n' },
          [],
        ),
      refusedWith({ message: /finds 2 elements of the page/ }),
    );
    assert.throws(
      () => pageTypes('<div id="a"></div>', {}, ["#unused"]),
      refusedWith({
        message: /MADE_BY_SCRIPT names "#unused", which no source writes/,
      }),
    );
    assert.throws(
      () =>
        pageTypes(
          '<div id="a"></div>',
          { "src/ts/10-x.ts": 'const n = $("#a");\n' },
          ["#a"],
        ),
      refusedWith({
        message: /MADE_BY_SCRIPT names "#a", which the page has/,
      }),
    );
  });

  check("ts-data-contracts-positive-and-negative", () => {
    const repo = loadRepositoryContracts(repositoryRoot);
    assert.deepEqual(verifyDataContracts(repo).issues, []);

    assert.ok(
      verifyDataContracts({
        ...repo,
        contractsText: repo.contractsText.replace('| "G6-C08"', ""),
      }).issues.some((i) => i.includes("ChallengeId: missing")),
      "must detect missing ChallengeId",
    );
    assert.ok(
      verifyDataContracts({
        ...repo,
        contractsText: repo.contractsText.replace("1 | 2 | 3 | 4 | 5 | 6", "1 | 2 | 3 | 4 | 5"),
      }).issues.some((i) => i.includes("Grade")),
      "must detect missing Grade",
    );
    assert.ok(
      verifyDataContracts({
        ...repo,
        contractsText: repo.contractsText.replace('"数" | "計算"', '"数"'),
      }).issues.some((i) => i.includes("Domain")),
      "must detect missing Domain",
    );

    const syntheticCore = {
      "src/ts/02-math.ts": [
        "function normalizeInput(spec) {",
        '  if (spec.type === "integer" || spec.type === "decimal") return {};',
        '  if (spec.type === "fraction" || spec.type === "quotient") return {};',
        '  if (spec.type === "common" || spec.type === "blocks") return {};',
        '  if (spec.type === "set" || spec.type === "compare" || spec.type === "parity") return {};',
        "}",
      ].join("\n"),
      "src/ts/07-run-and-save.ts": [
        "function validateBackup(text) {",
        '  only(obj, ["format","appVersion","schemaVersion","settings","bestRecords","recommendation","returnStack","practiceCheckpoint"]);',
        '  only(set, ["name","sound","effects","onboarded","config"]);',
        '  for (const k of ["displayN","presented","unshown","learningN","unansweredN","correctProblems","helpProblems","mistakeEvents","hintProblems","firstCorrectProblems","finalSelfCorrectProblems","repeatedWrongProblems","unansweredProblems","learningUnansweredCount"]) {}',
        "}",
      ].join("\n"),
    };
    assert.deepEqual(
      verifyDataContracts({ ...repo, coreSources: syntheticCore }).issues,
      [],
    );
    assert.ok(
      verifyDataContracts({
        ...repo,
        contractsText: repo.contractsText.replace('| "parity"', ""),
        coreSources: syntheticCore,
      }).issues.some((i) => i.includes("AnswerKind: missing")),
      "must detect missing AnswerKind",
    );
    assert.ok(
      verifyDataContracts({
        ...repo,
        contractsText: repo.contractsText.replace('| "practiceCheckpoint"', ""),
        coreSources: syntheticCore,
      }).issues.some((i) => i.includes("BackupTopKey: missing")),
      "must detect missing BackupTopKey",
    );
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let passed = 0;
  runTsBuildTests((id, fn) => {
    fn();
    passed++;
    console.log("PASS", id);
  });
  console.log("All " + passed + " ts-build checks passed.");
}
