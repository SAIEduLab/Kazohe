import assert from "node:assert/strict";
import { K } from "../../scripts/load-inline-core.mjs";
import { suite } from "../../scripts/report.mjs";
import { rawAnswer, eq } from "../../scripts/independent-math-oracle.mjs";
import { representatives } from "../fixtures/representatives.mjs";
const s = suite("unit"),
  f = representatives(K),
  same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
const q = (id) => K.clone(f[id].question),
  correct = (question, raw = rawAnswer(question)) =>
    assert(
      K.judge(question, K.normalizeInput(question.answerSpec, raw)).correct,
    ),
  wrong = (question, raw) =>
    assert.equal(
      K.judge(question, K.normalizeInput(question.answerSpec, raw)).correct,
      false,
    );
const make = (id = "G1-C01", options = {}) =>
  K.createRun(
    { selectedIds: [id], mode: "practice", quantity: 10, ...options },
    98765,
    0,
  );
const event = (run, type, extra = {}, time = 0) =>
  K.reduceRun(run, { type, ...extra }, time);
const answer = (run, good = true, time = 0) =>
  event(
    run,
    "SUBMIT",
    {
      questionId: run.currentQuestion.questionId,
      raw: good ? rawAnswer(run.currentQuestion) : { value: "999999" },
    },
    time,
  );
const done = (run) =>
  event(
    run,
    run.phase === "SOLUTION_READING" ? "SOLUTION_NEXT" : "FEEDBACK_DONE",
  );
