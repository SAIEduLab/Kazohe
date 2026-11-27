// Comprehensive positive and negative control tests for:
// - scripts/source-consistency.mjs
// - scripts/source-lint.mjs
// - scripts/source-clones.mjs
// - scripts/release-policy.mjs
// - scripts/test-map.mjs
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  dispatchValueIssues,
  DISPATCH_ALLOWED,
  domReferenceIssues,
  platformNames,
  jsonObjectKeys,
  unwrittenReads,
  unwrittenIssues,
  UNWRITTEN_ALLOWED,
  shownTextReads,
  shownTextIssues,
  SHOWN_TEXT_BASELINE,
  productCodes,
  namedCodes,
  diagnosticCodeIssues,
  childGlossaryIssues,
} from "../../scripts/source-consistency.mjs";
import {
  lintText,
  lintCoreScript,
  lintAppScript,
  lintFindings,
  verifyLintProbes,
} from "../../scripts/source-lint.mjs";
import {
  sourceClones,
  cloneIssues,
  CLONE_BASELINE,
} from "../../scripts/source-clones.mjs";
import {
  releasePolicyIssues,
  assertReleasePolicy,
  fileNameIssues,
  functionalNameIssues,
} from "../../scripts/release-policy.mjs";
import { testMap } from "../../scripts/test-map.mjs";
import { coreSource, K, Language, Written } from "../../scripts/load-inline-core.mjs";
import { refusedWith } from "../../scripts/refusal.mjs";

const root = process.cwd();

