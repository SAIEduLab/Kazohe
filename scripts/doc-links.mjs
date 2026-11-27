// AST Markdown and HTML link + release/filename checks, plus git-sanitized
// bidirectional tracked-file allowlist verification.
import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appVersion, htmlName } from "./artifact.mjs";
import { refusedWith } from "./refusal.mjs";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PUBLIC_DOCUMENTS = Object.freeze([
  "README.md",
  "CHANGELOG.md",
  "docs/verification.md",
  "index.html",
]);

export function allowedPublicFiles(productHtml = htmlName) {
  return [
    ".gitattributes",
    ".gitignore",
    ".github/CODEOWNERS",
    ".github/workflows/audit.yml",
    ".github/workflows/change-guard.yml",
    "CHANGELOG.md",
    productHtml,
    "LICENSE",
    "README.md",
    "index.html",
    "docs/verification.md",
    "package.json",
    "package-lock.json",
    "playwright.config.mjs",
    ...[
      "app.js",
      "catalog.json",
      "core.js",
      "shell.html",
      "style.css",
      "view.js",
      "teaching.js",
      "language.js",
      "language.json",
      "written.js",
    ].map((name) => `src/${name}`),
    ...[
      "artifact",
      "aggregate-evidence",
      "assertion-counts",
      "audit-catalog",
      "audit-code",
      "audit-inventory",
      "audit-release",
      "audit-single-html",
      "behaviour-snapshot",
      "build",
      "change-guard",
      "coverage",
      "doc-links",
      "independent-math-oracle",
      "lint",
      "lint-gate",
      "load-inline-core",
      "manifest",
      "refusal",
      "release-gate",
      "report",
      "review-gallery",
      "run-unit",
      "test-reporter",
      "visual-diff",
      "workflow-contract",
    ].map((name) => `scripts/${name}.mjs`),
    ...[
      "e2e/app.spec.mjs",
      "e2e/site.spec.mjs",
      "e2e/usability.spec.mjs",
      "e2e/teaching.spec.mjs",
      "evidence/visual-review.json",
      "fixtures/catalog.json",
      "fixtures/implementation-map.json",
      "fixtures/representatives.mjs",
      "fixtures/support-navigation.mjs",
      "fixtures/written-oracle.mjs",
      "fixtures/v0.2.4-backup.json",
      "manifests/intended-audit-changes.json",
      "manifests/intended-behaviour-changes.json",
      "property/domain-contracts.mjs",
      "property/generators.mjs",
      "unit/change-guard.mjs",
      "unit/core.mjs",
      "unit/pedagogy.mjs",
    ].map((name) => `tests/${name}`),
  ];
}

// Files tracked by the git checkout at root. Strips GIT_DIR / GIT_WORK_TREE /
// GIT_INDEX_FILE / GIT_COMMON_DIR so caller environment cannot redirect git.
export function trackedFiles(root = rootDir) {
  assert.ok(
    fs.existsSync(path.join(root, ".git")),
    "tracked-file check needs a git checkout; no .git at " + root,
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^GIT_(?:DIR|WORK_TREE|INDEX_FILE|COMMON_DIR)$/.test(key),
    ),
  );
  const git = (...args) => {
    const r = cp.spawnSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      env,
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(
      r.status,
      0,
      "git " +
        args.join(" ") +
        " failed: " +
        (r.error ? r.error.message : r.stderr.trim()),
    );
    return r.stdout;
  };
  assert.equal(
    fs.realpathSync.native(git("rev-parse", "--show-toplevel").trim()),
    fs.realpathSync.native(root),
    "checkout root mismatch",
  );
  return git("ls-files", "-z").split("\0").filter(Boolean);
}