const finish = (run) => event(run, "END_ACCEPT");
const runAnswers = (n, fn = () => 0, options = {}) => {
  let r = make("G1-C01", options);
  for (let i = 0; i < n; i++) {
    const attempts = fn(i);
    if (attempts === "help") r = event(r, "HELP");
    else {
      for (let j = 0; j < attempts; j++) {
        r = done(answer(r, false));
        if (r.phase === "HINT_READING") r = event(r, "HINT_CONTINUE");
      }
      r = answer(r);
    }
    r = done(r);
  }
  return r;
};
const mappings = {
  1: "G1-C01",
  3: "G1-C03",
  4: "G1-C05",
  6: "G1-C08",
  7: "G2-C02",
  8: "G2-C05",
  11: "G2-C07",
  12: "G2-C08",
  13: "G3-C02",
  14: "G3-C04",
  15: "G3-C06",
  16: "G3-C07",
  17: "G3-C08",
  18: "G3-C09",
  22: "G3-C10",
  23: "G4-C05",
  24: "G4-C07",
  25: "G4-C06",
  26: "G4-C08",
  27: "G4-C09",
  29: "G5-C03",
  30: "G4-C12",
  33: "G4-C01",
  35: "G4-C02",
  36: "G4-C03",
  37: "G4-C15",
  38: "G4-C16",
  41: "G5-N08",
  42: "G4-C13",
  43: "G4-N06",
  44: "G5-C07",
  45: "G5-C08",
  46: "G6-C01",
  47: "G6-C02",
  48: "G6-C03",
  49: "G6-C04",
  50: "G6-C05",
  51: "G6-C06",
  52: "G6-C07",
  53: "G6-C08",
  54: "G4-N01",
  55: "G4-N02",
  58: "G5-N04",
  59: "G5-N05",
  60: "G5-N01",
  61: "G5-N07",
  63: "G5-N11",
  64: "G5-N06",
};
for (let i = 1; i <= 70; i++)
  s.check(`TC-M${String(i).padStart(2, "0")}`, () => {
    if (mappings[i]) {
      const x = f[mappings[i]];
      correct(x.question);
      if (
        typeof x.expected !== "object" &&
        !["compare", "parity"].includes(x.question.answerSpec.type)
      )
        assert(eq(x.question.expectedExactValue, x.expected));
      if (i === 37) wrong(x.question, { value: "44" });
      if (i === 41)
        wrong(x.question, {
          first: { numerator: "1", denominator: "4" },
          second: { numerator: "1", denominator: "6" },
        });
      if (i === 43) wrong(x.question, { numerator: "7", denominator: "5" });
      return;
    }
    let x;
    switch (i) {
      case 2:
        x = K.complete(K.arithmetic("G1-C01", K.lit(0)));
        correct(x, { value: "0" });
        break;
      case 5:
        x = K.complete(K.arithmetic("G1-C04", K.op("-", K.lit(9), K.lit(9))));
        correct(x, { value: "0" });
        break;
      case 9:
      case 10:
        x = K.complete(
          K.arithmetic(
            i === 9 ? "G2-C05" : "G2-C06",
            K.op(
              i === 9 ? "+" : "-",
              K.lit(i === 9 ? 278 : 503),
              K.lit(i === 9 ? 57 : 27),
            ),
          ),
        );
        assert(!K.validateQuestion(K.BY_ID[x.challengeId], x).valid);
        break;
      case 19:
        wrong(q("G3-C09"), { quotient: "2", remainder: "7" });
        break;
      case 20:
      case 21:
        x = K.complete(
          K.arithmetic(
            "G3-C09",
            K.op("/", K.lit(i === 20 ? 3 : 0), K.lit(i === 20 ? 5 : 7)),
            { type: "quotient" },
          ),
        );
        correct(x, { quotient: "0", remainder: i === 20 ? "3" : "0" });
        break;
      case 28:
        correct(q("G5-C02"), { value: "3.60" });
        break;
      case 31:
        correct(q("G5-C04"), { quotient: "18", remainder: "0.1" });
        wrong(q("G5-C04"), { quotient: "18", remainder: "1" });
        break;
      case 32:
        correct(q("G5-C05"), { value: "0.67" });
        wrong(q("G5-C05"), { value: "0.66" });
        break;
      case 34:
        assert.equal(K.roundExact("9950", -2).n, "10000");
        break;
      case 39:
        x = K.complete(
          K.arithmetic(
            "G3-C13",
            K.op("+", K.lit(K.rat(1, 4)), K.lit(K.rat(1, 4))),
            { type: "fraction", reduced: false },
          ),
        );
        correct(x, { numerator: "2", denominator: "4" });
        break;
      case 40:
        wrong(q("G5-C06"), { numerator: "2", denominator: "4" });
        correct(q("G5-C06"), { numerator: "1", denominator: "2" });
        break;
      case 56:
        correct(q("G5-N02"), { values: ["6", "1", "12", "3", "4", "2"] });
        wrong(q("G5-N02"), { values: ["2"] });
        break;
      case 57:
        x = K.complete(K.special("G5-N02", "divisors", ["1"], { type: "set" }));
        correct(x, { values: ["1"] });
        break;
      case 62:
        correct(q("G5-N10"), { numerator: "1", denominator: "4" });
        wrong(q("G5-N10"), { numerator: "25", denominator: "100" });
        x = K.complete(
          K.special(
            "G5-N10",
            "fraction",
            [K.rat(3)],
            { type: "fraction", form: "fraction", denominator: "1" },
            { prompt: "3を分数", original: { n: "3", d: "1" } },
          ),
        );
        correct(x, { numerator: "3", denominator: "1" });
        wrong(x, { form: "integer", whole: "3" });
        break;
      case 65:
        assert.throws(() =>
          K.complete(
            K.special(
              "G6-N01",
              "reciprocal",
              [K.rat(0)],
              { type: "fraction" },
              { labels: ["0"] },
            ),
          ),
        );
        break;
      case 66:
        x = K.complete(
          K.arithmetic(
            "G3-C15",
            K.op("*", K.lit(0), K.lit(0)),
            { type: "integer" },
            { unknown: "0" },
          ),
        );
        assert(!K.validateQuestion(K.BY_ID["G3-C15"], x).valid);
        break;
      case 67:
        for (const value of ["", "x", "1e3", "NaN", "Infinity"])
          assert(K.normalizeInput({ type: "integer" }, { value }).error);
        break;
      case 68:
        assert.equal(
          K.normalizeInput({ type: "decimal" }, { value: "２．５０" }).value.n,
          "5",
        );
        break;
      case 69:
        assert(
          K.normalizeInput(
            { type: "fraction" },
            { numerator: "1", denominator: "0" },
          ).error,
        );
        assert(K.normalizeInput({ type: "decimal" }, "1..2").error);
        assert(K.normalizeInput({ type: "quotient" }, { quotient: "3" }).error);
        break;
      case 70: {
        const r = make();
        same(event(r, "TYPE", { raw: "1" }).records, r.records);
        same(event(r, "TYPE", { raw: "14" }).records, r.records);
        break;
      }
      default:
        throw Error("Unmapped test " + i);
    }
  });
