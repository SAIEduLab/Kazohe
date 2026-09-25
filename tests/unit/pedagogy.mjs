import assert from "node:assert/strict";
import { K } from "../../scripts/load-inline-core.mjs";
import { suite } from "../../scripts/report.mjs";
import {
  eq,
  operation,
  rawAnswer,
} from "../../scripts/independent-math-oracle.mjs";
import { representatives } from "../fixtures/representatives.mjs";
const s = suite("pedagogy"),
  seed = 20260925,
  samples = {},
  coverage = {};
for (const c of K.CATALOG) {
  const g = K.createGenerator(seed),
    qs = [];
  for (let i = 0; i < 40; i++) qs.push(K.generate(c.id, {}, g));
  samples[c.id] = qs;
  coverage[c.id] = {
    count: qs.length,
    buckets: [...new Set(qs.map((q) => q.conditionBucket))],
    inputs: [...new Set(qs.map((q) => q.answerSpec.type))],
  };
}
const trace = (q) => q.solutionTrace.map((t) => t.text).join("\n");
const all = (ids, fn) =>
  ids.forEach((id) =>
    samples[id].forEach((q) => {
      try {
        fn(q, K.buildHint(q), trace(q));
      } catch (e) {
        e.message += ` ${id} ${q.prompt} seed=${seed}`;
        throw e;
      }
    }),
  );
