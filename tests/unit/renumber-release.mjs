// Synthetic git-repository tests for scripts/renumber-release.mjs:
// Verifies parallel-PR renumbering (product changed & unchanged, multi-step catch-up,
// idempotence) and all safety refusals + atomic rollback without touching anything outside tmp.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renumberRelease } from "../../scripts/renumber-release.mjs";
import { buildProduct } from "../../scripts/build.mjs";
import { listSources, readSource } from "../../scripts/product-script.mjs";
import { refusedWith } from "../../scripts/refusal.mjs";
import { documentIssues, PUBLIC_DOCUMENTS } from "../../scripts/doc-links.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const cliPath = path.join(repoRoot, "scripts", "renumber-release.mjs");

export function runRenumberReleaseChecks() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "kazohe-renumber-"));
  const savedEnv = Object.fromEntries(
    ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"].map((k) => [k, process.env[k]]),
  );
  fs.writeFileSync(path.join(scratch, "gitconfig"), "");
  process.env.GIT_CONFIG_GLOBAL = path.join(scratch, "gitconfig");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !/^GIT_/.test(k) || k in savedEnv,
    ),
  );

  const git = (root, ...args) => {
    const r = cp.spawnSync("git", ["-C", root, ...args], {
      env,
      encoding: "utf8",
    });
    assert.ok(!r.error, r.error?.message);
    return r;
  };
  const ok = (root, ...args) => {
    const r = git(root, ...args);
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  const write = (root, file, value) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
    );
  };
  const readFixture = (root, file) => readSource(file, root);
  const edit = (root, file, from, to) => {
    const src = readFixture(root, file);
    assert.ok(src.includes(from), `${file} missing expected text: ${from}`);
    write(root, file, src.replace(from, to));
  };
  const snapshotTree = (root) => {
    const walk = (dir) =>
      fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.name !== ".git")
        .flatMap((e) =>
          e.isDirectory()
            ? walk(path.join(dir, e.name))
            : [path.join(dir, e.name)],
        );
    return Object.fromEntries(
      walk(root)
        .sort()
        .map((p) => [
          path.relative(root, p).replaceAll("\\", "/"),
          fs.readFileSync(p).toString("base64"),
        ]),
    );
  };
  const commitAll = (root, msg) => {
    ok(root, "add", "-A");
    ok(root, "commit", "-q", "-m", msg);
  };

  const makeFixture = () => {
    const root = fs.mkdtempSync(path.join(scratch, "repo-"));
    write(root, "package.json", {
      name: "kazohe",
      version: "0.2.7",
      private: true,
      type: "module",
    });
    write(root, "package-lock.json", {
      name: "kazohe",
      version: "0.2.7",
      lockfileVersion: 3,
      packages: { "": { name: "kazohe", version: "0.2.7" } },
    });
    write(
      root,
      "src/shell.html",
      [
        "<!doctype html>",
        '<html lang="ja">',
        "<head>",
        "<title>かぞへ v__KAZOHE_VERSION__</title>",
        "<style>",
        "<!-- @include style.css -->",
        "</style>",
        "</head>",
        "<body>",
        '<script id="kazohe-core">',
        "const { KZLanguage, KZWritten, KZ, KZTeaching } = (() => {",
        '  "use strict";',
        "<!-- @core ts/00-prelude.ts -->",
        "<!-- @core ts/01-first.ts -->",
        "<!-- @core ts/02-second.ts -->",
        "  return { KZLanguage, KZWritten, KZ, KZTeaching };",
        "})();",
        "</script>",
        '<script id="kazohe-app">',
        "(() => {",
        '  "use strict";',
        "<!-- @include ts/10-app.ts -->",
        "})();",
        "</script>",
        "</body>",
        "</html>",
        "",
      ].join("\n"),
    );
    write(root, "src/style.css", "body { margin: 0; }\n");
    write(root, "src/catalog.json", []);
    write(root, "src/language.json", { allocations: [], readings: {} });
    write(
      root,
      "src/ts/00-prelude.ts",
      'import catalogJson from "../catalog.json" with { type: "json" };\nexport const APP_VERSION = "0.2.7";\nexport const CATALOG = catalogJson;\n',
    );
    write(
      root,
      "src/ts/01-first.ts",
      [
        'import languageJson from "../language.json" with { type: "json" };',
        'export const firstValue: string = "first";',
        "const count: number = 1;",
        "void count;",
        "export const KZLanguage = Object.freeze({ ok: true, data: languageJson });",
        "export const KZWritten = Object.freeze({ ok: true });",
        "",
      ].join("\n"),
    );
    write(
      root,
      "src/ts/02-second.ts",
      [
        'export const secondValue: string = "second";',
        "export const KZ = Object.freeze({ ok: true });",
        "export const KZTeaching = Object.freeze({ ok: true });",
        "",
      ].join("\n"),
    );
    write(root, "src/ts/10-app.ts", "const ready: boolean = true;\nvoid ready;\n");
    write(
      root,
      "README.md",
      "かぞへ v<!-- APP_VERSION -->0.2.7<!-- /APP_VERSION --> [本体](./Kazohe_0_2_7.html)\nPlaywright 0.2.7 is a tool label\n",
    );
    write(
      root,
      "index.html",
      '<!doctype html><html lang="ja"><body><a href="./Kazohe_0_2_7.html">かぞへ v0.2.7</a></body></html>\n',
    );
    write(
      root,
      "docs/verification.md",
      "# v<!-- APP_VERSION -->0.2.7<!-- /APP_VERSION --> 検証\n配布候補は `Kazohe_0_2_7.html`\n",
    );
    write(root, "tests/fixtures/implementation-map.json", [
      { id: "KZ-001", file: "Kazohe_0_2_7.html" },
    ]);
    write(
      root,
      "CHANGELOG.md",
      "# Changelog\n\n## v0.2.7 開発版\n\n- TypeScript release\n\n## v0.2.6 開発版\n\n- Previous release\n",
    );
    const initialHtml = buildProduct({
      root,
      read: (f) => readSource(f, root),
      list: (d) => listSources(d, root),
      version: "0.2.7",
    }).html;
    write(root, "Kazohe_0_2_7.html", initialHtml);
    ok(root, "init", "-q", "-b", "main");
    for (const [k, v] of [
      ["user.name", "fixture"],
      ["user.email", "fixture@example.invalid"],
      ["commit.gpgsign", "false"],
      ["core.autocrlf", "false"],
    ]) {
      ok(root, "config", k, v);
    }
    commitAll(root, "base 0.2.7");
    ok(root, "tag", "start");
    return root;
  };

  const makeParallelBranches = (root, { onSecond = () => {} } = {}) => {
    ok(root, "checkout", "-q", "-b", "first", "start");
    edit(root, "src/ts/01-first.ts", '"first"', '"first-updated"');
    assert.equal(renumberRelease(root, { base: "main" }).version, "0.2.8");
    commitAll(root, "first branch 0.2.8");

    ok(root, "checkout", "-q", "-b", "second", "start");
    edit(root, "src/ts/02-second.ts", '"second"', '"second-updated"');
    assert.equal(renumberRelease(root, { base: "main" }).version, "0.2.8");
    onSecond(root);
    commitAll(root, "second branch 0.2.8");

    ok(root, "checkout", "-q", "main");
    ok(root, "merge", "-q", "--ff-only", "first");
    ok(root, "checkout", "-q", "second");
  };

  const mergeMain = (root) => {
    git(root, "merge", "-q", "--no-edit", "main");
    return ok(root, "diff", "--name-only", "--diff-filter=U")
      .split("\n")
      .filter(Boolean)
      .sort();
  };

  let count = 0;
  try {
    // 1. Parallel PRs both bumped 0.2.7 -> 0.2.8; after first merges, second merges main
    //    and CLI renumbers cleanly to 0.2.9, updating package.json, package-lock.json,
    //    00-prelude.ts, Kazohe_0_2_9.html, and stamped docs while keeping tool versions & CHANGELOG.
    {
      const root = makeFixture();
      makeParallelBranches(root);
      const conflicts = mergeMain(root);
      assert.ok(
        conflicts.every((f) => f === "Kazohe_0_2_8.html"),
        `only generated product HTML may conflict, got: ${conflicts.join(", ")}`,
      );
      const r = cp.spawnSync(process.execPath, [cliPath, "--base", "main"], {
        cwd: root,
        env,
        encoding: "utf8",
      });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /^Release 0\.2\.8 -> 0\.2\.9 /);
      commitAll(root, "merge main and renumber to 0.2.9");

      assert.equal(
        JSON.parse(readFixture(root, "package.json")).version,
        "0.2.9",
      );
      const lock = JSON.parse(readFixture(root, "package-lock.json"));
      assert.equal(lock.version, "0.2.9");
      assert.equal(lock.packages[""].version, "0.2.9");
      assert.ok(
        readFixture(root, "src/ts/00-prelude.ts").includes(
          'export const APP_VERSION = "0.2.9";',
        ),
      );
      const rootHtmls = fs
        .readdirSync(root)
        .filter((n) => /^Kazohe.*\.html$/.test(n));
      assert.deepEqual(rootHtmls, ["Kazohe_0_2_9.html"]);
      const htmlText = readFixture(root, "Kazohe_0_2_9.html");
      assert.ok(
        htmlText.includes('"first-updated"') &&
          htmlText.includes('"second-updated"') &&
          htmlText.includes('"0.2.9"'),
      );
      assert.ok(
        !htmlText.includes(": string") && !htmlText.includes(": number"),
        "TypeScript type annotations must be erased in built HTML",
      );
      assert.ok(readFixture(root, "README.md").includes("Kazohe_0_2_9.html"));
      assert.ok(
        readFixture(root, "README.md").includes(
          "Playwright 0.2.7 is a tool label",
        ),
        "tool versions must not be rewritten",
      );
      assert.ok(readFixture(root, "index.html").includes("Kazohe_0_2_9.html"));
      assert.ok(
        readFixture(root, "docs/verification.md").includes(
          "<!-- APP_VERSION -->0.2.9<!-- /APP_VERSION -->",
        ),
      );
      assert.ok(
        readFixture(root, "tests/fixtures/implementation-map.json").includes(
          "Kazohe_0_2_9.html",
        ),
      );
      const changelog = readFixture(root, "CHANGELOG.md");
      assert.ok(
        changelog.includes("## v0.2.9 開発版"),
        "top CHANGELOG heading must advance to 0.2.9",
      );
      assert.ok(
        changelog.includes("## v0.2.6 開発版"),
        "historical CHANGELOG headings stay intact",
      );
      const docMap = Object.fromEntries(
        PUBLIC_DOCUMENTS.map((doc) => [doc, readFixture(root, doc)]),
      );
      assert.deepEqual(
        documentIssues(docMap, {
          productFile: "Kazohe_0_2_9.html",
          productVersion: "0.2.9",
          exists: (rel) => fs.existsSync(path.join(root, rel)),
        }),
        [],
        "renumbered documents must pass doc-links cleanliness",
      );
      // Idempotence: renumbering again makes zero changes.
      assert.deepEqual(renumberRelease(root, { base: "main" }).changed, []);
      count++;
    }

    // 2. Audit/docs-only branch (no src/ or product HTML change) follows base version 0.2.8.
    {
      const root = makeFixture();
      makeParallelBranches(root);
      ok(root, "checkout", "-q", "-b", "docs-only", "start");
      write(root, "docs/notes.md", "# Notes\nDocumentation update.\n");
      commitAll(root, "docs update");
      assert.deepEqual(mergeMain(root), []);
      const res = renumberRelease(root, { base: "main" });
      assert.equal(res.version, "0.2.8");
      assert.equal(res.productChanged, false);
      assert.deepEqual(res.changed, []);
      count++;
    }

    // 3. All safety refusals leave the working tree byte-identical (0 mutations).
    const assertRefused = (
      prepare,
      pattern,
      { base = "main", at = (r) => r, verify } = {},
    ) => {
      const root = makeFixture();
      prepare(root);
      const before = snapshotTree(root);
      assert.throws(
        () => renumberRelease(at(root), { base, verify }),
        refusedWith({ message: pattern }),
      );
      assert.deepEqual(snapshotTree(root), before);
      count++;
    };

    // Unmerged base
    assertRefused(
      (root) => {
        makeParallelBranches(root);
      },
      /does not contain main/,
    );
    // Rebase in progress
    assertRefused(
      (root) => {
        makeParallelBranches(root, {
          onSecond: (r) =>
            edit(r, "src/ts/01-first.ts", '"first"', '"first-rebase-conflict"'),
        });
        git(root, "rebase", "main");
      },
      /a rebase is in progress/,
    );
    // Not at repo root
    assertRefused(
      (root) => {
        makeParallelBranches(root);
        mergeMain(root);
      },
      /run from the repository root/,
      { at: (r) => path.join(r, "src") },
    );
    // Unresolved merge conflict in hand-written file
    assertRefused(
      (root) => {
        makeParallelBranches(root, {
          onSecond: (r) =>
            edit(r, "src/ts/01-first.ts", '"first"', '"first-from-second"'),
        });
        mergeMain(root);
      },
      /resolve these conflicts by hand first: src\/ts\/01-first\.ts/,
    );
    // Conflict marker left in resolved file
    assertRefused(
      (root) => {
        makeParallelBranches(root);
        mergeMain(root);
        edit(
          root,
          "README.md",
          "Playwright",
          "<<<<<<< ours\nPlaywright\n=======\nTool\n>>>>>>> main",
        );
      },
      /resolve these conflicts by hand first: README\.md/,
    );
    // Version downgrade refusal (branch already bumped to 0.3.0 > 0.2.9)
    assertRefused(
      (root) => {
        makeParallelBranches(root);
        ok(root, "checkout", "-q", "-b", "minor-bump", "main");
        edit(root, "src/ts/00-prelude.ts", '"0.2.8"', '"0.3.0"');
        edit(root, "src/ts/01-first.ts", '"first-updated"', '"minor-feature"');
      },
      /names 0\.3\.0, above 0\.2\.9/,
    );
    // Added line in non-doc file containing ambiguous retired version
    assertRefused(
      (root) => {
        makeParallelBranches(root, {
          onSecond: (r) =>
            write(r, "tests/added-note.txt", "fixture targeting 0.2.8\n"),
        });
        mergeMain(root);
      },
      /earlier release \(0\.2\.8[^)]*\)[\s\S]*tests\/added-note\.txt: fixture targeting 0\.2\.8/,
    );
    // Untracked file containing ambiguous retired version
    assertRefused(
      (root) => {
        makeParallelBranches(root);
        mergeMain(root);
        write(root, "tests/untracked-note.txt", "temporary 0.2.8 note\n");
      },
      /earlier release[\s\S]*tests\/untracked-note\.txt: temporary 0\.2\.8 note/,
    );
    // Leftover recovery directory from earlier failed run
    assertRefused(
      (root) => {
        makeParallelBranches(root);
        mergeMain(root);
        write(root, ".release-renumber-leftover/package.json", "{}\n");
      },
      /left its recovery files/,
    );
    // Unknown base ref
    assertRefused(
      (root) => {
        makeParallelBranches(root);
        mergeMain(root);
      },
      /unknown base missing-ref/,
      { base: "missing-ref" },
    );
    // Rollback on post-apply verification failure restores every file cleanly
    assertRefused(
      (root) => {
        makeParallelBranches(root);
        mergeMain(root);
      },
      /simulated post-apply check failure/,
      {
        verify: () => {
          throw new Error("simulated post-apply check failure");
        },
      },
    );
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return count;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  console.log(`renumber-release: ${runRenumberReleaseChecks()} PASS`);
}
