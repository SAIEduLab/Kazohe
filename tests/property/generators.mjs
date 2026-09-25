import assert from "node:assert/strict";
import { K } from "../../scripts/load-inline-core.mjs";
import { suite } from "../../scripts/report.mjs";
import {
  expected,
  eq,
  rawAnswer,
  operation,
} from "../../scripts/independent-math-oracle.mjs";
import { representatives } from "../fixtures/representatives.mjs";
import { domainContract } from "./domain-contracts.mjs";
const s = suite("property"),
  sample = process.env.DEEP_AUDIT === "1" ? 10000 : 1000,
  counts = {},
  seed = 20260925;
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
function verify(q) {
  domainContract(q);
  const v = expected(q),
    actual = q.expectedExactValue;
  if (q.answerSpec.type === "quotient") {
    assert.equal(actual.quotient, v.quotient);
    assert(eq(actual.remainder, v.remainder));
    const d = q.expressionAST.args[1].value;
    assert(K.cmp(actual.remainder, 0) >= 0);
    assert(K.cmp(actual.remainder, d) < 0);
  } else if (
    ["common", "blocks", "set", "compare", "parity"].includes(q.answerSpec.type)
  )
    same(actual, v);
  else assert(eq(actual, v), `${q.challengeId}: ${q.prompt}`);
  for (const t of q.solutionTrace)
    if (t.check)
      assert(eq(operation(t.check.op, t.check.a, t.check.b), t.check.result));
  assert(K.validateQuestion(K.BY_ID[q.challengeId], q).valid);
  assert(K.judge(q, K.normalizeInput(q.answerSpec, rawAnswer(q))).correct);
  assert(K.buildHint(q).length > 5);
  assert(q.solutionTrace.some((t) => t.kind === "answer"));
}
s.check("TC-G01", () => {
  assert.equal(K.CATALOG.length, 101);
  same(
    [1, 2, 3, 4, 5, 6].map(
      (g) => K.CATALOG.filter((c) => c.grade === g).length,
    ),
    [12, 13, 21, 23, 22, 10],
  );
});
s.check("TC-G02", () => {
  for (const c of K.CATALOG) {
    const state = K.createGenerator(seed),
      buckets = {};
    for (let i = 0; i < sample; i++) {
      const q = K.generate(c.id, {}, state);
      try {
        verify(q);
      } catch (e) {
        e.message += ` seed=${seed} id=${c.id} index=${i} q=${JSON.stringify(q)}`;
        throw e;
      }
      buckets[q.conditionBucket] = (buckets[q.conditionBucket] || 0) + 1;
    }
    counts[c.id] = { count: sample, buckets };
    console.log(c.id, sample);
  }
  return { total: sample * 101, seed };
});
s.check("TC-G03", () => {
  for (const id of K.REMAINDER_IDS)
    for (const mode of ["none", "some", "mixed"]) {
      const state = K.createGenerator(seed);
      let some = 0;
      for (let i = 0; i < 20; i++) {
        const q = K.generate(id, { remainder: mode }, state);
        verify(q);
        const v = K.evaluate(q.expressionAST);
        const has = BigInt(v.n) % BigInt(v.d) !== 0n;
        some += +has;
        if (mode !== "mixed") assert.equal(has, mode === "some");
      }
      if (mode === "mixed") assert.equal(some, 10);
    }
});
s.check("TC-G04", () => {
  assert.equal(Object.keys(counts).length, 101);
  assert(Object.values(counts).every((c) => c.count >= 1000));
});
s.check("TC-G05", () => {
  for (const { question } of Object.values(representatives(K)))
    verify(question);
});
s.check("TC-G06", () => {
  let valid = 0;
  for (const c of K.CATALOG)
    for (const d of K.domains(c.id)) {
      for (const rank of [0n, 1n, d.size - 1n, d.size / 2n]) {
        const q = K.atRank(d, rank);
        if (q) {
          verify(q);
          valid++;
        }
      }
    }
  assert(valid > 200);
  return { validBoundaries: valid };
});
s.check("TC-G07", () => {
  for (const c of K.CATALOG) {
    const a = K.createGenerator(seed),
      b = K.createGenerator(seed),
      other = K.createGenerator(1234);
    const aa = [],
      cc = [];
    for (let i = 0; i < 12; i++) {
      const q = K.generate(c.id, {}, a);
      same(q, K.generate(c.id, {}, b));
      aa.push(q.canonicalKey);
      cc.push(K.generate(c.id, {}, other).canonicalKey);
    }
    assert.notEqual(JSON.stringify(aa), JSON.stringify(cc));
  }
});
function deck(id, options, n) {
  const state = K.createGenerator(seed),
    keys = [];
  for (let i = 0; i < n; i++) {
    const q = K.generate(id, options, state);
    keys.push(q.canonicalKey);
    assert.equal(q.cycleId, 0);
  }
  assert.equal(new Set(keys).size, n);
  const next = K.generate(id, options, state);
  assert.equal(next.cycleId, 1);
  assert.notEqual(next.canonicalKey, keys.at(-1));
}
s.check("TC-G08", () => deck("G2-C08", { table: 7 }, 9));
s.check("TC-G09", () => deck("G2-C08", {}, 81));
s.check("TC-G10", () => deck("G1-C01", {}, 11));
s.check("TC-G11", () => {
  const state = K.createGenerator(seed),
    q = K.generate("G1-N03", {}, state),
    entry = Object.values(state.ids)[0];
  for (const b of Object.values(entry.buckets)) {
    const d = K.domains("G1-N03")[0];
    b.used = [];
    for (let i = 0n; i < d.size - 1n; i++) {
      const candidate = K.atRank(d, i);
      if (candidate) b.used.push(candidate.canonicalKey);
    }
    b.cursor = String(d.size - 1n);
  }
  const next = K.generate("G1-N03", {}, state);
  assert.equal(next.cycleId, 0);
  assert.notEqual(q.canonicalKey, next.canonicalKey);
});
s.check("TC-G12", () => {
  const run = K.createRun(
    {
      selectedIds: ["G1-C01", "G1-C02", "G1-C03"],
      mode: "practice",
      quantity: 20,
    },
    seed,
  );
  assert.equal(run.records.length, 1);
  assert.equal(run.schedule.length, 20);
  const values = run.config.selectedIds.map(
    (id) => run.schedule.filter((x) => x === id).length,
  );
  assert(Math.max(...values) - Math.min(...values) <= 1);
});
s.check("TC-G13", () => {
  const state = K.createGenerator(seed),
    b = { none: 0, some: 0 };
  for (let i = 0; i < 20; i++)
    b[K.generate("G4-C07", { remainder: "mixed" }, state).conditionBucket]++;
  same(b, { none: 10, some: 10 });
});
s.check("TC-G14", () => {
  const visited = new Set(),
    visiting = new Set();
  const visit = (id) => {
    assert(K.BY_ID[id]);
    assert(!visiting.has(id));
    if (visited.has(id)) return;
    visiting.add(id);
    const c = K.BY_ID[id];
    [c.fallbackParent, ...c.prerequisites].filter(Boolean).forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  K.CATALOG.forEach((c) => visit(c.id));
  assert.equal(visited.size, 101);
});
s.check("TC-G15", () => {
  for (const { question: q } of Object.values(representatives(K))) {
    assert.notEqual(K.buildHint(q), K.answerText(q));
    assert(q.solutionTrace.length > 1);
  }
});
s.check("TC-G16", () => {
  const f = representatives(K);
  assert.equal(Object.keys(f).length, 101);
  for (const c of K.CATALOG) {
    const x = f[c.id];
    verify(x.question);
    if (x.question.answerSpec.type === "quotient") {
      assert.equal(x.question.expectedExactValue.quotient, x.expected.quotient);
      assert(eq(x.question.expectedExactValue.remainder, x.expected.remainder));
    } else if (
      ["common", "set", "compare", "parity"].includes(
        x.question.answerSpec.type,
      )
    )
      same(x.question.expectedExactValue, x.expected);
    else assert(eq(x.question.expectedExactValue, x.expected));
  }
});
s.check("TC-G17", () => {
  for (const c of K.CATALOG) {
    const buckets = counts[c.id].buckets;
    for (const d of K.domains(c.id))
      assert(buckets[d.bucket] > 0, `${c.id}/${d.bucket}`);
  }
  const f = representatives(K);
  assert(
    f["G4-C05"].question.solutionTrace.some((t) => t.text.includes("商：206")),
  );
  assert(f["G3-C08"].question.solutionTrace.some((t) => t.digits === "6120"));
});
s.check("TC-G18", () => {
  deck("G2-N03", {}, 4);
  assert.throws(() =>
    K.normalizeConfig({ selectedIds: [], mode: "practice", quantity: 10 }),
  );
});
s.done({
  seed,
  generatorCounts: counts,
  totalGenerated: Object.values(counts).reduce((n, c) => n + c.count, 0),
});