export function runSourceConsistencyControls() {
  // 1. Dispatch values: negative & positive controls + stale allowance rejection.
  const baseScript = [
    "const item = { kind: 'written', mode: 'practice', status: 'ok' };",
    "if (item.kind === 'written') void 0;",
    "switch (item.mode) { case 'practice': break; }",
    "if (['ok'].includes(item.status)) void 0;",
  ].join("\n");
  assert.deepEqual(dispatchValueIssues(baseScript, []), []);
  assert.ok(
    dispatchValueIssues(
      `${baseScript}\nif (item.op === 'NeverWrittenOp') {}\n`,
      [],
    ).some((i) => i.includes("op === 'NeverWrittenOp'")),
  );
  assert.ok(
    dispatchValueIssues(
      `${baseScript}\nswitch (item.screen) { case 'NeverWrittenScreen': break; }\n`,
      [],
    ).some((i) => i.includes("NeverWrittenScreen")),
  );
  assert.ok(
    dispatchValueIssues(
      `${baseScript}\nif (['NeverWrittenRole'].includes(item.role)) {}\n`,
      [],
    ).some((i) => i.includes("NeverWrittenRole")),
  );
  assert.ok(
    dispatchValueIssues(
      `${baseScript}\nif (item?.action === 'NeverWrittenAction') {}\n`,
      [],
    ).some((i) => i.includes("NeverWrittenAction")),
  );
  assert.deepEqual(
    dispatchValueIssues(
      `${baseScript}\nconst made = { kind: 'MadeHere' }; if (made.kind === 'MadeHere') {}\n`,
      [],
    ),
    [],
  );
  assert.deepEqual(
    dispatchValueIssues(
      `${baseScript}\nif (audio.state === 'suspended') {}\n`,
      [{ property: "state", value: "suspended", reason: "browser AudioContext state" }],
    ),
    [],
  );
  assert.ok(
    dispatchValueIssues(baseScript, [
      ...DISPATCH_ALLOWED,
      { property: "kind", value: "GoneKind", reason: "stale test allowance" },
    ]).some((i) => i.includes("allowance kind 'GoneKind'")),
  );

  // 2. DOM references: 5 negative probes + 4 positive probes.
  const pageHtml =
    '<!doctype html><main id="app" data-shell-ready="1"></main><dialog id="dialog"></dialog>';
  const cleanDom =
    "document.getElementById('app'); document.querySelector('#dialog'); document.querySelector('[data-shell-ready]');";
  assert.deepEqual(domReferenceIssues(cleanDom, pageHtml), []);
  const domNegativeProbes = [
    ["document.getElementById('neverGivenId');", "element id neverGivenId"],
    [
      "document.querySelector('#neverGivenSel .x');",
      "element id neverGivenSel",
    ],
    ["el.dataset.neverWritten;", "data-never-written"],
    ["el.closest('[data-never-matched]');", "data-never-matched"],
    ["el.getAttribute('data-never-read');", "data-never-read"],
  ];
  for (const [line, expected] of domNegativeProbes) {
    assert.ok(
      domReferenceIssues(`${cleanDom}\n${line}\n`, pageHtml).some((i) =>
        i.includes(expected),
      ),
      `expected DOM negative probe to flag ${expected}: ${line}`,
    );
  }
  const domPositiveProbes = [
    "el.dataset.madeHere = '1'; void el.dataset.madeHere;",
    "make('p', { 'data-made-attr': 1 }); void el.dataset.madeAttr;",
    "make('p', { [cond ? 'data-made-a' : 'data-made-b']: 1 }); void el.dataset.madeB;",
    "box.innerHTML = '<p id=\"madeInMarkup\"></p>'; document.getElementById('madeInMarkup');",
  ];
  for (const line of domPositiveProbes) {
    assert.deepEqual(
      domReferenceIssues(`${cleanDom}\n${line}\n`, pageHtml),
      [],
      `expected DOM positive probe to pass: ${line}`,
    );
  }

  // 3. Unwritten properties: negative, positive (written, platform, dataset, json), stale allowance.
  const platform = platformNames();
  assert.ok(platform.has("textContent") && platform.has("addEventListener"));
  const dataKeys = jsonObjectKeys({ challengeField: 1, nested: { readingKey: "a" } });
  const checkUnwritten = (code, allowed = []) =>
    unwrittenIssues(unwrittenReads(code, dataKeys), platform, allowed);
  assert.ok(
    checkUnwritten("function f(o) { return o.misspeltPropertyName; }").some(
      (i) => i.includes(".misspeltPropertyName but nothing"),
    ),
  );
  assert.deepEqual(
    checkUnwritten(
      "function f(o) { o.writtenHere = 1; return o.writtenHere + o.textContent.length + o.challengeField + o.readingKey; }",
    ),
    [],
  );
  assert.deepEqual(
    checkUnwritten(
      "function f(el) { el.setAttribute('data-probe-flag', '1'); return el.dataset.probeFlag; }",
    ),
    [],
  );
  assert.ok(
    checkUnwritten("function f(o) { return o.textContent; }", [
      { name: "goneAllowanceName", reason: "stale test" },
    ]).some((i) => i.startsWith("allowance goneAllowanceName is stale")),
  );
  assert.ok(
    checkUnwritten("function f(o) { return o.textContent; }", [
      { name: "textContent", reason: "already on platform" },
    ]).some((i) => i.startsWith("allowance textContent is stale")),
  );
  assert.ok(Array.isArray(UNWRITTEN_ALLOWED));

  // 4. Shown text branching: 7 negative probes + stale baseline rejection.
  const shownProbes = [
    "if (el.textContent === 'もういちど') retry();",
    "if (el.innerText.startsWith('たしかめ')) stop();",
    "if (['はい', 'いいえ'].includes(el.textContent)) go();",
    "if (el.textContent.trim() === 'もういちど') retry();",
    "function f(el) { const said = el.innerText; return said === 'はい'; }",
    "switch (el.textContent) { case 'はい': go(); }",
    "function g(el, ok) { const unit = ok ? el.textContent.trim() : ''; return unit.startsWith('こ'); }",
  ];
  for (const line of shownProbes) {
    assert.ok(
      shownTextIssues(
        shownTextReads(line, () => "probe.ts"),
        SHOWN_TEXT_BASELINE,
      ).some((i) => i.startsWith("probe.ts decides by shown text")),
      `expected shown-text probe to fail: ${line}`,
    );
  }
  assert.deepEqual(
    shownTextIssues(
      shownTextReads("el.textContent = 'こたえ';", () => "probe.ts"),
      [],
    ),
    [],
  );
  assert.ok(
    shownTextIssues([], [{ file: "src/ts/x.ts", source: "el.textContent === 'a'" }]).some(
      (i) => i.includes("is gone"),
    ),
  );

  // 5. Diagnostic codes named: extraction, unnamed refusal, stale baseline refusal.
  const extracted = productCodes(
    "function check() { if (a) throw Error('入力をたしかめてね。'); return { reason: 'natural-timeout' }; }",
  );
  assert.ok(extracted.has("入力をたしかめてね。"));
  assert.ok(extracted.has("natural-timeout"));
  const named = namedCodes(extracted, ["assert.throws(fn, /入力をたしかめてね。/);"]);
  assert.ok(
    diagnosticCodeIssues(extracted, named, []).some((i) =>
      i.includes('raises "natural-timeout"'),
    ),
  );
  assert.deepEqual(diagnosticCodeIssues(extracted, named, ["natural-timeout"]), []);
  assert.ok(
    diagnosticCodeIssues(extracted, named, ["入力をたしかめてね。"]).some((i) =>
      i.includes("a test file names it now"),
    ),
  );
  assert.ok(
    diagnosticCodeIssues(extracted, named, ["dropped-code"]).some((i) =>
      i.includes("no longer has it"),
    ),
  );

  // 6. Child glossary: banned words in script strings, templates, markup; comments ignored.
  const glossaryHits = (files) =>
    childGlossaryIssues(files)
      .map((i) => i.word)
      .sort();
  assert.deepEqual(
    glossaryHits([
      {
        file: "probe.js",
        kind: "script",
        text: "// スコア と リセット\nconst a = 'スコアを表示', b = `インポートと${x}`, c = 'Score';",
      },
    ]),
    ["インポート", "スコア"],
  );
  assert.deepEqual(
    glossaryHits([
      {
        file: "probe.html",
        kind: "html",
        text: '<!-- リトライ --><p>キャンセルしますか</p><button aria-label="エクスポート">x</button><script>const g = "リセット";</script>',
      },
    ]),
    ["エクスポート", "キャンセル"],
  );
  assert.deepEqual(
    glossaryHits([
      {
        file: "clean.html",
        kind: "product",
        text: '<p>JSONを読みこむ</p><script>const ok = "もういちど";</script>',
      },
    ]),
    [],
  );
}

