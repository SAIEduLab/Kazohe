// Safe parallel-PR release renumbering with backup staging and rollback.
// Usage: node scripts/renumber-release.mjs [--base <ref>]  (default: origin/main)
// Renumbers package.json, package-lock.json, the single TS release constant in src/,
// the versioned Kazohe_X_Y_Z.html artifact, and stamped docs so the branch matches
// the change-guard version rule against <base>. Stages nothing and commits nothing.
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { buildProduct } from "./build.mjs";
import { listSources, readSource } from "./product-script.mjs";
import { documentIssues, PUBLIC_DOCUMENTS } from "./doc-links.mjs";

const SEMVER_EXACT = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SEMVER_ANY =
  /(?<![0-9.])(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?![0-9.])/g;
const PRODUCT_HTML_NAME = /^Kazohe(?:_\d+_\d+_\d+)?\.html$/;
const RELEASE_DECL =
  /^(export const (?:APP_VERSION|PRODUCT_RELEASE)\s*=\s*["'])(\d+\.\d+\.\d+)(["'];)$/gm;
const CONFLICT_MARKER = /^(?:<{7}|>{7})(?: |$)/m;
const STAGING_PREFIX = ".release-renumber-";
const RECORDED_PKG_VERSION = /^[+-]\s*"version":\s*"(\d+\.\d+\.\d+)"/gm;
const TOOL_PREFIX =
  /(?:Node(?:\.js)?|Playwright|Chromium|Firefox|WebKit|ESLint|TypeScript|Prettier|jsdom|acorn|parse5|axe-core|css-tree|micromark|mdast|unicorn|sonarjs|@babel\/parser|@playwright\/test|v?node)\s+v?$/i;

export const STAMPED_DOCS = Object.freeze([
  "index.html",
  "README.md",
  "docs/verification.md",
  "tests/fixtures/implementation-map.json",
]);

export const generatedOutput = (file) => PRODUCT_HTML_NAME.test(file);

export function productFilename(version) {
  if (!SEMVER_EXACT.test(version)) {
    throw new Error(`Product version must be major.minor.patch: ${version}`);
  }
  return `Kazohe_${version.replaceAll(".", "_")}.html`;
}

export function nextPatch(version) {
  const m = SEMVER_EXACT.exec(version);
  if (!m) throw new Error(`Invalid semver version: ${version}`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

export function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export const versionAfter = (a, b) => compareVersions(a, b) > 0;

function gitIn(root) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^GIT_(?:DIR|WORK_TREE|INDEX_FILE|COMMON_DIR)$/.test(key),
    ),
  );
  const run = (args) => {
    const r = cp.spawnSync("git", ["-C", root, ...args], {
      env,
      maxBuffer: 1024 * 1024 * 256,
    });
    assert.ok(!r.error, `git ${args.join(" ")} failed: ${r.error?.message}`);
    return r;
  };
  const git = (args, { buffer = false } = {}) => {
    const r = run(args);
    assert.equal(
      r.status,
      0,
      `git ${args.join(" ")} failed: ${r.stderr.toString("utf8").trim()}`,
    );
    return buffer ? r.stdout : r.stdout.toString("utf8");
  };
  return { run, git };
}

const refuse = (items, message) => {
  if (items.length) throw new Error(message);
};

const listed = (text) => [...new Set(text.split("\0").filter(Boolean))];

function checkoutFiles(root, git) {
  const exists = (file) => fs.existsSync(path.join(root, ...file.split("/")));
  return [
    ...new Set([
      ...listed(git(["ls-files", "-z"])),
      ...listed(git(["ls-files", "-z", "--others", "--exclude-standard"])),
    ]),
  ]
    .filter(exists)
    .sort();
}

function labelsIn(text, versions) {
  return [...text.matchAll(SEMVER_ANY)].filter(
    (m) =>
      versions.has(m[0]) &&
      !TOOL_PREFIX.test(text.slice(Math.max(0, m.index - 40), m.index)),
  );
}

function stampDocument(text, version, retired) {
  const htmlFile = productFilename(version);
  return text
    .replace(/Kazohe(?:_\d+_\d+_\d+)?\.html/g, htmlFile)
    .replace(
      /<!-- APP_VERSION -->.*?<!-- \/APP_VERSION -->/g,
      `<!-- APP_VERSION -->${version}<!-- /APP_VERSION -->`,
    )
    .replace(SEMVER_ANY, (label, at, whole) =>
      retired.has(label) &&
      !TOOL_PREFIX.test(whole.slice(Math.max(0, at - 40), at))
        ? version
        : label,
    );
}

function rewritePackageJson(text, version) {
  const replaced = text.replace(
    /("version"\s*:\s*")\d+\.\d+\.\d+(")/,
    `$1${version}$2`,
  );
  assert.equal(
    JSON.parse(replaced).version,
    version,
    "package.json version update failed",
  );
  return replaced;
}

function rewritePackageLock(text, version) {
  const parsed = JSON.parse(text);
  let count = 0;
  let updated = text.replace(
    /^(\s*"version"\s*:\s*")\d+\.\d+\.\d+(",?)$/m,
    (_m, a, b) => {
      count++;
      return `${a}${version}${b}`;
    },
  );
  if (parsed.packages?.[""]?.version) {
    updated = updated.replace(
      /("":\s*\{[\s\S]*?"version"\s*:\s*")\d+\.\d+\.\d+(")/,
      `$1${version}$2`,
    );
  }
  const reparsed = JSON.parse(updated);
  assert.ok(count === 1 && reparsed.version === version, "package-lock.json root version update failed");
  if (reparsed.packages?.[""]) {
    assert.equal(
      reparsed.packages[""].version,
      version,
      "package-lock.json packages[\"\"] version update failed",
    );
  }
  return updated;
}

function stampChangelog(text, version, retired) {
  return text.replace(
    /^(##\s+v)(\d+\.\d+\.\d+)([^\n]*)$/m,
    (line, prefix, found, rest) =>
      retired.has(found) ? `${prefix}${version}${rest}` : line,
  );
}

// Default builder delegates to scripts/build.mjs buildProduct (full TS type erasure).
function defaultBuildHtml({ root, read, version }) {
  return buildProduct({
    root,
    read,
    list: (dir) => listSources(dir, root),
    version,
  }).html;
}

export function planReleaseRenumber(
  root,
  { base = "origin/main", build = defaultBuildHtml } = {},
) {
  root = fs.realpathSync.native(root);
  const { run, git } = gitIn(root);
  const full = (file) => path.join(root, ...file.split("/"));
  const exists = (file) => fs.existsSync(full(file));
  const bytes = (file) => fs.readFileSync(full(file));
  const loadText = (file) => readSource(file, root);
  const isText = (file) => exists(file) && !bytes(file).includes(0);

  const top = git(["rev-parse", "--show-toplevel"]).trim();
  assert.equal(
    fs.realpathSync.native(top),
    root,
    `run from the repository root ${top}`,
  );
  const gitPath = (name) =>
    path.resolve(root, git(["rev-parse", "--git-path", name]).trim());
  assert.ok(
    !["rebase-merge", "rebase-apply"].some((name) =>
      fs.existsSync(gitPath(name)),
    ),
    "a rebase is in progress; take the base in with a merge, then renumber",
  );

  const resolved = run(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  assert.equal(resolved.status, 0, `unknown base ${base}`);
  const baseCommit = resolved.stdout.toString("utf8").trim();
  const mergeHead = run(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"])
    .stdout.toString("utf8")
    .trim();
  const contained = ["HEAD", ...(mergeHead ? [mergeHead] : [])].some(
    (commit) =>
      run(["merge-base", "--is-ancestor", baseCommit, commit]).status === 0,
  );
  assert.ok(
    contained,
    `the branch does not contain ${base} (${baseCommit}); merge it first, then renumber`,
  );

  const files = checkoutFiles(root, git);
  const leftover = files.filter((file) => file.startsWith(STAGING_PREFIX));
  refuse(
    leftover,
    `an earlier renumber left its recovery files; restore from them or remove them first: ${leftover.join(", ")}`,
  );
  const unmerged = listed(
    git(["ls-files", "-u", "-z"])
      .split("\0")
      .map((line) => line.slice(line.indexOf("\t") + 1))
      .join("\0"),
  );
  const unresolved = [
    ...unmerged.filter((file) => !generatedOutput(file)),
    ...files.filter(
      (file) =>
        !generatedOutput(file) &&
        !unmerged.includes(file) &&
        isText(file) &&
        CONFLICT_MARKER.test(loadText(file)),
    ),
  ];
  refuse(
    unresolved,
    `resolve these conflicts by hand first: ${unresolved.join(", ")}`,
  );

  const show = (spec) => git(["show", spec], { buffer: true });
  const basePkg = JSON.parse(show(`${baseCommit}:package.json`).toString("utf8"));
  const baseVersion = basePkg.version;
  const baseProductFile = productFilename(baseVersion);
  const currentPkg = JSON.parse(loadText("package.json"));

  const sources = files.filter((file) => file.startsWith("src/"));
  const labelled = sources.filter(
    (file) => isText(file) && [...loadText(file).matchAll(RELEASE_DECL)].length > 0,
  );
  assert.ok(
    labelled.length <= 1,
    `at most one src/ file may declare APP_VERSION/PRODUCT_RELEASE: ${labelled.join(", ")}`,
  );
  const labelFile = labelled[0] ?? null;
  let previous = currentPkg.version;
  const relabel = (source, ver) =>
    source.replace(RELEASE_DECL, (_line, start, _old, end) => `${start}${ver}${end}`);
  if (labelFile) {
    const matches = [...loadText(labelFile).matchAll(RELEASE_DECL)];
    assert.equal(
      matches.length,
      1,
      `${labelFile}: expected one APP_VERSION/PRODUCT_RELEASE declaration`,
    );
    previous = matches[0][2];
  }

  // Judge productChanged identically to change-guard: src/ or product HTML differs from base.
  const atBase = (file) =>
    file === labelFile
      ? Buffer.from(relabel(loadText(file), baseVersion))
      : bytes(file);
  const baseSources = listed(
    git(["ls-tree", "-r", "-z", "--name-only", baseCommit, "--", "src"]),
  );
  const sourceChanged =
    baseSources.length !== sources.length ||
    sources.some(
      (file) =>
        !baseSources.includes(file) ||
        !atBase(file).equals(show(`${baseCommit}:${file}`)),
    );
  const readAtBase = (file) =>
    sources.includes(file) ? atBase(file).toString("utf8") : loadText(file);
  const builtAtBase = build({ root, read: readAtBase, version: baseVersion });
  const productChanged =
    sourceChanged ||
    !Buffer.from(builtAtBase).equals(show(`${baseCommit}:${baseProductFile}`));

  const version = productChanged ? nextPatch(baseVersion) : baseVersion;
  const productFile = productFilename(version);

  // Renumbering never lowers a branch version.
  const highestBranchVersion = versionAfter(currentPkg.version, previous)
    ? currentPkg.version
    : previous;
  assert.ok(
    !versionAfter(highestBranchVersion, version),
    `the branch names ${highestBranchVersion}, above ${version}; a raise other than one patch is an explicit decision, so renumber it by hand`,
  );

  // Collect retired version labels from base, current checkout, and branch history.
  const history = git([
    "log",
    "-p",
    "--no-color",
    "--no-ext-diff",
    "--format=",
    `${baseCommit}..HEAD`,
    "--",
    "package.json",
  ]);
  const retired = new Set(
    [
      previous,
      baseVersion,
      currentPkg.version,
      ...[...history.matchAll(RECORDED_PKG_VERSION)].map((m) => m[1]),
    ].filter((label) => label && label !== version),
  );

  // Refuse ambiguous old version strings in added lines or untracked files outside managed targets.
  const stampedSet = new Set(STAMPED_DOCS);
  const managed = (file) =>
    stampedSet.has(file) ||
    file === "CHANGELOG.md" ||
    file === "package.json" ||
    file === "package-lock.json" ||
    file.startsWith("src/") ||
    generatedOutput(file);

  const stale = [];
  if (retired.size) {
    const diff = git([
      "-c",
      "core.quotePath=false",
      "-c",
      "diff.noprefix=false",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "-U0",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      baseCommit,
      "--",
      ".",
      ":(exclude)src",
      ":(exclude)CHANGELOG.md",
      ":(exclude)package.json",
      ":(exclude)package-lock.json",
      ":(exclude)*.html",
    ]);
    let currentFile = null;
    let inHeader = false;
    for (const line of diff.split("\n")) {
      if (line.startsWith("diff --git ")) {
        inHeader = true;
        currentFile = null;
        continue;
      }
      if (inHeader) {
        if (line.startsWith("+++ ")) {
          currentFile = line === "+++ /dev/null" ? null : line.slice(6);
        }
        if (line.startsWith("@@")) inHeader = false;
        continue;
      }
      if (
        currentFile &&
        !managed(currentFile) &&
        line.startsWith("+") &&
        labelsIn(line.slice(1), retired).length
      ) {
        stale.push(`${currentFile}: ${line.slice(1).trim()}`);
      }
    }
    const untracked = new Set(
      listed(git(["ls-files", "-z", "--others", "--exclude-standard"])),
    );
    for (const file of files.filter(
      (f) => untracked.has(f) && !managed(f) && isText(f),
    )) {
      for (const line of loadText(file).split("\n")) {
        if (labelsIn(line, retired).length) {
          stale.push(`${file}: ${line.trim()}`);
        }
      }
    }
  }
  refuse(
    stale,
    `lines this branch added name an earlier release (${[...retired].join(", ")}); change them by hand to ${version} or to wording without a release:\n${stale.join("\n")}`,
  );

  // Plan all file updates.
  const changes = new Map();
  const put = (file, after) => {
    const before = exists(file) ? bytes(file) : null;
    const next = after === null ? null : Buffer.from(after);
    if ((before === null && next === null) || (before && next && before.equals(next))) {
      return;
    }
    changes.set(file, { before, after: next });
  };

  put("package.json", rewritePackageJson(loadText("package.json"), version));
  if (exists("package-lock.json")) {
    put(
      "package-lock.json",
      rewritePackageLock(loadText("package-lock.json"), version),
    );
  }
  if (labelFile) {
    put(labelFile, relabel(loadText(labelFile), version));
  }
  for (const doc of STAMPED_DOCS) {
    if (exists(doc)) {
      put(doc, stampDocument(loadText(doc), version, retired));
    }
  }
  if (exists("CHANGELOG.md")) {
    put(
      "CHANGELOG.md",
      stampChangelog(loadText("CHANGELOG.md"), version, retired),
    );
  }

  const readNext = (file) =>
    changes.has(file) ? changes.get(file).after.toString("utf8") : loadText(file);
  const builtHtml = build({ root, read: readNext, version });
  put(productFile, builtHtml);
  for (const name of fs
    .readdirSync(root)
    .filter((n) => PRODUCT_HTML_NAME.test(n) && n !== productFile)) {
    put(name, null);
  }

  return {
    root,
    base: baseCommit,
    baseVersion,
    previous,
    version,
    productFile,
    productChanged,
    retired,
    changes,
    build,
  };
}

export function applyReleaseRenumber(plan, { verify } = {}) {
  const { root, changes, version, productFile, build } = plan;
  const full = (file) => path.join(root, ...file.split("/"));
  const now = (file) => (fs.existsSync(full(file)) ? fs.readFileSync(full(file)) : null);
  for (const [file, { before }] of changes) {
    assert.deepEqual(now(file), before, `renumber input changed: ${file}`);
  }
  const staging = fs.mkdtempSync(path.join(root, STAGING_PREFIX));
  const applied = [];
  const place = (from, file) => {
    fs.mkdirSync(path.dirname(full(file)), { recursive: true });
    fs.renameSync(from, full(file));
  };
  const copy = (file, data, dir) => {
    const target = path.join(staging, dir, ...file.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    return target;
  };
  let keepStaging = false;
  try {
    for (const [file, { before, after }] of changes) {
      if (before !== null) copy(file, before, "backup");
      if (after !== null) copy(file, after, "next");
    }
    // Write/update files first, delete stale outputs last.
    const ordered = [...changes].sort(
      (a, b) => Number(a[1].after === null) - Number(b[1].after === null),
    );
    for (const [file, { after }] of ordered) {
      applied.push(file);
      if (after === null) fs.unlinkSync(full(file));
      else place(path.join(staging, "next", ...file.split("/")), file);
    }

    // Post-apply verification: package.json, single product HTML matching build, clean docs.
    const pkg = JSON.parse(fs.readFileSync(full("package.json"), "utf8"));
    assert.equal(pkg.version, version, "renumbered package.json version mismatch");
    const rootHtmls = fs
      .readdirSync(root)
      .filter((n) => PRODUCT_HTML_NAME.test(n));
    assert.deepEqual(
      rootHtmls,
      [productFile],
      `expected only ${productFile} at root; found ${rootHtmls.join(", ")}`,
    );
    const readDisk = (file) => readSource(file, root);
    const rebuilt = build({ root, read: readDisk, version });
    assert.ok(
      Buffer.from(rebuilt).equals(Buffer.from(readDisk(productFile))),
      "rebuilt product HTML differs from written artifact",
    );
    const docsToCheck = {};
    for (const doc of PUBLIC_DOCUMENTS) {
      if (fs.existsSync(full(doc))) docsToCheck[doc] = readDisk(doc);
    }
    const docProblems = documentIssues(docsToCheck, {
      productFile,
      productVersion: version,
      exists: (rel) => fs.existsSync(full(rel)),
    });
    refuse(
      docProblems,
      `documents failed release link/version verification:\n${docProblems.join("\n")}`,
    );
    if (verify) verify(plan);
  } catch (error) {
    const failures = [];
    for (const file of applied.reverse()) {
      try {
        const { before } = changes.get(file);
        if (before === null) {
          fs.rmSync(full(file), { force: true });
        } else {
          fs.mkdirSync(path.dirname(full(file)), { recursive: true });
          fs.copyFileSync(
            path.join(staging, "backup", ...file.split("/")),
            full(file),
          );
        }
      } catch (restoreError) {
        failures.push(`${file}: ${restoreError.message}`);
      }
    }
    if (failures.length) {
      keepStaging = true;
      error.message += `; restoring failed: ${failures.join(", ")}; recovery files kept in ${staging}`;
      error.recoveryDirectory = staging;
    }
    throw error;
  } finally {
    if (!keepStaging) fs.rmSync(staging, { recursive: true, force: true });
  }
  return [...changes.keys()].sort();
}

export function renumberRelease(root, options = {}) {
  const plan = planReleaseRenumber(root, options);
  const changed = applyReleaseRenumber(plan, { verify: options.verify });
  return {
    base: plan.base,
    baseVersion: plan.baseVersion,
    previous: plan.previous,
    version: plan.version,
    productFile: plan.productFile,
    productChanged: plan.productChanged,
    changed,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--base");
  if (args.length !== (at < 0 ? 0 : 2) || at > 0 || (at === 0 && !args[1])) {
    throw new Error("usage: node scripts/renumber-release.mjs [--base <ref>]");
  }
  const result = renumberRelease(
    process.cwd(),
    at < 0 ? {} : { base: args[1] },
  );
  console.log(
    `Release ${result.previous} -> ${result.version} (base ${result.baseVersion} at ${result.base.slice(0, 12)}, ${result.productChanged ? "product or src/ changed" : "product and src/ unchanged"})`,
  );
  for (const file of result.changed) console.log(`  ${file}`);
  if (!result.changed.length) console.log("  nothing to change");
}
