import assert from "node:assert/strict";
import { K, Teaching, Language } from "../../scripts/load-inline-core.mjs";
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
        // The literal operand 10 is allowed; an unrelated make-ten strategy is not.
        assert(!/10のまとまり|10にする|10と.*分け/.test(h));
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
s.check("TC-E09", () => {
  let states = 0;
  const display = (row) => {
    if (!Array.isArray(row.digits)) return row.digits;
    return row.digits
      .map((digit, i) => digit + (row.points?.includes(i) ? "." : ""))
      .join("");
  };
  for (const qs of Object.values(samples))
    for (const q of qs) {
      const frames = Teaching.steps(q),
        before = JSON.stringify(frames);
      assert(frames.length > 0 && frames.at(-1).text.startsWith("こたえ："));
      for (const frame of frames) {
        assert(!/undefined|NaN/.test(frame.text));
        if (frame.check)
          assert(
            eq(
              operation(frame.check.op, frame.check.a, frame.check.b),
              frame.check.result,
            ),
          );
        if (frame.board) {
          assert(
            frame.board.rows.every(
              (row) => !["borrow", "annotation"].includes(row.kind),
            ),
          );
          for (const row of frame.board.rows)
            for (const [column, note] of Object.entries(
              row.annotations || {},
            )) {
              assert(Number(column) >= 0 && Number(column) < frame.board.cols);
              assert(/^\d{1,2}$/.test(note.value));
            }
        }
        states++;
      }
      if (q.written) {
        const board = frames.at(-1).board,
          op = q.expressionAST.op;
        if (["+", "-"].includes(op)) {
          assert(frames.every((frame) => frame.board.rows.length === 3));
          assert(eq(display(board.rows.at(-1)), q.expectedExactValue));
          assert(frames[0].board.rows.at(-1).digits.every((d) => d === ""));
        } else if (op === "*")
          assert(eq(display(board.rows.at(-1)), q.expectedExactValue));
        else {
          const quotient = display(board.rows.find((row) => row.quotient));
          assert(
            eq(
              quotient,
              q.answerSpec.type === "quotient"
                ? q.expectedExactValue.quotient
                : q.expectedExactValue,
            ),
          );
          assert(frames[0].board.rows[0].digits.every((d) => d === ""));
        }
      }
      assert.equal(JSON.stringify(Teaching.steps(q)), before);
    }
  const subtract = (a, b) =>
    K.complete(
      K.arithmetic(
        "G3-C02",
        K.op("-", K.lit(a), K.lit(b)),
        { type: "integer" },
        { written: true },
      ),
    );
  for (const [a, b, expected] of [
    [324, 166, 158],
    [9910, 9541, 369],
    [1000, 1, 999],
  ]) {
    const frames = Teaching.steps(subtract(a, b));
    assert.equal(Number(display(frames.at(-1).board.rows.at(-1))), expected);
    assert(frames.every((f) => f.board.rows.length === 3));
    const earliest = JSON.stringify(frames[0]);
    frames.at(-1).board.rows[0].annotations = {};
    assert.equal(JSON.stringify(frames[0]), earliest);
  }
  return { states, questions: 4040, allChallengeIds: Object.keys(samples) };
});
const fixedArithmetic = (id, op, a, b, spec = { type: "integer" }) =>
  K.complete(K.arithmetic(id, K.op(op, K.lit(a), K.lit(b)), spec));