export async function runSourceLintControls() {
  // 1. Every rule in LINT_RULES must reject its probe in LINT_PROBES.
  assert.deepEqual(await verifyLintProbes(root), []);

  // 2. noInlineConfig: inline eslint-disable comments must NOT silence findings.
  const suppressed = await lintText(
    root,
    "/* eslint-disable no-undef */\nstillUndefined();\n",
    { kind: "core" },
  );
  assert.ok(
    suppressed.some((m) => m.ruleId === "no-undef"),
    "noInlineConfig must reject inline eslint-disable",
  );

  // 3. Core globals isolation: DOM globals like document are rejected in #kazohe-core.
  const coreDomLeak = await lintCoreScript(
    root,
    "const KZ = 1, KZLanguage = 1, KZWritten = 1, KZTeaching = 1;\ndocument.getElementById('app');\n",
  );
  assert.ok(
    coreDomLeak.some(
      (m) => m.ruleId === "no-undef" && m.message.includes("'document'"),
    ),
    "#kazohe-core must forbid DOM globals",
  );

  // 4. Core exports verification: missing KZLanguage triggers no-undef in lintCoreScript.
  const coreMissingExport = await lintCoreScript(
    root,
    "const KZ = 1, KZWritten = 1, KZTeaching = 1;\n",
  );
  assert.ok(
    coreMissingExport.some(
      (m) => m.ruleId === "no-undef" && m.message.includes("'KZLanguage'"),
    ),
  );

  // 5. App closed globals: unlisted browser globals (alert) are rejected in #kazohe-app.
  const appUnlisted = await lintAppScript(root, "alert('nope');\n");
  assert.ok(
    appUnlisted.some(
      (m) => m.ruleId === "no-undef" && m.message.includes("'alert'"),
    ),
  );

  // 6. Line mapping back to src/ts/<file>:<line>.
  const mapped = lintFindings(appUnlisted, {
    lines: [{ file: "src/ts/12-app-main.ts", line: 42 }],
  });
  assert.ok(
    mapped.some((m) => m.startsWith("src/ts/12-app-main.ts:42 no-undef ")),
    `expected mapped finding, got: ${mapped.join("; ")}`,
  );
}

