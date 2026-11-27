// AST counter for test-failing assertion calls in scripts/ and tests/.
// Counts assert(...), assert.*(...), Playwright expect(...) / expect.*(...),
// and refusedWith(...). A change that lowers a file's count removes checks
// from it and requires a recorded reason in intended-audit-changes.json.
import { parse } from "acorn";

const checkers = new Set(["assert", "expect", "refusedWith"]);
const memberCheckers = new Set(["assert", "expect"]);
const skip = new Set(["start", "end", "loc", "raw"]);
const auditScriptPattern = /^(?:scripts|tests)\/.*\.(?:m|c)?js$/;

function parseProgram(text) {
  for (const sourceType of ["module", "script"]) {
    try {
      return parse(text, {
        ecmaVersion: "latest",
        sourceType,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowHashBang: true,
      });
    } catch {
      // try next sourceType
    }
  }
  return null;
}

export function assertionCount(text) {
  const ast = parseProgram(text);
  if (!ast) return null;
  let count = 0;
  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "CallExpression") {
      const callee = node.callee;
      if (callee.type === "Identifier" && checkers.has(callee.name)) {
        count++;
      } else if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.object.type === "Identifier" &&
        memberCheckers.has(callee.object.name)
      ) {
        count++;
      }
    }
    for (const key of Object.keys(node)) {
      if (skip.has(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value.type === "string") visit(value);
    }
  };
  visit(ast);
  return count;
}

// Returns { [file]: count } for all JS/MJS/CJS scripts under scripts/ and tests/.
export function assertionCounts(files, read) {
  return Object.fromEntries(
    files
      .filter((file) => auditScriptPattern.test(file))
      .sort()
      .map((file) => [file, assertionCount(read(file))])
      .filter(([, count]) => count !== null),
  );
}

// Returns files whose assertion count decreased, or that were deleted while holding checks.
export function weakenedFiles(before, after) {
  return Object.entries(before)
    .filter(([file, count]) => count > 0 && (after[file] ?? 0) < count)
    .map(([file, count]) => `${file}: ${count} -> ${after[file] ?? 0}`)
    .sort();
}