function audit8012(frames) {
  let cursor = -1;
  const next = (pattern) => {
    const at = frames.findIndex((f, i) => i > cursor && pattern.test(f.text));
    assert(at > cursor, `missing causal prerequisite: ${pattern}`);
    cursor = at;
    return frames[at];
  };
  next(/一の位.*2.*2から6は引けない/);
  next(/十の位には1.*渡せる/);
  next(/十の位の1.*一の位では10/);
  next(/十の位は1−1＝0.*一の位は2＋10＝12/);
  next(/12−6＝6.*次は十の位.*0.*6を引けない/);
  next(/十の位.*0から6は引けない/);
  next(/百の位も0.*借りられない/);
  next(/千の位には8/);
  next(/千の位の1.*百の位では10/);
  next(/千の位は8−1＝7.*百の位は0＋10＝10/);
  next(/百の位の1.*十の位では10/);
  next(/百の位は10−1＝9.*十の位は0＋10＝10/);
  next(/10−6＝4/);
  next(/9−5＝4/);
  next(/7−7＝0/);
  next(/いちばん左の0.*省/);
  next(/こたえ：446/);
  for (const frame of frames) {
    const row = frame.board.rows[0],
      original = [8, 0, 1, 2];
    const current = original.map((digit, i) =>
      Number(row.annotations?.[i]?.value ?? digit),
    );
    assert.equal(
      current.reduce((sum, digit, i) => sum + digit * [1000, 100, 10, 1][i], 0),
      8012,
    );
  }
}
s.check("TC-E10", () => {
  const q = fixedArithmetic("G3-C04", "-", 8012, 7566);
  const frames = Teaching.steps(q);
  audit8012(frames);
  assert.match(K.buildHint(q), /2−6.*2では6を引けない.*1.*10/);
  // Keep all arithmetic and final answers correct while deliberately removing a reason.
  for (const pattern of [
    /一の位.*2から6は引けない/,
    /十の位の1.*一の位では10/,
    /一の位は2＋10＝12/,
    /百の位も0/,
  ]) {
    const broken = frames.filter((f) => !pattern.test(f.text));
    assert.throws(() => audit8012(broken), /missing causal prerequisite/);
    assert.equal(broken.at(-1).text, "こたえ：446");
  }
  for (const qs of Object.values(samples))
    for (const q of qs.filter((q) => q.written && q.expressionAST.op === "-")) {
      const frames = Teaching.steps(q),
        a = K.evaluate(q.expressionAST.args[0]);
      const scale = Math.max(
        ...q.expressionAST.args.map((x) => K.decimalPlaces(K.evaluate(x))),
      );
      const expected = (BigInt(a.n) * 10n ** BigInt(scale)) / BigInt(a.d);
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        if (f.intent !== "borrow-exchange") continue;
        assert.equal(f.to, f.from + 1);
        assert.equal(
          f.currentDigits.reduce((sum, digit) => sum * 10n + BigInt(digit), 0n),
          expected,
        );
        assert.equal(frames[i - 1].intent, "borrow-unit");
        assert(frames.slice(0, i).some((f) => f.intent === "borrow-need"));
      }
    }
  return { example: "8012−7566", omittedReasonsDetected: 4 };
});
s.check("TC-E11", () => {
  const f = representatives(K);
  const ordered = (frames, patterns) => {
    let at = -1;
    for (const pattern of patterns) {
      const next = frames.findIndex((x, i) => i > at && pattern.test(x.text));
      assert(next > at, `missing intermediate operation: ${pattern}`);
      at = next;
    }
  };
  const plus = Teaching.steps(f["G5-C06"].question),
    product = Teaching.steps(f["G6-C03"].question);
  const plusExpected = [
    /1\/3と1\/6.*大きさが違う/,
    /1×2＝2.*1\/3＝2\/6/,
    /2＋1＝3.*3\/6/,
    /分子は3÷3＝1/,
    /分母も.*6÷3＝2/,
  ];
  ordered(plus, plusExpected);
  assert.throws(() =>
    ordered(
      plus.filter((f) => !f.text.includes("2＋1＝3")),
      plusExpected,
    ),
  );
  ordered(product, [
    /分子どうし：2×9＝18/,
    /分母どうし：3×10＝30.*18\/30/,
    /分子は18÷6＝3/,
    /分母も.*30÷6＝5/,
  ]);
  const mixed = Teaching.steps(f["G6-C08"].question);
  ordered(mixed, [/0.5.*5\/10/, /0.5＝1\/2/, /求めた数を元の場所へ戻す/]);
  for (const id of ["G1-C08", "G4-C15", "G4-C16", "G5-N13", "G6-N02", "G6-C07"])
    assert(
      Teaching.steps(f[id].question).some(
        (t) => t.intent === "expression-replacement",
      ),
      id,
    );
  return { addition: "1/3＋1/6", multiplication: "2/3×9/10" };
});
s.check("TC-E12", () => {
  const f = representatives(K);
  const bundles = Teaching.steps(f["G2-N02"].question);
  const exchanged = bundles.findIndex((t) => /100が10個で1000/.test(t.text));
  assert(exchanged > 0);
  assert(bundles.slice(0, exchanged).every((t) => !t.text.includes("2300")));
  const equivalent = Teaching.steps(f["G4-N05"].question);
  assert(
    Teaching.steps(f["G3-N03"].question).some((t) => /2×10＝20/.test(t.text)),
  );
  assert(
    Teaching.steps(f["G4-N03"].question).some((t) => /3×10＝30/.test(t.text)),
  );
  assert(!/分母|分子/.test(K.buildHint(f["G6-N02"].question)));
  assert(!/1\/2が1個分/.test(K.buildHint(f["G6-C07"].question)));
  assert(!/同じ数で変える/.test(K.buildHint(f["G2-N03"].question)));
  assert(
    Teaching.steps(f["G5-N06"].question).some((t) =>
      t.text.includes("0.02485"),
    ),
  );
  assert(!equivalent[0].diagram);
  assert.equal(equivalent.find((t) => t.diagram)?.diagram.length, 1);
  const before = equivalent.findIndex((t) => t.text.includes("分子も1×2＝2"));
  assert(before > 0);
  assert(
    equivalent
      .slice(0, before)
      .every((t) => !t.diagram?.some(([n, d]) => n === 2 && d === 4)),
  );
  const times = Teaching.steps(f["G3-C07"].question);
  assert(times.some((t) => /8＋4＝12/.test(t.text)));
  assert(!times.some((t) => /12＝12/.test(t.text)));
  const decimals = Teaching.steps(f["G5-C02"].question);
  const converted = decimals.findIndex(
    (t) => t.intent === "integer-working-form",
  );
  assert(converted > 0);
  assert.equal(decimals[converted].board.rows[0].digits, "24");
  assert.equal(decimals[converted].board.rows[1].digits, "15");
  const restored = decimals.at(-1).board;
  assert.equal(restored.rows[0].digits, "2.4");
  assert.equal(restored.rows[1].digits, "1.5");
  assert.equal(restored.rows.at(-1).digits, "3.60");
  const remainder = Teaching.steps(f["G5-C04"].question).at(-1).board;
  assert.equal(remainder.rows[1].divisor, "0.4");
  assert.equal(remainder.rows[1].dividend, "7.3");
  assert.equal(remainder.rows.at(-1).digits, "0.1");
  const division = Teaching.steps(f["G4-C06"].question);
  const adjustment = division.find((t) => t.intent === "quotient-adjustment");
  assert(adjustment.text.includes("3に直した"));
  assert.equal(adjustment.board.rows[0].digits.at(-1), "3");
  for (const c of K.CATALOG) {
    const states = Teaching.steps(f[c.id].question);
    assert(states.length >= 3, c.id);
    assert(states.at(-1).text.startsWith("こたえ："));
    assert(!states.slice(0, -1).some((t) => t.kind === "answer"));
  }
  return {
    challenges: 101,
    diagrams: "no premature equivalent fraction",
    trial: "text and board agree",
  };
});
s.check("TC-E13", () => {
  let inspected = 0;
  const fixed = representatives(K);
  for (const c of K.CATALOG)
    for (const q of [...samples[c.id], fixed[c.id].question]) {
      const states = Teaching.steps(q),
        values = [
          c.title,
          q.prompt,
          q.instruction || "",
          K.buildHint(q),
          ...states.flatMap((step) => [step.text, step.board?.caption || ""]),
        ];
      // Check both the challenge's own grade and mixed-grade UI at grade one.
      for (const grade of [...new Set([1, c.grade])])
        for (const value of values) {
          const audit = Language.audit(value, grade);
          assert(
            audit.valid,
            `${c.id}/g${grade}: ${audit.rendered} (${audit.invalid})`,
          );
          assert(
            !/かずえ|こかず|くりうえ|くりした/.test(audit.rendered),
            audit.rendered,
          );
          const numeric = (text) => text.match(/\d+(?:\.\d+)?/g) || [];
          assert.deepEqual(
            numeric(audit.rendered),
            numeric(value),
            `${c.id}: changed numbers`,
          );
          inspected++;
        }
      assert.equal(states.length, Teaching.steps(q).length);
    }
  return { challenges: 101, inspected, exceptionCount: 0 };
});
s.check("TC-E14", () => {
  // A final-string scan does not trust a reading dictionary or the original source.
  const allowed = (grade) =>
    new Set(Language.allocations.slice(0, grade - 1).join(""));
  const valid = (value, grade) =>
    [...value].every(
      (char) => !/\p{Script=Han}/u.test(char) || allowed(grade).has(char),
    );
  for (let grade = 1; grade <= 6; grade++) {
    const next = Language.allocations[grade - 1][0];
    assert(!valid(`ここを ${next} にする`, grade));
    assert(!valid("ヒントに鬱蒼をまぜる", grade));
    assert(
      valid(
        Language.readable("次の位から借りる。0では引けない。", grade),
        grade,
      ),
    );
  }
  assert.equal(
    Language.readable("左の位の1は、この位では10。", 1),
    "ひだりのくらいの1は、このくらいでは10。",
  );
});
s.done({ seed, generatorCoverage: coverage });