export function runSourceClonesControls() {
  const repeatedBlock = Array.from(
    { length: 22 },
    (_, i) => `  acc = (acc + x * ${i + 1}) % 997;`,
  ).join("\n");
  const cleanText = `function computeFirst(x) {\n  let acc = 0;\n${repeatedBlock}\n  return acc;\n}\n`;
  const linesOf = (text) =>
    text
      .split("\n")
      .slice(0, -1)
      .map((_, i) => ({ file: "src/ts/probe.ts", line: i + 1 }));

  assert.deepEqual(
    cloneIssues(sourceClones({ text: cleanText, lines: linesOf(cleanText) }), []),
    [],
  );

  const dupText =
    cleanText +
    cleanText.replace("computeFirst", "computeSecond");
  const dupClones = sourceClones({ text: dupText, lines: linesOf(dupText) });
  assert.equal(dupClones.length, 1);
  assert.ok(dupClones[0].length >= 100);
  assert.ok(
    cloneIssues(dupClones, []).some((i) => i.startsWith("clone ")),
  );

  // Comment-invariance: differing comments inside the second copy produce the same clone id & length.
  const commentedDup =
    cleanText +
    cleanText
      .replace("computeFirst", "computeSecond")
      .replace("let acc = 0;", "let acc = 0; // comment only here\n  /* block comment */");
  const commentedClones = sourceClones({
    text: commentedDup,
    lines: linesOf(commentedDup),
  });
  assert.deepEqual(
    commentedClones.map((c) => [c.id, c.length]),
    dupClones.map((c) => [c.id, c.length]),
  );

  // Stale baseline entry rejection.
  assert.ok(
    cloneIssues([], [
      ...CLONE_BASELINE,
      { id: "0000000000000000", what: "removed repetition" },
    ]).some((i) => i.includes("0000000000000000")),
  );
}

export function runReleasePolicyControls() {
  const validHtml = [
    '<script id="kazohe-core">',
    'const APP_VERSION = "0.2.7";',
    'const VERSION = "0.2";',
    'const STORAGE_KEY = "kazohe:v0.2:state";',
    "function checkSave(obj) { return obj.appVersion === VERSION; }",
    "const KZ = Object.freeze({ APP_VERSION, VERSION, STORAGE_KEY, checkSave });",
    "</script>",
    '<script id="kazohe-app">',
    "function boot() { return KZ.VERSION; }",
    "</script>",
  ].join("\n");

  const validAudit = [
    {
      file: "scripts/sample.mjs",
      source:
        "function verifyFormatCompatibility() {} function base64Decode() {} const obj = { checkSaveContract: () => true };",
    },
  ];
  assertReleasePolicy(validHtml, {
    auditSources: validAudit,
    tcIds: ["TC-M01", "TC-D01"],
    gateIds: ["SOURCE-DISPATCH-VALUES", "SOURCE-LINT"],
    trackedFiles: [
      "Kazohe_0_2_7.html",
      "src/ts/00-prelude.ts",
      "tests/fixtures/v0.2.4-backup.json",
    ],
    productLabel: "Kazohe_0_2_7.html",
  });

  const expectRejected = (html, opts, pattern, label) => {
    const issues = releasePolicyIssues(html, {
      productLabel: "Kazohe_0_2_7.html",
      ...opts,
    });
    assert.ok(
      issues.some((i) => pattern.test(i)),
      `${label}: expected match for ${pattern}, got: ${issues.join(" | ")}`,
    );
  };

  // Version-derived identifiers in product & audit (short math vars v0/v1 stay allowed).
  assert.deepEqual(
    releasePolicyIssues(
      validHtml.replace("</script>", "function pair(a, b) { const v0 = a, v1 = b; return v0 + v1; }\n</script>"),
      { productLabel: "Kazohe_0_2_7.html" },
    ),
    [],
  );
  for (const bad of ["restoreV024", "v024", "v0_2", "runVersion02Tests", "parseRelease026", "runCore026Tests"]) {
    expectRejected(
      validHtml.replace("</script>", `function ${bad}() {}\n</script>`),
      {},
      /release-derived identifier/,
      `product ${bad}`,
    );
    expectRejected(
      validHtml,
      { auditSources: [{ file: "scripts/bad.mjs", source: `function ${bad}() {}` }] },
      /release-derived identifier/,
      `audit ${bad}`,
    );
  }

  // Past-process identifiers in product, audit callables, TC/gate IDs, and file names.
  for (const bad of ["phase2Check", "repair1Fix", "loadDevSession", "verifyFollowup", "checkFormat2", "run_commit_a1b2c3d"]) {
    expectRejected(
      validHtml.replace("</script>", `function ${bad}() {}\n</script>`),
      {},
      /past-process identifier/,
      `product ${bad}`,
    );
    expectRejected(
      validHtml,
      { auditSources: [{ file: "scripts/bad.mjs", source: `const ${bad} = () => {};` }] },
      /past-process identifier/,
      `audit ${bad}`,
    );
  }

  assert.ok(
    functionalNameIssues("TC ID", ["TC-M01", "v024-check", "phase-2-gate"]).length === 2,
  );
  assert.ok(
    fileNameIssues(["scripts/repair-1.mjs", "tests/unit/v0.2.5-check.mjs", "tests/fixtures/v0.2.4-backup.json"]).length === 2,
  );

  // Copied x.y.z release literals (string and template).
  expectRejected(
    validHtml.replace("</script>", 'function x() { return "0.2.7"; }\n</script>'),
    {},
    /copied release literal/,
    "copied string literal",
  );
  expectRejected(
    validHtml.replace("</script>", "function x() { return `0.2.7`; }\n</script>"),
    {},
    /copied release literal/,
    "copied template literal",
  );

  // Runtime reads / comparisons / aliasing / member access / destructuring of APP_VERSION.
  expectRejected(
    validHtml.replace("</script>", 'function x() { return APP_VERSION === "0.2"; }\n</script>'),
    {},
    /must not be read, compared, or branched on/,
    "APP_VERSION comparison",
  );
  expectRejected(
    validHtml.replace("</script>", "function x() { const v = APP_VERSION; return v; }\n</script>"),
    {},
    /must not be read, compared, or branched on/,
    "APP_VERSION alias",
  );
  expectRejected(
    validHtml.replace("</script>", "function x() { return KZ.APP_VERSION; }\n</script>"),
    {},
    /cannot be read back through a property access/,
    "KZ.APP_VERSION property read",
  );
  expectRejected(
    validHtml.replace("</script>", "function x() { return KZ[`APP_VERSION`]; }\n</script>"),
    {},
    /cannot be read back through a property access/,
    "KZ[`APP_VERSION`] template read",
  );
  expectRejected(
    validHtml.replace("</script>", "function x() { const { APP_VERSION: v } = KZ; return v; }\n</script>"),
    {},
    /cannot be read through destructuring/,
    "APP_VERSION destructuring",
  );

  // Missing or duplicate APP_VERSION declaration.
  expectRejected(
    validHtml.replace('const APP_VERSION = "0.2.7";', 'const APP_VERSION = "0.2.7";\nconst PRODUCT_RELEASE = "0.2.7";'),
    {},
    /expected one APP_VERSION\/PRODUCT_RELEASE declaration, found 2/,
    "duplicate release declaration",
  );
  assert.throws(
    () =>
      assertReleasePolicy(
        validHtml.replace('const APP_VERSION = "0.2.7";', "").replace("APP_VERSION, ", ""),
        { productLabel: "Kazohe_0_2_7.html" },
      ),
    refusedWith({
      message: /expected one APP_VERSION\/PRODUCT_RELEASE declaration, found 0/,
    }),
  );
}

