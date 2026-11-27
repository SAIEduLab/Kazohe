/* SPDX-License-Identifier: MIT */
// Generates and verifies src/types/page.d.ts from src/shell.html (via jsdom) and the
// selectors written for the page finder `$` in src/ts/1*.ts.
//   node scripts/page-types.mjs          fail unless src/types/page.d.ts matches
//   node scripts/page-types.mjs --write  regenerate src/types/page.d.ts
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { listSources, readSource } from "./product-script.mjs";

const require = createRequire(import.meta.url);
export const pageTypesFile = "src/types/page.d.ts";
export const pageFile = "src/shell.html";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Dynamic selectors written for `$` in #kazohe-app that are created at runtime (not in initial src/shell.html).
export const MADE_BY_SCRIPT = Object.freeze([
  "#clock",
  ".support-panel",
  "[data-active-target]",
  '[data-key="."]',
]);

export function writtenSelectors(sources) {
  const ts = require("typescript"),
    found = new Map();
  for (const [file, text] of Object.entries(sources)) {
    const sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const collect = (node, at) => {
      if (ts.isStringLiteralLike(node)) {
        if (!found.has(node.text)) found.set(node.text, []);
        found.get(node.text).push(at);
      } else if (ts.isConditionalExpression(node)) {
        collect(node.whenTrue, at);
        collect(node.whenFalse, at);
      } else if (ts.isParenthesizedExpression(node)) {
        collect(node.expression, at);
      }
    };
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        node.arguments.length &&
        ((ts.isIdentifier(node.expression) && node.expression.text === "$") ||
          (ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === "$"))
      )
        collect(
          node.arguments[0],
          file +
            ":" +
            (sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1),
        );
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

export function pageTypes(html, sources, made = MADE_BY_SCRIPT) {
  const { JSDOM } = require("jsdom"),
    doc = new JSDOM(html).window.document,
    entries = new Map(),
    problems = [];
  const kind = (element) => {
    const name = element.constructor.name;
    if (!/^HTML\w*Element$/.test(name) || name === "HTMLUnknownElement")
      problems.push(
        "<" + element.tagName.toLowerCase() + "> is no element of HTML",
      );
    return name;
  };
  for (const element of doc.querySelectorAll("[id]")) {
    const key = "#" + element.id;
    if (!/^#[A-Za-z][\w-]*$/.test(key))
      problems.push(
        "the id " + JSON.stringify(element.id) + " is not written as a selector",
      );
    else if (entries.has(key))
      problems.push("two elements have the id " + element.id);
    else entries.set(key, kind(element));
  }
  const written = writtenSelectors(sources);
  for (const [selector, at] of written) {
    if (entries.has(selector)) continue;
    let matches;
    try {
      matches = doc.querySelectorAll(selector);
    } catch {
      problems.push(
        at[0] + ": the selector " + JSON.stringify(selector) + " is not one",
      );
      continue;
    }
    if (matches.length > 1)
      problems.push(
        at[0] +
          ": " +
          JSON.stringify(selector) +
          " finds " +
          matches.length +
          " elements of the page",
      );
    else if (matches.length === 1) entries.set(selector, kind(matches[0]));
    else if (!made.includes(selector))
      problems.push(
        at[0] +
          ": " +
          JSON.stringify(selector) +
          " finds nothing in the page and is not in MADE_BY_SCRIPT",
      );
  }
  for (const selector of made)
    if (!written.has(selector))
      problems.push(
        "MADE_BY_SCRIPT names " +
          JSON.stringify(selector) +
          ", which no source writes",
      );
    else if (entries.has(selector))
      problems.push(
        "MADE_BY_SCRIPT names " +
          JSON.stringify(selector) +
          ", which the page has",
      );
  if (problems.length)
    throw Error("src/types/page.d.ts cannot be made:\n  " + problems.join("\n  "));
  return [
    "// The elements of Kazohe's page (src/shell.html) found by selector: each id of the page, and each",
    "// other written selector that finds one element. Made by scripts/page-types.mjs from src/shell.html",
    "// and src/ts/1*.ts; do not edit manually: `node scripts/page-types.mjs --write`.",
    "// Types only; the built product contains none of this.",
    "export interface PageElements {",
    ...[...entries]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(
        ([selector, type]) => "  " + JSON.stringify(selector) + ": " + type + ";",
      ),
    "}",
    "export type PageElement<S extends string> = S extends keyof PageElements",
    "  ? PageElements[S]",
    "  : HTMLElement | null;",
    "export type PageFinder = <S extends string>(selector: S) => PageElement<S>;",
    "",
  ].join("\n");
}

export function repositoryPage(baseRoot = root) {
  const sources = {};
  for (const file of listSources("src/ts", baseRoot))
    if (/^src\/ts\/1\d-.*\.ts$/.test(file))
      sources[file] = readSource(file, baseRoot);
  return {
    html: readSource(pageFile, baseRoot),
    sources,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { html, sources } = repositoryPage(),
    text = pageTypes(html, sources),
    file = path.join(root, pageTypesFile);
  if (process.argv.includes("--write")) {
    fs.writeFileSync(file, text);
    console.log("Wrote " + pageTypesFile);
  } else if (!fs.existsSync(file) || readSource(pageTypesFile, root) !== text) {
    console.error(
      pageTypesFile +
        " is not what the page and the sources make: run node scripts/page-types.mjs --write",
    );
    process.exitCode = 1;
  } else {
    console.log(pageTypesFile + ": matches src/shell.html and sources");
  }
}