// Bidirectional allowlist check: every listed file is tracked, every tracked file
// is listed, and no entry repeats.
export function assertTrackedFilesMatch(listed, tracked) {
  const repeated = listed.filter((file, i) => listed.indexOf(file) !== i);
  const trackedSet = new Set(tracked);
  const listedSet = new Set(listed);
  const untracked = listed.filter((file) => !trackedSet.has(file));
  const unlisted = tracked.filter((file) => !listedSet.has(file));
  if (repeated.length || untracked.length || unlisted.length) {
    throw new Error(
      "Public tracked-file allowlist mismatch: " +
        JSON.stringify({ repeated, untracked, unlisted }),
    );
  }
}

let markdownParser, markdownTokenizer, htmlParser;
const offsets = (node) => [
  node.position.start.offset,
  node.position.end.offset,
];

function resolveRelativeUrl(file, url) {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(url)) return null;
  if (url.startsWith("#")) return { resolved: file, fragment: url.slice(1) };
  if (url.startsWith("/")) return { resolved: url.slice(1), fragment: "" };
  const base = "https://kazohe.invalid/__kazohe_root__/";
  try {
    const parsed = new URL(
      url,
      base + file.split("/").map(encodeURIComponent).join("/"),
    );
    if (!parsed.href.startsWith(base)) return { outsideRoot: true, url };
    const resolved = decodeURIComponent(
      parsed.pathname.slice("/__kazohe_root__/".length),
    );
    return {
      resolved,
      fragment: parsed.hash ? decodeURIComponent(parsed.hash.slice(1)) : "",
    };
  } catch {
    return { malformed: true, url };
  }
}

// Extracts relative links from Markdown (via mdast-util-from-markdown + micromark)
// and HTML (via parse5), plus HTML element IDs. Code blocks, inline code, and raw
// HTML text elements (<script>, <style>, ...) never produce links.
export function extractDocumentLinks(file, text) {
  const links = [];
  const htmlRanges = [];
  const rawTextRanges = [];
  const htmlIds = new Set();

  const lineOf = (index) => text.slice(0, index).split("\n").length;
  const addLink = (url, start, kind) => {
    const rel = resolveRelativeUrl(file, url);
    if (!rel) return;
    links.push({ ...rel, url, line: lineOf(start), start, kind });
  };

  if (file.endsWith(".md")) {
    const { fromMarkdown } = (markdownParser ??= require(
      "mdast-util-from-markdown",
    ));
    const { parse, postprocess, preprocess } = (markdownTokenizer ??=
      require("micromark"));
    const tree = fromMarkdown(text);
    const destinations = postprocess(
      parse().document().write(preprocess()(text, undefined, true)),
    )
      .filter(
        ([event, token]) =>
          event === "enter" &&
          [
            "resourceDestinationString",
            "definitionDestinationString",
          ].includes(token.type),
      )
      .map(([, token]) => ({
        type: token.type,
        start: token.start.offset,
        end: token.end.offset,
      }));
    const destination = (node, type, after) =>
      destinations.find(
        (token) =>
          token.type === type &&
          token.start >= after &&
          token.end <= node.position.end.offset,
      ) ?? { start: after };
    const walkMd = (node) => {
      if (node.type === "html") htmlRanges.push(offsets(node));
      if (node.type === "link" || node.type === "image") {
        const close =
          node.children?.at(-1)?.position?.end?.offset ??
          node.position.start.offset + 1;
        const span = destination(node, "resourceDestinationString", close);
        addLink(node.url, span.start, "markdown");
      }
      if (node.type === "definition") {
        const [start] = offsets(node);
        const span = destination(node, "definitionDestinationString", start);
        addLink(node.url, span.start, "reference");
      }
      for (const child of node.children ?? []) walkMd(child);
    };
    walkMd(tree);
  } else {
    htmlRanges.push([0, text.length]);
  }

  if (htmlRanges.length) {
    const visible = text.split("");
    let cursor = 0;
    for (const [start, end] of htmlRanges.sort((a, b) => a[0] - b[0])) {
      for (; cursor < start; cursor++)
        if (visible[cursor] !== "\n") visible[cursor] = " ";
      cursor = Math.max(cursor, end);
    }
    for (; cursor < visible.length; cursor++)
      if (visible[cursor] !== "\n") visible[cursor] = " ";
    const { parseFragment } = (htmlParser ??= require("parse5"));
    const fragment = parseFragment(visible.join(""), {
      sourceCodeLocationInfo: true,
    });
    const walkHtml = (node) => {
      if (
        [
          "script",
          "style",
          "textarea",
          "title",
          "xmp",
          "iframe",
          "noembed",
          "noframes",
          "plaintext",
        ].includes(node.tagName) &&
        node.sourceCodeLocation?.startTag
      ) {
        rawTextRanges.push([
          node.sourceCodeLocation.startTag.endOffset,
          node.sourceCodeLocation.endTag?.startOffset ??
            node.sourceCodeLocation.endOffset,
        ]);
      }
      for (const attr of node.attrs ?? []) {
        if (attr.name === "id" && attr.value) htmlIds.add(attr.value);
        if (
          attr.name === "href" &&
          ["a", "area", "link", "base"].includes(node.tagName)
        ) {
          const key = attr.prefix ? `${attr.prefix}:href` : "href";
          const loc = node.sourceCodeLocation?.attrs?.[key];
          addLink(attr.value, loc?.startOffset ?? 0, "html");
        }
      }
      for (const child of node.childNodes ?? []) walkHtml(child);
      if (node.content) walkHtml(node.content);
    };
    walkHtml(fragment);
  }

  const filtered = links.filter(
    (row) =>
      row.kind === "html" ||
      !rawTextRanges.some(
        ([start, end]) => row.start >= start && row.start < end,
      ),
  );
  return { links: filtered, htmlIds };
}