s.check("TC-E01", () => {
  all(["G1-N02", "G1-N03"], (q, h, t) => {
    assert(!/ひこう|逆数|小数|わり算|かっこ|×|÷/.test(h));
    assert(!/×|÷/.test(t));
    assert.match(h, q.challengeId === "G1-N02" ? /10の まとまり/ : /1だけ/);
  });
  assert(coverage["G1-N02"].inputs.includes("blocks"));
  assert(coverage["G1-N02"].inputs.includes("integer"));
});
s.check("TC-E02", () => {
  all(
    [
      "G1-C01",
      "G1-C02",
      "G1-C03",
      "G1-C04",
      "G1-C05",
      "G1-C06",
      "G1-C07",
      "G1-C08",
      "G1-C09",
    ],
    (q, h, t) => {
      assert(!/×|÷|かけ算|わり算|かっこ|逆数|小数/.test(h + t));
      if (q.challengeId === "G1-C02" || q.challengeId === "G1-C04")
        assert(!h.includes("10"));
      if (["G1-C02", "G1-C03", "G1-C04", "G1-C05"].includes(q.challengeId)) {
        const picture = q.solutionTrace.find((t) => t.kind === "counters");
        assert(picture);
        assert.equal(picture.splitTen, q.challengeId === "G1-C05");
        assert.equal(picture.operation, q.expressionAST.op);
        assert(
          eq(
            operation(picture.operation, picture.a, picture.b),
            q.expectedExactValue,
          ),
        );
      }
    },
  );
});
s.check("TC-E03", () => {
  all(["G2-C10", "G3-C15"], (q, h) => {
    if (q.challengeId === "G2-C10")
      assert.match(h, q.expressionAST.op === "+" ? /たそう/ : /ひこう/);
    else assert.match(h, q.expressionAST.op === "*" ? /かけよう/ : /わろう/);
  });
  for (const id of ["G2-C10", "G3-C15"])
    assert(coverage[id].buckets.length >= 4);
});
s.check("TC-E04", () => {
  all(["G2-C08"], (q, h, t) => {
    assert.match(h, /だん/);
    assert(!/部分積|位ごと|小数/.test(h + t));
    const p = q.solutionTrace.find((t) => t.kind === "counters");
    assert.equal(p.a * p.b, Number(q.expectedExactValue.n));
    assert(t.includes(Array(p.b).fill(p.a).join("＋")));
  });
  all(["G2-N02"], (q, h, t) => {
    assert(!/小数|わり算/.test(h + t));
    assert(h.includes("1000・100・10・1"));
  });
  all(
    K.CATALOG.filter(
      (c) => samples[c.id].some((q) => q.written) && c.grade <= 3,
    ).map((c) => c.id),
    (q, h, t) => {
      if (q.expressionAST.args.every((a) => K.evaluate(a).d === "1"))
        assert(!/小数|分母|分子/.test(h + t), q.prompt);
    },
  );
});
s.check("TC-E05", () => {
  all(["G3-N03", "G4-N03"], (q, h, t) => {
    const a = q.expressionAST,
      unit = K.evaluate(a.args[a.op === "/" ? 1 : 0]);
    assert(h.includes(K.format(unit, "decimal")));
    assert(t.includes(K.format(unit, "decimal")));
    assert(!/両方の小数点|逆数/.test(h + t));
    const count = a.op === "/" ? q.expectedExactValue : K.evaluate(a.args[1]),
      total = a.op === "/" ? K.evaluate(a.args[0]) : q.expectedExactValue;
    assert(eq(operation("*", unit, count), total));
  });
});
s.check("TC-E06", () => {
  all(["G5-N12"], (q, h, t) => {
    assert(!/逆数/.test(h + t));
    assert.match(h, /わられる数を分子、わる数を分母/);
  });
  all(["G5-N10"], (q, h, t) => {
    assert(!/逆数/.test(h + t));
    assert.match(h, /分母/);
    const str = K.format(q.original, "decimal"),
      places = (str.split(".")[1] || "").length;
    assert(t.includes(places ? `分母を${10 ** places}` : "分母1"));
    if (places) assert(t.includes(`分子を${BigInt(str.replace(".", ""))}に`));
  });
  all(["G4-N05"], (q, h, t) => {
    const [[n, d], [nn, dd]] = q.diagram;
    assert(t.includes(`分母は${d}×${dd / d}＝${dd}`));
    assert(t.includes(`${n}/${d}＝${nn}/${dd}`));
  });
  all(["G6-N02"], (q, h, t) => {
    if (q.conditionBucket === "integer") assert(!/分母|分子/.test(t));
  });
});
s.check("TC-E07", () => {
  let checked = 0,
    written = 0;
  for (const qs of Object.values(samples))
    for (const q of qs) {
      assert(K.buildHint(q).length > 5);
      assert(q.solutionTrace.at(-1).text.startsWith("こたえ："));
      for (const t of q.solutionTrace) {
        assert(!/undefined|NaN/.test(t.text));
        if (t.check)
          assert(
            eq(operation(t.check.op, t.check.a, t.check.b), t.check.result),
          );
      }
      assert(K.judge(q, K.normalizeInput(q.answerSpec, rawAnswer(q))).correct);
      if (q.written) written++;
      checked++;
    }
  const f = representatives(K),
    d = f["G4-C12"].question.solutionTrace;
  assert.equal(written, 1200);
  assert.equal(d.find((r) => r.dividend).dividend, "7.00");
  assert.equal(d.find((r) => r.quotient).digits, "1.75");
  assert.equal(d.find((r) => r.digits === "30").trailing, 1);
  for (const id of ["G3-C02", "G3-C04"]) {
    const b = f[id].question.solutionTrace.find(
      (t) => t.annotation === "borrow",
    );
    assert.match(b.text, /百の位|千の位/);
    assert(!b.text.includes("けた目"));
  }
  const remainder = K.complete(
    K.arithmetic(
      "G5-C04",
      K.op("/", K.lit("7.3"), K.lit("4")),
      { type: "quotient", decimalRemainder: true },
      { written: true },
    ),
  );
  assert.equal(remainder.solutionTrace.find((t) => t.dividend).dividend, "7.3");
  assert.equal(remainder.solutionTrace.find((t) => t.quotient).trailing, 1);
  assert.equal(remainder.solutionTrace.find((t) => t.remainder).digits, "3.3");
  return { seed, checked, written, coverage };
});
s.check("TC-E08", () => {
  const spec = { type: "set" },
    parse = (raw) => K.normalizeInput(spec, raw);
  assert.equal(
    JSON.stringify(
      parse({ values: ["1", "2", "3", "4", "6"], "set-value": "12" }).values,
    ),
    JSON.stringify(["1", "2", "3", "4", "6", "12"]),
  );
  for (const raw of [
    { values: ["1"], "set-value": "1" },
    { values: ["1"], "set-value": "oops" },
  ])
    assert(parse(raw).error);
  assert.equal(K.VERSION, "0.2");
  assert.equal(K.STORAGE_KEY, "kazohe:v0.2:state");
  const old = K.emptySave();
  old.appVersion = "0.1";
  const before = JSON.stringify(old);
  assert.throws(() => K.validateBackup(before));
  assert.equal(JSON.stringify(old), before);
  const current = K.emptySave();
  assert.equal(
    JSON.stringify(K.validateBackup(JSON.stringify(current))),
    JSON.stringify(current),
  );
});
s.done({ seed, generatorCoverage: coverage });
