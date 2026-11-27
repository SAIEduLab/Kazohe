// Unit and synthetic negative-control tests for scripts/change-guard.mjs,
// scripts/behaviour-snapshot.mjs, and scripts/assertion-counts.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { appVersion, htmlName } from "../../scripts/artifact.mjs";
import { html as productText } from "../../scripts/load-inline-core.mjs";
import { tcIds, manifest } from "../../scripts/manifest.mjs";
import { suite } from "../../scripts/report.mjs";
import {
  assertionCount,
  weakenedFiles,
} from "../../scripts/assertion-counts.mjs";
import {
  behaviourSnapshot,
  boundedSnapshot,
  fixedClockMs,
  intendedChangesFile,
  intendedChangesSchema,
  productApi,
  runLimited,
} from "../../scripts/behaviour-snapshot.mjs";
import {
  auditChangesFile,
  auditChangesSchema,
  changedScriptLines,
  changeGuard,
  formatGuardReport,
  git,
  nextPatch,
  rewrittenLines,
  testScriptPattern,
  treeIdentity,
} from "../../scripts/change-guard.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function createSyntheticRepo(tmp) {
  const config = path.join(tmp, "gitconfig");
  fs.writeFileSync(config, "");
  const gitEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: config,
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Kazohe audit",
    GIT_AUTHOR_EMAIL: "audit@kazohe.invalid",
    GIT_COMMITTER_NAME: "Kazohe audit",
    GIT_COMMITTER_EMAIL: "audit@kazohe.invalid",
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
  };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
  ])
    delete gitEnv[key];

  const repo = path.join(tmp, "repo");
  const trees = path.join(tmp, "trees");
  fs.mkdirSync(trees, { recursive: true });
  cp.execFileSync("git", ["init", "-q", repo], { env: gitEnv, stdio: "pipe" });

  const tracked = cp
    .execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], {
      env: gitEnv,
      encoding: "utf8",
    })
    .split("\0")
    .filter(Boolean);
  const extraFiles = [
    "scripts/behaviour-snapshot.mjs",
    "scripts/assertion-counts.mjs",
    "scripts/change-guard.mjs",
    "tests/manifests/intended-audit-changes.json",
    "tests/manifests/intended-behaviour-changes.json",
    ".github/workflows/change-guard.yml",
  ].filter((f) => fs.existsSync(path.join(repoRoot, f)));
  const files = [...new Set([...tracked, ...extraFiles])].sort();
  const oids = cp
    .execFileSync(
      "git",
      ["-C", repo, "hash-object", "-w", "--no-filters", "--stdin-paths"],
      {
        env: gitEnv,
        input: files.map((f) => path.resolve(repoRoot, f)).join("\n") + "\n",
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    )
    .trim()
    .split("\n");
  assert.equal(oids.length, files.length, "hashed file count");
  const baseFiles = new Map(files.map((f, i) => [f, oids[i]]));

  const blob = (content) =>
    cp
      .execFileSync(
        "git",
        ["-C", repo, "hash-object", "-w", "--no-filters", "--stdin"],
        { env: gitEnv, input: content, encoding: "utf8" },
      )
      .trim();

  let serial = 0;
  function commitFiles(map, parents) {
    const index = path.join(tmp, `index-${++serial}`);
    fs.rmSync(index, { force: true });
    const env = { ...gitEnv, GIT_INDEX_FILE: index };
    const run = (args, input) =>
      cp
        .execFileSync("git", ["-C", repo, ...args], {
          env,
          input,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        })
        .trim();
    run(
      ["update-index", "--add", "-z", "--index-info"],
      [...map].map(([p, oid]) => `100644 ${oid}\t${p}\0`).join(""),
    );
    const tree = run(["write-tree"]);
    const commit = run([
      "commit-tree",
      tree,
      ...parents.flatMap((p) => ["-p", p]),
      "-m",
      `fixture ${serial}`,
    ]);
    fs.rmSync(index, { force: true });
    return commit;
  }

  const base = commitFiles(baseFiles, []);
  function derive(changes, parent = base, baseMap = baseFiles) {
    const map = new Map(baseMap);
    for (const [file, content] of Object.entries(changes)) {
      if (content === null) {
        assert.ok(map.delete(file), "fixture lacks " + file);
      } else {
        map.set(file, blob(content));
      }
    }
    return commitFiles(map, [parent]);
  }
  const show = (commit, file) =>
    git(repo, ["show", `${commit}:${file}`]).toString("utf8");

  return { repo, trees, base, baseFiles, blob, commitFiles, derive, show };
}