export const productFilenamePattern = /Kazohe_?\d+_\d+_\d+\.html/g;
export const versionNumberPattern = /(?<![\d.])\d+\.\d+\.\d+(?!\d|\.\d)/g;
export const toolVersionPrefix =
  /(?:@|\b(?:Playwright|jsdom|Chrome for Testing|Chrome|Chromium|Node\.js|Python|ESLint)\s+|v(?=\d+\.\d+\.\d+-backup\.json))/i;

export function documentIssues(
  documents,
  {
    productFile = htmlName,
    productVersion = appVersion,
    exists = (target) => fs.existsSync(path.join(rootDir, target)),
  } = {},
) {
  const issues = [];
  for (const [file, text] of Object.entries(documents).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const lineOf = (index) => text.slice(0, index).split("\n").length;
    const isChangelog = file === "CHANGELOG.md";

    if (text.includes("かぞへ.html")) {
      issues.push(
        `${file}:${lineOf(text.indexOf("かぞへ.html"))} references retired legacy filename かぞへ.html`,
      );
    }

    const { links, htmlIds } = extractDocumentLinks(file, text);
    for (const link of links) {
      if (link.outsideRoot || link.malformed) {
        issues.push(`${file}:${link.line} invalid relative link: ${link.url}`);
        continue;
      }
      if (link.resolved === file && link.fragment) {
        if (file.endsWith(".html") && !htmlIds.has(link.fragment)) {
          issues.push(
            `${file}:${link.line} broken fragment link #${link.fragment}`,
          );
        }
        continue;
      }
      if (!exists(link.resolved)) {
        issues.push(
          `${file}:${link.line} broken relative link ${link.url} (resolved ${link.resolved})`,
        );
      }
      if (
        /^Kazohe_?\d+_\d+_\d+\.html$/.test(link.resolved) &&
        link.resolved !== productFile
      ) {
        issues.push(
          `${file}:${link.line} links retired product file ${link.resolved} (expected ${productFile})`,
        );
      }
    }

    if (isChangelog) {
      const firstHeading = text.match(/^## v(\d+\.\d+\.\d+)\b/m);
      if (!firstHeading || firstHeading[1] !== productVersion) {
        issues.push(
          `${file}:1 top CHANGELOG heading must match current version v${productVersion}`,
        );
      }
    } else {
      for (const m of text.matchAll(productFilenamePattern)) {
        if (m[0] !== productFile) {
          issues.push(
            `${file}:${lineOf(m.index)} names retired product file ${m[0]} (expected ${productFile})`,
          );
        }
      }
      for (const m of text.matchAll(versionNumberPattern)) {
        const before = text.slice(Math.max(0, m.index - 40), m.index);
        if (m[0] !== productVersion && !toolVersionPrefix.test(before)) {
          issues.push(
            `${file}:${lineOf(m.index)} names stale release version ${m[0]} (expected ${productVersion})`,
          );
        }
      }
    }
  }
  return issues;
}

export function runDocLinksNegativeControls(root = rootDir) {
  const existing = new Set([
    "README.md",
    "CHANGELOG.md",
    "docs/verification.md",
    "index.html",
    "LICENSE",
    htmlName,
  ]);
  const exists = (p) => existing.has(p);
  const opts = { productFile: htmlName, productVersion: appVersion, exists };

  // 1. Markdown AST link detection: detects inline, reference, and inline-HTML links; ignores code spans/blocks.
  const mdCodeIgnored =
    "```md\n[ignored](missing.md)\n```\n\nInline `[also-ignored](missing.md)` and `<a href=\"missing.md\">x</a>`.\n";
  assert.deepEqual(
    documentIssues({ "README.md": mdCodeIgnored }, opts),
    [],
    "Markdown code blocks/spans must not be treated as links",
  );
  assert(
    documentIssues(
      { "README.md": "See [broken](does-not-exist.md).\n" },
      opts,
    ).some((i) => i.includes("broken relative link does-not-exist.md")),
    "Markdown broken inline link must fail",
  );
  assert(
    documentIssues(
      { "README.md": "See [broken][ref].\n\n[ref]: missing-ref.md\n" },
      opts,
    ).some((i) => i.includes("broken relative link missing-ref.md")),
    "Markdown broken reference link must fail",
  );
  assert(
    documentIssues(
      { "README.md": '<a href="missing-html.md">x</a>\n' },
      opts,
    ).some((i) => i.includes("broken relative link missing-html.md")),
    "Markdown inline HTML broken link must fail",
  );

  // 2. HTML parse5 link detection: catches broken href and missing fragment, ignores <style>/<script>.
  assert(
    documentIssues(
      { "index.html": '<!doctype html><a href="./missing.html">x</a>' },
      opts,
    ).some((i) => i.includes("broken relative link ./missing.html")),
    "HTML broken href must fail",
  );
  assert(
    documentIssues(
      { "index.html": '<!doctype html><a href="#missing-id">x</a>' },
      opts,
    ).some((i) => i.includes("broken fragment link #missing-id")),
    "HTML broken #id fragment must fail",
  );
  assert.deepEqual(
    documentIssues(
      {
        "index.html":
          '<!doctype html><style>/* <a href="missing.html"> */</style><main id="ok"><a href="#ok">ok</a></main>',
      },
      opts,
    ),
    [],
    "HTML raw-text <style> must not be parsed as links",
  );

  // 3. Stale release / retired filename checks + CHANGELOG historical allowance
  assert(
    documentIssues(
      { "README.md": "Open Kazohe_0_2_5.html.\n" },
      opts,
    ).some((i) => i.includes("retired product file Kazohe_0_2_5.html")),
    "Retired product filename must fail",
  );
  assert(
    documentIssues(
      { "README.md": "Open かぞへ.html.\n" },
      opts,
    ).some((i) => i.includes("retired legacy filename")),
    "Legacy Japanese filename must fail",
  );
  assert(
    documentIssues(
      { "docs/verification.md": "Version 0.2.5 is verified.\n" },
      opts,
    ).some((i) => i.includes("stale release version 0.2.5")),
    "Stale release version in docs must fail",
  );
  assert.deepEqual(
    documentIssues(
      {
        "docs/verification.md":
          "Uses Node.js 24.22.2 and eslint@10.13.0 for v" + appVersion + ".\n",
      },
      opts,
    ),
    [],
    "Pinned tool versions must be allowed",
  );
  assert.deepEqual(
    documentIssues(
      {
        "CHANGELOG.md": `# Changelog\n\n## v${appVersion} 開発版\n\n- Current\n\n## v0.2.5 開発版\n\n- Historical entry\n`,
      },
      opts,
    ),
    [],
    "Historical CHANGELOG headings must be allowed",
  );
  assert(
    documentIssues(
      { "CHANGELOG.md": "# Changelog\n\n## v0.2.5 開発版\n\n- Stale top\n" },
      opts,
    ).some((i) => i.includes("top CHANGELOG heading must match")),
    "Stale top CHANGELOG heading must fail",
  );
  assert(
    documentIssues(
      {
        "CHANGELOG.md": `# Changelog\n\n## v${appVersion} 開発版\n\n- [bad](missing.md)\n`,
      },
      opts,
    ).some((i) => i.includes("broken relative link missing.md")),
    "Broken link inside CHANGELOG must fail",
  );

  // 4. trackedFiles git sanitization and non-repo refusal
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "kazohe-doc-links-"));
  try {
    assert.throws(
      () => trackedFiles(temp),
      refusedWith({ message: /tracked-file check needs a git checkout/ }),
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  const savedGitDir = process.env.GIT_DIR;
  const savedWorkTree = process.env.GIT_WORK_TREE;
  try {
    process.env.GIT_DIR = path.join(os.tmpdir(), "nonexistent-git-dir");
    process.env.GIT_WORK_TREE = path.join(os.tmpdir(), "nonexistent-work-tree");
    const files = trackedFiles(root);
    assert(files.includes("package.json"), "trackedFiles must strip GIT_DIR/GIT_WORK_TREE");
  } finally {
    if (savedGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = savedGitDir;
    if (savedWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = savedWorkTree;
  }

  // 5. Bidirectional allowlist negative controls
  assert.throws(
    () => assertTrackedFilesMatch(["a", "a"], ["a"]),
    refusedWith({ message: /Public tracked-file allowlist mismatch.*repeated/ }),
  );
  assert.throws(
    () => assertTrackedFilesMatch(["a", "b"], ["a"]),
    refusedWith({ message: /Public tracked-file allowlist mismatch.*untracked/ }),
  );
  assert.throws(
    () => assertTrackedFilesMatch(["a"], ["a", "b"]),
    refusedWith({ message: /Public tracked-file allowlist mismatch.*unlisted/ }),
  );
}

export function verifyDocLinks(root = rootDir, { checkAllowlist = true } = {}) {
  runDocLinksNegativeControls(root);
  const documents = {};
  for (const file of PUBLIC_DOCUMENTS) {
    const full = path.join(root, file);
    assert(fs.existsSync(full), `Missing required public document: ${file}`);
    documents[file] = fs.readFileSync(full, "utf8");
  }
  const issues = documentIssues(documents, {
    productFile: htmlName,
    productVersion: appVersion,
    exists: (target) => fs.existsSync(path.join(root, target)),
  });
  assert.deepEqual(
    issues,
    [],
    `Document link/release checks failed:\n${issues.join("\n")}`,
  );
  const tracked = trackedFiles(root);
  if (checkAllowlist) {
    assertTrackedFilesMatch(allowedPublicFiles(htmlName), tracked);
  }
  return { documents: PUBLIC_DOCUMENTS.length, tracked: tracked.length };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const result = verifyDocLinks(rootDir, {
    checkAllowlist: !process.argv.includes("--skip-allowlist"),
  });
  console.log(
    `doc-links: ${result.documents} docs, ${result.tracked} tracked files PASS`,
  );
}