export async function runTestMapControls() {
  // Verify testMap hits core spans with offsetDelta alignment and routes #kazohe-app to e2e.
  const teachingStart = coreSource.indexOf("KZTeaching");
  assert.ok(teachingStart >= 0, "KZTeaching must exist in #kazohe-core");
  const teachingMap = await testMap(["src/ts/04-teaching.ts"], {
    corePieces: [
      {
        label: "src/ts/04-teaching.ts",
        start: teachingStart,
        end: coreSource.length,
      },
    ],
    coreText: coreSource,
    appPieces: [{ label: "src/ts/13-app-main.ts", start: 0, end: 10 }],
  });
  assert.ok(
    teachingMap.suites.includes("pedagogy"),
    `expected pedagogy to cover teaching span, got: ${teachingMap.suites.join(", ")}`,
  );
  const appMap = await testMap(["src/ts/13-app-main.ts"], {
    corePieces: [],
    appPieces: [{ label: "src/ts/13-app-main.ts", start: 0, end: 10 }],
  });
  assert.deepEqual(appMap.suites, ["e2e"]);

  // Synthetic unreachable span must report 0 suites.
  const emptyMap = await testMap(["src/ts/zz-unreachable.ts"], {
    corePieces: [
      { label: "src/ts/zz-unreachable.ts", start: 99999999, end: 100000000 },
    ],
    appPieces: [],
  });
  assert.deepEqual(emptyMap.suites, []);
}

