import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { K } from "./load-inline-core.mjs";
import { suite } from "./report.mjs";
const s = suite("catalog"),
  reference = JSON.parse(readFileSync("tests/fixtures/catalog.json", "utf8"));
s.check("catalog-metadata", () => {
  assert.equal(JSON.stringify(K.CATALOG), JSON.stringify(reference));
  assert.equal(K.CATALOG.length, 101);
  assert.equal(new Set(K.CATALOG.map((c) => c.id)).size, 101);
});
s.check("catalog-connected-functions", () => {
  for (const c of K.CATALOG) {
    assert(c.sourceCodes.every((x) => /^M[1-6]A[1-7]$/.test(x)));
    const q = K.generate(c.id);
    assert(K.validateQuestion(c, q).valid);
    assert(K.buildHint(q));
    assert(K.buildSolution(q).length > 1);
  }
});
s.check("catalog-prerequisite-dag", () => {
  const visiting = new Set(),
    visited = new Set();
  function visit(id) {
    assert(K.BY_ID[id]);
    assert(!visiting.has(id));
    if (visited.has(id)) return;
    visiting.add(id);
    const c = K.BY_ID[id];
    for (const p of [c.fallbackParent, ...c.prerequisites].filter(Boolean)) {
      assert(K.BY_ID[p].grade <= c.grade);
      visit(p);
    }
    visiting.delete(id);
    visited.add(id);
  }
  K.CATALOG.forEach((c) => visit(c.id));
});
s.done();