export async function runChangeGuardTests() {
  const s = suite("change-guard-unit");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kazohe-guard-test-"));
  const prevTmp = {
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    TMPDIR: process.env.TMPDIR,
  };
  const snapTemp = path.join(tmp, "temp");
  fs.mkdirSync(snapTemp);
  Object.assign(process.env, {
    TEMP: snapTemp,
    TMP: snapTemp,
    TMPDIR: snapTemp,
  });

  try {
    const ctx = createSyntheticRepo(tmp);
    const { repo, trees, base, baseFiles, blob, commitFiles, derive, show } =
      ctx;
    const guard = (head, { from = base, limitMs } = {}) =>
      changeGuard({ repo, base: from, head, workDir: trees, limitMs });
    const recordFolders = () =>
      fs
        .readdirSync(snapTemp)
        .filter((name) => name.startsWith("kazohe-snapshot-"));

    const replaced = (file, from, to) => {
      const text = show(base, file);
      assert.ok(text.includes(from), `${file} lacks ${JSON.stringify(from)}`);
      return text.replace(from, to);
    };
    const recordAudit = (...changes) => ({
      [auditChangesFile]:
        JSON.stringify(
          {
            schema: auditChangesSchema,
            changes: changes.map((change) => ({
              change,
              reason: "an intended audit change recorded for this test",
            })),
            allowances: [],
          },
          null,
          2,
        ) + "\n",
    });
    const recordAllowances = (...allowances) => ({
      [auditChangesFile]:
        JSON.stringify(
          {
            schema: auditChangesSchema,
            changes: [],
            allowances: allowances.map((change) => ({
              change,
              reason: "an intended baseline allowance recorded for this test",
            })),
          },
          null,
          2,
        ) + "\n",
    });
    const recordBehaviour = (...items) => ({
      [intendedChangesFile]:
        JSON.stringify(
          {
            schema: intendedChangesSchema,
            changes: items.map((c) => ({
              case: c,
              reason: "an intended behaviour change recorded for this test",
            })),
          },
          null,
          2,
        ) + "\n",
    });
    const shellText = show(base, "src/shell.html");
    const sourceChange = {
      "src/shell.html": shellText + "\n<!-- guard-test -->\n",
    };
    const pkgText = show(base, "package.json");
    const release = (
      next,
      { changeSource = false, productBytes = productText } = {},
    ) => {
      const nextFile = `Kazohe_${next.replaceAll(".", "_")}.html`;
      const nextPkg = JSON.parse(pkgText);
      nextPkg.version = next;
      const changes = {
        "package.json": JSON.stringify(nextPkg, null, 2) + "\n",
        [nextFile]: productBytes,
        ...(changeSource ? sourceChange : {}),
      };
      if (nextFile !== htmlName) changes[htmlName] = null;
      return changes;
    };

    const assertPass = (label, r, removed = {}) => {
      assert.equal(r.status, "PASS", `${label}: ${JSON.stringify(r)}`);
      assert.deepEqual(r.removed, removed, `${label} removed`);
    };
    const assertFail = (label, r, field, pattern) => {
      assert.equal(r.status, "FAIL", `${label} expected FAIL`);
      assert.ok(
        r[field].some((m) => pattern.test(m)),
        `${label} ${field}: ${JSON.stringify(r[field])}`,
      );
    };

    await s.checkAsync("identity-and-controls", async () => {
      const id = await treeIdentity(repo, base, trees);
      assert.deepEqual(id.sets.tc, tcIds);
      assert.deepEqual(
        id.sets["manifest-entry"],
        manifest.map((m) => `${m.id}/${m.method}`),
      );
      assert.ok(id.sets["gate-case"].includes("lint/html-js-syntax"));
      assert.ok(
        id.sets["gate-case"].includes("lint/public-boundary-and-secrets"),
      );
      assert.ok(id.sets["gate-case"].includes("lint-gate/TC-D06"));
      assert.ok(
        id.sets["gate-case"].includes(
          "audit-catalog/catalog-connected-functions",
        ),
      );
      const checkoutPin = show(base, ".github/workflows/audit.yml").match(
        /actions\/checkout@([0-9a-f]{40})/,
      )?.[1];
      assert.ok(checkoutPin, "checkout pin in audit.yml");
      assert.ok(id.sets.pin.includes(checkoutPin));
      assert.ok(
        [...id.pins.values()]
          .flat()
          .every((f) => f !== "tests/evidence/visual-review.json"),
      );
      assert.deepEqual(
        [id.version, id.productFile, id.products],
        [appVersion, htmlName, [htmlName]],
      );

      const docHead = derive({
        "README.md": show(base, "README.md") + "\n<!-- doc note -->\n",
      });
      const docReport = await guard(docHead);
      assertPass("doc-only", docReport);
      assert.deepEqual(docReport.guardCode, { base: true, head: true });
      assert.ok(
        formatGuardReport(docReport).includes("Guard code: the base's"),
      );

      const editedGuard = await guard(
        derive({
          "scripts/change-guard.mjs":
            show(base, "scripts/change-guard.mjs") + "\n// guard note\n",
        }),
      );
      assertPass("edited-guard", editedGuard);
      assert.deepEqual(editedGuard.guardCode, { base: true, head: false });

      const addedCheck = replaced(
        "scripts/lint.mjs",
        's.check("html-js-syntax",',
        's.check("extra-check", () => { assert.ok(true); });\ns.check("html-js-syntax",',
      );
      assertPass(
        "additions-only",
        await guard(derive({ "scripts/lint.mjs": addedCheck })),
      );

      const advancedBase = derive({ "scripts/lint.mjs": addedCheck });
      const advanced = await guard(docHead, { from: advancedBase });
      assert.equal(advanced.mergeBase, base);
      assertPass("base-advanced-after-branch", advanced);
    });

    await s.checkAsync("version-and-product-file-rules", async () => {
      const next = nextPatch(appVersion);
      const afterNext = nextPatch(next);
      const [major, minor, patch] = appVersion.split(".").map(Number);

      assertFail(
        "src-changed-no-bump",
        await guard(derive(sourceChange)),
        "versionIssues",
        new RegExp("must be " + next.replaceAll(".", "\\.")),
      );
      assertFail(
        "product-changed-no-bump",
        await guard(derive({ [htmlName]: productText + "\n" })),
        "versionIssues",
        new RegExp("must be " + next.replaceAll(".", "\\.")),
      );
      assertPass(
        "patch-bump-accepted",
        await guard(
          derive(
            release(next, {
              changeSource: true,
              productBytes: productText + "\n",
            }),
          ),
        ),
      );
      assertFail(
        "patch-skipped-unrecorded",
        await guard(
          derive(
            release(afterNext, {
              changeSource: true,
              productBytes: productText + "\n",
            }),
          ),
        ),
        "auditChangeIssues",
        new RegExp(
          "version:" + afterNext.replaceAll(".", "\\.") + " is not recorded",
        ),
      );
      const skippedRecorded = await guard(
        derive({
          ...release(afterNext, {
            changeSource: true,
            productBytes: productText + "\n",
          }),
          ...recordAudit("version:" + afterNext),
        }),
      );
      assertPass("patch-skipped-recorded", skippedRecorded);
      assert.ok(
        formatGuardReport(skippedRecorded).includes(
          "For the owner to read before the merge:",
        ),
      );
      assert.ok(
        formatGuardReport(skippedRecorded).includes(
          `the product version ${afterNext} is raised past the next patch ${next}`,
        ),
      );

      const minorVer = `${major}.${minor + 1}.0`;
      assertFail(
        "minor-bump-unrecorded",
        await guard(
          derive(
            release(minorVer, {
              changeSource: true,
              productBytes: productText + "\n",
            }),
          ),
        ),
        "auditChangeIssues",
        /version:0\.3\.0 is not recorded/,
      );
      assertPass(
        "minor-bump-recorded",
        await guard(
          derive({
            ...release(minorVer, {
              changeSource: true,
              productBytes: productText + "\n",
            }),
            ...recordAudit("version:" + minorVer),
          }),
        ),
      );
      const majorVer = `${major + 1}.0.0`;
      assertPass(
        "major-bump-recorded",
        await guard(
          derive({
            ...release(majorVer, {
              changeSource: true,
              productBytes: productText + "\n",
            }),
            ...recordAudit("version:" + majorVer),
          }),
        ),
      );

      const lowerVer = `${major}.${minor}.${Math.max(0, patch - 1)}`;
      assertFail(
        "downgrade-always-fails",
        await guard(
          derive({
            ...release(lowerVer, {
              changeSource: true,
              productBytes: productText + "\n",
            }),
            ...recordAudit("version:" + lowerVer),
          }),
        ),
        "versionIssues",
        /must be 0\.2\.7/,
      );
      assertFail(
        "bump-without-product-change",
        await guard(
          derive({ ...release(next), ...recordAudit("version:" + next) }),
        ),
        "versionIssues",
        new RegExp("must stay " + appVersion.replaceAll(".", "\\.")),
      );
      assertFail(
        "unbumped-src-change-even-recorded",
        await guard(
          derive({ ...sourceChange, ...recordAudit("version:" + appVersion) }),
        ),
        "versionIssues",
        /must be 0\.2\.7/,
      );

      assertFail(
        "two-product-htmls",
        await guard(derive({ "Kazohe_0_2_7.html": productText })),
        "releaseIssues",
        /exactly one product HTML/,
      );
      assertFail(
        "wrong-product-html-name",
        await guard(
          derive({ [htmlName]: null, "Kazohe_9_9_9.html": productText }),
        ),
        "releaseIssues",
        /exactly one product HTML/,
      );
      assertFail(
        "missing-product-html",
        await guard(derive({ [htmlName]: null })),
        "releaseIssues",
        /found none/,
      );
    });

    await s.checkAsync("audit-id-and-pin-rules", async () => {
      const removedTc = {
        "scripts/manifest.mjs": replaced(
          "scripts/manifest.mjs",
          '"07", "08"',
          '"07"',
        ),
      };
      const tcFail = await guard(derive(removedTc));
      assertFail(
        "tc-deleted",
        tcFail,
        "auditChangeIssues",
        /tc:TC-D08 is not recorded/,
      );
      assert.deepEqual(tcFail.removed, {
        tc: ["TC-D08"],
        "manifest-entry": ["TC-D08/browser"],
      });

      const tcRecorded = await guard(
        derive({
          ...removedTc,
          ...recordAudit("tc:TC-D08", "manifest-entry:TC-D08/browser"),
        }),
      );
      assertPass("tc-deleted-recorded", tcRecorded, {
        tc: ["TC-D08"],
        "manifest-entry": ["TC-D08/browser"],
      });
      assert.ok(
        formatGuardReport(tcRecorded).includes(
          "- removed tc TC-D08: an intended audit change recorded for this test",
        ),
      );

      const removedGate = {
        "scripts/lint.mjs": replaced(
          "scripts/lint.mjs",
          's.check("html-js-syntax",',
          's.check("renamed-syntax",',
        ),
      };
      assertFail(
        "gate-deleted",
        await guard(derive(removedGate)),
        "auditChangeIssues",
        /gate-case:lint\/html-js-syntax is not recorded/,
      );
      assertPass(
        "gate-deleted-recorded",
        await guard(
          derive({
            ...removedGate,
            ...recordAudit("gate-case:lint/html-js-syntax"),
          }),
        ),
        { "gate-case": ["lint/html-js-syntax"] },
      );

      // Removing a named check in tests/unit/*.mjs must also be flagged as gate-case:...
      const removedUnitGate = {
        "tests/unit/core.mjs": replaced(
          "tests/unit/core.mjs",
          's.check("configuration-boundaries",',
          's.check("renamed-configuration-boundaries",',
        ),
      };
      assertFail(
        "unit-gate-deleted",
        await guard(derive(removedUnitGate)),
        "auditChangeIssues",
        /gate-case:core\/configuration-boundaries is not recorded/,
      );
      assertPass(
        "unit-gate-deleted-recorded",
        await guard(
          derive({
            ...removedUnitGate,
            ...recordAudit("gate-case:core/configuration-boundaries"),
          }),
        ),
        { "gate-case": ["core/configuration-boundaries"] },
      );

      // Weakening audit together with src/ or product HTML change is FORBIDDEN even when recorded.
      const next = nextPatch(appVersion);
      const productBump = release(next, {
        changeSource: true,
        productBytes: productText + "\n",
      });
      assertFail(
        "tc-weakened-with-product-forbidden",
        await guard(
          derive({
            ...productBump,
            ...removedTc,
            ...recordAudit("tc:TC-D08", "manifest-entry:TC-D08/browser"),
          }),
        ),
        "auditChangeIssues",
        /checks less, and this change also changes src\/ or the product/,
      );
      assertFail(
        "gate-weakened-with-product-forbidden",
        await guard(
          derive({
            ...productBump,
            ...removedGate,
            ...recordAudit("gate-case:lint/html-js-syntax"),
          }),
        ),
        "auditChangeIssues",
        /gate-case:lint\/html-js-syntax checks less, and this change also changes src\/ or the product/,
      );

      // Pin changes require a record, and ARE allowed with product changes when recorded.
      const baseIdentity = await treeIdentity(repo, base, trees);
      const oldSha = show(base, ".github/workflows/audit.yml").match(
        /actions\/checkout@([0-9a-f]{40})/,
      )?.[1];
      assert.ok(oldSha, "checkout pin in audit.yml");
      const pinHolders = baseIdentity.pins.get(oldSha) || [];
      assert.ok(pinHolders.length > 0, "at least one file holds checkout pin");
      const newSha = "e".repeat(40);
      const pinChanged = Object.fromEntries(
        pinHolders.map((file) => [
          file,
          show(base, file).replaceAll(oldSha, newSha),
        ]),
      );
      assertFail(
        "pin-changed-unrecorded",
        await guard(derive(pinChanged)),
        "auditChangeIssues",
        new RegExp(`pin:${oldSha} is not recorded`),
      );
      assertPass(
        "pin-changed-with-product-recorded",
        await guard(
          derive({
            ...productBump,
            ...pinChanged,
            ...recordAudit("pin:" + oldSha),
          }),
        ),
        { pin: [oldSha] },
      );

      // Unused record fails; base-kept record covers nothing; short reason & wrong shape fail.
      assertFail(
        "unused-audit-record",
        await guard(derive(recordAudit("gate-case:lint/does-not-exist"))),
        "auditChangeIssues",
        /records gate-case:lint\/does-not-exist, but this change does not make it/,
      );
      const baseWithRecord = derive(
        recordAudit("gate-case:lint/html-js-syntax"),
      );
      assertFail(
        "kept-from-base-covers-nothing",
        await guard(
          derive(
            { ...removedGate, ...recordAudit("gate-case:lint/html-js-syntax") },
            baseWithRecord,
          ),
          { from: baseWithRecord },
        ),
        "auditChangeIssues",
        /gate-case:lint\/html-js-syntax is not recorded/,
      );
      assertFail(
        "short-reason-rejected",
        await guard(
          derive({
            ...removedGate,
            [auditChangesFile]: JSON.stringify({
              changes: [
                { change: "gate-case:lint/html-js-syntax", reason: "ok" },
              ],
            }),
          }),
        ),
        "errors",
        /each entry names a change and a reason/,
      );
      assertFail(
        "wrong-shape-rejected",
        await guard(
          derive({
            [auditChangesFile]: JSON.stringify({
              schema: "wrong-schema",
              changes: [],
            }),
          }),
        ),
        "errors",
        /has the wrong shape/,
      );
    });

    await s.checkAsync("assertion-counts-rules", async () => {
      const sample = [
        "assert(a);",
        "assert.equal(a, b);",
        "expect(x).toBe(1);",
        "expect.soft(y).toEqual(2);",
        "refusedWith(() => boom(), /specific/);",
      ].join("\n");
      assert.equal(assertionCount(sample), 5);
      assert.deepEqual(
        weakenedFiles(
          { "tests/a.mjs": 4, "tests/b.mjs": 2 },
          { "tests/a.mjs": 3 },
        ),
        ["tests/a.mjs: 4 -> 3", "tests/b.mjs: 2 -> 0"],
      );

      const fewerChecks = {
        "scripts/audit-catalog.mjs": replaced(
          "scripts/audit-catalog.mjs",
          "assert(K.buildHint(q));",
          "// removed check",
        ),
      };
      const weakenedReport = await guard(derive(fewerChecks));
      assertFail(
        "fewer-checks-unrecorded",
        weakenedReport,
        "auditChangeIssues",
        /fewer-checks:scripts\/audit-catalog\.mjs is not recorded/,
      );
      assert.ok(
        weakenedReport.weakened.some((w) =>
          w.startsWith("scripts/audit-catalog.mjs: "),
        ),
      );
      assertPass(
        "fewer-checks-recorded-audit-only",
        await guard(
          derive({
            ...fewerChecks,
            ...recordAudit("fewer-checks:scripts/audit-catalog.mjs"),
          }),
        ),
      );
      const next = nextPatch(appVersion);
      assertFail(
        "fewer-checks-with-product-forbidden",
        await guard(
          derive({
            ...release(next, {
              changeSource: true,
              productBytes: productText + "\n",
            }),
            ...fewerChecks,
            ...recordAudit("fewer-checks:scripts/audit-catalog.mjs"),
          }),
        ),
        "auditChangeIssues",
        /fewer-checks:scripts\/audit-catalog\.mjs checks less, and this change also changes src\/ or the product/,
      );
      assertFail(
        "deleted-test-file-with-assertions",
        await guard(derive({ "tests/e2e/site.spec.mjs": null })),
        "auditChangeIssues",
        /fewer-checks:tests\/e2e\/site\.spec\.mjs is not recorded/,
      );
    });

    await s.checkAsync("rewritten-test-lines-rules", async () => {
      assert.deepEqual(
        [
          "tests/unit/core.mjs",
          "tests/e2e/app.spec.mjs",
          "tests/property/generators.mjs",
          "scripts/lint.mjs",
          "tests/manifests/intended-audit-changes.json",
        ].map((f) => testScriptPattern.test(f)),
        [true, true, true, false, false],
      );
      assert.deepEqual(
        rewrittenLines("a();\n\n// c\nb();\n", "  a(); // ok\nvoid 0;\nb();\n"),
        [],
      );
      assert.deepEqual(
        [
          rewrittenLines("x();\ny();\nx();\n", "x();\ny();\n"),
          rewrittenLines("eq(t, 'a b');\n", "eq(t, 'a  b');\n"),
          rewrittenLines("a=1;\nb=2;\n", ""),
          rewrittenLines("a();\nb();\n", "b();\na();\n"),
          rewrittenLines("a=1;\nb=;\n", "a=1;\n  b=;\n"),
          rewrittenLines("a=1;\nb=;\n", "a=2;\nb=;\n"),
        ],
        [[3], [1], [1, 2], [1], [], [1]],
      );
      const rawBytes = (byte) =>
        Buffer.from([0x61, 0x3d, 0x22, byte, 0x22, 0x3b, 0x0a]);
      assert.deepEqual(
        [
          rewrittenLines(rawBytes(0xff), rawBytes(0xfe)),
          rewrittenLines(rawBytes(0xff), rawBytes(0xff)),
        ],
        [[1], []],
      );

      const next = nextPatch(appVersion);
      const productBump = release(next, {
        changeSource: true,
        productBytes: productText + "\n",
      });
      const coreLines = show(base, "tests/unit/core.mjs").split("\n");
      const editAt = coreLines.findIndex((line) =>
        /^\s*const\b.*;\s*$/.test(line),
      );
      assert.ok(editAt >= 0, "find core.mjs statement line to rewrite");
      const rewrittenCore = [...coreLines];
      rewrittenCore[editAt] = rewrittenCore[editAt] + " void 0;";
      const rewrittenText = rewrittenCore.join("\n");

      const bare = await guard(
        derive({ ...productBump, "tests/unit/core.mjs": rewrittenText }),
      );
      assertFail(
        "rewritten-test-needs-record",
        bare,
        "auditChangeIssues",
        /rewritten-test:tests\/unit\/core\.mjs is not recorded/,
      );
      assert.deepEqual(bare.rewritten, [
        { file: "tests/unit/core.mjs", lines: [editAt + 1] },
      ]);

      const recorded = await guard(
        derive({
          ...productBump,
          "tests/unit/core.mjs": rewrittenText,
          ...recordAudit("rewritten-test:tests/unit/core.mjs"),
        }),
      );
      assertPass("rewritten-test-recorded", recorded);
      assert.ok(
        formatGuardReport(recorded).includes(
          `- rewritten, removed or reordered lines in tests/unit/core.mjs (1 of the base: ${editAt + 1}):`,
        ),
      );
      const truncated = formatGuardReport({
        ...recorded,
        rewritten: [
          {
            file: "tests/unit/core.mjs",
            lines: Array.from({ length: 12 }, (_, i) => i + 1),
          },
        ],
      });
      assert.ok(
        truncated.includes(
          "(12 of the base: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, …)",
        ),
      );

      // Adding comments/lines without changing base lines requires no record; audit-only rewrites forbid rewritten-test record.
      const freeCore = [...coreLines];
      freeCore.splice(editAt, 0, "// added comment", "void 0;");
      assertPass(
        "added-lines-free",
        await guard(
          derive({
            ...productBump,
            "tests/unit/core.mjs": freeCore.join("\n"),
          }),
        ),
      );
      assertPass(
        "audit-only-rewrite-free",
        await guard(derive({ "tests/unit/core.mjs": rewrittenText })),
      );
      assertFail(
        "rewritten-test-forbidden-on-audit-only",
        await guard(
          derive({
            "tests/unit/core.mjs": rewrittenText,
            ...recordAudit("rewritten-test:tests/unit/core.mjs"),
          }),
        ),
        "auditChangeIssues",
        /records rewritten-test:tests\/unit\/core\.mjs, but this change does not make it/,
      );
    });

    await s.checkAsync("shrink-only-baselines-rules", async () => {
      const baseBaselines = {
        "scripts/audit-code.mjs": [
          'export const WAIT_BASELINE = Object.freeze({ "tests/e2e/app.spec.mjs": 2 });',
          'export const SOURCE_READ_BASELINE = Object.freeze({ "scripts/lint.mjs": 1 });',
          'export const LINT_BASELINE = Object.freeze({ "scripts/lint.mjs": { "no-unused-vars": 1 } });',
          'export const UNNAMED_CODES = Object.freeze(["E001"]);',
          'export const CLONE_BASELINE = Object.freeze([{ id: "C001" }]);',
          'export const SHOWN_TEXT_BASELINE = Object.freeze([{ file: "src/app.js", source: "x" }]);',
          "",
        ].join("\n"),
      };
      const baselineBase = derive(baseBaselines);
      const baseWithMap = new Map([
        ...baseFiles,
        [
          "scripts/audit-code.mjs",
          blob(baseBaselines["scripts/audit-code.mjs"]),
        ],
      ]);

      const grownSource = [
        'export const WAIT_BASELINE = Object.freeze({ "tests/e2e/app.spec.mjs": 3 });',
        'export const SOURCE_READ_BASELINE = Object.freeze({ "scripts/lint.mjs": 2 });',
        'export const LINT_BASELINE = Object.freeze({ "scripts/lint.mjs": { "no-unused-vars": 2 } });',
        'export const UNNAMED_CODES = Object.freeze(["E001", "E002"]);',
        'export const CLONE_BASELINE = Object.freeze([{ id: "C001" }, { id: "C002" }]);',
        'export const SHOWN_TEXT_BASELINE = Object.freeze([{ file: "src/app.js", source: "x" }, { file: "src/view.js", source: "y" }]);',
        "",
      ].join("\n");
      const grownHead = derive(
        { "scripts/audit-code.mjs": grownSource },
        baselineBase,
        baseWithMap,
      );
      const grownReport = await guard(grownHead, { from: baselineBase });
      assertFail(
        "grown-baselines-unrecorded",
        grownReport,
        "auditChangeIssues",
        /wait-allowance:tests\/e2e\/app\.spec\.mjs#3 is not recorded with a reason in the allowances/,
      );
      const expectedItems = [
        "unnamed-code:E002",
        "clone-allowance:C002",
        "shown-text-allowance:src/view.js|y",
        "wait-allowance:tests/e2e/app.spec.mjs#3",
        "source-read-allowance:scripts/lint.mjs#2",
        "lint-allowance:scripts/lint.mjs|no-unused-vars#2",
      ];
      for (const item of expectedItems) {
        assert.ok(
          grownReport.auditChangeIssues.some((m) => m.includes(item)),
          `missing issue for ${item}`,
        );
      }

      // Putting grown allowances into changes instead of allowances FAILS.
      assertFail(
        "allowance-in-changes-fails",
        await guard(
          derive(
            {
              "scripts/audit-code.mjs": grownSource,
              ...recordAudit(...expectedItems),
            },
            baselineBase,
            baseWithMap,
          ),
          { from: baselineBase },
        ),
        "auditChangeIssues",
        /but this change does not make it/,
      );

      // Recording all grown items in allowances PASSES and lists them for the owner.
      const approved = await guard(
        derive(
          {
            "scripts/audit-code.mjs": grownSource,
            ...recordAllowances(...expectedItems),
          },
          baselineBase,
          baseWithMap,
        ),
        { from: baselineBase },
      );
      assertPass("grown-baselines-recorded", approved);
      assert.ok(
        formatGuardReport(approved).includes(
          "- a new wait-allowance entry tests/e2e/app.spec.mjs#3:",
        ),
      );

      // Unused allowance FAILS; shrunk baseline PASSES; non-literal baseline FAILS.
      assertFail(
        "unused-allowance-fails",
        await guard(
          derive(
            recordAllowances("unnamed-code:E999"),
            baselineBase,
            baseWithMap,
          ),
          { from: baselineBase },
        ),
        "auditChangeIssues",
        /records the allowance unnamed-code:E999, but this change does not grow it/,
      );
      const shrunk = await guard(
        derive(
          {
            "scripts/audit-code.mjs": baseBaselines[
              "scripts/audit-code.mjs"
            ].replace(": 2 }", ": 1 }"),
          },
          baselineBase,
          baseWithMap,
        ),
        { from: baselineBase },
      );
      assertPass("shrunk-baseline-passes", shrunk);
      assert.deepEqual(shrunk.grown, {});

      assertFail(
        "non-literal-allowance-fails",
        await guard(
          derive(
            {
              "scripts/audit-code.mjs":
                "const helper = () => ({});\nexport const WAIT_BASELINE = helper();\n",
            },
            baselineBase,
            baseWithMap,
          ),
          { from: baselineBase },
        ),
        "errors",
        /an allowance is not a literal/,
      );
    });

    await s.checkAsync("behaviour-snapshot-diff-and-confinement", async () => {
      const next = nextPatch(appVersion);
      // Inert HTML lacks #kazohe-core -> returns unavailable without crashing.
      assert.deepEqual(behaviourSnapshot("<p>no core</p>"), {
        unavailable: { reason: "the page has no Kazohe API" },
      });

      // Fixed clock & no performance inside productApi.
      const probeHtml =
        '<script id="kazohe-core">const KZ={CATALOG:[],generate:()=>null,now:()=>Date.now(),perf:typeof performance};</script>';
      const probeApi = productApi(probeHtml, { fixedClock: true });
      assert.equal(probeApi.KZ.now(), fixedClockMs);
      assert.equal(probeApi.KZ.perf, "undefined");

      // Patch bump + whitespace/comment refactor inside #kazohe-core -> 0 diff, 0 changedScriptLines.
      const versionBumped = productText
        .replace(
          `const APP_VERSION = "${appVersion}";`,
          `const APP_VERSION = "${next}"; // patch bump`,
        )
        .replace(
          /function gcd\s*\([^)]*\)\s*\{/,
          (m) => `${m}\n    void (1 + 1);`,
        );
      assert.notEqual(versionBumped, productText);
      const refactored = await guard(
        derive(
          release(next, { changeSource: true, productBytes: versionBumped }),
        ),
      );
      assertPass("refactor-zero-behaviour-diff", refactored);
      assert.equal(refactored.behaviour.differences.length, 0);
      assert.ok(refactored.behaviour.cases >= 109);
      assert.ok(refactored.changedScriptLines.count >= 1);
      assert.ok(
        formatGuardReport(refactored).includes(
          `Changed product script lines: ${refactored.changedScriptLines.count}`,
        ),
      );

      // Behaviour change in core (mutating a hint text) -> FAIL unrecorded, PASS when recorded.
      const hintAnchor = '"わる数を逆数にして、かけ算にしよう。"';
      assert.ok(productText.includes(hintAnchor), "hint anchor in product");
      const behaviourChanged = productText
        .replace(
          `const APP_VERSION = "${appVersion}";`,
          `const APP_VERSION = "${next}";`,
        )
        .replace(hintAnchor, '"わる数を逆数にして、かけ算で計算しよう。"');
      const unrecorded = await guard(
        derive(
          release(next, { changeSource: true, productBytes: behaviourChanged }),
        ),
      );
      assertFail(
        "behaviour-change-unrecorded",
        unrecorded,
        "behaviourIssues",
        /changed, and tests\/manifests\/intended-behaviour-changes\.json does not record it/,
      );
      const diffs = unrecorded.behaviour.differences;
      assert.ok(diffs.length > 0, "at least one skill differs");

      const recorded = await guard(
        derive({
          ...release(next, {
            changeSource: true,
            productBytes: behaviourChanged,
          }),
          ...recordBehaviour(...diffs),
        }),
      );
      assertPass("behaviour-change-recorded", recorded);
      assert.ok(
        formatGuardReport(recorded).includes(
          `- changed behaviour of ${diffs[0]}: an intended behaviour change recorded for this test`,
        ),
      );

      // Unused behaviour record (0 diff) FAILS; short reason / wrong shape FAIL.
      const unchangedItem = "meta/core";
      assert.ok(!diffs.includes(unchangedItem));
      assertFail(
        "unused-behaviour-record",
        await guard(
          derive({
            ...release(next, {
              changeSource: true,
              productBytes: behaviourChanged,
            }),
            ...recordBehaviour(...diffs, unchangedItem),
          }),
        ),
        "behaviourIssues",
        /records a change of meta\/core, but its behaviour did not change/,
      );
      assertFail(
        "behaviour-record-short-reason",
        await guard(
          derive({
            ...release(next, {
              changeSource: true,
              productBytes: behaviourChanged,
            }),
            [intendedChangesFile]: JSON.stringify({
              changes: [{ case: diffs[0], reason: "short" }],
            }),
          }),
        ),
        "errors",
        /each change names an item and a reason/,
      );
      assertFail(
        "behaviour-record-wrong-shape",
        await guard(
          derive({
            ...release(next, {
              changeSource: true,
              productBytes: behaviourChanged,
            }),
            [intendedChangesFile]: JSON.stringify({
              schema: "wrong-schema",
              changes: [],
            }),
          }),
        ),
        "errors",
        /has the wrong shape/,
      );

      // Timeout enforcement cleans up child process and temp snapshot folders.
      const endless = productText.replace(
        /function gcd\s*\([^)]*\)\s*\{/,
        (m) => `${m} for (;;) {}`,
      );
      assert.notEqual(endless, productText);
      assertFail(
        "snapshot-timeout",
        await guard(
          derive(release(next, { changeSource: true, productBytes: endless })),
          { limitMs: 3000 },
        ),
        "errors",
        /the behaviour snapshot did not finish within 3 s/,
      );
      assert.deepEqual(recordFolders(), []);

      // Node --permission confinement: VM escape writes unconfined, blocked inside boundedSnapshot & --identity.
      const mark = path.join(tmp, "escape-mark.txt");
      const escapeCode = `try{TextEncoder.constructor("return process")().getBuiltinModule("fs").writeFileSync(${JSON.stringify(mark)},"x");}catch{}`;
      const escapePage = `<script id="kazohe-core">${escapeCode}</script>`;
      const wrote = () => {
        const hit = fs.existsSync(mark);
        fs.rmSync(mark, { force: true });
        return hit;
      };
      productApi(escapePage);
      assert.equal(wrote(), true, "escape succeeds unconfined");
      await boundedSnapshot(escapePage, 30000);
      assert.equal(
        wrote(),
        false,
        "boundedSnapshot blocks unauthorized writes",
      );

      const badTree = path.join(tmp, "confined-tree");
      fs.mkdirSync(path.join(badTree, "scripts"), { recursive: true });
      fs.writeFileSync(
        path.join(badTree, "scripts", "manifest.mjs"),
        `import fs from "node:fs";\ntry{fs.writeFileSync(${JSON.stringify(mark)},"x");}catch{}\nexport const tcIds=["TC-X01"];\nexport const manifest=[{id:"TC-X01",method:"unit"}];\n`,
      );
      const ans = path.join(tmp, "confined-answer.json");
      runLimited(
        [
          path.resolve(repoRoot, "scripts/change-guard.mjs"),
          "--identity",
          badTree,
          ans,
        ],
        30000,
        "confined identity",
        [ans],
      );
      assert.equal(wrote(), false, "identity child blocks unauthorized writes");
      assert.deepEqual(JSON.parse(fs.readFileSync(ans, "utf8")).sets.tc, [
        "TC-X01",
      ]);
    });

    await s.checkAsync("changed-script-lines-and-errors", async () => {
      const a =
        '<script id="kazohe-core">\nconst x = "a b";\nconst y = 1;\n</script>';
      const b =
        '<script id="kazohe-core">\n  const x = "a b"; // comment\nconst y = 1;\n</script>';
      const c =
        '<script id="kazohe-core">\nconst x = "a  b";\nconst y = 1;\n</script>';
      assert.deepEqual(changedScriptLines(a, b), []);
      assert.deepEqual(changedScriptLines(a, c), [[2, 'const x = "a  b";']]);

      // Unrelated history fails with "no merge base".
      const unrelated = commitFiles(
        new Map([...baseFiles, ["README.md", blob("unrelated\n")]]),
        [],
      );
      assertFail(
        "no-merge-base",
        await guard(base, { from: unrelated }),
        "errors",
        /no merge base/,
      );

      // Broken syntax in scripts/manifest.mjs fails with SyntaxError.
      assertFail(
        "broken-manifest-syntax",
        await guard(
          derive({
            "scripts/manifest.mjs":
              show(base, "scripts/manifest.mjs") +
              "\nexport const broken = ;\n",
          }),
        ),
        "errors",
        /SyntaxError/,
      );

      // CLI entry writes report JSON and sets exit code 0 on PASS.
      const cliOut = path.join(tmp, "cli-report.json");
      const cliRun = cp.spawnSync(
        process.execPath,
        [
          path.resolve(repoRoot, "scripts/change-guard.mjs"),
          "HEAD",
          "HEAD",
          cliOut,
        ],
        { cwd: repoRoot, encoding: "utf8", timeout: 60000 },
      );
      assert.equal(cliRun.status, 0, cliRun.stderr);
      const parsed = JSON.parse(fs.readFileSync(cliOut, "utf8"));
      assert.equal(parsed.status, "PASS");
      assert.ok(cliRun.stdout.includes("Changed product script lines: 0"));
    });
  } finally {
    for (const [k, v] of Object.entries(prevTmp)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  return s.done();
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runChangeGuardTests();
}