export function runDiagnosticErrorTests() {
  // Verify reachable product diagnostic error paths with exact expected messages.
  assert.throws(
    () => Language.forbidden("漢字", 0),
    refusedWith({ message: /学年をたしかめてね。/ }),
  );
  assert.throws(
    () => K.normalizeConfig({ selectedIds: [] }),
    refusedWith({ message: /チャレンジをえらんでね。/ }),
  );
  assert.throws(
    () => K.evaluate({ op: "-", args: [{ value: { n: "1", d: "1" } }, { value: { n: "5", d: "1" } }] }),
    refusedWith({ message: /Negative intermediate/ }),
  );
  assert.throws(
    () => K.generate("G9-X99", {}, K.createGenerator(1)),
    refusedWith({ message: /Unknown challenge/ }),
  );
  assert.throws(
    () => K.domains("G4-C06", { remainder: "none", written: "some" }),
    refusedWith({ message: /この組合せでは問題を作れません。/ }),
  );
  assert.throws(
    () => K.generate("G4-C06", { remainder: "none", written: "some" }, K.createGenerator(1)),
    refusedWith({ message: /この組合せでは問題を作れません。|この条件では問題を作れません/ }),
  );
  assert.throws(
    () =>
      K.normalizeConfig({
        selectedIds: ["G4-C07"],
        mode: "practice",
        quantity: 10,
        optionsById: { "G4-C07": { written: "invalid" } },
      }),
    refusedWith({ message: /筆算の条件をたしかめてね。/ }),
  );
  assert.throws(
    () =>
      Written.classify({
        challengeId: "G4-C07",
        written: true,
        expressionAST: {
          op: "/",
          args: [
            { value: { n: "1", d: "1" } },
            { value: { n: "3", d: "1" } },
          ],
        },
        answerSpec: { type: "decimal" },
      }),
    refusedWith({ message: /わり算のけたをたしかめてね。/ }),
  );
  assert.throws(
    () => K.answerText({ answerSpec: { type: "integer" }, expectedExactValue: "bad" }),
    refusedWith({ message: /有理数の形式をたしかめてね。/ }),
  );
  assert.throws(
    () => K.answerText({ answerSpec: { type: "quotient" }, expectedExactValue: "bad" }),
    refusedWith({ message: /商とあまりの形式をたしかめてね。/ }),
  );
  assert.throws(
    () => K.answerText({ answerSpec: { type: "compare" }, expectedExactValue: "?" }),
    refusedWith({ message: /比べた答えをたしかめてね。/ }),
  );
  assert.throws(
    () => K.answerText({ answerSpec: { type: "common" }, expectedExactValue: "bad" }),
    refusedWith({ message: /通分の答えをたしかめてね。/ }),
  );
  assert.throws(
    () => K.answerText({ answerSpec: { type: "set" }, expectedExactValue: "bad" }),
    refusedWith({ message: /答えの並びをたしかめてね。/ }),
  );

  // Input normalization diagnostic errors.
  assert.equal(
    K.normalizeInput({ type: "fraction" }, { form: "invalid" }).error,
    "答えの形をえらんでね。",
  );
  assert.equal(
    K.normalizeInput(
      { type: "fraction" },
      { form: "fraction", numerator: "1", denominator: "0" },
    ).error,
    "分母は0にできません。",
  );
  assert.equal(
    K.normalizeInput(
      { type: "fraction" },
      { form: "mixed", whole: "1", numerator: "3", denominator: "2" },
    ).error,
    "分数の部分を1より小さくしてね。",
  );
  assert.equal(
    K.normalizeInput({ type: "blocks", labels: ["10", "1"] }, { values: ["1"] })
      .error,
    "数字をさいごまで入れてね。",
  );
  assert.equal(
    K.normalizeInput({ type: "set" }, { values: [] }).error,
    "数を追加してね。",
  );
  assert.equal(
    K.normalizeInput({ type: "set" }, { values: ["2", "2"] }).error,
    "同じ数は1回だけ入れてね。",
  );
  assert.equal(
    K.normalizeInput({ type: "compare" }, { value: "" }).error,
    "答えをえらんでね。",
  );

  // Backup validation diagnostic errors (depth, negative number, overlong string).
  assert.throws(
    () => K.validateBackup('{"a":'.repeat(90) + "1" + "}".repeat(90)),
    refusedWith({ message: /データが大きすぎます。/ }),
  );
  assert.throws(
    () => K.validateBackup('{"n":-5}'),
    refusedWith({ message: /不正な数値です。/ }),
  );
  assert.throws(
    () => K.validateBackup(JSON.stringify({ s: "a".repeat(20001) })),
    refusedWith({ message: /文字列が長すぎます。/ }),
  );
}

export async function runAllSourceAuditControls() {
  runSourceConsistencyControls();
  await runSourceLintControls();
  runSourceClonesControls();
  runReleasePolicyControls();
  await runTestMapControls();
  runDiagnosticErrorTests();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await runAllSourceAuditControls();
  console.log("source-audit negative controls: PASS");
}
