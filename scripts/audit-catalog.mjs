import assert from "node:assert/strict";
import { K } from "./load-inline-core.mjs";
import { suite } from "./report.mjs";
// Equality with src/catalog.json and the independent fixture is TC-D04 (lint).
const s = suite("catalog");
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
