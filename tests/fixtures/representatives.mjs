// Fixed curriculum examples, independently specified expected values.
export function representatives(K) {
  const q = {};
  const leaf = (s) =>
    String(s).includes("/")
      ? K.lit(
          { n: String(s).split("/")[0], d: String(s).split("/")[1] },
          String(s),
        )
      : K.lit(s);
  const arithmetic = (id, sign, a, b, value, extra = {}) => {
    if (/^G[34]-C1[34]$/.test(id))
      extra.displayDenominator = String(a).split("/")[1];
    q[id] = {
      question: K.complete(
        K.arithmetic(
          id,
          K.op(sign, leaf(a), leaf(b)),
          {
            type:
              id.startsWith("G6-") || /G[345]-C1[34]|G5-C0[678]/.test(id)
                ? "fraction"
                : "integer",
            reduced: id.startsWith("G5-") || id.startsWith("G6-"),
            ...extra.answerSpec,
          },
          extra,
        ),
      ),
      expected: value,
    };
  };
  const rows = [
    ["G1-C02", "+", 4, 5, 9],
    ["G1-C03", "+", 8, 7, 15],
    ["G1-C04", "-", 9, 4, 5],
    ["G1-C05", "-", 13, 7, 6],
    ["G1-C06", "+", 23, 5, 28],
    ["G1-C07", "-", 37, 4, 33],
    ["G2-C01", "+", 23, 45, 68],
    ["G2-C02", "+", 58, 67, 125],
    ["G2-C03", "-", 76, 32, 44],
    ["G2-C04", "-", 125, 67, 58],
    ["G2-C05", "+", 234, 57, 291],
    ["G2-C06", "-", 546, 27, 519],
    ["G2-C07", "+", 800, 700, 1500],
    ["G2-C08", "*", 7, 8, 56],
    ["G2-C09", "*", 12, 3, 36],
    ["G3-C01", "+", 568, 757, 1325],
    ["G3-C02", "-", 403, 178, 225],
    ["G3-C03", "+", 4568, 3787, 8355],
    ["G3-C04", "-", 4003, 1786, 2217],
    ["G3-C05", "*", 47, 6, 282],
    ["G3-C06", "*", 306, 7, 2142],
    ["G3-C07", "*", 47, 26, 1222],
    ["G3-C08", "*", 306, 24, 7344],
    ["G3-C10", "/", 69, 3, 23],
    ["G3-C11", "+", "2.7", "3.8", "6.5", { answerSpec: { type: "decimal" } }],
    ["G3-C12", "-", 5, "2.7", "2.3", { answerSpec: { type: "decimal" } }],
    ["G3-C13", "+", "1/5", "2/5", "3/5"],
    ["G3-C14", "-", "4/7", "2/7", "2/7"],
    ["G4-C08", "+", "2.75", "0.8", "3.55", { answerSpec: { type: "decimal" } }],
    [
      "G4-C09",
      "-",
      "5.003",
      "2.178",
      "2.825",
      { answerSpec: { type: "decimal" } },
    ],
    ["G4-C10", "*", "3.6", 4, "14.4", { answerSpec: { type: "decimal" } }],
    ["G4-C11", "/", "7.5", 3, "2.5", { answerSpec: { type: "decimal" } }],
    ["G4-C12", "/", 7, 4, "1.75", { answerSpec: { type: "decimal" } }],
    ["G4-C13", "+", "3/5", "4/5", "7/5"],
    ["G4-C14", "-", "11/5", "4/5", "7/5"],
    ["G5-C01", "*", 25, "0.4", 10, { answerSpec: { type: "decimal" } }],
    ["G5-C02", "*", "2.4", "1.5", "3.6", { answerSpec: { type: "decimal" } }],
    ["G5-C03", "/", "6.3", "0.7", 9, { answerSpec: { type: "decimal" } }],
    [
      "G5-C05",
      "/",
      2,
      3,
      "0.67",
      { answerSpec: { type: "decimal" }, roundPlaces: 2 },
    ],
    ["G5-C06", "+", "1/3", "1/6", "1/2"],
    ["G5-C07", "-", "5/6", "1/4", "7/12"],
    ["G5-C08", "-", "7/3", "11/6", "1/2"],
    [
      "G5-N06",
      "/",
      "2.485",
      100,
      "0.02485",
      { answerSpec: { type: "decimal" } },
    ],
    [
      "G5-N12",
      "/",
      5,
      9,
      "5/9",
      { answerSpec: { type: "fraction", reduced: true } },
    ],
    ["G6-C01", "*", "2/3", 4, "8/3"],
    ["G6-C02", "/", "3/4", 2, "3/8"],
    ["G6-C03", "*", "2/3", "9/10", "3/5"],
    ["G6-C04", "/", "3/4", "2/5", "15/8"],
    ["G6-C05", "*", "3/2", "8/3", 4],
    ["G6-C06", "/", "9/4", "3/2", "3/2"],
  ];
  rows.forEach((r) => arithmetic(...r));
  for (const [id, a, d, quo, rem] of [
    ["G3-C09", 17, 5, 3, 2],
    ["G4-C04", 84, 3, 28, 0],
    ["G4-C05", 824, 4, 206, 0],
    ["G4-C06", 87, 23, 3, 18],
    ["G4-C07", 987, 24, 41, 3],
    ["G5-C04", "7.3", "0.4", 18, "0.1"],
  ])
    arithmetic(
      id,
      "/",
      a,
      d,
      { quotient: String(quo), remainder: rem },
      { answerSpec: { type: "quotient", decimalRemainder: id === "G5-C04" } },
    );
  const direct = (id, value, prompt) => {
    q[id] = {
      question: K.complete(
        K.arithmetic(id, leaf(value), { type: "integer" }, { prompt }),
      ),
      expected: value,
    };
  };
  [
    ["G1-N02", 43, "10が4こ、1が3こ"],
    ["G1-N03", 28, "27、□、29"],
    ["G1-C01", 3, "7＋□＝10"],
    ["G1-C09", 5, "3＋□＝8"],
    ["G2-N02", 2300, "100が23こ"],
    ["G2-C10", 59, "□−24＝35"],
    ["G3-N02", 32, "320の10分の1"],
    ["G3-N03", 23, "2.3は0.1が□こ"],
    ["G3-C15", 7, "□×6＝42"],
    ["G4-N02", 300250000, "3億と25万"],
    ["G4-N03", 2035, "2.035は0.001が□こ"],
    ["G4-N05", 2, "1/2＝□/4"],
    ["G4-C17", 4, "25×16＝（25×4）×□"],
    ["G5-N03", 24, "6の正の倍数の4番目"],
  ].forEach((r) => direct(...r));
  for (const [id, a, b, expected] of [
    ["G1-N01", 8, 5, ">"],
    ["G2-N01", 3050, 3500, "<"],
    ["G3-N01", 4020000, 4200000, "<"],
    ["G3-N04", "2.3", "2.8", "<"],
    ["G3-N06", "2/7", "5/7", "<"],
    ["G4-N01", "9007199254740993", "9007199254740992", ">"],
    ["G4-N04", "2.05", "2.5", "<"],
    ["G5-N09", "3/4", "5/8", ">"],
  ])
    q[id] = {
      question: K.complete(
        K.special(
          id,
          "compare",
          [leaf(a).value, leaf(b).value],
          { type: "compare" },
          { labels: [String(a), String(b)] },
        ),
      ),
      expected,
    };
  for (const [id, n, d, extra] of [
    ["G2-N03", 1, 4, { diagram: [[1, 4]] }],
    ["G3-N05", 3, 5, { diagram: [[3, 5]] }],
    ["G4-N06", 7, 5, { form: "mixed", denominator: "5" }],
    ["G5-N07", 18, 24, {}],
    ["G5-N10", 25, 100, {}],
  ])
    q[id] = {
      question: K.complete(
        K.special(
          id,
          "fraction",
          [K.rat(n, d)],
          { type: "fraction", reduced: id.startsWith("G5"), ...extra },
          {
            prompt: {
              "G2-N03": "4つに おなじ おおきさで わけた 1つぶん",
              "G3-N05": "1/5 が 3こ",
              "G4-N06": "7/5 を帯分数に（分母は5）",
              "G5-N07": "18/24 を約分",
              "G5-N10": "0.25 を分数に",
            }[id],
            original: { n: String(n), d: String(d) },
          },
        ),
      ),
      expected: `${n}/${d}`,
    };
  q["G4-N05"].question.diagram = [
    [1, 2],
    [2, 4],
  ];
  q["G5-N01"] = {
    question: K.complete(
      K.special("G5-N01", "parity", ["0"], { type: "parity" }),
    ),
    expected: "even",
  };
  q["G5-N02"] = {
    question: K.complete(
      K.special("G5-N02", "divisors", ["12"], { type: "set" }),
    ),
    expected: ["1", "2", "3", "4", "6", "12"],
  };
  for (const [id, task, values, expected] of [
    ["G5-N04", "gcd", ["18", "24"], "6"],
    ["G5-N05", "lcm", ["6", "8"], "24"],
  ])
    q[id] = {
      question: K.complete(K.special(id, task, values, { type: "integer" })),
      expected,
    };
  q["G5-N08"] = {
    question: K.complete(
      K.special(
        "G5-N08",
        "common",
        [
          { n: "1", d: "4" },
          { n: "1", d: "6" },
        ],
        { type: "common" },
        { labels: ["1/4", "1/6"] },
      ),
    ),
    expected: [
      { n: "3", d: "12" },
      { n: "2", d: "12" },
    ],
  };
  q["G4-C01"] = {
    question: K.complete(
      K.special(
        "G4-C01",
        "round",
        ["42948"],
        { type: "integer" },
        { places: -3 },
      ),
    ),
    expected: "43000",
  };
  arithmetic("G4-C02", "+", 300, 300, 600, {
    prompt: "347＋258を、それぞれ百の位まで四捨五入して計算",
    roundOperands: [
      { original: "347", places: -2 },
      { original: "258", places: -2 },
    ],
  });
  arithmetic("G4-C03", "/", 200, 50, 4, {
    prompt: "196÷48を、それぞれ上から1桁で見積もる",
    roundOperands: [
      { original: "196", places: -2 },
      { original: "48", places: -1 },
    ],
  });
  q["G5-N11"] = {
    question: K.complete(
      K.arithmetic(
        "G5-N11",
        leaf("3/8"),
        { type: "decimal" },
        { prompt: "3/8を小数で" },
      ),
    ),
    expected: "0.375",
  };
  q["G6-N01"] = {
    question: K.complete(
      K.special(
        "G6-N01",
        "reciprocal",
        [K.rat(2, 3)],
        { type: "fraction", reduced: true },
        { labels: ["2/3"] },
      ),
    ),
    expected: "3/2",
  };
  const expr = (id, ast, expected, type = "integer") => {
    q[id] = {
      question: K.complete(
        K.arithmetic(id, ast, {
          type,
          reduced: type === "fraction" && id.startsWith("G6"),
        }),
      ),
      expected,
    };
  };
  expr("G1-C08", K.op("-", K.op("+", leaf(8), leaf(5)), leaf(3)), 10);
  expr("G4-C15", K.op("+", leaf(8), K.op("*", leaf(3), leaf(4))), 20);
  expr("G4-C16", K.op("*", K.op("-", leaf(15), leaf(7), true), leaf(6)), 48);
  expr(
    "G5-C09",
    K.op("+", leaf(6), K.op("*", leaf("0.5"), leaf(2))),
    7,
    "decimal",
  );
  expr("G5-N13", K.op("+", K.op("*", leaf(3), leaf(2)), leaf(1)), 7, "decimal");
  q["G5-N13"].question.prompt = "□＝3×△＋1、△＝2";
  expr(
    "G6-N02",
    K.op("+", K.op("*", leaf(4), leaf(3)), leaf(2)),
    14,
    "fraction",
  );
  q["G6-N02"].question.prompt = "x×3＋2、x＝4（答えは整数か分数で）";
  expr(
    "G6-C07",
    K.op("+", leaf("1/2"), K.op("*", leaf("2/3"), leaf("3/4"))),
    1,
    "fraction",
  );
  expr(
    "G6-C08",
    K.op("-", K.op("+", leaf("0.5"), leaf("1/3")), leaf("1/6")),
    "2/3",
    "fraction",
  );
  const replace = (id, ast) => {
    q[id].question = K.complete({ ...q[id].question, expressionAST: ast });
  };
  replace("G1-N02", K.op("+", K.op("*", leaf(10), leaf(4)), leaf(3)));
  q["G1-N03"].question = K.complete({
    ...q["G1-N03"].question,
    sequence: [27, 28, 29],
  });
  replace("G1-C01", K.op("-", leaf(10), leaf(7)));
  replace("G1-C09", K.op("-", leaf(8), leaf(3)));
  replace("G2-N02", K.op("*", leaf(100), leaf(23)));
  replace("G2-C10", K.op("+", leaf(35), leaf(24)));
  replace("G3-N02", K.op("/", leaf(320), leaf(10)));
  replace("G3-N03", K.op("/", leaf("2.3"), leaf("0.1")));
  replace("G3-C15", K.op("/", leaf(42), leaf(6)));
  replace(
    "G4-N02",
    K.op(
      "+",
      K.op("*", leaf(3), leaf(100000000)),
      K.op("*", leaf(25), leaf(10000)),
    ),
  );
  replace("G4-N03", K.op("/", leaf("2.035"), leaf("0.001")));
  replace("G4-N05", K.op("*", leaf(1), leaf(2)));
  replace("G4-C17", K.op("/", leaf(16), leaf(4)));
  q["G4-C17"].question = K.complete({
    ...q["G4-C17"].question,
    law: { kind: "associate", a: 25, b: 4, c: 4 },
  });
  replace("G5-N03", K.op("*", leaf(6), leaf(4)));
  for (const id of ["G3-N01", "G4-N01"]) q[id].question.numberBlocks = true;
  for (const id of ["G4-C14", "G5-C08", "G6-C05", "G6-C06"]) {
    const x = q[id].question;
    for (const n of x.expressionAST.args) {
      const a = BigInt(n.value.n),
        b = BigInt(n.value.d);
      if (a > b && a % b) n.label = `${a / b}と${a % b}/${b}`;
    }
    x.prompt = K.expression(x.expressionAST);
    q[id].question = K.complete(x);
  }
  return q;
}