const scoreTests = [
  () => {
    same(
      Array.from({ length: 10 }, (_, i) => K.scoreCorrect(100, i + 1, false)),
      [100, 100, 150, 150, 200, 200, 200, 300, 300, 300],
    );
    assert.equal(runAnswers(10).score, 2000);
  },
  () => {
    const r = answer(runAnswers(4), false);
    assert.equal(r.streak, 0);
    assert.equal(r.score, 500);
    assert.equal(r.records.at(-1).wrongAttempts, 1);
  },
  () => {
    let r = make("G3-C01");
    r = answer(done(answer(r, false)));
    assert.equal(r.score, 300);
    assert.equal(r.streak, 1);
  },
  () => {
    let r = make("G3-C01");
    r = done(answer(r, false));
    r = done(answer(r, false));
    assert.equal(r.phase, "HINT_READING");
    r = answer(event(r, "HINT_CONTINUE"));
    assert.equal(r.score, 150);
    assert.equal(K.runMetrics(r).hintProblems, 1);
  },
  () => {
    let r = make("G3-C01");
    r = done(answer(r, false));
    r = event(done(answer(r, false)), "HINT_CONTINUE");
    r = done(answer(r));
    r = done(answer(r));
    r = answer(r);
    assert.equal(r.score, 900);
  },
  () => {
    const r = event(make(), "HELP"),
      m = K.runMetrics(r);
    assert.equal(r.score, 0);
    assert.equal(m.mistakeEvents, 1);
    assert.equal(m.repeatedWrongProblems, 0);
  },
  () => {
    let r = done(answer(make(), false));
    r = event(done(answer(r, false)), "HINT_CONTINUE");
    r = event(r, "HELP");
    const m = K.runMetrics(r);
    assert.equal(m.mistakeEvents, 3);
    assert.equal(m.repeatedWrongProblems, 1);
  },
  () => {
    const r = event(make(), "HELP"),
      qid = r.currentQuestion.questionId;
    const next = event(r, "SOLUTION_NEXT", { questionId: qid });
    same(
      event(next, "SOLUTION_NEXT", { questionId: qid }).records,
      next.records,
    );
  },
  () => {
    const r = answer(make());
    same(answer(r).records, r.records);
    assert.equal(r.score, 100);
  },
  () => assert.equal(K.scoreCorrect(101, 3, false), 152),
  () => {
    let r = done(answer(make(), false));
    r = event(done(answer(r, false)), "HINT_CONTINUE");
    r = done(answer(r));
    assert.equal(r.records.length, 2);
    assert.equal(r.records.filter((r) => r.terminal).length, 1);
  },
  () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      terminal: i === 10 ? "help" : "correct",
      wrongAttempts: i < 4 ? 1 : 0,
      helpUsed: i === 10,
      hintShown: false,
    }));
    assert.equal(K.deriveMetrics(rows).answerAccuracy, 10 / 15);
  },
  () => assert.equal(K.runMetrics(finish(make())).answerAccuracy, null),
  () => {
    const r = answer(done(answer(make(), false)));
    assert(r.notice.includes("やりなおして"));
    assert.equal(r.score, 100);
  },
];
scoreTests.forEach((fn, i) =>
  s.check(`TC-S${String(i + 1).padStart(2, "0")}`, fn),
);
function synthetic({
  count = 10,
  first = count,
  help = 0,
  repeated = 0,
  unanswered = 0,
  mode = "practice",
  quantity = 10,
  natural = false,
  ids = ["G1-C01"],
  presented = count,
} = {}) {
  const r = make(ids[0], {
    mode,
    quantity,
    selectedIds: ids,
    ...(mode === "time" ? { timeLimitMs: 60000 } : {}),
  });
  r.records = [];
  r.schedule = [];
  for (let i = 0; i < (quantity || presented); i++)
    r.schedule.push(ids[i % ids.length]);
  for (let i = 0; i < presented; i++) {
    const h = i >= count - help,
      u = i >= count - help - unanswered && i < count - help,
      w = i < first ? 0 : i < first + repeated ? 2 : 1;
    r.records.push({
      questionId: "r" + i,
      challengeId: ids[i % ids.length],
      terminal: h ? "help" : u ? "unanswered" : "correct",
      wrongAttempts: h || u ? 0 : w,
      hintShown: !h && !u && w >= 2,
      helpUsed: h,
      endReason:
        natural && i === presented - 1 && u
          ? "natural-timeout"
          : u
            ? "manual"
            : h
              ? "help"
              : "correct",
    });
  }
  r.endReason = natural ? "natural-timeout" : "manual";
  return r;
}
const rec = (r) => K.evaluateFallback(r).recommendation;
const fallbackTests = [
  () => assert.equal(rec(synthetic()), null),
  () => assert.equal(rec(synthetic({ first: 7 })), null),
  () => assert(rec(synthetic({ first: 6 }))),
  () => assert(rec(synthetic({ first: 8, help: 2 }))),
  () => assert.equal(rec(synthetic({ first: 9, help: 1 })), null),
  () => assert(rec(synthetic({ first: 8, repeated: 2 }))),
  () => assert(rec(synthetic({ first: 8, unanswered: 2 }))),
  () => {
    const r = finish(runAnswers(10, () => 0, { quantity: 30 }));
    assert.equal(K.runMetrics(r).unansweredProblems, 20);
    assert(rec(r));
  },
  () => {
    const r = finish(make("G1-C01", { quantity: 30 }));
    assert.equal(K.runMetrics(r).unansweredProblems, 30);
    assert(rec(r));
  },
  () => {
    const r = synthetic({
      count: 3,
      first: 2,
      unanswered: 1,
      mode: "time",
      quantity: null,
      natural: true,
    });
    const m = K.runMetrics(r);
    assert.equal(m.learningN, 2);
    assert.equal(m.unansweredN, 2);
    assert.equal(rec(r), null);
  },
  () =>
    assert(
      rec(
        synthetic({
          count: 3,
          first: 2,
          unanswered: 1,
          mode: "time",
          quantity: null,
        }),
      ),
    ),
  () => {
    const r = synthetic({
      count: 3,
      first: 2,
      unanswered: 1,
      mode: "time",
      quantity: null,
      natural: true,
    });
    r.records[2].wrongAttempts = 1;
    assert.equal(K.runMetrics(r).learningN, 3);
    assert(rec(r));
    assert.equal(K.runMetrics(r).learningUnansweredCount, 0);
  },
  () => {
    const r = synthetic({
      count: 1,
      first: 0,
      unanswered: 1,
      mode: "time",
      quantity: null,
      natural: true,
    });
    assert.equal(K.runMetrics(r).learningN, 0);
    assert.equal(rec(r), null);
  },
  () =>
    assert.equal(rec(synthetic({ count: 9, first: 0, quantity: null })), null),
  () => assert(rec(synthetic({ count: 10, first: 6, quantity: null }))),
  () => {
    const r = synthetic({ count: 20, quantity: 20, ids: ["G1-C01", "G1-C02"] });
    r.records
      .filter((x) => x.challengeId === "G1-C01")
      .slice(6)
      .forEach((x) => (x.wrongAttempts = 1));
    assert.equal(rec(r).sourceId, "G1-C01");
  },
  () =>
    assert(
      K.evaluateFallback(
        synthetic({ count: 10, first: 0, ids: ["G1-C01", "G1-C02"] }),
      ).insufficient,
    ),
  () => {
    const r = synthetic({
      count: 6,
      presented: 6,
      first: 0,
      quantity: 30,
      ids: ["G1-C01", "G1-C02", "G1-C03"],
    });
    assert.equal(K.runMetrics(r).unshown, 24);
    assert(K.evaluateFallback(r).insufficient);
  },
  () => {
    const r = synthetic({ count: 20, quantity: 20, ids: ["G1-C01", "G1-C02"] });
    r.records
      .filter((x) => x.challengeId === "G1-C01")
      .slice(6)
      .forEach((x) => (x.wrongAttempts = 1));
    r.records
      .filter((x) => x.challengeId === "G1-C02")
      .slice(4)
      .forEach((x) => (x.wrongAttempts = 1));
    assert.equal(rec(r).sourceId, "G1-C02");
  },
  () =>
    assert.equal(
      rec(
        synthetic({
          count: 20,
          quantity: 20,
          first: 0,
          ids: ["G1-C01", "G1-C02"],
        }),
      ).sourceId,
      "G1-C01",
    ),
  () =>
    assert.equal(
      rec(synthetic({ first: 0, ids: ["G4-C07"] })).targetId,
      "G4-C06",
    ),
  () =>
    assert.equal(
      rec(synthetic({ first: 0, ids: ["G5-C06"] })).targetId,
      "G5-N08",
    ),
  () => {
    const r = synthetic({ first: 0, ids: ["G1-N01"] }),
      save = K.emptySave();
    save.recommendation = rec(r);
    assert.equal(K.recommendConfig(save, r.config).saved.returnStack.length, 0);
  },
  () =>
    assert.equal(
      rec(synthetic({ first: 0, ids: ["G4-C06"] })).targetId,
      "G4-C04",
    ),
  () => {
    const r = make("G4-C07", {
        mode: "time",
        timeLimitMs: 60000,
        optionsById: { "G4-C07": { remainder: "mixed" } },
      }),
      save = K.emptySave();
    save.recommendation = { sourceId: "G4-C07", targetId: "G4-C06" };
    const next = K.recommendConfig(save, r.config);
    same(next.saved.returnStack[0], r.config);
  },
  () => {
    const save = K.emptySave();
    save.recommendation = {
      sourceId: "G1-C03",
      targetId: "G1-C01",
      reason: "practice",
    };
    save.returnStack = [make("G1-C03").config];
    const next = K.applyResult(save, runAnswers(10)).saved;
    assert.equal(next.recommendation, null);
    assert.equal(next.returnStack.length, 1);
  },
  () => {
    const save = K.emptySave();
    save.recommendation = {
      sourceId: "G1-C03",
      targetId: "G1-C01",
      reason: "practice",
    };
    assert(
      K.applyResult(
        save,
        synthetic({ count: 6, presented: 6, ids: ["G1-C01", "G1-C02"] }),
      ).saved.recommendation,
    );
  },
  () => {
    const save = K.emptySave();
    save.recommendation = null;
    assert.equal(K.validateBackup(JSON.stringify(save)).recommendation, null);
  },
  () => {
    const r = synthetic({ first: 6 }),
      a = rec(r);
    r.score = 999999;
    same(rec(r), a);
  },
  () =>
    assert.equal(
      rec(synthetic({ count: 2, first: 2, mode: "time", quantity: null })),
      null,
    ),
];
fallbackTests.forEach((fn, i) =>
  s.check(`TC-F${String(i + 1).padStart(2, "0")}`, fn),
);
function timed() {
  const r = make("G1-C01", { mode: "time", timeLimitMs: 30000 });
  r.activeTimeRemainingMs = 1000;
  return r;
}
const timerTests = [
  () =>
    assert.equal(event(timed(), "TICK", {}, 600).activeTimeRemainingMs, 400),
  () => {
    let r = event(timed(), "TICK", {}, 600);
    r.phase = "HINT_READING";
    r.pauseReasons = ["hint"];
    r = event(r, "HINT_CONTINUE", {}, 10600);
    assert.equal(r.activeTimeRemainingMs, 400);
    assert(event(r, "TICK", {}, 11000).finishedOnce);
  },
  () => {
    let r = timed();
    r.phase = "HINT_READING";
    r.pauseReasons = ["hint"];
    r = event(event(r, "HIDDEN", {}, 100), "VISIBLE", {}, 10000);
    same(r.pauseReasons, ["hint"]);
    assert.equal(r.activeTimeRemainingMs, 1000);
  },
  () => {
    let r = event(timed(), "PAUSE", {}, 100);
    r = event(event(r, "HIDDEN", {}, 100), "VISIBLE", {}, 10000);
    same(r.pauseReasons, ["manual"]);
    assert.equal(r.activeTimeRemainingMs, 900);
  },
  () => {
    let r = event(timed(), "HIDDEN", {}, 100);
    r = event(r, "VISIBLE", {}, 10100);
    assert.equal(r.activeTimeRemainingMs, 900);
  },
  () => {
    let r = answer(timed(), true, 100);
    r = event(r, "FEEDBACK_DONE", {}, 860);
    assert.equal(r.activeTimeRemainingMs, 900);
    r = answer(r, false, 900);
    r = event(r, "FEEDBACK_DONE", {}, 1280);
    assert.equal(r.activeTimeRemainingMs, 860);
  },
  () => {
    const r = answer(timed(), true, 999);
    assert.equal(r.records[0].terminal, "correct");
    assert.equal(r.activeTimeRemainingMs, 1);
  },
  () => {
    const r = answer(timed(), true, 1000);
    assert.equal(r.score, 0);
    assert.equal(r.records[0].terminal, "unanswered");
  },
  () => {
    let r = done(answer(make(), false));
    r = event(done(answer(r, false)), "HINT_CONTINUE");
    r = done(answer(r, false));
    assert.equal(r.phase, "QUESTION");
    assert.equal(r.records[0].wrongAttempts, 3);
  },
  () => {
    let r = event(timed(), "HELP", {}, 100);
    r = event(r, "TICK", {}, 99999);
    assert.equal(r.activeTimeRemainingMs, 900);
    assert.equal(r.phase, "SOLUTION_READING");
  },
  () => {
    let r = runAnswers(9);
    r = event(r, "HELP");
    r = finish(r);
    assert.equal(K.runMetrics(r).unansweredProblems, 0);
  },
  () => {
    let r = event(timed(), "PAUSE");
    r = event(r, "END_CONFIRM");
    r = event(r, "END_CANCEL");
    same(r.pauseReasons, ["manual"]);
  },
  () => assert.equal(K.checkpoint(timed()), null),
  () => {
    let r = runAnswers(1);
    r = answer(r, false);
    const cp = K.checkpoint(r);
    assert.equal(cp.records[1].wrongAttempts, 0);
    assert.equal(cp.score, 100);
  },
  () => {
    const r = event(timed(), "TICK", {}, 1000);
    same(event(r, "SUBMIT", { raw: { value: "0" } }, 1000), r);
  },
  () => {
    const a = answer(timed(), true, 500),
      b = answer(timed(), true, 500);
    same(a, b);
    assert.equal(a.activeTimeRemainingMs, 500);
  },
];
timerTests.forEach((fn, i) =>
  s.check(`TC-T${String(i + 1).padStart(2, "0")}`, fn),
);
const mockStorage = () => {
  const data = new Map();
  return {
    data,
    getItem: (k) => data.get(k) || null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
};
const completed = () => K.applyResult(K.emptySave(), runAnswers(10)).saved;
const persistenceTests = [
  () =>
    assert.notEqual(
      K.bestKey(
        make("G1-C01", { mode: "time", timeLimitMs: 60000 }).config,
        "independent",
      ),
      K.bestKey(
        make("G1-C01", { mode: "time", timeLimitMs: 90000 }).config,
        "independent",
      ),
    ),
  () =>
    assert.notEqual(
      K.bestKey(make().config, "supported"),
      K.bestKey(make().config, "independent"),
    ),
  () => assert(K.bestKey(make("G2-C08").config, "independent")),
  () =>
    assert.equal(
      K.bestKey(
        make("G1-C01", { selectedIds: ["G1-C01", "G1-C02"] }).config,
        "independent",
      ),
      null,
    ),
  () =>
    assert.equal(
      K.bestKey(make("G1-C01", { quantity: null }).config, "independent"),
      null,
    ),
  () => {
    const r = runAnswers(10),
      save = K.applyResult(K.emptySave(), r).saved;
    assert(!K.applyResult(save, r).newBest);
    r.score++;
    assert(K.applyResult(save, r).newBest);
  },
  () =>
    assert.equal(
      Object.keys(
        K.applyResult(K.emptySave(), finish(make())).saved.bestRecords,
      ).length,
      1,
    ),
  () =>
    assert.notEqual(
      K.bestKey(make().config, "independent"),
      K.bestKey(make("G1-C01", { quantity: 20 }).config, "independent"),
    ),
  () => {
    const save = completed();
    save.bestRecords = {
      ...save.bestRecords,
      ...K.applyResult(K.emptySave(), finish(make("G1-C02"))).saved.bestRecords,
    };
    const next = K.clearScores(save, "G1-C01");
    assert.equal(Object.keys(next.bestRecords).length, 1);
    assert.equal(
      Object.values(next.bestRecords)[0].config.selectedIds[0],
      "G1-C02",
    );
  },
  () => {
    const save = completed();
    save.settings.name = "試験";
    save.practiceCheckpoint = K.checkpoint(runAnswers(1));
    const next = K.clearScores(save);
    assert.equal(Object.keys(next.bestRecords).length, 0);
    same(next.practiceCheckpoint, save.practiceCheckpoint);
    assert.equal(next.settings.name, "試験");
  },
  () => {
    const store = mockStorage();
    store.setItem("other-app:test", "keep");
    const a = K.storageAdapter(store);
    a.write(completed());
    a.reset();
    assert.equal(store.getItem("other-app:test"), "keep");
    assert.equal(store.getItem(K.STORAGE_KEY), null);
  },
  () => {
    const save = K.emptySave();
    save.settings.onboarded = true;
    const result = K.validateBackup(JSON.stringify(save));
    assert.equal(result.settings.name, "");
    assert(!("players" in result));
  },
  () => {
    const save = K.emptySave();
    save.settings.name = "試験";
    save.settings.sound = false;
    save.settings.effects = false;
    const a = K.storageAdapter(mockStorage());
    assert(a.write(save));
    same(a.load(), save);
  },
  () => {
    let r = runAnswers(1);
    const question = r.currentQuestion;
    r = answer(r, false);
    const cp = K.checkpoint(r);
    same(cp.currentQuestion, question);
    assert.equal(cp.records[1].wrongAttempts, 0);
    assert.equal(cp.streak, 1);
    const save = K.emptySave();
    save.practiceCheckpoint = cp;
    K.validateBackup(JSON.stringify(save));
  },
  () => {
    const r = event(make(), "HELP"),
      cp = K.checkpoint(r);
    assert.equal(cp.records.length, 2);
    assert.equal(cp.records[0].terminal, "help");
    assert.equal(K.runMetrics(cp).mistakeEvents, 1);
  },
  () => {
    const save = K.emptySave();
    save.practiceCheckpoint = K.checkpoint(runAnswers(1));
    const before = JSON.stringify(save);
    same(K.validateBackup(before), save);
    assert.equal(JSON.stringify(save), before);
  },
  () => {
    const save = K.emptySave();
    save.practiceCheckpoint = K.checkpoint(runAnswers(1));
    make("G1-C02");
    assert.equal(save.practiceCheckpoint.config.selectedIds[0], "G1-C01");
  },
  () => {
    const save = completed();
    assert.equal(save.practiceCheckpoint, null);
    assert(!JSON.stringify(save.bestRecords).includes("firstWrongAnswer"));
  },
  () => {
    const save = completed();
    save.practiceCheckpoint = K.checkpoint(runAnswers(1));
    save.settings.name = "試験";
    same(K.validateBackup(JSON.stringify(save)), save);
  },
  () => {
    const save = completed(),
      low = K.clone(save);
    Object.values(low.bestRecords)[0].score = 1000;
    const restored = K.validateBackup(JSON.stringify(low));
    assert.equal(Object.values(restored.bestRecords)[0].score, 1000);
  },
  () => {
    for (const key of ["appVersion", "schemaVersion"]) {
      const x = K.emptySave();
      x[key] = key === "appVersion" ? "0.1" : 2;
      assert.throws(() => K.validateBackup(JSON.stringify(x)));
    }
  },
  () => {
    assert.throws(() => K.validateBackup("{"));
    const a = completed();
    Object.values(a.bestRecords)[0].score = -1;
    assert.throws(() => K.validateBackup(JSON.stringify(a)));
    const b = K.emptySave();
    b.settings.config.selectedIds = ["unknown"];
    assert.throws(() => K.validateBackup(JSON.stringify(b)));
    const c = K.emptySave();
    c.recommendation = {
      sourceId: "G4-C07",
      targetId: "G1-C01",
      reason: "bad",
    };
    assert.throws(() => K.validateBackup(JSON.stringify(c)));
  },
  () => assert.throws(() => K.validateBackup(" ".repeat(16 * 1024 * 1024 + 1))),
  () => {
    assert.throws(() => K.validateBackup('{"__proto__":{}}'));
    const x = K.emptySave();
    x.settings.name = "<img src=x onerror=alert(1)>";
    assert.equal(
      K.validateBackup(JSON.stringify(x)).settings.name,
      x.settings.name,
    );
  },
  () => {
    let warnings = 0;
    const a = K.storageAdapter(
      {
        getItem() {
          throw Error("SecurityError");
        },
        setItem() {
          throw Error("SecurityError");
        },
        removeItem() {
          throw Error("SecurityError");
        },
      },
      () => warnings++,
    );
    assert(!a.available);
    assert(!a.write(K.emptySave()));
    correct(q("G1-C01"));
    assert(warnings >= 2);
  },
  () => {
    const store = mockStorage(),
      a = K.storageAdapter(store),
      save = completed();
    a.write(save);
    const before = store.getItem(K.STORAGE_KEY);
    store.setItem = () => {
      throw Error("QuotaExceededError");
    };
    assert(!a.write(K.emptySave()));
    assert.equal(store.getItem(K.STORAGE_KEY), before);
  },
  () => {
    const save = completed(),
      before = JSON.stringify(save);
    K.validateBackup(JSON.stringify(K.emptySave()));
    assert.equal(JSON.stringify(save), before);
  },
  () => {
    const store = mockStorage(),
      a = K.storageAdapter(store),
      r = event(timed(), "TICK", {}, 1000),
      save = K.applyResult(K.emptySave(), r).saved;
    assert(a.write(save));
    same(a.load().bestRecords, save.bestRecords);
    assert.equal(a.load().practiceCheckpoint, null);
  },
];
persistenceTests.forEach((fn, i) =>
  s.check(`TC-P${String(i + 1).padStart(2, "0")}`, fn),
);
for (const [id, x] of Object.entries(f))
  s.check("representative-" + id, () => correct(x.question));
s.check("defensive-number-and-input-boundaries", () => {
  same(K.rat(-2, -4), { n: "1", d: "2" });
  assert.throws(() => K.number("1e3"));
  assert.throws(() => K.calc("?", 1, 2));
  assert.equal(K.decimalPlaces(K.rat(1, 3)), Infinity);
  assert.throws(() => K.format(K.rat(1, 3), "decimal"));
  for (const [spec, raw] of [
    [
      { type: "fraction" },
      { form: "mixed", whole: "1", numerator: "5", denominator: "4" },
    ],
    [
      { type: "fraction" },
      { form: "nonsense", numerator: "1", denominator: "2" },
    ],
    [{ type: "common" }, {}],
    [{ type: "blocks", labels: ["a"] }, {}],
    [{ type: "set" }, {}],
    [{ type: "set" }, { values: ["1", "1"] }],
    [{ type: "compare" }, {}],
    [{ type: "parity" }, {}],
    [{ type: "unknown" }, {}],
  ])
    assert(K.normalizeInput(spec, raw).error);
  same(
    K.normalizeInput(
      { type: "blocks", labels: ["a", "b"] },
      { values: ["1", "0"] },
    ).values,
    ["1", "0"],
  );
  assert(K.judge(q("G1-C01"), { error: "invalid" }).inputError);
  wrong(q("G4-N06"), {
    form: "mixed",
    whole: "1",
    numerator: "4",
    denominator: "10",
  });
  const r = answer(make(), false);
  assert.equal(event(r, "RESUME").phase, "WRONG_FEEDBACK");
  assert(event(make(), "SUBMIT", { raw: { value: "" } }).notice);
});
s.check("configuration-boundaries", () => {
  for (const cfg of [
    {},
    { selectedIds: ["G1-C01"], mode: "invalid" },
    { selectedIds: ["G1-C01"], mode: "practice", quantity: 9 },
    { selectedIds: ["G1-C01"], mode: "time", timeLimitMs: 120000 },
    {
      selectedIds: ["G2-C08"],
      mode: "practice",
      optionsById: { "G2-C08": { table: 10 } },
    },
    {
      selectedIds: ["G4-C07"],
      mode: "practice",
      optionsById: { "G4-C07": { remainder: "invalid" } },
    },
  ])
    assert.throws(() => K.normalizeConfig(cfg));
  assert.equal(
    K.normalizeConfig({ selectedIds: ["G1-C01"], mode: "practice" }).quantity,
    10,
  );
  assert.equal(
    K.normalizeConfig({ selectedIds: ["G1-C01"], mode: "time" }).timeLimitMs,
    60000,
  );
  assert.equal(
    K.normalizeConfig({ selectedIds: ["G4-C07"], mode: "time" }).timeLimitMs,
    120000,
  );
  assert.equal(
    K.applyResult(K.emptySave(), finish(event(make(), "HELP"))).saved
      .bestRecords[K.bestKey(make().config, "supported")].supportClass,
    "supported",
  );
  const save = K.emptySave();
  same(K.recommendConfig(save, make().config).saved, save);
  assert.equal(K.checkpoint(make()).score, 0);
  const store = mockStorage();
  store.setItem = () => {};
  assert.equal(K.storageAdapter(store).available, false);
});
s.check("untrusted-backup-shapes-and-completion", () => {
  const mutate = (fn) => {
    const v = completed();
    fn(v);
    assert.throws(() => K.validateBackup(JSON.stringify(v)));
  };
  mutate((v) => (v.settings.name = "x".repeat(31)));
  mutate((v) => (v.settings.sound = "yes"));
  mutate((v) => (v.bestRecords = []));
  mutate((v) => (v.returnStack = {}));
  mutate((v) => {
    Object.values(v.bestRecords)[0].supportClass = "bad";
  });
  mutate((v) => {
    Object.values(v.bestRecords)[0].metrics = null;
  });
  mutate(
    (v) =>
      (v.recommendation = {
        sourceId: "G1-N01",
        targetId: "G1-N01",
        reason: 2,
      }),
  );
  const valid = completed();
  valid.practiceCheckpoint = K.checkpoint(runAnswers(1));
  for (const fn of [
    (v) => (v.practiceCheckpoint.schedule[0] = "bad"),
    (v) => (v.practiceCheckpoint.generator.rngState = 0),
    (v) => (v.practiceCheckpoint.records[0].earnedPoints = 1),
    (v) => (v.practiceCheckpoint.records[0].questionId = "bad"),
    (v) => v.practiceCheckpoint.score++,
    (v) => (v.practiceCheckpoint.records[1].wrongAttempts = 1),
  ]) {
    const v = K.clone(valid);
    fn(v);
    assert.throws(() => K.validateBackup(JSON.stringify(v)));
  }
  const all = K.emptySave();
  all.practiceCheckpoint = K.checkpoint(runAnswers(10));
  K.validateBackup(JSON.stringify(all));
  const nested = K.emptySave();
  nested.extra = {};
  let p = nested.extra;
  for (let i = 0; i < 85; i++) p = p.a = {};
  assert.throws(() => K.validateBackup(JSON.stringify(nested)));
});
s.check("every-challenge-checkpoint-and-idempotent-question", () => {
  for (const c of K.CATALOG) {
    let r = make(c.id);
    const check = () => {
      const saved = K.emptySave();
      saved.practiceCheckpoint = K.checkpoint(r);
      const text = JSON.stringify(saved);
      assert.equal(JSON.stringify(K.validateBackup(text)), text, c.id);
      const original = r.currentQuestion;
      const rebuilt = K.complete(K.clone(original), original.conditionBucket);
      same(rebuilt, original);
    };
    check();
    r = done(answer(r));
    check();
    r = event(r, "HELP");
    check();
  }
});
s.check("explanations-respect-prerequisite-learning", () => {
  assert(!q("G1-N02").solutionTrace.some((t) => t.text.includes("×")));
  assert(!q("G3-N03").solutionTrace.some((t) => t.text.includes("÷")));
  assert(!q("G3-C09").solutionTrace.some((t) => t.text.includes("17/5")));
  assert(!q("G5-N12").solutionTrace.some((t) => t.text.includes("逆数")));
  for (const id of ["G1-N01", "G2-N01", "G3-N04", "G4-N04"])
    assert(!q(id).solutionTrace.some((t) => t.text.includes("1/")), id);
  for (const id of ["G3-C07", "G3-C08"])
    assert(!q(id).solutionTrace.some((t) => t.text.includes("小数")), id);
  const thirds = K.complete(
    K.arithmetic(
      "G3-C13",
      K.op("+", K.lit(K.rat(3, 6), "3/6"), K.lit(K.rat(3, 6), "3/6")),
      { type: "fraction", reduced: false },
      { displayDenominator: "6" },
    ),
  );
  assert(thirds.solutionTrace.some((t) => t.text.includes("分母6はそのまま")));
  assert(!thirds.solutionTrace.some((t) => t.text.includes("分母を2")));
  assert.equal(K.answerText(thirds), "6/6");
});
s.done();
