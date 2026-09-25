/* KZ-030: exact numbers, curriculum, judging, run reducer, persistence.
   This source is embedded in Kazohe.html; tests load that final inline code. */
const KZ = (() => {
  "use strict";
  const VERSION = "0.2";
  const STORAGE_KEY = "kazohe:v0.2:state";
  const CATALOG = __KAZOHE_CATALOG__;
  const BY_ID = Object.fromEntries(CATALOG.map((c) => [c.id, c]));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const abs = (n) => (n < 0n ? -n : n);
  function gcd(a, b) {
    a = abs(BigInt(a));
    b = abs(BigInt(b));
    while (b) [a, b] = [b, a % b];
    return a;
  }
  const lcm = (a, b) => (BigInt(a) / gcd(a, b)) * BigInt(b);
  function rat(n, d = 1) {
    n = BigInt(n);
    d = BigInt(d);
    if (!d) throw Error("分母は0にできません");
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d);
    return { n: String(n / g), d: String(d / g) };
  }
  function number(s) {
    if (s && typeof s === "object") return rat(s.n, s.d);
    s = String(s);
    if (!/^\d+(?:\.\d+)?$/.test(s)) throw Error("数字をたしかめてね");
    const [i, f = ""] = s.split(".");
    return rat(i + f, 10n ** BigInt(f.length));
  }
  function calc(op, a, b) {
    a = number(a);
    b = number(b);
    const an = BigInt(a.n),
      ad = BigInt(a.d),
      bn = BigInt(b.n),
      bd = BigInt(b.d);
    if (op === "+") return rat(an * bd + bn * ad, ad * bd);
    if (op === "-") return rat(an * bd - bn * ad, ad * bd);
    if (op === "*") return rat(an * bn, ad * bd);
    if (op === "/") return rat(an * bd, ad * bn);
    throw Error("Unknown operation");
  }
  const cmp = (a, b) => {
    const v = calc("-", a, b);
    return BigInt(v.n) < 0n ? -1 : BigInt(v.n) > 0n ? 1 : 0;
  };
  const decimal = (coefficient, scale) => {
    const s = String(coefficient).padStart(scale + 1, "0");
    return scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s;
  };
  function decimalPlaces(a) {
    let d = BigInt(number(a).d),
      twos = 0,
      fives = 0;
    while (d % 2n === 0n) {
      d /= 2n;
      twos++;
    }
    while (d % 5n === 0n) {
      d /= 5n;
      fives++;
    }
    return d === 1n ? Math.max(twos, fives) : Infinity;
  }
  function format(a, kind = "fraction") {
    a = number(a);
    if (a.d === "1") return a.n;
    if (kind === "decimal") {
      const s = decimalPlaces(a);
      if (!Number.isFinite(s)) throw Error("Non-terminating decimal");
      return decimal((BigInt(a.n) * 10n ** BigInt(s)) / BigInt(a.d), s)
        .replace(/0+$/, "")
        .replace(/\.$/, "");
    }
    return `${a.n}/${a.d}`;
  }
  function roundExact(a, places) {
    a = number(a);
    const unit = 10n ** BigInt(Math.abs(places));
    const n = BigInt(a.n) * (places >= 0 ? unit : 1n),
      d = BigInt(a.d) * (places < 0 ? unit : 1n);
    const rounded = (n * 2n + d) / (2n * d);
    return places >= 0 ? rat(rounded, unit) : rat(rounded * unit);
  }
  const lit = (v, label) => ({ value: number(v), ...(label ? { label } : {}) });
  const op = (operator, a, b, group = false) => ({
    op: operator,
    args: [a, b],
    group,
  });
  function evaluate(ast) {
    if (ast.value) return number(ast.value);
    const v = calc(ast.op, evaluate(ast.args[0]), evaluate(ast.args[1]));
    if (BigInt(v.n) < 0n) throw Error("Negative intermediate");
    return v;
  }
  function expression(ast) {
    if (ast.value)
      return (
        ast.label ||
        format(
          ast.value,
          decimalPlaces(ast.value) <= 4 ? "decimal" : "fraction",
        )
      );
    const signs = { "+": "＋", "-": "−", "*": "×", "/": "÷" };
    const str = ast.args
      .map((a, i) => {
        const s = expression(a);
        const needs =
          a.op &&
          !a.group &&
          ((["*", "/"].includes(ast.op) && ["+", "-"].includes(a.op)) ||
            (i === 1 && ["-", "/"].includes(ast.op)));
        return needs ? `（${s}）` : s;
      })
      .join(` ${signs[ast.op]} `);
    return ast.group ? `（${str}）` : str;
  }
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return {
      next() {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        return (s >>> 0) / 4294967296;
      },
      get state() {
        return s >>> 0;
      },
    };
  }
  const shuffle = (a, r) => {
    a = [...a];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const int = (r, min, max) => min + Math.floor(r.next() * (max - min + 1));
  const D = (n, s) => decimal(n, s);
  const F = (n, d) => lit(rat(n, d), `${n}/${d}`);
  function carry(a, b) {
    let c = 0,
      found = false;
    while (a || b) {
      const t = (a % 10) + (b % 10) + c;
      c = t >= 10 ? 1 : 0;
      found ||= !!c;
      a = Math.floor(a / 10);
      b = Math.floor(b / 10);
    }
    return found;
  }
  function borrow(a, b) {
    let c = 0,
      found = false;
    while (a || b) {
      c = (a % 10) - c < b % 10 ? 1 : 0;
      found ||= !!c;
      a = Math.floor(a / 10);
      b = Math.floor(b / 10);
    }
    return found;
  }
  const REMAINDER_IDS = [
    "G3-C09",
    "G4-C04",
    "G4-C05",
    "G4-C06",
    "G4-C07",
    "G5-C04",
  ];
  const LONG_ARITHMETIC =
    /^(G2-C0[1-6]|G3-C0[1-8]|G3-C1[12]|G4-C(?:0[4-9]|1[012])|G5-C0[1-5])$/;
  const fractionSpec = (grade, policy = {}) => ({
    type: "fraction",
    reduced: grade >= 5,
    ...policy,
  });
  function arithmetic(id, ast, spec = { type: "integer" }, extra = {}) {
    return {
      challengeId: id,
      task: "arithmetic",
      expressionAST: ast,
      answerSpec: spec,
      expectedExactValue: evaluate(ast),
      prompt: expression(ast),
      ...extra,
    };
  }
  function special(id, task, values, spec, extra = {}) {
    return { challengeId: id, task, values, answerSpec: spec, ...extra };
  }
  function complete(q, bucket = "standard") {
    const id = q.challengeId;
    if (q.task === "arithmetic")
      q.expectedExactValue = evaluate(q.expressionAST);
    q.conditionBucket = bucket;
    q.written = LONG_ARITHMETIC.test(id) && q.task === "arithmetic";
    if (q.task === "compare") {
      q.expectedExactValue = ["<", "=", ">"][cmp(q.values[0], q.values[1]) + 1];
      q.prompt = `${q.labels?.[0] || format(q.values[0])} □ ${q.labels?.[1] || format(q.values[1])}`;
    }
    if (q.task === "parity") {
      q.expectedExactValue = BigInt(q.values[0]) % 2n === 0n ? "even" : "odd";
      q.prompt = `${q.values[0]} は 偶数（ぐうすう）？ 奇数（きすう）？`;
    }
    if (q.task === "divisors") {
      const n = Number(q.values[0]);
      q.expectedExactValue = Array.from({ length: n }, (_, i) => i + 1)
        .filter((i) => n % i === 0)
        .map(String);
      q.prompt = `${n} の正の約数を全部見つけよう`;
    }
    if (q.task === "gcd" || q.task === "lcm") {
      q.expectedExactValue = rat(
        q.task === "gcd" ? gcd(...q.values) : lcm(...q.values),
      );
      q.prompt = `${q.values.join(" と ")} の${q.task === "gcd" ? "最大公約数" : "最小公倍数"}`;
    }
    if (q.task === "round") {
      q.expectedExactValue = roundExact(q.values[0], q.places);
      q.prompt = `${q.values[0]} を${{ 1: "十", 2: "百", 3: "千", 4: "万" }[-q.places]}の位まで四捨五入`;
    }
    if (q.task === "fraction") {
      q.expectedExactValue = number(q.values[0]);
    }
    if (q.task === "reciprocal") {
      q.expectedExactValue = calc("/", 1, q.values[0]);
      q.prompt = `${q.labels[0]} の逆数を求めよう`;
    }
    if (q.task === "common") {
      const d = lcm(q.values[0].d, q.values[1].d);
      q.answerSpec.denominator = String(d);
      q.expectedExactValue = q.values.map((v) => ({
        n: String((BigInt(v.n) * d) / BigInt(v.d)),
        d: String(d),
      }));
      q.prompt = `${q.labels.join(" と ")} を、最小公倍数を分母にして通分`;
    }
    if (q.task === "arithmetic" && q.answerSpec.type === "quotient") {
      const a = evaluate(q.expressionAST.args[0]),
        b = evaluate(q.expressionAST.args[1]);
      const v = calc("/", a, b),
        quotient = BigInt(v.n) / BigInt(v.d);
      q.expectedExactValue = {
        quotient: String(quotient),
        remainder: calc("-", a, calc("*", b, rat(quotient))),
      };
      q.prompt = expression(q.expressionAST) + "（商は整数まで）";
    }
    if (q.task === "arithmetic" && q.roundPlaces !== undefined) {
      q.expectedExactValue = roundExact(
        evaluate(q.expressionAST),
        q.roundPlaces,
      );
      q.prompt =
        expression(q.expressionAST) +
        `（小数第${q.roundPlaces + 1}位を四捨五入して、小数第${q.roundPlaces}位まで）`;
    }
    q.canonicalKey = JSON.stringify([
      id,
      q.task,
      q.expressionAST || q.values,
      q.answerSpec,
      q.prompt,
    ]);
    q.solutionTrace = buildSolution(q);
    return q;
  }
  // Each finite domain has a rank space. Collisions fall back to exhaustive rank
  // traversal; a cycle can advance only after that space has been exhausted.
  const domain = (dims, make, bucket = "standard") => ({
    dims,
    make,
    bucket,
    size: dims.reduce((a, [l, h]) => a * BigInt(h - l + 1), 1n),
  });
  function domains(id, options = {}) {
    const grade = BY_ID[id].grade,
      I = { type: "integer" },
      E = { type: "decimal" },
      FS = fractionSpec(grade);
    const A = (sign, a, b, spec = I, extra = {}) =>
      arithmetic(id, op(sign, lit(a), lit(b)), spec, extra);
    const compare = (a, b, labels) =>
      special(
        id,
        "compare",
        [number(a), number(b)],
        { type: "compare" },
        { labels },
      );
    const blank = (x, prompt, solve) =>
      arithmetic(id, solve || lit(x), I, { prompt, unknown: String(x) });
    const frac = (n, d, prompt, policy = {}) =>
      special(id, "fraction", [rat(n, d)], fractionSpec(grade, policy), {
        prompt,
        original: { n: String(n), d: String(d) },
      });
    const dec = (a, b, sign) => A(sign, a, b, E);
    const sameFractions = (limit, addition) => [
      domain(
        [
          [2, limit],
          [0, 5 * limit],
          [0, 5 * limit],
        ],
        ([d, n, m]) => {
          const max = grade === 3 ? d : 5 * d;
          if (
            n > max ||
            m > max ||
            (addition && grade === 3 && (!n || !m || n + m > d)) ||
            (!addition && m > n)
          )
            return null;
          const f = (n) =>
            grade === 4 && n > d && n % d && n % 2
              ? lit(rat(n, d), `${Math.floor(n / d)}と${n % d}/${d}`)
              : F(n, d);
          return arithmetic(id, op(addition ? "+" : "-", f(n), f(m)), FS, {
            displayDenominator: String(d),
          });
        },
      ),
    ];
    const exprDomains = (kind) =>
      ["+", "-", "*", "/"].map((sign, idx) =>
        domain(
          [
            [0, kind === "decimal" ? 2000 : kind === "fraction" ? 60 : 100],
            [0, kind === "decimal" ? 2000 : kind === "fraction" ? 60 : 100],
            [0, kind === "decimal" ? 2000 : kind === "fraction" ? 60 : 100],
            [0, id === "G4-C15" ? 0 : 1],
            [2, kind === "fraction" ? 12 : 2],
            [2, kind === "fraction" ? 12 : 2],
            [2, kind === "fraction" ? 12 : 2],
          ],
          ([a, b, c, group, da, db, dc]) => {
            if (kind === "fraction" && (a > 5 * da || b > 5 * db || c > 5 * dc))
              return null;
            if (kind === "decimal") {
              a = D(a, 2);
              b = D(b, 2);
              c = D(c, 2);
            }
            let x = kind === "fraction" ? F(a, da) : lit(a),
              y = kind === "fraction" ? F(b, db) : lit(b),
              z = kind === "fraction" ? F(c, dc) : lit(c);
            let ast;
            if (sign === "/") {
              x = op("*", x, y);
              ast = op("+", op("/", x, y, !!group), z);
            } else if (sign === "-") {
              ast = op("-", op("+", x, y, !!group), z);
            } else if (sign === "*")
              ast = group
                ? op("*", op("-", x, y, true), z)
                : op("+", op("*", x, y), z);
            else
              ast = group
                ? op("*", op("+", x, y, true), z)
                : op("+", x, op("*", y, z));
            try {
              const value = evaluate(ast);
              if (kind === "decimal" && decimalPlaces(value) > 4) return null;
              const validIntermediates = (node) =>
                (!node.op || node.args.every(validIntermediates)) &&
                (kind !== "integer" || cmp(evaluate(node), 9999) <= 0) &&
                (kind !== "decimal" || decimalPlaces(evaluate(node)) <= 4);
              if (!validIntermediates(ast)) return null;
              return arithmetic(
                id,
                ast,
                kind === "fraction" ? FS : kind === "decimal" ? E : I,
              );
            } catch {
              return null;
            }
          },
          ["multiply-first", "subtract", "parentheses", "divide-first"][idx],
        ),
      );
    if (id === "G2-N01")
      return ["digit-length", "interior-zero", "equal"].map((bucket, k) =>
        domain(
          k === 2
            ? [[0, 9999]]
            : [
                [0, 9999],
                [0, 9999],
              ],
          ([a, b]) => {
            if (k === 2) b = a;
            else if (a === b) return null;
            if (k === 0 && String(a).length === String(b).length) return null;
            if (
              k === 1 &&
              (String(a).length !== String(b).length ||
                ![a, b].some((n) => String(n).slice(1, -1).includes("0")))
            )
              return null;
            return compare(a, b);
          },
          bucket,
        ),
      );
    if (
      id === "G1-N01" ||
      id === "G3-N01" ||
      id === "G4-N01" ||
      id === "G3-N04" ||
      id === "G4-N04"
    ) {
      let max =
        {
          "G1-N01": 100,
          "G2-N01": 9999,
          "G3-N01": 99999999,
          "G3-N04": 99,
          "G4-N04": 99999,
        }[id] || 99999999;
      return ["less", "equal", "greater"].map((bucket, k) =>
        domain(
          id === "G4-N01"
            ? k === 1
              ? [
                  [1, 99999999],
                  [0, 99999999],
                ]
              : [
                  [0, 99999999],
                  [0, 99999999],
                  [1, 99999999],
                  [0, 99999999],
                ]
            : k === 1
              ? [[0, id === "G4-N04" ? 9999 : max]]
              : [
                  [0, max],
                  [0, max],
                ],
          (v) => {
            let a, b;
            if (id === "G4-N01") {
              a = BigInt(v[0]) * 100000000n + BigInt(v[1]);
              b = k === 1 ? a : BigInt(v[2]) * 100000000n + BigInt(v[3]);
            } else {
              [a, b] = v;
              a = BigInt(a);
              if (id === "G4-N04" && k === 1) a *= 10n;
              b = k === 1 ? a : BigInt(b);
            }
            if (k === 1) b = a;
            else if (a === b) return null;
            if ((k === 0 && a > b) || (k === 2 && a < b)) [a, b] = [b, a];
            if (id === "G4-N01" && a < 100000000n && b < 100000000n)
              return null;
            const scale = id === "G3-N04" ? 1 : id === "G4-N04" ? 3 : 0;
            const labels = [D(a, scale), D(b, scale)];
            if (id === "G4-N04" && k === 1)
              labels[1] =
                format(number(labels[1]), "decimal") +
                (BigInt(number(labels[1]).d) === 1n ? ".0" : "0");
            const q = compare(D(a, scale), D(b, scale), labels);
            if (id === "G3-N01" || id === "G4-N01") q.numberBlocks = true;
            return q;
          },
          bucket,
        ),
      );
    }
    if (id === "G1-N02")
      return [0, 1].map((reverse) =>
        domain(
          [
            [1, 9],
            [0, 9],
          ],
          ([a, b]) =>
            reverse
              ? special(
                  id,
                  "blocks",
                  [String(a), String(b)],
                  { type: "blocks", labels: ["10のまとまり", "のこりの1"] },
                  {
                    prompt: `${10 * a + b} は10が□こ、1が□こ`,
                    expectedExactValue: [String(a), String(b)],
                  },
                )
              : blank(
                  10 * a + b,
                  `10が${a}こ、1が${b}こ`,
                  op("+", op("*", lit(10), lit(a)), lit(b)),
                ),
          reverse ? "decompose" : "compose",
        ),
      );
    if (id === "G1-N03")
      return [
        domain(
          [
            [0, 98],
            [0, 2],
          ],
          ([a, p]) => ({
            ...blank(
              a + p,
              [a, a + 1, a + 2].map((n, i) => (i === p ? "□" : n)).join("、"),
            ),
            sequence: [a, a + 1, a + 2],
          }),
        ),
      ];
    if (id === "G1-C01")
      return [
        domain([[0, 10]], ([a]) =>
          blank(10 - a, `${a} ＋ □ ＝ 10`, op("-", lit(10), lit(a))),
        ),
      ];
    if (id === "G1-C09")
      return [
        domain(
          [
            [2, 9],
            [0, 9],
          ],
          ([t, a]) =>
            a > t
              ? null
              : blank(t - a, `${a} ＋ □ ＝ ${t}`, op("-", lit(t), lit(a))),
        ),
      ];
    if (id === "G1-C02")
      return [
        domain(
          [
            [0, 9],
            [0, 9],
          ],
          ([a, b]) => (a + b <= 10 ? A("+", a, b) : null),
        ),
      ];
    if (id === "G1-C03")
      return [
        domain(
          [
            [1, 9],
            [1, 9],
          ],
          ([a, b]) => (a + b >= 11 ? A("+", a, b) : null),
          "carry",
        ),
      ];
    if (id === "G1-C04")
      return [
        domain(
          [
            [0, 10],
            [0, 10],
          ],
          ([a, b]) => (a >= b ? A("-", a, b) : null),
        ),
      ];
    if (id === "G1-C05")
      return [
        domain(
          [
            [11, 18],
            [1, 9],
          ],
          ([a, b]) => (b > a % 10 ? A("-", a, b) : null),
          "borrow",
        ),
      ];
    if (id === "G1-C06" || id === "G1-C07")
      return [0, 1].map((kind) =>
        domain(
          kind
            ? [
                [10, 99],
                [1, 9],
              ]
            : [
                [1, 9],
                [0, 9],
              ],
          ([a, b]) => {
            if (!kind) {
              a *= 10;
              b *= 10;
            }
            const plus = id === "G1-C06";
            return plus
              ? a + b <= 99 && !carry(a, b)
                ? A("+", a, b)
                : null
              : a >= b && !borrow(a, b)
                ? A("-", a, b)
                : null;
          },
          kind ? "ones" : "tens",
        ),
      );
    if (id === "G1-C08")
      return [0, 1, 2, 3].map((i) =>
        domain(
          [
            [0, 9],
            [0, 9],
            [0, 9],
          ],
          ([a, b, c]) => {
            try {
              const ast = op(
                i & 1 ? "-" : "+",
                op(i & 2 ? "-" : "+", lit(a), lit(b)),
                lit(c),
              );
              if (
                cmp(evaluate(ast), 20) > 0 ||
                cmp(evaluate(ast.args[0]), 20) > 0
              )
                return null;
              return arithmetic(id, ast);
            } catch {
              return null;
            }
          },
          `signs-${i}`,
        ),
      );
    if (id === "G2-N02" || id === "G4-N02")
      return [0, 1].map((reverse) =>
        domain(
          id === "G2-N02"
            ? [
                [0, 9],
                [0, 9],
                [0, 9],
                [0, 9],
              ]
            : [
                [0, 9999],
                [0, 9999],
                [0, 9999],
                [0, 9999],
              ],
          (v) => {
            const unit = id === "G2-N02" ? 10n : 10000n;
            const value = v.reduce(
              (s, n, i) => s + BigInt(n) * unit ** BigInt(i),
              0n,
            );
            if (!value) return null;
            const labels =
              id === "G2-N02"
                ? ["1", "10", "100", "1000"]
                : ["一", "万", "億", "兆"];
            return reverse
              ? special(
                  id,
                  "blocks",
                  v.map(String),
                  { type: "blocks", labels },
                  {
                    prompt: `${value} の${labels.join("・")}のまとまりは？`,
                    expectedExactValue: v.map(String),
                  },
                )
              : blank(
                  value,
                  v
                    .map((n, i) => `${labels[i]}が${n}こ`)
                    .reverse()
                    .join("、"),
                  v
                    .map((n, i) =>
                      op("*", lit(n), lit(String(unit ** BigInt(i)))),
                    )
                    .reduce((a, b) => op("+", a, b)),
                );
          },
          reverse ? "decompose" : "compose",
        ),
      );
    if (id === "G2-N03")
      return [
        domain([[0, 3]], ([i]) => {
          const d = [2, 3, 4, 8][i];
          return frac(1, d, `${d}つに おなじ おおきさで わけた 1つぶん`, {
            diagram: [[1, d]],
          });
        }),
      ];
    if (/^G2-C0[1-6]$/.test(id) || /^G3-C0[1-4]$/.test(id)) {
      const n = Number(id.slice(-2)),
        add =
          (n % 2 === 1 && grade === 3) ||
          (grade === 2 && [1, 2, 5].includes(n));
      const min = grade === 3 ? (n <= 2 ? 100 : 1000) : n >= 5 ? 100 : 10;
      const max =
        grade === 3 ? (n <= 2 ? 999 : 9999) : n >= 5 ? 999 : n === 4 ? 198 : 99;
      const bm = grade === 3 ? max : 99;
      const buckets =
        grade === 2 && n <= 4
          ? [n % 2 === 0 ? "carry" : "no-carry"]
          : ["carry", "no-carry"];
      return buckets.map((bucket) =>
        domain(
          [
            [min, max],
            [grade === 2 && n <= 2 ? 10 : 1, bm],
          ],
          ([a, b]) => {
            if (!add && b > a) return null;
            if (
              grade === 2 &&
              n === 4 &&
              a > 99 &&
              (b < 10 || a - b < 10 || a - b > 99)
            )
              return null;
            if (
              (grade === 2 && n === 5 && (a % 100) + b >= 100) ||
              (grade === 2 && n === 6 && a % 100 < b)
            )
              return null;
            if ((add ? carry(a, b) : borrow(a, b)) !== (bucket === "carry"))
              return null;
            return A(add ? "+" : "-", a, b);
          },
          bucket,
        ),
      );
    }
    if (id === "G2-C07")
      return ["+", "-"].map((sign) =>
        domain(
          [
            [1, 9],
            [1, 9],
          ],
          ([a, b]) =>
            sign === "-" && a < b ? null : A(sign, a * 100, b * 100),
          sign,
        ),
      );
    if (id === "G2-C08")
      return [
        domain(
          [
            [options.table || 1, options.table || 9],
            [1, 9],
          ],
          ([a, b]) => A("*", a, b),
        ),
      ];
    if (id === "G2-C09")
      return [
        domain(
          [
            [10, 19],
            [2, 5],
          ],
          ([a, b]) => A("*", a, b),
        ),
      ];
    if (id === "G2-C10" || id === "G3-C15")
      return [0, 1, 2, 3].map((i) =>
        domain(
          id === "G2-C10"
            ? [
                [0, 100],
                [0, 100],
              ]
            : [
                [1, 9],
                [1, 9],
              ],
          ([a, b]) => {
            if (id === "G2-C10") {
              if (a + b > 100) return null;
              return i < 2
                ? blank(
                    i === 0 ? a : b,
                    `${i === 0 ? "□" : a} ＋ ${i === 1 ? "□" : b} ＝ ${a + b}`,
                    op("-", lit(a + b), lit(i === 0 ? b : a)),
                  )
                : blank(
                    i === 2 ? a + b : b,
                    `${i === 2 ? "□" : a + b} − ${i === 3 ? "□" : b} ＝ ${a}`,
                    i === 2
                      ? op("+", lit(a), lit(b))
                      : op("-", lit(a + b), lit(a)),
                  );
            }
            return i < 2
              ? blank(
                  i === 0 ? a : b,
                  `${i === 0 ? "□" : a} × ${i === 1 ? "□" : b} ＝ ${a * b}`,
                  op("/", lit(a * b), lit(i === 0 ? b : a)),
                )
              : blank(
                  i === 2 ? a * b : b,
                  `${i === 2 ? "□" : a * b} ÷ ${i === 3 ? "□" : b} ＝ ${a}`,
                  i === 2
                    ? op("*", lit(a), lit(b))
                    : op("/", lit(a * b), lit(a)),
                );
          },
          `position-${i}`,
        ),
      );
    if (id === "G3-N02" || id === "G5-N06")
      return [0, 1, 2, 3, 4, 5]
        .filter((i) => id === "G5-N06" || i < 4)
        .map((i) =>
          domain(
            id === "G3-N02" ? [[1, 9999]] : [[1, 999999]],
            ([n]) => {
              const v = id === "G3-N02" ? String(n) : D(n, 3),
                divisor = i >= 3;
              if (id === "G3-N02" && divisor && n % 10 !== 0) return null;
              return A(
                divisor ? "/" : "*",
                v,
                10 ** ((i % 3) + 1),
                id === "G3-N02" ? I : E,
              );
            },
            `shift-${i}`,
          ),
        );
    if (id === "G3-N03" || id === "G4-N03")
      return (id === "G3-N03" ? [1] : [2, 3]).flatMap((scale) =>
        [0, 1].map((reverse) =>
          domain(
            [[1, scale === 1 ? 99 : 99999]],
            ([n]) =>
              reverse
                ? arithmetic(
                    id,
                    op("/", lit(D(n, scale)), lit(D(1, scale))),
                    I,
                    { prompt: `${D(n, scale)} は ${D(1, scale)} が □こ` },
                  )
                : arithmetic(id, op("*", lit(D(1, scale)), lit(n)), E, {
                    prompt: `${D(1, scale)} が ${n}こ`,
                  }),
            `${scale}-${reverse}`,
          ),
        ),
      );
    if (id === "G3-N05")
      return [0, 1].map((reverse) =>
        domain(
          [
            [2, 10],
            [1, 10],
          ],
          ([d, n]) =>
            n > d
              ? null
              : reverse
                ? {
                    ...blank(n, `${n}/${d} は 1/${d} が □こ`),
                    unitFraction: { n, d },
                    diagram: [[n, d]],
                  }
                : frac(n, d, `1/${d} が ${n}こ`, { diagram: [[n, d]] }),
          reverse ? "count" : "fraction",
        ),
      );
    if (id === "G3-N06")
      return [
        domain(
          [
            [2, 10],
            [0, 10],
            [0, 10],
          ],
          ([d, n, m]) =>
            n > d || m > d
              ? null
              : compare(rat(n, d), rat(m, d), [`${n}/${d}`, `${m}/${d}`]),
        ),
      ];
    if (/^G3-C0[5-8]$/.test(id)) {
      const n = Number(id.slice(-2)),
        low = n % 2 ? 10 : 100,
        high = n % 2 ? 99 : 999;
      return n < 7
        ? [
            domain(
              [
                [low, high],
                [0, 0],
              ],
              ([a, b]) => A("*", a, b),
              "zero",
            ),
            {
              ...domain(
                [
                  [low, high],
                  [1, 9],
                ],
                ([a, b]) => A("*", a, b),
                "nonzero",
              ),
              weight: 9,
            },
          ]
        : [
            domain(
              [
                [low, high],
                [10, 99],
              ],
              ([a, b]) => A("*", a, b),
            ),
          ];
    }
    if (REMAINDER_IDS.includes(id)) {
      const mode = options.remainder || "mixed";
      const buckets =
        mode === "mixed"
          ? ["none", "some"]
          : [mode === "some" ? "some" : "none"];
      return buckets.map((bucket) => {
        const [amin, amax, dmin, dmax] = {
          "G3-C09": [0, 89, 1, 9],
          "G4-C04": [10, 99, 1, 9],
          "G4-C05": [100, 999, 1, 9],
          "G4-C06": [10, 99, 10, 99],
          "G4-C07": [100, 999, 10, 99],
          "G5-C04": [0, 9999, 1, 99],
        }[id];
        return domain(
          [
            [amin, amax],
            [
              bucket === "some" && dmin === 1 && id !== "G5-C04" ? 2 : dmin,
              dmax,
            ],
          ],
          ([a, d]) => {
            const av = id === "G5-C04" ? D(a, 2) : String(a),
              dv = id === "G5-C04" ? D(d, 1) : String(d),
              v = calc("/", av, dv);
            const q = BigInt(v.n) / BigInt(v.d),
              has = BigInt(v.n) % BigInt(v.d) !== 0n;
            if (
              has !== (bucket === "some") ||
              (id === "G3-C09" && q > 9n) ||
              (id === "G4-C06" && a < d)
            )
              return null;
            return A(
              "/",
              av,
              dv,
              {
                type: mode === "none" ? "integer" : "quotient",
                decimalRemainder: id === "G5-C04",
              },
              mode === "none" ? { integerQuotient: true } : {},
            );
          },
          bucket,
        );
      });
    }
    if (id === "G3-C10")
      return [
        domain(
          [
            [10, 99],
            [2, 9],
          ],
          ([a, d]) =>
            Math.floor(a / 10) % d || (a % 10) % d || a / d < 10
              ? null
              : A("/", a, d),
        ),
      ];
    if (
      id === "G3-C11" ||
      id === "G3-C12" ||
      id === "G4-C08" ||
      id === "G4-C09"
    ) {
      const scale = grade === 3 ? 1 : 3,
        max = grade === 3 ? 99 : 99999,
        add = ["G3-C11", "G4-C08"].includes(id);
      return ["carry", "no-carry"].map((bucket) =>
        domain(
          [
            [0, max],
            [0, max],
          ],
          ([a, b]) => {
            if (
              (!add && a < b) ||
              (add && a % 10 ** scale === 0 && b % 10 ** scale === 0) ||
              (id === "G4-C08" && a % 100 === 0 && b % 100 === 0)
            )
              return null;
            if ((add ? carry(a, b) : borrow(a, b)) !== (bucket === "carry"))
              return null;
            return dec(D(a, scale), D(b, scale), add ? "+" : "-");
          },
          bucket,
        ),
      );
    }
    if (["G3-C13", "G3-C14", "G4-C13", "G4-C14"].includes(id))
      return sameFractions(
        grade === 3 ? 10 : 12,
        ["G3-C13", "G4-C13"].includes(id),
      );
    if (id === "G4-N05")
      return [
        domain(
          [
            [2, 6],
            [2, 3],
            [1, 6],
          ],
          ([d, k, n]) =>
            k * d > 12 || n > d
              ? null
              : arithmetic(id, op("*", lit(n), lit(k)), I, {
                  prompt: `${n}/${d} ＝ □/${k * d}`,
                  diagram: [
                    [n, d],
                    [n * k, d * k],
                  ],
                }),
        ),
      ];
    if (id === "G4-N06")
      return [0, 1].map((mixed) =>
        domain(
          [
            [2, 12],
            [3, 60],
          ],
          ([d, n]) =>
            n <= d || n > 5 * d
              ? null
              : frac(
                  n,
                  d,
                  mixed
                    ? `${n}/${d} を帯分数に（分母は${d}）`
                    : `${Math.floor(n / d)}と${n % d}/${d} を仮分数に（分母は${d}）`,
                  {
                    form: mixed ? "mixed" : "fraction",
                    denominator: String(d),
                  },
                ),
          mixed ? "to-mixed" : "to-improper",
        ),
      );
    if (id === "G4-C01")
      return [1, 2, 3, 4].map((p) =>
        domain(
          [[0, 9999999]],
          ([n]) => special(id, "round", [String(n)], I, { places: -p }),
          `place-${p}`,
        ),
      );
    if (id === "G4-C02" || id === "G4-C03")
      return ["+", "-", "*", "/"]
        .filter((sign) =>
          id === "G4-C02"
            ? ["+", "-"].includes(sign)
            : ["*", "/"].includes(sign),
        )
        .map((sign) =>
          domain(
            [
              [10, id === "G4-C02" ? 9999 : 999],
              [10, id === "G4-C02" ? 9999 : 999],
              [1, 2],
            ],
            ([a, b, p]) => {
              const pa = id === "G4-C02" ? p : String(a).length - 1,
                pb = id === "G4-C02" ? p : String(b).length - 1;
              const aa = roundExact(a, -pa),
                bb = roundExact(b, -pb);
              if (
                (sign === "-" && cmp(aa, bb) < 0) ||
                (sign === "/" && (bb.n === "0" || calc("/", aa, bb).d !== "1"))
              )
                return null;
              const q = A(sign, aa, bb);
              q.prompt = `${a} ${{ "+": "＋", "-": "−", "*": "×", "/": "÷" }[sign]} ${b}：それぞれ${id === "G4-C02" ? (p === 1 ? "十" : "百") + "の位まで" : "上から1桁に"}四捨五入してから計算`;
              q.roundOperands = [
                { original: String(a), places: -pa },
                { original: String(b), places: -pb },
              ];
              return q;
            },
            sign,
          ),
        );
    if (id === "G4-C10" || id === "G5-C01" || id === "G5-C02")
      return [
        domain(
          id === "G4-C10"
            ? [
                [1, 9999],
                [1, 99],
              ]
            : id === "G5-C01"
              ? [
                  [1, 999],
                  [1, 999],
                ]
              : [
                  [1, 9999],
                  [1, 9999],
                ],
          ([a, b]) => {
            if (
              (id === "G5-C01" && b % 100 === 0) ||
              (id === "G5-C02" && (a % 100 === 0 || b % 100 === 0))
            )
              return null;
            return dec(
              id === "G5-C01" ? a : D(a, 2),
              id === "G4-C10" ? b : D(b, 2),
              "*",
            );
          },
        ),
      ];
    if (["G4-C11", "G4-C12", "G5-C03", "G5-C05"].includes(id))
      return [
        domain(
          id === "G4-C11"
            ? [
                [1, 9999],
                [1, 9],
              ]
            : id === "G4-C12"
              ? [
                  [1, 999],
                  [2, 99],
                ]
              : id === "G5-C03"
                ? [
                    [1, 99999],
                    [1, 9999],
                  ]
                : [
                    [100, 9999],
                    [1, 99],
                    [1, 2],
                  ],
          ([a, d, p]) => {
            const av = id === "G4-C12" ? String(a) : D(a, 2),
              dv =
                id === "G5-C03"
                  ? D(d, 2)
                  : id === "G5-C05"
                    ? D(d, 1)
                    : String(d);
            if (id === "G5-C03" && d % 100 === 0) return null;
            const v = calc("/", av, dv),
              places = decimalPlaces(v);
            if (id === "G5-C05") {
              if (places <= p) return null;
              return A("/", av, dv, E, { roundPlaces: p });
            }
            return places > 3 || (id === "G4-C12" && v.d === "1")
              ? null
              : A("/", av, dv, E);
          },
        ),
      ];
    if (id === "G4-C15")
      return exprDomains("integer").map((d) => ({
        ...d,
        make: (v) => {
          v[3] = 0;
          const q = d.make(v);
          if (q) {
            const clear = (ast) => {
              if (ast.op) {
                ast.group = false;
                ast.args.forEach(clear);
              }
            };
            clear(q.expressionAST);
            q.prompt = expression(q.expressionAST);
          }
          return q;
        },
      }));
    if (id === "G4-C16")
      return [
        domain(
          [
            [0, 100],
            [0, 100],
            [1, 99],
          ],
          ([a, b, c]) =>
            a < b || (a - b) * c > 9999
              ? null
              : arithmetic(id, op("*", op("-", lit(a), lit(b), true), lit(c))),
        ),
      ];
    if (id === "G4-C17")
      return [0, 1, 2].map((i) =>
        domain(
          [
            [1, 20],
            [1, 20],
            [1, 20],
          ],
          ([a, b, c]) => {
            if (i === 0)
              return {
                ...blank(b, `${a} × ${b} ＝ □ × ${a}`),
                law: { kind: "exchange", a, b, c },
              };
            if (i === 1 && b * c <= 100)
              return {
                ...blank(
                  c,
                  `${a} × ${b * c} ＝（${a} × ${b}）× □`,
                  op("/", lit(b * c), lit(b)),
                ),
                law: { kind: "associate", a, b, c },
              };
            if (i === 2 && b + c <= 100)
              return {
                ...blank(c, `${a} ×（${b} ＋ ${c}）＝ ${a} × ${b} ＋ ${a} × □`),
                law: { kind: "distribute", a, b, c },
              };
            return null;
          },
          ["exchange", "associate", "distribute"][i],
        ),
      );
    if (id === "G5-N01")
      return [
        domain([[0, 9999]], ([n]) =>
          special(id, "parity", [String(n)], { type: "parity" }),
        ),
      ];
    if (id === "G5-N02")
      return [
        domain([[1, 60]], ([n]) =>
          special(id, "divisors", [String(n)], { type: "set" }),
        ),
      ];
    if (id === "G5-N03")
      return [
        domain(
          [
            [2, 20],
            [1, 10],
          ],
          ([n, k]) =>
            arithmetic(id, op("*", lit(n), lit(k)), I, {
              prompt: `${n} の正の倍数の ${k}番目`,
            }),
        ),
      ];
    if (id === "G5-N04" || id === "G5-N05")
      return [
        domain(
          [
            [1, id === "G5-N04" ? 100 : 30],
            [1, id === "G5-N04" ? 100 : 30],
          ],
          (v) => special(id, id === "G5-N04" ? "gcd" : "lcm", v.map(String), I),
        ),
      ];
    if (id === "G5-N07")
      return [
        domain(
          [
            [1, 99],
            [2, 99],
          ],
          ([n, d]) =>
            gcd(n, d) === 1n ? null : frac(n, d, `${n}/${d} を約分しよう`),
        ),
      ];
    if (id === "G5-N08" || id === "G5-N09")
      return [
        domain(
          [
            [2, 12],
            [2, 12],
            [0, 60],
            [0, 60],
          ],
          ([d, e, n, m]) => {
            if (n > 5 * d || m > 5 * e || d === e) return null;
            const v = [rat(n, d), rat(m, e)];
            return id === "G5-N09"
              ? compare(...v, [`${n}/${d}`, `${m}/${e}`])
              : special(
                  id,
                  "common",
                  [
                    { n: String(n), d: String(d) },
                    { n: String(m), d: String(e) },
                  ],
                  { type: "common" },
                  { labels: [`${n}/${d}`, `${m}/${e}`] },
                );
          },
        ),
      ];
    if (id === "G5-N10")
      return [
        domain(
          [[0, 20]],
          ([n]) =>
            frac(n, 1, `${n} を分母1の分数に`, {
              form: "fraction",
              denominator: "1",
            }),
          "integer",
        ),
        domain(
          [[1, 20999]],
          ([n]) =>
            n % 1000 === 0
              ? null
              : frac(n, 1000, `${D(n, 3)} を約分した分数に`),
          "decimal",
        ),
      ];
    if (id === "G5-N11")
      return [
        domain(
          [
            [0, 20000],
            [0, 10],
          ],
          ([n, i]) => {
            const d = [2, 4, 5, 8, 10, 20, 25, 40, 50, 100, 1000][i];
            return n > 20 * d
              ? null
              : arithmetic(id, F(n, d), E, { prompt: `${n}/${d} を小数に` });
          },
        ),
      ];
    if (id === "G5-N12")
      return [
        domain(
          [
            [0, 99],
            [1, 99],
          ],
          ([a, d]) => A("/", a, d, FS),
        ),
      ];
    if (id === "G5-N13" || id === "G6-N02")
      return (
        grade === 5 ? ["decimal"] : ["integer", "decimal", "fraction"]
      ).map((kind) =>
        domain(
          [
            [0, kind === "integer" ? 20 : kind === "fraction" ? 240 : 200],
            [0, kind === "integer" ? 20 : kind === "fraction" ? 240 : 200],
            [0, kind === "integer" ? 20 : kind === "fraction" ? 240 : 200],
            [2, kind === "fraction" ? 12 : 2],
          ],
          ([a, b, x, d]) => {
            if (kind === "fraction" && [a, b, x].some((n) => n > 20 * d))
              return null;
            if (
              grade === 6 &&
              kind === "decimal" &&
              [a, b, x].every((n) => n % 10 === 0)
            )
              return null;
            const val = (n) =>
              kind === "fraction"
                ? F(n, d)
                : kind === "integer"
                  ? lit(n)
                  : lit(D(n, 1));
            const ast = op("+", op("*", val(x), val(a)), val(b));
            return arithmetic(id, ast, grade === 5 ? E : FS, {
              prompt:
                grade === 5
                  ? `□ ＝ ${expression(val(a))} × △ ＋ ${expression(val(b))}、△ ＝ ${expression(val(x))}`
                  : `x × ${expression(val(a))} ＋ ${expression(val(b))}、x ＝ ${expression(val(x))}（答えは整数か分数で）`,
            });
          },
          kind,
        ),
      );
    if (["G5-C06", "G5-C07", "G5-C08"].includes(id))
      return (id === "G5-C08" ? ["+", "-"] : [id === "G5-C06" ? "+" : "-"]).map(
        (sign) =>
          domain(
            [
              [2, 12],
              [2, 12],
              [0, 71],
              [0, 71],
            ],
            ([d, e, n, m]) => {
              if (
                d === e ||
                (id !== "G5-C08" && (n > d || m > e)) ||
                (id === "G5-C06" && (!n || !m || n === d || m === e)) ||
                (id === "G5-C08" &&
                  (n >= 6 * d || m >= 6 * e || (n <= d && m <= e))) ||
                (sign === "-" && n * e < m * d)
              )
                return null;
              const mixed = (n, d) =>
                lit(
                  rat(n, d),
                  n > d ? `${Math.floor(n / d)}と${n % d}/${d}` : `${n}/${d}`,
                );
              return arithmetic(
                id,
                op(
                  sign,
                  id === "G5-C08" ? mixed(n, d) : F(n, d),
                  id === "G5-C08" ? mixed(m, e) : F(m, e),
                ),
                FS,
              );
            },
            sign,
          ),
      );
    if (id === "G5-C09") return exprDomains("decimal");
    if (id === "G6-N01")
      return [
        domain(
          [
            [1, 12],
            [1, 12],
          ],
          ([n, d]) =>
            special(id, "reciprocal", [rat(n, d)], FS, {
              labels: [
                n > d ? `${Math.floor(n / d)}と${n % d}/${d}` : `${n}/${d}`,
              ],
            }),
        ),
      ];
    if (/^G6-C0[1-6]$/.test(id)) {
      const k = Number(id.slice(-2));
      return [
        domain(
          k < 3
            ? [
                [2, 20],
                [0, 100],
                [1, 12],
              ]
            : k < 5
              ? [
                  [2, 20],
                  [2, 20],
                  [0, 20],
                  [0, 20],
                ]
              : [
                  [2, 12],
                  [2, 12],
                  [0, 47],
                  [0, 47],
                ],
          (v) => {
            let a, b;
            if (k < 3) {
              const [d, n, m] = v;
              if (n > 5 * d) return null;
              a = F(n, d);
              b = lit(m);
            } else {
              const [d, e, n, m] = v;
              if (k >= 5 && (n >= 4 * d || m >= 4 * e || (n <= d && m <= e)))
                return null;
              if (k % 2 === 0 && !m) return null;
              const f = (n, d) =>
                k >= 5 && n > d
                  ? lit(rat(n, d), `${Math.floor(n / d)}と${n % d}/${d}`)
                  : F(n, d);
              a = f(n, d);
              b = f(m, e);
            }
            return arithmetic(id, op(k % 2 ? "*" : "/", a, b), FS);
          },
        ),
      ];
    }
    if (id === "G6-C07") return exprDomains("fraction");
    if (id === "G6-C08")
      return ["+", "-", "*", "/"].map((sign) =>
        domain(
          [
            [0, 10],
            [1, 99],
            [2, 12],
            [1, 11],
          ],
          ([i, decimalN, d, n]) => {
            if (n >= d) return null;
            const ast = op(
              sign,
              op(
                "+",
                lit(i),
                lit(D(decimalN, 2)),
                sign === "*" || sign === "/",
              ),
              F(n, d),
            );
            try {
              return arithmetic(id, ast, FS, {
                instruction: "答えは整数か分数で",
              });
            } catch {
              return null;
            }
          },
          sign,
        ),
      );
    throw Error(`Generator missing: ${id}`);
  }
  function decode(d, rank) {
    return d.dims.map(([lo, hi]) => {
      const n = BigInt(hi - lo + 1),
        v = Number(rank % n) + lo;
      rank /= n;
      return v;
    });
  }
  function atRank(d, rank) {
    try {
      const q = d.make(decode(d, rank));
      return q ? complete(q, d.bucket) : null;
    } catch {
      return null;
    }
  }
  function randomRank(d, r) {
    let x = 0n;
    for (const [lo, hi] of d.dims)
      x = x * BigInt(hi - lo + 1) + BigInt(int(r, 0, hi - lo));
    return x % d.size;
  }
  function createGenerator(seed = 1) {
    return { rngState: seed >>> 0 || 1, ids: {} };
  }
  function generate(id, options = {}, state = createGenerator()) {
    if (!BY_ID[id]) throw Error("Unknown challenge");
    const ds = domains(id, options),
      r = rng(state.rngState);
    const key = JSON.stringify([id, options]);
    const s = (state.ids[key] ||= { round: [], buckets: {}, last: null });
    if (!s.round.length)
      s.round = shuffle(
        ds.flatMap((d, i) => Array(d.weight || 1).fill(i)),
        r,
      );
    const bi = s.round.shift(),
      d = ds[bi];
    const b = (s.buckets[bi] ||= { used: [], cursor: "0", cycle: 0 });
    const used = new Set(b.used);
    let q = null,
      rank = null;
    for (let i = 0; i < 128; i++) {
      const x = randomRank(d, r),
        candidate = atRank(d, x);
      if (
        candidate &&
        !used.has(candidate.canonicalKey) &&
        candidate.canonicalKey !== s.last
      ) {
        q = candidate;
        rank = x;
        break;
      }
    }
    if (!q) {
      let scanned = 0n,
        x = BigInt(b.cursor),
        repeat = null;
      while (scanned < d.size) {
        const candidate = atRank(d, x);
        if (candidate && !used.has(candidate.canonicalKey)) {
          if (candidate.canonicalKey !== s.last) {
            q = candidate;
            rank = x;
            break;
          }
          repeat = { candidate, x };
        }
        x = (x + 1n) % d.size;
        scanned++;
      }
      if (!q && repeat) {
        q = repeat.candidate;
        rank = repeat.x;
      }
      if (!q) {
        // Exhaustion is established by the complete scan above.
        b.used = [];
        b.cycle++;
        used.clear();
        let first = null;
        for (let x = 0n; x < d.size; x++) {
          const candidate = atRank(d, x);
          if (candidate) {
            first ||= { candidate, x };
            if (candidate.canonicalKey !== s.last) {
              q = candidate;
              rank = x;
              break;
            }
          }
        }
        if (!q && first) {
          q = first.candidate;
          rank = first.x;
        }
        if (!q) throw Error("この条件では問題を作れません");
      }
    }
    b.used.push(q.canonicalKey);
    b.cursor = String((rank + 1n) % d.size);
    s.last = q.canonicalKey;
    state.rngState = r.state;
    q.cycleId = b.cycle;
    return q;
  }
  function buildHint(q) {
    const id = q.challengeId,
      ast = q.expressionAST;
    const early = {
      "G1-N02": "10の まとまりを かぞえてから、ばらの1を あわせよう。",
      "G1-N03": "となりの かずは、1だけ ちがうよ。じゅんばんに かぞえよう。",
      "G1-C01": "わかっている かずに、あと いくつで10になるかな。",
      "G1-C02": "はじめの かずから、たす かずのぶんだけ かぞえよう。",
      "G1-C03": "はじめの かずを10にするには、あと いくつかな。",
      "G1-C04": "はじめの かずから、ひく かずのぶんだけ とってみよう。",
      "G1-C05": "はじめの かずを10と のこりに わけて、10から ひいてみよう。",
      "G1-C06": "10の まとまりと、ばらの1に わけて、たそう。",
      "G1-C07": "10の まとまりと、ばらの1に わけて、ひこう。",
      "G1-C08": "まず、ひだりの 2つの かずを けいさんしよう。",
      "G1-C09":
        "ぜんぶの かずから、わかっている かずを とると、のこりは いくつかな。",
      "G2-N02":
        "1000・100・10・1の まとまりで かんがえよう。ない くらいは0だよ。",
      "G2-C07": "100の まとまりが いくつあるかを けいさんしよう。",
      "G2-C09": "かけられる かずを10と のこりに わけよう。",
      "G3-N02": "10倍では位が1つ左へ、10分の1では1つ右へ移るよ。",
      "G4-N02": "右から4けたずつ、一・万・億・兆のまとまりに分けよう。",
      "G4-N05": "分母が何倍になったか見よう。分子も同じ数で倍にするよ。",
      "G5-N03": "その数を1倍、2倍、3倍…とならべて、指定された順を見よう。",
      "G5-N06":
        "小数点を基準に位を見よう。10倍と10分の1では、動く向きが逆だよ。",
      "G5-N11": "分子を分母でわると、小数で表せるよ。",
      "G5-N12": "わられる数を分子、わる数を分母にして、分数で表そう。",
      "G5-N13": "△のところに、指定された数を入れてから計算しよう。",
      "G6-N02": "xのところに、指定された数を入れてから計算しよう。",
    };
    if (early[id]) return early[id];
    if (id === "G2-C08")
      return `${format(evaluate(ast.args[0]))}の だんを おもいだそう。1つぶんが、いくつぶん あるかな。`;
    if (id === "G2-C10")
      return ast.op === "+"
        ? "ひくまえの かずを もとめるよ。のこった かずと、ひいた かずを たそう。"
        : "ぜんぶの かずから、わかっている かずを ひこう。";
    if (id === "G3-C15")
      return ast.op === "*"
        ? "わられる数を求めるよ。わる数と商をかけよう。"
        : "かけ算とわり算のつながりを使い、分かっている数でわろう。";
    if (["G3-N03", "G4-N03"].includes(id)) {
      const unit = ast?.op
        ? format(evaluate(ast.args[ast.op === "/" ? 1 : 0]), "decimal")
        : id === "G3-N03"
          ? "0.1"
          : "0.001";
      return `${unit}を1つ分として、何こ分かを数えよう。`;
    }
    if (id === "G5-N10")
      return q.original.d === "1"
        ? "整数は、分母を1にした分数で表せるよ。"
        : "小数点の右のけた数を見よう。1けたなら分母10、2けたなら100、3けたなら1000にするよ。";
    if (id === "G4-C17")
      return "かける順を入れかえる、まとめる、分けるとき、同じ数がどこにあるか見よう。";
    if (q.task === "compare") {
      if (["G1-N01", "G2-N01", "G3-N01", "G4-N01"].includes(id))
        return "まず、けたの かずを くらべよう。同じなら、ひだりの くらいから くらべるよ。";
      if (["G3-N04", "G4-N04"].includes(id))
        return "小数点をそろえて、大きい位からくらべよう。";
      return id === "G3-N06"
        ? "分母が同じだから、分子の数をくらべよう。"
        : "分母をそろえて、同じ大きさの1つ分が何こあるかをくらべよう。";
    }
    if (q.task === "parity") return "2でわって あまりがあるかを考えよう。";
    if (q.task === "gcd")
      return "両方の数の約数を書き、共通する数の中で一番大きいものを探そう。";
    if (q.task === "divisors")
      return `${q.values[0]} を1から順にわって、わり切れる数を見つけよう。`;
    if (q.task === "lcm" || q.task === "common")
      return "それぞれの倍数を小さい順に書いて、はじめて同じになる数を見つけよう。";
    if (q.task === "blocks")
      return "位ごとに分けよう。空いている位にも0を書くよ。";
    if (q.task === "round")
      return "求める位の1つ下を見よう。5以上なら切り上げるよ。";
    if (q.task === "reciprocal")
      return "かけて1になる数を考えよう。帯分数は先に仮分数にするよ。";
    if (q.task === "fraction")
      return BY_ID[id].grade <= 2
        ? "おなじ おおきさに わけた ひとつぶんを 見てみよう。"
        : q.answerSpec.form === "mixed"
          ? "分子を分母でわり、整数の部分と残りに分けよう。"
          : q.answerSpec.reduced
            ? "分子と分母を同じ数でわり切れるかな。"
            : "同じ大きさの1つ分が、いくつあるか数えよう。";
    if (q.unknown !== undefined)
      return "□の場所を見よう。たし算とひき算、かけ算とわり算のつながりを使おう。";
    if (q.roundOperands)
      return "はじめに、それぞれの数を指定された位まで四捨五入しよう。";
    if (!ast.op) return "1つ分の大きさと、いくつ分かをたしかめよう。";
    if (ast.args.some((a) => a.op))
      return "かっこの中が先。そのあと、かけ算・わり算から計算しよう。";
    if (q.answerSpec.type === "fraction")
      return ast.op === "/"
        ? "わる数を逆数にして、かけ算にしよう。"
        : ast.op === "*"
          ? "分子どうし、分母どうしをかけよう。途中で約分できるかな。"
          : "分母をそろえて、何こ分かを計算しよう。";
    if (ast.op === "+")
      return q.written
        ? ast.args.some((a) => decimalPlaces(evaluate(a)) > 0)
          ? "位と小数点をそろえて、一番右の位からたそう。"
          : "おなじ くらいを そろえて、いちの くらいから たそう。"
        : "10のまとまりを作れるかな。";
    if (ast.op === "-")
      return q.written
        ? "同じ位をそろえて、一番右の位からひこう。足りない位は左から借りよう。"
        : "10と のこりに分けて考えよう。";
    if (ast.op === "*")
      return "かける数を位ごとに分けよう。まず一の位からかけるよ。";
    return decimalPlaces(evaluate(ast.args[1])) > 0
      ? "わる数が整数になるように、両方の小数点を同じだけ動かそう。"
      : "わる数が何こ入るか、九九を使って考えよう。";
  }
  const placeName = (column, scale = 0) =>
    column < scale
      ? `小数第${scale - column}位`
      : `${["一", "十", "百", "千", "万"][column - scale] || 10 ** (column - scale)}の位`;
  const step = (text, extra = {}) => ({ kind: "text", text, ...extra });
  function writtenTrace(q) {
    const ast = q.expressionAST;
    if (!ast?.op || ast.args.some((a) => a.op)) return [];
    const av = evaluate(ast.args[0]),
      bv = evaluate(ast.args[1]);
    const sa = decimalPlaces(av),
      sb = decimalPlaces(bv);
    if (!Number.isFinite(sa + sb)) return [];
    const coeff = (v, s) => (BigInt(v.n) * 10n ** BigInt(s)) / BigInt(v.d);
    const trace = [];
    const row = (digits, text, extra = {}) =>
      trace.push({ kind: "digits", digits: String(digits), text, ...extra });
    if (ast.op === "+" || ast.op === "-") {
      const scale = Math.max(sa, sb),
        a = coeff(av, scale),
        b = coeff(bv, scale),
        size = Math.max(String(a).length, String(b).length, scale + 1);
      const aa = String(a).padStart(size, "0").split("").map(Number),
        bb = String(b).padStart(size, "0").split("").map(Number);
      row(D(a, scale), scale ? "位と小数点をそろえる" : "同じ位をそろえる");
      row(D(b, scale), "下の数", {
        sign: ast.op === "+" ? "＋" : "−",
        underline: true,
      });
      let carryIn = 0;
      const out = Array(size).fill(0),
        carries = Array(size + 1).fill("");
      for (let i = size - 1; i >= 0; i--) {
        const column = size - 1 - i;
        if (ast.op === "+") {
          const sum = aa[i] + bb[i] + carryIn;
          out[i] = sum % 10;
          trace.push(
            step(
              `${placeName(column, scale)}：${aa[i]}＋${bb[i]}${carryIn ? "＋" + carryIn : ""}＝${sum}。${out[i]}を書く。${sum >= 10 ? "1を左の位へくり上げる。" : ""}`,
              {
                column,
                value: String(sum),
                check: {
                  op: "+",
                  a: String(aa[i] + bb[i]),
                  b: String(carryIn),
                  result: String(sum),
                },
              },
            ),
          );
          carryIn = Math.floor(sum / 10);
          if (carryIn) carries[i] = String(carryIn);
        } else {
          if (aa[i] < bb[i]) {
            let j = i - 1;
            while (j >= 0 && aa[j] === 0) j--;
            if (j < 0) throw Error("Borrow underflow");
            aa[j]--;
            for (let k = j + 1; k < i; k++) aa[k] = 9;
            aa[i] += 10;
            const borrowDigits = aa.map(String);
            if (scale) borrowDigits.splice(size - scale, 0, ".");
            trace.push({
              kind: "borrow",
              digits: borrowDigits,
              column,
              text: `${placeName(size - j - 1, scale)}から1を借り、${placeName(column, scale)}を${aa[i]}にする。${i - j > 1 ? "間にある0は9にする。" : ""}`,
              annotation: "borrow",
            });
          }
          out[i] = aa[i] - bb[i];
          trace.push(
            step(`${aa[i]}−${bb[i]}＝${out[i]}`, {
              column,
              value: String(out[i]),
              check: {
                op: "-",
                a: String(aa[i]),
                b: String(bb[i]),
                result: String(out[i]),
              },
            }),
          );
        }
      }
      if (carryIn) out.unshift(carryIn);
      if (carries.some(Boolean)) {
        if (scale) carries.splice(carries.length - scale, 0, ".");
        trace.unshift({
          kind: "borrow",
          digits: carries,
          text: "繰り上がった数を、左の位に足す。",
          annotation: "carry",
        });
      }
      row(D(BigInt(out.join("")), scale), "こたえ", { line: true });
    } else if (ast.op === "*") {
      const a = coeff(av, sa),
        b = coeff(bv, sb);
      row(
        String(a),
        sa + sb ? "小数点をいったん外して計算" : "一の位から、位ごとにかける",
      );
      row(String(b), "かける数", { sign: "×", underline: true });
      const digits = String(b).split("").reverse();
      digits.forEach((digit, shift) => {
        if (shift)
          trace.push(
            step(
              `${placeName(shift)}の${digit}は${BigInt(digit) * 10n ** BigInt(shift)}。かけた答えは${shift}けた左にずらして書く。`,
            ),
          );
        let c = 0;
        String(a)
          .split("")
          .reverse()
          .forEach((x, column) => {
            const p = Number(x) * Number(digit) + c;
            trace.push(
              step(
                `${x}×${digit}${c ? "＋" + c : ""}＝${p}。${p % 10}を書く。${p >= 10 ? Math.floor(p / 10) + "を左の位へくり上げる。" : ""}`,
                {
                  column: column + shift,
                  value: String(p),
                  check: {
                    op: "+",
                    a: String(Number(x) * Number(digit)),
                    b: String(c),
                    result: String(p),
                  },
                },
              ),
            );
            c = Math.floor(p / 10);
          });
        row(
          String(a * BigInt(digit) * 10n ** BigInt(shift)),
          `${10 ** shift}の位の部分積${digit === "0" ? "（この位は0）" : ""}`,
          {
            shift,
            displayDigits: String(a * BigInt(digit)),
            trailing: shift,
            check: {
              op: "*",
              a: String(a),
              b: String(BigInt(digit) * 10n ** BigInt(shift)),
              result: String(a * BigInt(digit) * 10n ** BigInt(shift)),
            },
          },
        );
      });
      row(
        String(a * b),
        `${digits.map((digit, shift) => String(a * BigInt(digit) * 10n ** BigInt(shift))).join("＋")}＝${a * b}。位をそろえてたす。`,
        { line: true, sumRow: digits.length > 1 },
      );
      if (sa + sb)
        trace.push(
          step(
            `小数は合わせて${sa + sb}けた。右から${sa + sb}けた目に小数点を戻す。`,
          ),
        );
      if (sa + sb)
        row(
          D(a * b, sa + sb),
          `小数点を${sa + sb}けた戻す。末尾の0は取っても同じ大きさ。`,
          { line: true, decimalResult: true },
        );
    } else {
      const movedA = calc("*", av, rat(10n ** BigInt(sb))),
        movedD = coeff(bv, sb);
      if (sb)
        trace.push(
          step(
            `両方を${10n ** BigInt(sb)}倍：${format(av, "decimal")}÷${format(bv, "decimal")} ＝ ${format(movedA, "decimal")}÷${movedD}`,
          ),
        );
      const quotient = q.answerSpec.type === "quotient" || q.integerQuotient;
      const quotientPlaces = quotient
        ? 0
        : q.roundPlaces !== undefined
          ? q.roundPlaces + 1
          : decimalPlaces(evaluate(ast));
      const digits = format(movedA, "decimal").split("."),
        tail = (digits[1] || "")
          .padEnd(quotientPlaces, "0")
          .slice(0, quotientPlaces);
      const untouched = quotient ? digits[1] || "" : "";
      const dividend = `${digits[0]}${tail || untouched ? "." + (tail || untouched) : ""}`;
      let remainder = 0n,
        started = false,
        answer = "";
      const source = digits[0] + tail;
      row(dividend, "わり算の筆算", { divisor: String(movedD), dividend });
      for (let i = 0; i < source.length; i++) {
        const partial = remainder * 10n + BigInt(source[i]),
          qd = partial / movedD,
          prod = qd * movedD,
          rem = partial - prod;
        if (movedD >= 10n && partial >= movedD) {
          const place = 10n ** BigInt(String(movedD).length - 1),
            leading = (movedD / place) * place;
          let trial = partial / leading;
          if (trial > 9n) trial = 9n;
          while (trial > qd) {
            trace.push(
              step(
                `${movedD}×${trial}＝${movedD * trial} は ${partial} より大きい。商を ${trial - 1n} に直す。`,
                {
                  trialAdjustment: true,
                  check: {
                    op: "*",
                    a: String(movedD),
                    b: String(trial),
                    result: String(movedD * trial),
                  },
                },
              ),
            );
            trial--;
          }
        }
        if (qd || started || i >= digits[0].length - 1) {
          const firstStep = !started;
          started = true;
          if (i === digits[0].length) answer += ".";
          answer += String(qd);
          const trailing = source.length - i - 1 + untouched.length;
          row(String(partial), "下ろした数", {
            column: i,
            trailing,
            stage: "partial",
            firstStep,
          });
          row(String(prod), `${qd}を立てる → ${movedD}×${qd}＝${prod}`, {
            sign: "−",
            column: i,
            trailing,
            underline: true,
            stage: "product",
            check: {
              op: "*",
              a: String(movedD),
              b: String(qd),
              result: String(prod),
            },
          });
          row(
            String(rem),
            `${partial}−${prod}＝${rem}。${i < source.length - 1 ? "つぎの数字を下ろす。" : "ここまで。"}`,
            {
              column: i,
              trailing,
              stage: "remainder",
              finalStep: i === source.length - 1,
              check: {
                op: "-",
                a: String(partial),
                b: String(prod),
                result: String(rem),
              },
            },
          );
        }
        remainder = rem;
      }
      if (untouched)
        row(
          `${remainder}.${untouched}`,
          "商は整数まで。小数部分を合わせたあまり。",
          { remainder: true },
        );
      trace.unshift({
        kind: "digits",
        digits: answer || "0",
        text: "商。途中の0も書く。",
        quotient: true,
        trailing: untouched.length,
      });
      trace.unshift(
        step(
          `商：${answer || "0"}${q.roundPlaces !== undefined ? "（このあと四捨五入）" : ""}`,
        ),
      );
      if (q.answerSpec.type === "quotient")
        trace.push(
          step(
            `${sa || sb ? "余りの小数点は元の位へ。" : "たしかめ："}${q.expectedExactValue.quotient}×${format(bv, "decimal")}＋${format(q.expectedExactValue.remainder, "decimal")}＝${format(av, "decimal")}`,
          ),
        );
    }
    return trace;
  }
  function buildSolution(q) {
    const t = [];
    if (q.task === "arithmetic") {
      const id = q.challengeId,
        ast = q.expressionAST;
      let elementaryExplanation = false;
      if (
        ast.op &&
        ["G1-C02", "G1-C03", "G1-C04", "G1-C05", "G1-C09", "G2-C08"].includes(
          id,
        )
      ) {
        const a = Number(evaluate(ast.args[0]).n),
          b = Number(evaluate(ast.args[1]).n);
        t.push({
          kind: "counters",
          operation: ast.op,
          a,
          b,
          splitTen: id === "G1-C05",
          text:
            ast.op === "*"
              ? `${a}が${b}こぶん。1つの まとまりを じゅんに たそう。`
              : ast.op === "+"
                ? `${a}こと${b}こを あわせよう。`
                : id === "G1-C05"
                  ? `${a}を10と${a - 10}に わけよう。10から${b}こ とるよ。`
                  : `${a}こから${b}こ とろう。`,
        });
        if (ast.op === "*")
          t.push(step(Array(b).fill(a).join("＋") + `＝${a * b}`));
      }
      if (id === "G1-N02" || id === "G2-N02") {
        const v = BigInt(q.expectedExactValue.n);
        const units = id === "G1-N02" ? [10n, 1n] : [1000n, 100n, 10n, 1n];
        t.push(
          step(
            units.map((u) => `${u}が${(v / u) % 10n}こ`).join("、") +
              `。あわせて${v}。`,
          ),
        );
        elementaryExplanation = true;
      }
      if ((id === "G3-N03" || id === "G4-N03") && ast.op) {
        const unit = evaluate(ast.args[ast.op === "/" ? 1 : 0]);
        const count =
          ast.op === "/" ? q.expectedExactValue : evaluate(ast.args[1]);
        const total =
          ast.op === "/" ? evaluate(ast.args[0]) : q.expectedExactValue;
        t.push(
          step(
            `1は${format(unit, "decimal")}が${unit.d}こ。${format(total, "decimal")}は${format(unit, "decimal")}が${format(count)}こ分。`,
          ),
        );
        elementaryExplanation = true;
      }
      if (id === "G3-C09" && q.answerSpec.type === "quotient") {
        const a = evaluate(ast.args[0]),
          b = evaluate(ast.args[1]);
        const v = q.expectedExactValue,
          product = calc("*", b, v.quotient);
        t.push(
          step(
            `${format(b)}×${v.quotient}＝${format(product)}。${format(a)}−${format(product)}＝${format(v.remainder)}。あまり${format(v.remainder)}は${format(b)}より小さい。`,
          ),
        );
        elementaryExplanation = true;
      }
      if (["G2-C07", "G2-C09", "G3-C10"].includes(id)) {
        const a = Number(evaluate(ast.args[0]).n),
          b = Number(evaluate(ast.args[1]).n);
        if (id === "G2-C07")
          t.push(
            step(
              `100のまとまりで見ると、${a / 100}${ast.op === "+" ? "＋" : "−"}${b / 100}＝${Number(q.expectedExactValue.n) / 100}。100が${Number(q.expectedExactValue.n) / 100}こ。`,
            ),
          );
        if (id === "G2-C09")
          t.push(
            step(
              `${a}を10と${a - 10}に分ける。10×${b}＝${10 * b}、${a - 10}×${b}＝${(a - 10) * b}。${10 * b}＋${(a - 10) * b}＝${a * b}。`,
            ),
          );
        if (id === "G3-C10") {
          const tens = a - (a % 10);
          t.push(
            step(
              `${a}を${tens}と${a % 10}に分ける。${tens}÷${b}＝${tens / b}、${a % 10}÷${b}＝${(a % 10) / b}。${tens / b}＋${(a % 10) / b}＝${a / b}。`,
            ),
          );
        }
        elementaryExplanation = true;
      }
      if (id === "G5-N12") {
        const a = evaluate(ast.args[0]).n,
          b = evaluate(ast.args[1]).n,
          g = gcd(a, b);
        t.push(step(`${a}÷${b}は、${a}を${b}等分した大きさなので${a}/${b}。`));
        if (g > 1n)
          t.push(
            step(`分子と分母を${g}でわる：${BigInt(a) / g}/${BigInt(b) / g}。`),
          );
        elementaryExplanation = true;
      }
      if (q.sequence)
        t.push(
          step(`1ずつ ふえるよ。${q.sequence.join(" → ")} のじゅんばん。`),
        );
      if (id === "G4-N05" && q.diagram) {
        const [[n, d], [nextN, nextD]] = q.diagram,
          factor = nextD / d;
        t.push(
          step(
            `分母は${d}×${factor}＝${nextD}。分子も同じ${factor}倍にする：${n}×${factor}＝${nextN}。${n}/${d}＝${nextN}/${nextD}。`,
          ),
        );
        elementaryExplanation = true;
      }
      if (q.unitFraction)
        t.push(
          step(
            `1/${q.unitFraction.d} が${q.unitFraction.n}こで ${q.unitFraction.n}/${q.unitFraction.d}。図のぬったところを数えよう。`,
          ),
        );
      if (q.law) {
        const { a, b, c, kind } = q.law;
        t.push(
          step(
            kind === "exchange"
              ? `${a}×${b}と${b}×${a}は同じ。かける順を入れかえても積は変わらない。`
              : kind === "associate"
                ? `${b * c}を${b}×${c}に分ける。${a}×（${b}×${c}）＝（${a}×${b}）×${c}。かけるまとまりを変えても積は同じ。`
                : `${a}を${b}と${c}の両方にかける。${a}×${b + c}＝${a * b}＋${a * c}`,
          ),
        );
      }
      if (!q.expressionAST.op && q.challengeId === "G5-N11") {
        const v = q.expressionAST.value;
        t.push(
          step(
            `${v.n}÷${v.d}＝${format(v, "decimal")}。分子を分母でわると小数になる。`,
          ),
        );
      }
      if (q.roundOperands)
        q.roundOperands.forEach((v) =>
          t.push(
            step(
              `${v.original} → ${format(roundExact(v.original, v.places))}（指定の位まで）`,
            ),
          ),
        );
      if (q.challengeId === "G1-C03") {
        const a = Number(evaluate(q.expressionAST.args[0]).n),
          b = Number(evaluate(q.expressionAST.args[1]).n),
          toTen = 10 - a;
        t.push(
          step(
            `${a}＋${toTen}＝10。${b}は${toTen}と${b - toTen}。10＋${b - toTen}＝${a + b}`,
          ),
        );
      }
      if (q.challengeId === "G1-C05") {
        const a = Number(evaluate(q.expressionAST.args[0]).n),
          b = Number(evaluate(q.expressionAST.args[1]).n);
        t.push(
          step(
            `${a}は10と${a - 10}。10−${b}＝${10 - b}。${10 - b}＋${a - 10}＝${a - b}`,
          ),
        );
      }
      function walk(ast) {
        if (!ast.op) return;
        ast.args.forEach(walk);
        const a = evaluate(ast.args[0]),
          b = evaluate(ast.args[1]);
        if (
          q.answerSpec.type === "fraction" &&
          (a.d !== "1" ||
            b.d !== "1" ||
            ast.args.some((x) => x.label?.includes("/")))
        ) {
          for (const node of ast.args)
            if (node.label?.includes("と"))
              t.push(
                step(
                  `${node.label} ＝ ${q.displayDenominator ? `${(BigInt(evaluate(node).n) * BigInt(q.displayDenominator)) / BigInt(evaluate(node).d)}/${q.displayDenominator}` : format(evaluate(node))}（仮分数にする）`,
                ),
              );
          if (ast.op === "+" || ast.op === "-") {
            const d = q.displayDenominator
              ? BigInt(q.displayDenominator)
              : lcm(a.d, b.d);
            t.push(
              step(
                `${q.displayDenominator ? `分母${d}はそのまま、分子を計算する` : `分母を${d}にそろえる`}：${(BigInt(a.n) * d) / BigInt(a.d)}/${d} ${ast.op === "+" ? "＋" : "−"} ${(BigInt(b.n) * d) / BigInt(b.d)}/${d}`,
              ),
            );
          }
          if (ast.op === "/")
            t.push(step(`わる数の逆数${format(calc("/", 1, b))}をかける。`));
        }
        const value = evaluate(ast);
        if (q.answerSpec.reduced && q.answerSpec.type === "fraction") {
          const common = lcm(a.d, b.d);
          const n =
            ast.op === "+" || ast.op === "-"
              ? (BigInt(a.n) * common) / BigInt(a.d) +
                ((ast.op === "+" ? 1n : -1n) * BigInt(b.n) * common) /
                  BigInt(b.d)
              : BigInt(a.n) * BigInt(ast.op === "*" ? b.n : b.d);
          const d =
            ast.op === "+" || ast.op === "-"
              ? common
              : BigInt(a.d) * BigInt(ast.op === "*" ? b.d : b.n);
          const g = gcd(n, d);
          if (g > 1n)
            t.push(
              step(`${n}/${d} の分子と分母を${g}でわる → ${format(value)}。`),
            );
        }
        const label = q.displayDenominator
          ? `${(BigInt(value.n) * BigInt(q.displayDenominator)) / BigInt(value.d)}/${q.displayDenominator}`
          : format(
              value,
              q.answerSpec.type === "decimal" && decimalPlaces(value) < Infinity
                ? "decimal"
                : "fraction",
            );
        t.push(
          step(`${expression(ast)} ＝ ${label}`, {
            value,
            check: { op: ast.op, a, b, result: value },
          }),
        );
      }
      if (q.written) t.push(...writtenTrace(q));
      else if (!elementaryExplanation) walk(q.expressionAST);
      if (q.roundPlaces !== undefined)
        t.push(
          step(`小数第${q.roundPlaces + 1}位を見て、5以上なら切り上げる。`),
        );
    } else if (q.task === "compare") {
      const [a, b] = q.values;
      if (["G1-N01", "G2-N01", "G3-N01", "G4-N01"].includes(q.challengeId)) {
        t.push(
          step(
            `けたの かずを みよう。同じなら、左の大きいくらいから くらべよう。${format(a)} と ${format(b)}。`,
          ),
        );
      } else if (["G3-N04", "G4-N04"].includes(q.challengeId)) {
        const places = Math.max(decimalPlaces(a), decimalPlaces(b));
        const padded = (v) => {
          const [i, f = ""] = format(v, "decimal").split(".");
          return i + (places ? "." + f.padEnd(places, "0") : "");
        };
        t.push(
          step(
            `小数点をそろえる：${padded(a)} と ${padded(b)}。左の大きい位からくらべる。`,
          ),
        );
      } else if (q.challengeId === "G3-N06") {
        t.push(
          step(`分母が同じなので、分子をくらべる。${q.labels.join(" と ")}。`),
        );
      } else {
        const d = lcm(a.d, b.d);
        t.push(
          step(
            `同じ1/${d}のまとまりで見ると、${(BigInt(a.n) * d) / BigInt(a.d)} と ${(BigInt(b.n) * d) / BigInt(b.d)}。`,
          ),
        );
      }
    } else if (q.task === "divisors" || q.task === "gcd" || q.task === "lcm") {
      const ds = (n) =>
        Array.from({ length: Number(n) }, (_, i) => i + 1).filter(
          (i) => Number(n) % i === 0,
        );
      q.values.forEach((n) =>
        t.push(
          step(
            q.task === "lcm"
              ? `${n}の倍数：${Array.from({ length: Number(q.expectedExactValue.n) / Number(n) }, (_, i) => Number(n) * (i + 1)).join("、")}`
              : `${n}の約数：${ds(n).join("、")}`,
          ),
        ),
      );
    } else if (q.task === "common") {
      q.values.forEach((v, i) =>
        t.push(
          step(
            `${v.n}/${v.d} の分子・分母を${BigInt(q.answerSpec.denominator) / BigInt(v.d)}倍 → ${q.expectedExactValue[i].n}/${q.expectedExactValue[i].d}`,
          ),
        ),
      );
    } else if (q.task === "fraction") {
      if (q.challengeId === "G5-N10") {
        const value = format(q.original, "decimal"),
          places = (value.split(".")[1] || "").length;
        t.push(
          step(
            places
              ? `小数${places}けたなので、分母を${10 ** places}、分子を${BigInt(value.replace(".", ""))}にする。最後に約分する。`
              : `${value}は1が${value}こ。分母1の分数で${value}/1。`,
          ),
        );
      } else if (q.answerSpec.form === "mixed") {
        const v = q.original;
        t.push(
          step(
            `${v.n}÷${v.d}＝${BigInt(v.n) / BigInt(v.d)} あまり${BigInt(v.n) % BigInt(v.d)}。整数の部分と、分母${v.d}の分数にする。`,
          ),
        );
      } else if (q.challengeId === "G4-N06") {
        const n = BigInt(q.original.n),
          d = BigInt(q.original.d);
        t.push(
          step(
            `${n / d}×${d}＋${n % d}＝${n}。分母${d}はそのままで、分子を${n}にする。`,
          ),
        );
      } else {
        const g = gcd(q.original.n, q.original.d);
        t.push(
          step(
            g > 1n && q.answerSpec.reduced
              ? `分子${q.original.n}と分母${q.original.d}を${g}でわる。`
              : `同じ大きさの${q.original.d}つ分に分けたうちの${q.original.n}こ分。`,
          ),
        );
      }
    } else if (q.task === "parity")
      t.push(
        step(
          `${q.values[0]}÷2のあまりは${BigInt(q.values[0]) % 2n}。あまり0なら偶数。`,
        ),
      );
    else if (q.task === "reciprocal")
      t.push(
        step(
          `${format(q.values[0])} の分子と分母を入れかえる。かけて1になる。`,
        ),
      );
    else if (q.task === "round")
      t.push(
        step(
          `1つ下の位は${(BigInt(q.values[0]) / 10n ** BigInt(-q.places - 1)) % 10n}。5以上なら切り上げる。`,
        ),
      );
    else if (q.task === "blocks")
      t.push(
        step(
          q.answerSpec.labels
            .map((l, i) => `${l}は${q.values[i]}こ`)
            .join("、"),
        ),
      );
    t.push({ kind: "answer", text: `こたえ：${answerText(q)}` });
    return t;
  }
  function answerText(q) {
    const v = q.expectedExactValue,
      s = q.answerSpec;
    if (s.type === "compare")
      return { "<": "＜（小さい）", ">": "＞（大きい）", "=": "＝（同じ）" }[v];
    if (s.type === "parity")
      return v === "even" ? "偶数（ぐうすう）" : "奇数（きすう）";
    if (s.type === "quotient")
      return `${v.quotient} あまり ${format(v.remainder, "decimal")}`;
    if (s.type === "common") return v.map((f) => `${f.n}/${f.d}`).join(" と ");
    if (s.type === "blocks" || s.type === "set") return v.join("、");
    if (
      s.type === "fraction" &&
      !s.form &&
      !s.reduced &&
      (q.displayDenominator || q.original)
    ) {
      const d = q.displayDenominator || q.original.d;
      return `${(BigInt(v.n) * BigInt(d)) / BigInt(v.d)}/${d}`;
    }
    if (s.type === "fraction" && s.denominator) {
      const d = BigInt(s.denominator),
        n = (BigInt(v.n) * d) / BigInt(v.d);
      return s.form === "mixed" ? `${n / d}と${n % d}/${d}` : `${n}/${d}`;
    }
    return format(v, s.type === "decimal" ? "decimal" : "fraction");
  }
  function normalizeInput(spec, raw) {
    const clean = (v) =>
      String(v ?? "")
        .replace(/[０-９]/g, (s) => String(s.charCodeAt(0) - 65296))
        .replace(/．/g, ".")
        .trim();
    function numeric(v, decimalAllowed = false) {
      v = clean(v);
      if (
        v.length > 40 ||
        !(decimalAllowed ? /^\d+(?:\.\d+)?$/ : /^\d+$/).test(v)
      )
        throw Error("数字をさいごまで入れてね。");
      return number(v);
    }
    function fraction(v) {
      const form = v.form || "fraction";
      if (form === "integer")
        return { value: numeric(v.whole), form, n: "0", d: "1" };
      if (!["mixed", "fraction"].includes(form))
        throw Error("答えの形をえらんでね。");
      const n = numeric(v.numerator).n,
        d = numeric(v.denominator).n;
      if (d === "0") throw Error("分母は0にできません。");
      const w = form === "mixed" ? numeric(clean(v.whole) || "0").n : "0";
      if (form === "mixed" && BigInt(n) >= BigInt(d))
        throw Error("分数の部分を1より小さくしてね。");
      return { value: rat(BigInt(w) * BigInt(d) + BigInt(n), d), form, n, d };
    }
    try {
      raw = typeof raw === "object" && raw !== null ? raw : { value: raw };
      if (spec.type === "integer" || spec.type === "decimal")
        return { value: numeric(raw.value, spec.type === "decimal") };
      if (spec.type === "fraction") return fraction(raw);
      if (spec.type === "quotient")
        return {
          quotient: numeric(raw.quotient).n,
          remainder: numeric(raw.remainder, !!spec.decimalRemainder),
        };
      if (spec.type === "common")
        return {
          values: [fraction(raw.first || {}), fraction(raw.second || {})],
        };
      if (spec.type === "blocks")
        return {
          values: spec.labels.map((_, i) => numeric(raw.values?.[i]).n),
        };
      if (spec.type === "set") {
        const entries = (raw.values || []).map((v) => numeric(v).n);
        if (clean(raw["set-value"]) !== "")
          entries.push(numeric(raw["set-value"]).n);
        if (!entries.length) throw Error("数を追加してね。");
        if (new Set(entries).size !== entries.length)
          throw Error("同じ数は1回だけ入れてね。");
        return {
          values: entries.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)),
        };
      }
      if (spec.type === "compare" || spec.type === "parity") {
        const allowed =
          spec.type === "compare" ? ["<", "=", ">"] : ["even", "odd"];
        if (!allowed.includes(raw.value)) throw Error("答えをえらんでね。");
        return { value: raw.value };
      }
      throw Error("入力をたしかめてね。");
    } catch (e) {
      return { error: e.message };
    }
  }
  function judge(q, p) {
    if (p.error) return { correct: false, inputError: p.error };
    const s = q.answerSpec,
      v = q.expectedExactValue;
    const wrong = (reason) => ({ correct: false, reason });
    if (s.type === "fraction") {
      if (s.form && p.form !== s.form) return wrong("指定された形に直そう。");
      if (s.denominator && p.d !== s.denominator)
        return wrong(`分母を${s.denominator}にしよう。`);
      if (s.reduced && gcd(p.n, p.d) !== 1n) return wrong("約分しよう。");
    }
    if (s.type === "quotient")
      return {
        correct:
          p.quotient === v.quotient && cmp(p.remainder, v.remainder) === 0,
      };
    if (s.type === "common")
      return {
        correct: p.values.every(
          (f, i) => f.d === s.denominator && cmp(f.value, number(v[i])) === 0,
        ),
      };
    if (s.type === "blocks" || s.type === "set")
      return { correct: JSON.stringify(p.values) === JSON.stringify(v) };
    if (s.type === "compare" || s.type === "parity")
      return { correct: p.value === v };
    return { correct: cmp(p.value, v) === 0 };
  }
  function validateQuestion(spec, q) {
    const errors = [];
    if (q.challengeId !== spec.id) errors.push("id");
    const ast = q.expressionAST;
    let v;
    try {
      if (ast) v = evaluate(ast);
    } catch {
      errors.push("arithmetic");
    }
    if (!q.prompt || !q.answerSpec || !q.solutionTrace?.length)
      errors.push("incomplete");
    if (ast?.op && ast.args.every((a) => a.value)) {
      const a =
          Number(evaluate(ast.args[0]).n) / Number(evaluate(ast.args[0]).d),
        b = Number(evaluate(ast.args[1]).n) / Number(evaluate(ast.args[1]).d),
        id = spec.id;
      if (
        id === "G2-C05" &&
        (a < 100 || a > 999 || b < 1 || b > 99 || (a % 100) + b >= 100)
      )
        errors.push("range");
      if (
        id === "G2-C06" &&
        (a < 100 || a > 999 || b < 1 || b > 99 || a % 100 < b)
      )
        errors.push("range");
      if (
        id === "G3-C10" &&
        (a < 10 ||
          a > 99 ||
          b < 2 ||
          b > 9 ||
          Math.floor(a / 10) % b ||
          (a % 10) % b ||
          a / b < 10)
      )
        errors.push("range");
      if (
        id === "G1-C03" &&
        (a < 1 || a > 9 || b < 1 || b > 9 || a + b < 11 || a + b > 18)
      )
        errors.push("range");
      if (
        id === "G1-C05" &&
        (a < 11 || a > 18 || b < 1 || b > 9 || b <= a % 10)
      )
        errors.push("range");
      if (q.unknown !== undefined && ast.op === "*" && (a === 0 || b === 0))
        errors.push("nonunique");
    }
    if (q.task === "reciprocal" && number(q.values[0]).n === "0")
      errors.push("zero");
    if (v && BigInt(v.n) < 0n) errors.push("negative");
    return { valid: errors.length === 0, errors };
  }
  function normalizeConfig(c) {
    const selectedIds = [...new Set(c.selectedIds || [])].sort();
    if (!selectedIds.length || selectedIds.some((id) => !BY_ID[id]))
      throw Error("チャレンジをえらんでね。");
    if (!["practice", "time"].includes(c.mode)) throw Error("モードが不正です");
    const long = selectedIds.some((id) => BY_ID[id].timeClass === "long");
    const quantity =
      c.mode === "practice"
        ? c.quantity === null
          ? null
          : (c.quantity ?? 10)
        : null;
    if (quantity !== null && ![10, 20, 30].includes(quantity))
      throw Error("問題数が不正です");
    const timeLimitMs =
      c.mode === "time" ? (c.timeLimitMs ?? (long ? 120000 : 60000)) : null;
    if (
      c.mode === "time" &&
      !(long ? [60000, 120000, 180000] : [30000, 60000, 90000]).includes(
        timeLimitMs,
      )
    )
      throw Error("時間が不正です");
    const optionsById = {};
    for (const id of selectedIds) {
      const o = c.optionsById?.[id] || {};
      const next = {};
      if (id === "G2-C08") {
        if (
          o.table !== undefined &&
          o.table !== null &&
          (!Number.isInteger(o.table) || o.table < 1 || o.table > 9)
        )
          throw Error("段が不正です");
        next.table = o.table ?? null;
      }
      if (REMAINDER_IDS.includes(id)) {
        if (
          o.remainder !== undefined &&
          !["none", "some", "mixed"].includes(o.remainder)
        )
          throw Error("余り条件が不正です");
        next.remainder = o.remainder || "mixed";
      }
      optionsById[id] = next;
    }
    return {
      selectedIds,
      optionsById,
      mode: c.mode,
      quantity,
      timeLimitMs,
      languageGrade: Math.min(...selectedIds.map((id) => BY_ID[id].grade)),
      appVersion: VERSION,
    };
  }
  function schedule(ids, count, r) {
    const result = [];
    while (result.length < count) result.push(...shuffle(ids, r));
    return result.slice(0, count);
  }
  const scoreCorrect = (base, streak, hint) =>
    Math.round(
      base *
        (streak >= 8 ? 3 : streak >= 5 ? 2 : streak >= 3 ? 1.5 : 1) *
        (hint ? 0.5 : 1),
    );
  function present(s) {
    if (s.config.quantity !== null && s.records.length >= s.config.quantity)
      return finish(s, "completed");
    if (s.config.mode === "time" && s.activeTimeRemainingMs <= 0)
      return finish(s, "natural-timeout");
    const i = s.records.length;
    if (!s.schedule[i]) {
      const r = rng(s.generator.rngState);
      s.schedule.push(...shuffle(s.config.selectedIds, r));
      s.generator.rngState = r.state;
    }
    const id = s.schedule[i],
      q = generate(id, s.config.optionsById[id], s.generator);
    q.questionId = `${s.runId}:${i}`;
    s.currentQuestion = q;
    s.records.push({
      questionId: q.questionId,
      challengeId: id,
      presentationIndex: i,
      question: q,
      wrongAttempts: 0,
      firstWrongAnswer: null,
      hintShown: false,
      helpUsed: false,
      terminal: null,
      endReason: null,
      earnedPoints: 0,
      streakAfter: null,
    });
    s.phase = "QUESTION";
    s.pauseReasons = s.pauseReasons.filter((p) => p === "hidden");
    return s;
  }
  function createRun(config, seed = Date.now(), now = 0) {
    config = normalizeConfig(config);
    const r = rng(seed);
    const s = {
      runId: `${seed >>> 0}-${Math.floor(now)}`,
      config,
      phase: "PREPARING",
      currentQuestion: null,
      records: [],
      schedule: config.quantity
        ? schedule(config.selectedIds, config.quantity, r)
        : [],
      generator: createGenerator(r.state),
      score: 0,
      streak: 0,
      bestStreak: 0,
      activeTimeRemainingMs: config.timeLimitMs,
      pauseReasons: [],
      lastNow: now,
      finishedOnce: false,
      endReason: null,
    };
    return present(s);
  }
  function finish(s, reason) {
    if (s.finishedOnce) return s;
    const rec = s.records.at(-1);
    if (rec && !rec.terminal) {
      rec.terminal = "unanswered";
      rec.endReason = reason === "natural-timeout" ? reason : "manual";
    }
    s.phase = "RESULT";
    s.finishedOnce = true;
    s.endReason = reason;
    s.pauseReasons = [];
    return s;
  }
  function reduceRun(state, event, now) {
    const s = clone(state);
    s.notice = null;
    if (s.finishedOnce) return s;
    if (
      s.config.mode === "time" &&
      s.phase === "QUESTION" &&
      !s.pauseReasons.length
    )
      s.activeTimeRemainingMs = Math.max(
        0,
        s.activeTimeRemainingMs - Math.max(0, now - s.lastNow),
      );
    s.lastNow = now;
    if (s.config.mode === "time" && s.activeTimeRemainingMs <= 0)
      return finish(s, "natural-timeout");
    const add = (p) => {
        if (!s.pauseReasons.includes(p)) s.pauseReasons.push(p);
      },
      remove = (p) => {
        s.pauseReasons = s.pauseReasons.filter((x) => x !== p);
      };
    const rec = s.records.at(-1);
    if (event.questionId && event.questionId !== rec.questionId) return s;
    if (event.type === "HIDDEN") {
      add("hidden");
      return s;
    }
    if (event.type === "VISIBLE") {
      remove("hidden");
      return s;
    }
    if (event.type === "END_CONFIRM") {
      add("confirm");
      return s;
    }
    if (event.type === "END_CANCEL") {
      remove("confirm");
      return s;
    }
    if (event.type === "END_ACCEPT") return finish(s, "manual");
    if (event.type === "PAUSE" && s.phase === "QUESTION") {
      add("manual");
      return s;
    }
    if (event.type === "RESUME") {
      remove("manual");
      return s;
    }
    if (event.type === "HINT_CONTINUE" && s.phase === "HINT_READING") {
      remove("hint");
      s.phase = "QUESTION";
      return s;
    }
    if (event.type === "FEEDBACK_DONE" && s.pauseReasons.includes("confirm"))
      return s;
    if (event.type === "FEEDBACK_DONE" && s.phase === "WRONG_FEEDBACK") {
      remove("wrong-animation");
      if (rec.wrongAttempts === 2 && !rec.hintShown) {
        rec.hintShown = true;
        s.phase = "HINT_READING";
        add("hint");
      } else s.phase = "QUESTION";
      return s;
    }
    if (
      (event.type === "FEEDBACK_DONE" && s.phase === "CORRECT_FEEDBACK") ||
      (event.type === "SOLUTION_NEXT" && s.phase === "SOLUTION_READING")
    ) {
      remove("correct-animation");
      remove("solution");
      return present(s);
    }
    if (s.phase !== "QUESTION" || s.pauseReasons.length || rec.terminal)
      return s;
    if (event.type === "HELP") {
      rec.helpUsed = true;
      rec.terminal = "help";
      rec.endReason = "help";
      rec.streakAfter = 0;
      s.streak = 0;
      s.phase = "SOLUTION_READING";
      add("solution");
      return s;
    }
    if (event.type !== "SUBMIT") return s;
    const parsed = normalizeInput(rec.question.answerSpec, event.raw),
      result = judge(rec.question, parsed);
    if (result.inputError) {
      s.notice = result.inputError;
      return s;
    }
    if (result.correct) {
      s.streak++;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
      rec.earnedPoints = scoreCorrect(
        BY_ID[rec.challengeId].basePoints,
        s.streak,
        rec.hintShown,
      );
      s.score += rec.earnedPoints;
      rec.terminal = "correct";
      rec.endReason = "correct";
      rec.normalizedCorrectAnswer = parsed;
      rec.streakAfter = s.streak;
      s.phase = "CORRECT_FEEDBACK";
      add("correct-animation");
      s.notice = `できた！${rec.wrongAttempts ? " やりなおして せいかい！" : ""} ＋${rec.earnedPoints}点`;
    } else {
      rec.wrongAttempts++;
      rec.firstWrongAnswer ||= clone(event.raw);
      s.streak = 0;
      s.phase = "WRONG_FEEDBACK";
      add("wrong-animation");
      s.notice = result.reason || "おしい！ もういちど！";
    }
    return s;
  }
  function deriveMetrics(records, unshownSlots = [], endReason = "manual") {
    const m = {
      displayN: records.length + unshownSlots.length,
      presented: records.length,
      unshown: unshownSlots.length,
      learningN: records.length + unshownSlots.length,
      unansweredN: records.length + unshownSlots.length,
      correctProblems: 0,
      helpProblems: 0,
      mistakeEvents: 0,
      hintProblems: 0,
      firstCorrectProblems: 0,
      finalSelfCorrectProblems: 0,
      repeatedWrongProblems: 0,
      unansweredProblems: unshownSlots.length,
      learningUnansweredCount: unshownSlots.length,
      exclusions: [],
    };
    records.forEach((r) => {
      const correct = r.terminal === "correct",
        help = r.terminal === "help",
        unanswered = r.terminal === "unanswered" || !r.terminal;
      m.correctProblems += +correct;
      m.helpProblems += +help;
      m.mistakeEvents += r.wrongAttempts + +help;
      m.hintProblems += +r.hintShown;
      m.firstCorrectProblems += +(correct && !r.wrongAttempts && !r.helpUsed);
      m.finalSelfCorrectProblems += +(correct && !r.helpUsed);
      m.repeatedWrongProblems += +(r.wrongAttempts >= 2);
      m.unansweredProblems += +unanswered;
      m.learningUnansweredCount += +unanswered;
      if (
        unanswered &&
        r.endReason === "natural-timeout" &&
        endReason === "natural-timeout"
      ) {
        m.unansweredN--;
        m.learningUnansweredCount--;
        if (!r.wrongAttempts) m.learningN--;
        m.exclusions.push({
          questionId: r.questionId,
          reason: "natural-timeout",
          learning: !r.wrongAttempts,
        });
      }
    });
    m.answerAccuracy =
      m.correctProblems + m.mistakeEvents
        ? m.correctProblems / (m.correctProblems + m.mistakeEvents)
        : null;
    return m;
  }
  function runMetrics(s, id = null) {
    const records = id
      ? s.records.filter((r) => r.challengeId === id)
      : s.records;
    const slots = s.config.quantity ? s.schedule.slice(s.records.length) : [];
    return deriveMetrics(
      records,
      id ? slots.filter((x) => x === id) : slots,
      s.endReason,
    );
  }
  function eligibility(s, id) {
    const m = runMetrics(s, id);
    return (
      m.learningN > 0 &&
      (s.config.quantity !== null ||
        s.config.mode === "time" ||
        s.records.length >= 10) &&
      (s.config.selectedIds.length < 2 || m.presented >= 10)
    );
  }
  function evaluateFallback(s) {
    const candidates = [],
      excluded = [];
    for (const id of s.config.selectedIds) {
      const m = runMetrics(s, id);
      if (!eligibility(s, id)) {
        excluded.push(id);
        continue;
      }
      const flags = [
        m.unansweredN > 0 && m.learningUnansweredCount * 5 >= m.unansweredN,
        m.helpProblems * 5 >= m.learningN,
        m.repeatedWrongProblems * 5 >= m.learningN,
        m.firstCorrectProblems * 10 < m.learningN * 7,
        m.finalSelfCorrectProblems * 10 < m.learningN * 7,
      ];
      if (!flags.some(Boolean)) continue;
      const severity = Math.max(
        1 - m.firstCorrectProblems / m.learningN,
        1 - m.finalSelfCorrectProblems / m.learningN,
        m.helpProblems / m.learningN,
        m.repeatedWrongProblems / m.learningN,
        m.unansweredN ? m.learningUnansweredCount / m.unansweredN : 0,
      );
      const reason =
        m.unshown && flags[0]
          ? "まだ取り組んでいない問題もあったね。まずこの練習から"
          : [
              "こたえていない問題を、少しずつ練習しよう。",
              "助けてもらったところを、いっしょに練習しよう。",
              "何度かやりなおしたところを練習しよう。",
              "はじめの考え方を、もういちど練習しよう。",
              "こたえまでの道すじを練習しよう。",
            ][flags.findIndex(Boolean)];
      candidates.push({
        sourceId: id,
        targetId: BY_ID[id].fallbackParent || id,
        severity,
        conditionCount: flags.filter(Boolean).length,
        learningN: m.learningN,
        reason,
      });
    }
    candidates.sort(
      (a, b) =>
        b.severity - a.severity ||
        b.conditionCount - a.conditionCount ||
        b.learningN - a.learningN ||
        a.sourceId.localeCompare(b.sourceId),
    );
    return {
      recommendation: candidates[0] || null,
      excluded,
      insufficient: excluded.length === s.config.selectedIds.length,
    };
  }
  function bestKey(config, supportClass) {
    config = normalizeConfig(config);
    if (
      config.selectedIds.length !== 1 ||
      (config.mode === "practice" && config.quantity === null)
    )
      return null;
    return JSON.stringify([
      VERSION,
      config.selectedIds[0],
      config.optionsById,
      config.mode,
      config.quantity ?? config.timeLimitMs,
      supportClass,
    ]);
  }
  function emptySave() {
    return {
      format: "kazohe-backup",
      appVersion: VERSION,
      schemaVersion: 1,
      settings: {
        name: "",
        onboarded: false,
        sound: true,
        effects: true,
        config: normalizeConfig({
          selectedIds: ["G1-N01"],
          mode: "practice",
          quantity: 10,
        }),
      },
      bestRecords: {},
      recommendation: null,
      returnStack: [],
      practiceCheckpoint: null,
    };
  }
  function checkpoint(s) {
    if (s.config.mode !== "practice") return null;
    const c = clone(s);
    const current = c.records.at(-1);
    if (current && !current.terminal) {
      Object.assign(current, {
        wrongAttempts: 0,
        firstWrongAnswer: null,
        hintShown: false,
        helpUsed: false,
        earnedPoints: 0,
      });
      const completed = c.records.slice(0, -1);
      c.streak = completed.at(-1)?.streakAfter || 0;
      c.score = completed.reduce((n, r) => n + r.earnedPoints, 0);
      c.bestStreak = Math.max(0, ...completed.map((r) => r.streakAfter || 0));
    }
    c.pauseReasons = [];
    c.lastNow = 0;
    if (
      current?.terminal &&
      current.terminal !== "unanswered" &&
      !c.finishedOnce
    )
      present(c);
    else if (!c.finishedOnce) c.phase = "QUESTION";
    return c;
  }
  function applyResult(saved, s) {
    const next = clone(saved),
      metrics = runMetrics(s),
      supportClass = s.records.some((r) => r.hintShown || r.helpUsed)
        ? "supported"
        : "independent",
      key = bestKey(s.config, supportClass);
    let newBest = false;
    if (
      key &&
      (!next.bestRecords[key] || s.score > next.bestRecords[key].score)
    ) {
      next.bestRecords[key] = {
        score: s.score,
        bestStreak: s.bestStreak,
        metrics,
        config: s.config,
        supportClass,
        endReason: s.endReason,
      };
      newBest = true;
    }
    const evaluated = evaluateFallback(s);
    if (evaluated.recommendation)
      next.recommendation = evaluated.recommendation;
    else if (
      next.recommendation &&
      s.config.selectedIds.includes(next.recommendation.targetId) &&
      eligibility(s, next.recommendation.targetId)
    )
      next.recommendation = null;
    if (s.config.mode === "practice") next.practiceCheckpoint = null;
    return { saved: next, newBest, metrics, ...evaluated };
  }
  function recommendConfig(saved, current) {
    if (!saved.recommendation) return { saved, config: current };
    const next = clone(saved),
      id = next.recommendation.targetId;
    if (current.selectedIds.length !== 1 || current.selectedIds[0] !== id)
      next.returnStack.push(clone(current));
    return {
      saved: next,
      config: normalizeConfig({
        selectedIds: [id],
        mode: "practice",
        quantity: 10,
      }),
    };
  }
  function clearScores(saved, id = null) {
    const s = clone(saved);
    s.bestRecords = Object.fromEntries(
      Object.entries(s.bestRecords).filter(
        ([, r]) => id && r.config.selectedIds[0] !== id,
      ),
    );
    return s;
  }
  function validateBackup(text) {
    if (
      typeof text !== "string" ||
      new TextEncoder().encode(text).length > 16 * 1024 * 1024
    )
      throw Error("JSONは16 MiBまでです。");
    const obj = JSON.parse(text);
    let nodes = 0;
    function scan(v, depth = 0, field = "") {
      if (++nodes > 1000000 || depth > 80)
        throw Error("データが大きすぎます。");
      if (v && typeof v === "object") {
        for (const key of Object.keys(v)) {
          if (["__proto__", "prototype", "constructor"].includes(key))
            throw Error("不正なキーです。");
          scan(v[key], depth + 1, key);
        }
      } else if (
        typeof v === "number" &&
        (!Number.isFinite(v) ||
          (v < 0 && !(field === "places" && [-1, -2, -3, -4].includes(v))) ||
          v > Number.MAX_SAFE_INTEGER)
      )
        throw Error("不正な数値です。");
      else if (typeof v === "string" && v.length > 20000)
        throw Error("文字列が長すぎます。");
    }
    scan(obj);
    const fail = () => {
      throw Error("バックアップの形式が正しくありません。");
    };
    if (
      !obj ||
      obj.format !== "kazohe-backup" ||
      obj.appVersion !== VERSION ||
      obj.schemaVersion !== 1
    )
      throw Error("対応していないバージョンです。");
    const only = (v, keys) => {
      if (
        !v ||
        typeof v !== "object" ||
        Array.isArray(v) ||
        Object.keys(v).some((k) => !keys.includes(k))
      )
        fail();
    };
    only(obj, [
      "format",
      "appVersion",
      "schemaVersion",
      "settings",
      "bestRecords",
      "recommendation",
      "returnStack",
      "practiceCheckpoint",
    ]);
    const set = obj.settings;
    if (
      !set ||
      typeof set.name !== "string" ||
      [...set.name].length > 30 ||
      /[\u0000-\u001f\u007f]/.test(set.name) ||
      ["sound", "effects", "onboarded"].some((k) => typeof set[k] !== "boolean")
    )
      fail();
    only(set, ["name", "sound", "effects", "onboarded", "config"]);
    const conf = (c) => {
      const normalized = normalizeConfig(c);
      if (JSON.stringify(normalized) !== JSON.stringify(c)) fail();
    };
    conf(set.config);
    if (
      !obj.bestRecords ||
      Array.isArray(obj.bestRecords) ||
      typeof obj.bestRecords !== "object" ||
      Object.keys(obj.bestRecords).length > 50000
    )
      fail();
    for (const [key, r] of Object.entries(obj.bestRecords)) {
      conf(r.config);
      if (
        !["independent", "supported"].includes(r.supportClass) ||
        bestKey(r.config, r.supportClass) !== key ||
        !Number.isSafeInteger(r.score) ||
        r.score < 0 ||
        !r.metrics ||
        !Number.isSafeInteger(r.bestStreak) ||
        !["completed", "manual", "natural-timeout"].includes(r.endReason)
      )
        fail();
      const m = r.metrics;
      for (const k of [
        "displayN",
        "presented",
        "unshown",
        "learningN",
        "unansweredN",
        "correctProblems",
        "helpProblems",
        "mistakeEvents",
        "hintProblems",
        "firstCorrectProblems",
        "finalSelfCorrectProblems",
        "repeatedWrongProblems",
        "unansweredProblems",
        "learningUnansweredCount",
      ])
        if (!Number.isSafeInteger(m[k]) || m[k] < 0) fail();
      if (
        m.displayN !== m.presented + m.unshown ||
        m.displayN !==
          m.correctProblems + m.helpProblems + m.unansweredProblems ||
        m.learningN > m.displayN ||
        m.unansweredN > m.displayN ||
        m.firstCorrectProblems > m.finalSelfCorrectProblems ||
        m.finalSelfCorrectProblems > m.correctProblems ||
        m.correctProblems > m.learningN ||
        m.helpProblems > m.learningN ||
        m.hintProblems > m.presented ||
        m.repeatedWrongProblems > m.presented ||
        m.learningUnansweredCount > m.unansweredN
      )
        fail();
      const accuracy =
        m.correctProblems + m.mistakeEvents
          ? m.correctProblems / (m.correctProblems + m.mistakeEvents)
          : null;
      if (m.answerAccuracy !== accuracy) fail();
    }
    if (!Array.isArray(obj.returnStack) || obj.returnStack.length > 101) fail();
    obj.returnStack.forEach(conf);
    if (obj.recommendation) {
      const r = obj.recommendation;
      if (
        !BY_ID[r.sourceId] ||
        r.targetId !== (BY_ID[r.sourceId].fallbackParent || r.sourceId) ||
        typeof r.reason !== "string"
      )
        fail();
    }
    const s = obj.practiceCheckpoint;
    if (s) {
      conf(s.config);
      if (
        s.config.mode !== "practice" ||
        !Array.isArray(s.records) ||
        !s.records.length ||
        s.records.length > 100000 ||
        !Array.isArray(s.schedule) ||
        s.schedule.some((id) => !s.config.selectedIds.includes(id)) ||
        (s.config.quantity !== null &&
          (s.schedule.length !== s.config.quantity ||
            s.records.length > s.config.quantity))
      )
        fail();
      if (
        !s.generator ||
        !Number.isInteger(s.generator.rngState) ||
        s.generator.rngState < 1 ||
        s.generator.rngState > 4294967295 ||
        typeof s.generator.ids !== "object"
      )
        fail();
      for (const [key, g] of Object.entries(s.generator.ids)) {
        const [id, options] = JSON.parse(key);
        if (
          !s.config.selectedIds.includes(id) ||
          JSON.stringify(options) !== JSON.stringify(s.config.optionsById[id])
        )
          fail();
        const ds = domains(id, options);
        if (
          !Array.isArray(g.round) ||
          g.round.length > ds.reduce((n, d) => n + (d.weight || 1), 0) ||
          g.round.some(
            (i) => !Number.isInteger(i) || i < 0 || i >= ds.length,
          ) ||
          ds.some(
            (d, i) => g.round.filter((x) => x === i).length > (d.weight || 1),
          ) ||
          !g.buckets ||
          typeof g.buckets !== "object" ||
          (g.last !== null && typeof g.last !== "string")
        )
          fail();
        for (const [index, b] of Object.entries(g.buckets)) {
          if (
            !/^\d+$/.test(index) ||
            !ds[Number(index)] ||
            !Number.isSafeInteger(b.cycle) ||
            b.cycle < 0 ||
            typeof b.cursor !== "string" ||
            !/^\d{1,80}$/.test(b.cursor) ||
            BigInt(b.cursor) >= ds[Number(index)].size ||
            !Array.isArray(b.used) ||
            b.used.length > 100000 ||
            new Set(b.used).size !== b.used.length ||
            b.used.some((k) => typeof k !== "string")
          )
            fail();
        }
      }
      let score = 0,
        streak = 0,
        best = 0;
      s.records.forEach((r, i) => {
        if (
          r.challengeId !== s.schedule[i] ||
          r.questionId !== `${s.runId}:${i}` ||
          r.question?.challengeId !== r.challengeId ||
          r.question.questionId !== r.questionId ||
          !Number.isInteger(r.wrongAttempts) ||
          r.wrongAttempts < 0 ||
          typeof r.hintShown !== "boolean" ||
          typeof r.helpUsed !== "boolean" ||
          !["correct", "help", null].includes(r.terminal) ||
          (i < s.records.length - 1 && !r.terminal)
        )
          fail();
        const rebuilt = complete(
          { ...r.question, solutionTrace: undefined },
          r.question.conditionBucket,
        );
        if (
          JSON.stringify(rebuilt.expectedExactValue) !==
            JSON.stringify(r.question.expectedExactValue) ||
          rebuilt.canonicalKey !== r.question.canonicalKey ||
          !validateQuestion(BY_ID[r.challengeId], rebuilt).valid
        )
          fail();
        if (r.wrongAttempts > 0) {
          const p = normalizeInput(r.question.answerSpec, r.firstWrongAnswer);
          if (p.error || judge(r.question, p).correct) fail();
        } else if (r.firstWrongAnswer !== null) fail();
        if (r.hintShown !== !!(r.wrongAttempts >= 2)) fail();
        if (r.terminal === "help") {
          if (!r.helpUsed || r.earnedPoints !== 0) fail();
          streak = 0;
        } else if (r.terminal === "correct") {
          if (r.wrongAttempts) streak = 0;
          streak++;
          if (
            r.helpUsed ||
            r.earnedPoints !==
              scoreCorrect(BY_ID[r.challengeId].basePoints, streak, r.hintShown)
          )
            fail();
          score += r.earnedPoints;
          best = Math.max(best, streak);
        } else if (
          r.wrongAttempts ||
          r.helpUsed ||
          r.hintShown ||
          r.earnedPoints
        )
          fail();
      });
      if (
        score !== s.score ||
        streak !== s.streak ||
        best !== s.bestStreak ||
        s.phase !== (s.finishedOnce ? "RESULT" : "QUESTION") ||
        s.pauseReasons.length ||
        JSON.stringify(s.currentQuestion) !==
          JSON.stringify(s.records.at(-1).question)
      )
        fail();
    }
    return clone(obj);
  }
  function storageAdapter(storage, notify = () => {}) {
    let available = true;
    const failed = () => {
      available = false;
      notify(
        "このブラウザでは記録を保存できません。JSONに書き出して残せます。",
      );
    };
    try {
      storage.setItem(STORAGE_KEY + ":probe", "1");
      if (storage.getItem(STORAGE_KEY + ":probe") !== "1") throw Error("probe");
      storage.removeItem(STORAGE_KEY + ":probe");
    } catch {
      failed();
    }
    return {
      get available() {
        return available;
      },
      load() {
        try {
          const text = storage.getItem(STORAGE_KEY);
          return text ? validateBackup(text) : emptySave();
        } catch {
          failed();
          return emptySave();
        }
      },
      write(saved) {
        try {
          const text = JSON.stringify(saved);
          validateBackup(text);
          storage.setItem(STORAGE_KEY, text);
          return true;
        } catch {
          failed();
          return false;
        }
      },
      reset() {
        try {
          storage.removeItem(STORAGE_KEY);
          return true;
        } catch {
          failed();
          return false;
        }
      },
    };
  }
  return Object.freeze({
    VERSION,
    STORAGE_KEY,
    CATALOG,
    BY_ID,
    REMAINDER_IDS,
    clone,
    gcd,
    lcm,
    rat,
    number,
    calc,
    cmp,
    decimal,
    decimalPlaces,
    format,
    roundExact,
    lit,
    op,
    evaluate,
    expression,
    rng,
    shuffle,
    carry,
    borrow,
    domains,
    decode,
    atRank,
    complete,
    arithmetic,
    special,
    createGenerator,
    generate,
    buildHint,
    buildSolution,
    answerText,
    normalizeInput,
    judge,
    validateQuestion,
    normalizeConfig,
    schedule,
    scoreCorrect,
    createRun,
    reduceRun,
    deriveMetrics,
    runMetrics,
    eligibility,
    evaluateFallback,
    bestKey,
    emptySave,
    checkpoint,
    applyResult,
    recommendConfig,
    clearScores,
    validateBackup,
    storageAdapter,
  });
})();
