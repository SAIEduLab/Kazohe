/* SPDX-License-Identifier: MIT */
// Reads back the built Kazohe product scripts (#kazohe-core and #kazohe-app) into their
// source modules with character-exact line maps, and measures module line counts.
import fs from "node:fs";
import path from "node:path";
import { buildProduct, repositoryRoot } from "./build.mjs";

const defaultRead = (file) =>
  fs.readFileSync(path.join(repositoryRoot, file), "utf8");

export function readSource(file, root = repositoryRoot) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

export function listSources(dir, root = repositoryRoot) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .sort()
    .map((name) => dir + "/" + name);
}

function buildPieces(text, lines, label) {
  const pieces = [];
  let at = 0;
  for (const where of lines) {
    const nextNewline = text.indexOf("\n", at);
    const end = nextNewline >= 0 ? nextNewline + 1 : text.length;
    const last = pieces.at(-1);
    if (last && last.label === where.file) last.end = end;
    else pieces.push({ label: where.file, start: at, end });
    at = end;
  }
  if (at !== text.length)
    throw new Error(
      label +
        ": the build maps " +
        lines.length +
        " lines, not the whole script (" +
        at +
        " !== " +
        text.length +
        ")",
    );
  return { text, pieces, lines };
}

// Build product scripts from `read` (and optional `list`) and map both #kazohe-core and
// #kazohe-app back to their source modules.
export function productScript(read = defaultRead, list) {
  const built = buildProduct({ read, ...(list ? { list } : {}) });
  const core = buildPieces(built.coreScript, built.coreLines, "#kazohe-core");
  const app = buildPieces(built.appScript, built.appLines, "#kazohe-app");
  const text = core.text + app.text;
  const lines = [...core.lines, ...app.lines];
  const pieces = [
    ...core.pieces.map((p) => ({ ...p, script: "core" })),
    ...app.pieces.map((p) => ({
      ...p,
      start: p.start + core.text.length,
      end: p.end + core.text.length,
      script: "app",
    })),
  ];
  return { core, app, text, pieces, lines, built };
}

// Map a character offset in a script ({text, lines}) back to [file, line].
export function lineMap({ text, lines }) {
  const starts = [0];
  for (let i = 0; i < text.length; i++)
    if (text[i] === "\n") starts.push(i + 1);
  return (offset) => {
    if (offset < 0 || offset >= text.length) return null;
    let lo = 0,
      hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    const where = lines[lo];
    return where ? [where.file, where.line] : null;
  };
}

// Maximum permitted lines per TypeScript source module.
export const SOURCE_SIZE_LINES = 2000;

export const sourceSizes = (read, files) =>
  files.map((file) => {
    const text = read(file);
    return {
      file,
      lines: text.split("\n").length - (text.endsWith("\n") ? 1 : 0),
    };
  });
