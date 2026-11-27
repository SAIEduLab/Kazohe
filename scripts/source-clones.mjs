// Token-based duplicate code detector over the product scripts.
// A non-overlapping run of >= CLONE_TOKENS tokens (ignoring comments so copies with
// differing comments still match) is reported as a clone, named by the SHA-256 prefix
// of its first window. CLONE_BASELINE is shrink-only: new clones or gone entries fail.
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parse } = require("@babel/parser");

export const CLONE_TOKENS = 100;
export const CLONE_BASELINE = Object.freeze([]);

function defaultLineLookup({ text, lines }) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return (offset) => {
    if (offset < 0 || offset >= text.length) return ["product", 0];
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    const where = Array.isArray(lines) ? lines[lo] : null;
    return where ? [where.file, where.line] : ["product", lo + 1];
  };
}

// script: { text, pieces?, lines? } (compatible with productScript output).
export function sourceClones(script, size = CLONE_TOKENS) {
  const { text, pieces, lines } = script;
  const ast = parse(text, {
    sourceType: "script",
    allowReturnOutsideFunction: true,
    tokens: true,
  });
  const where = defaultLineLookup({ text, lines });
  const own = Array.isArray(pieces) ? pieces.filter((p) => !p.extension) : null;
  const inOwn = own
    ? (offset) => own.some((p) => p.start <= offset && offset < p.end)
    : () => true;
  const tokens = ast.tokens.filter(
    (t) =>
      t.type.label !== "eof" &&
      t.type !== "CommentLine" &&
      t.type !== "CommentBlock" &&
      inOwn(t.start),
  );
  const words = tokens.map((t) => text.slice(t.start, t.end));
  const at = new Map();
  for (let i = 0; i + size <= words.length; i++) {
    const key = crypto
      .createHash("sha256")
      .update(words.slice(i, i + size).join("\u0001"))
      .digest("hex")
      .slice(0, 16);
    if (!at.has(key)) at.set(key, []);
    at.get(key).push(i);
  }
  const repeated = [...at].filter(
    ([, starts]) =>
      starts.length > 1 &&
      starts.some((s, i) => i > 0 && s - starts[i - 1] >= size),
  );
  const byFirst = new Map(
    repeated.map(([key, starts]) => [starts[0], { key, starts }]),
  );
  const clones = [];
  for (const [first, entry] of [...byFirst].sort((a, b) => a[0] - b[0])) {
    const previous = byFirst.get(first - 1);
    if (
      previous &&
      previous.starts.length === entry.starts.length &&
      previous.starts.every((s, i) => s + 1 === entry.starts[i])
    ) {
      entry.clone = previous.clone;
      entry.clone.length++;
      continue;
    }
    entry.clone = {
      id: entry.key,
      places: entry.starts.map((s) => where(tokens[s].start).join(":")),
      length: size,
    };
    clones.push(entry.clone);
  }
  return clones;
}

export function cloneIssues(clones, baseline = CLONE_BASELINE) {
  const listed = new Set(baseline.map((b) => b.id));
  const found = new Set(clones.map((c) => c.id));
  const issues = [];
  for (const c of clones) {
    if (!listed.has(c.id)) {
      issues.push(
        `clone ${c.id} of ${c.length} tokens at ${c.places.join(", ")}`,
      );
    }
  }
  for (const b of baseline) {
    if (!found.has(b.id)) {
      issues.push(`baseline clone ${b.id} (${b.what}) is gone; remove it`);
    }
  }
  return issues;
}
