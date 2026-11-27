/* Finite rank domains, deterministic sampling, and all 101 challenge generators. */
import { BY_ID, REMAINDER_IDS, specOf } from "./00-prelude.ts";
import {
  OP_SIGNS,
  borrow,
  calc,
  carry,
  cmp,
  decimal,
  decimalPlaces,
  evaluate,
  expression,
  format,
  gcd,
  lit,
  number,
  op,
  randInt,
  rat,
  rng,
  roundExact,
  shuffle,
} from "./02-math.ts";
import { KZWritten } from "./03-written.ts";
import { arithmetic, complete, special } from "./05-solutions.ts";
import type {
  AnswerSpec,
  ArithmeticOp,
  ChallengeId,
  ChallengeOptions,
  DomainSpec,
  ExprLiteral,
  ExprNode,
  GeneratorState,
  NumericInput,
  Question,
  Rng,
} from "../types/contracts.d.ts";

const D = (n: number | bigint, s: number): string => decimal(n, s);

const F = (n: number | bigint, d: number | bigint): ExprLiteral =>
  lit(rat(n, d), `${n}/${d}`);

const fractionSpec = (
  grade: number,
  policy: Partial<AnswerSpec> = {},
): AnswerSpec => ({
  type: "fraction",
  reduced: grade >= 5,
  ...policy,
});

// Each finite domain has a rank space. Collisions fall back to exhaustive rank
// traversal; a cycle can advance only after that space has been exhausted.
const domain = (
  dims: [number, number][],
  make: (values: number[]) => Question | null,
  bucket = "standard",
): DomainSpec => ({
  dims,
  make,
  bucket,
  size: dims.reduce((a, [l, h]) => a * BigInt(h - l + 1), 1n),
});

function baseDomains(
  id: ChallengeId,
  options: ChallengeOptions = {},
): DomainSpec[] {
  const grade = specOf(id).grade;
  const I: AnswerSpec = { type: "integer" };
  const E: AnswerSpec = { type: "decimal" };
  const FS = fractionSpec(grade);
  const A = (
    sign: ArithmeticOp,
    a: NumericInput,
    b: NumericInput,
    spec: AnswerSpec = I,
    extra: Partial<Question> = {},
  ): Question => arithmetic(id, op(sign, lit(a), lit(b)), spec, extra);
  const compare = (
    a: NumericInput,
    b: NumericInput,
    labels?: string[],
  ): Question =>
    special(
      id,
      "compare",
      [number(a), number(b)],
      { type: "compare" },
      { labels },
    );
  const blank = (
    x: number | bigint,
    prompt: string,
    solve?: ExprNode,
  ): Question =>
    arithmetic(id, solve || lit(x), I, { prompt, unknown: String(x) });
  const frac = (
    n: number | bigint,
    d: number | bigint,
    prompt: string,
    policy: Partial<AnswerSpec> = {},
  ): Question =>
    special(id, "fraction", [rat(n, d)], fractionSpec(grade, policy), {
      prompt,
      original: { n: String(n), d: String(d) },
    });
  const dec = (a: NumericInput, b: NumericInput, sign: ArithmeticOp): Question =>
    A(sign, a, b, E);
  const sameFractions = (limit: number, addition: boolean): DomainSpec[] => [
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
        ) {
          return null;
        }
        const f = (num: number): ExprLiteral =>
          grade === 4 && num > d && num % d && num % 2
            ? lit(rat(num, d), `${Math.floor(num / d)}と${num % d}/${d}`)
            : F(num, d);
        return arithmetic(id, op(addition ? "+" : "-", f(n), f(m)), FS, {
          displayDenominator: String(d),
        });
      },
    ),
  ];
  const exprDomains = (
    kind: "integer" | "decimal" | "fraction",
  ): DomainSpec[] => {
    const signs: readonly ArithmeticOp[] = ["+", "-", "*", "/"];
    return signs.map((sign, idx) =>
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
          if (kind === "fraction" && (a > 5 * da || b > 5 * db || c > 5 * dc)) {
            return null;
          }
          const av: NumericInput = kind === "decimal" ? D(a, 2) : a;
          const bv: NumericInput = kind === "decimal" ? D(b, 2) : b;
          const cv: NumericInput = kind === "decimal" ? D(c, 2) : c;
          let x: ExprNode = kind === "fraction" ? F(a, da) : lit(av);
          const y: ExprNode = kind === "fraction" ? F(b, db) : lit(bv);
          const z: ExprNode = kind === "fraction" ? F(c, dc) : lit(cv);
          let ast: ExprNode;
          if (sign === "/") {
            x = op("*", x, y);
            ast = op("+", op("/", x, y, !!group), z);
          } else if (sign === "-") {
            ast = op("-", op("+", x, y, !!group), z);
          } else if (sign === "*") {
            ast = group
              ? op("*", op("-", x, y, true), z)
              : op("+", op("*", x, y), z);
          } else {
            ast = group
              ? op("*", op("+", x, y, true), z)
              : op("+", x, op("*", y, z));
          }
          try {
            const value = evaluate(ast);
            if (kind === "decimal" && decimalPlaces(value) > 4) return null;
            const validIntermediates = (node: ExprNode): boolean =>
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
  };

  if (id === "G2-N01") {
    return ["digit-length", "interior-zero", "equal"].map((bucket, k) =>
      domain(
        k === 2
          ? [[0, 9999]]
          : [
              [0, 9999],
              [0, 9999],
            ],
        ([a, bRaw]) => {
          const b = k === 2 ? a : bRaw;
          if (k !== 2 && a === b) return null;
          if (k === 0 && String(a).length === String(b).length) return null;
          if (
            k === 1 &&
            (String(a).length !== String(b).length ||
              ![a, b].some((n) => String(n).slice(1, -1).includes("0")))
          ) {
            return null;
          }
          return compare(a, b);
        },
        bucket,
      ),
    );
  }
  if (
    id === "G1-N01" ||
    id === "G3-N01" ||
    id === "G4-N01" ||
    id === "G3-N04" ||
    id === "G4-N04"
  ) {
    const maxMap: Readonly<Record<string, number | undefined>> = {
      "G1-N01": 100,
      "G2-N01": 9999,
      "G3-N01": 99999999,
      "G3-N04": 99,
      "G4-N04": 99999,
    };
    const max = maxMap[id] || 99999999;
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
          let a: bigint;
          let b: bigint;
          if (id === "G4-N01") {
            a = BigInt(v[0]) * 100000000n + BigInt(v[1]);
            b = k === 1 ? a : BigInt(v[2]) * 100000000n + BigInt(v[3]);
          } else {
            a = BigInt(v[0]);
            if (id === "G4-N04" && k === 1) a *= 10n;
            b = k === 1 ? a : BigInt(v[1]);
          }
          if (k === 1) b = a;
          else if (a === b) return null;
          if ((k === 0 && a > b) || (k === 2 && a < b)) [a, b] = [b, a];
          if (id === "G4-N01" && a < 100000000n && b < 100000000n) return null;
          const scale = id === "G3-N04" ? 1 : id === "G4-N04" ? 3 : 0;
          const labels = [D(a, scale), D(b, scale)];
          if (id === "G4-N04" && k === 1) {
            labels[1] =
              format(number(labels[1]), "decimal") +
              (BigInt(number(labels[1]).d) === 1n ? ".0" : "0");
          }
          const q = compare(D(a, scale), D(b, scale), labels);
          if (id === "G3-N01" || id === "G4-N01") q.numberBlocks = true;
          return q;
        },
        bucket,
      ),
    );
  }
  if (id === "G1-N02") {
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
  }
  if (id === "G1-N03") {
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
  }
  if (id === "G1-C01") {
    return [
      domain([[0, 10]], ([a]) =>
        blank(10 - a, `${a} ＋ □ ＝ 10`, op("-", lit(10), lit(a))),
      ),
    ];
  }
  if (id === "G1-C09") {
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
  }
  if (id === "G1-C02") {
    return [
      domain(
        [
          [0, 9],
          [0, 9],
        ],
        ([a, b]) => (a + b <= 10 ? A("+", a, b) : null),
      ),
    ];
  }
  if (id === "G1-C03") {
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
  }
  if (id === "G1-C04") {
    return [
      domain(
        [
          [0, 10],
          [0, 10],
        ],
        ([a, b]) => (a >= b ? A("-", a, b) : null),
      ),
    ];
  }
  if (id === "G1-C05") {
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
  }
  if (id === "G1-C06" || id === "G1-C07") {
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
        ([aRaw, bRaw]) => {
          const a = kind ? aRaw : aRaw * 10;
          const b = kind ? bRaw : bRaw * 10;
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
  }
  if (id === "G1-C08") {
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
            ) {
              return null;
            }
            return arithmetic(id, ast);
          } catch {
            return null;
          }
        },
        `signs-${i}`,
      ),
    );
  }
  if (id === "G2-N02" || id === "G4-N02") {
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
          const value = v.reduce<bigint>(
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
                  .map<ExprNode>((n, i) =>
                    op("*", lit(n), lit(String(unit ** BigInt(i)))),
                  )
                  .reduce((a, b) => op("+", a, b)),
              );
        },
        reverse ? "decompose" : "compose",
      ),
    );
  }
  if (id === "G2-N03") {
    return [
      domain([[0, 3]], ([i]) => {
        const d = [2, 3, 4, 8][i];
        return frac(1, d, `${d}つに おなじ おおきさで わけた 1つぶん`, {
          diagram: [[1, d]],
        });
      }),
    ];
  }
  if (/^G2-C0[1-6]$/.test(id) || /^G3-C0[1-4]$/.test(id)) {
    const n = Number(id.slice(-2));
    const add =
      (n % 2 === 1 && grade === 3) || (grade === 2 && [1, 2, 5].includes(n));
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
          ) {
            return null;
          }
          if (
            (grade === 2 && n === 5 && (a % 100) + b >= 100) ||
            (grade === 2 && n === 6 && a % 100 < b)
          ) {
            return null;
          }
          if ((add ? carry(a, b) : borrow(a, b)) !== (bucket === "carry")) {
            return null;
          }
          return A(add ? "+" : "-", a, b);
        },
        bucket,
      ),
    );
  }
  if (id === "G2-C07") {
    const signs: readonly ArithmeticOp[] = ["+", "-"];
    return signs.map((sign) =>
      domain(
        [
          [1, 9],
          [1, 9],
        ],
        ([a, b]) => (sign === "-" && a < b ? null : A(sign, a * 100, b * 100)),
        sign,
      ),
    );
  }
  if (id === "G2-C08") {
    return [
      domain(
        [
          [options.table || 1, options.table || 9],
          [1, 9],
        ],
        ([a, b]) => A("*", a, b),
      ),
    ];
  }
  if (id === "G2-C09") {
    return [
      domain(
        [
          [10, 19],
          [2, 5],
        ],
        ([a, b]) => A("*", a, b),
      ),
    ];
  }
  if (id === "G2-C10" || id === "G3-C15") {
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
                i === 2 ? op("*", lit(a), lit(b)) : op("/", lit(a * b), lit(a)),
              );
        },
        `position-${i}`,
      ),
    );
  }
  if (id === "G3-N02" || id === "G5-N06") {
    return [0, 1, 2, 3, 4, 5]
      .filter((i) => id === "G5-N06" || i < 4)
      .map((i) =>
        domain(
          id === "G3-N02" ? [[1, 9999]] : [[1, 999999]],
          ([n]) => {
            const v = id === "G3-N02" ? String(n) : D(n, 3);
            const divisor = i >= 3;
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
  }
  if (id === "G3-N03" || id === "G4-N03") {
    return (id === "G3-N03" ? [1] : [2, 3]).flatMap((scale) =>
      [0, 1].map((reverse) =>
        domain(
          [[1, scale === 1 ? 99 : 99999]],
          ([n]) =>
            reverse
              ? arithmetic(id, op("/", lit(D(n, scale)), lit(D(1, scale))), I, {
                  prompt: `${D(n, scale)} は ${D(1, scale)} が □こ`,
                })
              : arithmetic(id, op("*", lit(D(1, scale)), lit(n)), E, {
                  prompt: `${D(1, scale)} が ${n}こ`,
                }),
          `${scale}-${reverse}`,
        ),
      ),
    );
  }
  if (id === "G3-N05") {
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
  }
  if (id === "G3-N06") {
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
  }
  if (/^G3-C0[5-8]$/.test(id)) {
    const n = Number(id.slice(-2));
    const low = n % 2 ? 10 : 100;
    const high = n % 2 ? 99 : 999;
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
    const ranges: Readonly<Record<string, [number, number, number, number]>> = {
      "G3-C09": [0, 89, 1, 9],
      "G4-C04": [10, 99, 1, 9],
      "G4-C05": [100, 999, 1, 9],
      "G4-C06": [10, 99, 10, 99],
      "G4-C07": [100, 999, 10, 99],
      "G5-C04": [0, 9999, 1, 99],
    };
    return buckets.map((bucket) => {
      const [amin, amax, dmin, dmax] = ranges[id];
      return domain(
        [
          [amin, amax],
          [
            bucket === "some" && dmin === 1 && id !== "G5-C04" ? 2 : dmin,
            dmax,
          ],
        ],
        ([a, d]) => {
          const av = id === "G5-C04" ? D(a, 2) : String(a);
          const dv = id === "G5-C04" ? D(d, 1) : String(d);
          const v = calc("/", av, dv);
          const q = BigInt(v.n) / BigInt(v.d);
          const has = BigInt(v.n) % BigInt(v.d) !== 0n;
          if (
            has !== (bucket === "some") ||
            (id === "G3-C09" && q > 9n) ||
            (id === "G4-C06" && a < d)
          ) {
            return null;
          }
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
  if (id === "G3-C10") {
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
  }
  if (
    id === "G3-C11" ||
    id === "G3-C12" ||
    id === "G4-C08" ||
    id === "G4-C09"
  ) {
    const scale = grade === 3 ? 1 : 3;
    const max = grade === 3 ? 99 : 99999;
    const add = ["G3-C11", "G4-C08"].includes(id);
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
          ) {
            return null;
          }
          if ((add ? carry(a, b) : borrow(a, b)) !== (bucket === "carry")) {
            return null;
          }
          return dec(D(a, scale), D(b, scale), add ? "+" : "-");
        },
        bucket,
      ),
    );
  }
  if (["G3-C13", "G3-C14", "G4-C13", "G4-C14"].includes(id)) {
    return sameFractions(
      grade === 3 ? 10 : 12,
      ["G3-C13", "G4-C13"].includes(id),
    );
  }
  if (id === "G4-N05") {
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
  }
  if (id === "G4-N06") {
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
  }
  if (id === "G4-C01") {
    return [1, 2, 3, 4].map((p) =>
      domain(
        [[0, 9999999]],
        ([n]) => special(id, "round", [String(n)], I, { places: -p }),
        `place-${p}`,
      ),
    );
  }
  if (id === "G4-C02" || id === "G4-C03") {
    const ops: readonly ArithmeticOp[] =
      id === "G4-C02" ? ["+", "-"] : ["*", "/"];
    return ops.map((sign) =>
      domain(
        [
          [10, id === "G4-C02" ? 9999 : 999],
          [10, id === "G4-C02" ? 9999 : 999],
          [1, 2],
        ],
        ([a, b, p]) => {
          const pa = id === "G4-C02" ? p : String(a).length - 1;
          const pb = id === "G4-C02" ? p : String(b).length - 1;
          const aa = roundExact(a, -pa);
          const bb = roundExact(b, -pb);
          if (
            (sign === "-" && cmp(aa, bb) < 0) ||
            (sign === "/" && (bb.n === "0" || calc("/", aa, bb).d !== "1"))
          ) {
            return null;
          }
          const q = A(sign, aa, bb);
          q.prompt = `${a} ${OP_SIGNS[sign]} ${b}：それぞれ${id === "G4-C02" ? (p === 1 ? "十" : "百") + "の位まで" : "上から1桁に"}四捨五入してから計算`;
          q.roundOperands = [
            { original: String(a), places: -pa },
            { original: String(b), places: -pb },
          ];
          return q;
        },
        sign,
      ),
    );
  }
  if (id === "G4-C10" || id === "G5-C01" || id === "G5-C02") {
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
          ) {
            return null;
          }
          return dec(
            id === "G5-C01" ? a : D(a, 2),
            id === "G4-C10" ? b : D(b, 2),
            "*",
          );
        },
      ),
    ];
  }
  if (["G4-C11", "G4-C12", "G5-C03", "G5-C05"].includes(id)) {
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
          const av = id === "G4-C12" ? String(a) : D(a, 2);
          const dv =
            id === "G5-C03"
              ? D(d, 2)
              : id === "G5-C05"
                ? D(d, 1)
                : String(d);
          if (id === "G5-C03" && d % 100 === 0) return null;
          const v = calc("/", av, dv);
          const places = decimalPlaces(v);
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
  }
  if (id === "G4-C15") {
    return exprDomains("integer").map((d) => ({
      ...d,
      make: (v) => {
        v[3] = 0;
        const q = d.make(v);
        if (q && q.expressionAST) {
          const clear = (ast: ExprNode): void => {
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
  }
  if (id === "G4-C16") {
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
  }
  if (id === "G4-C17") {
    return [0, 1, 2].map((i) =>
      domain(
        [
          [1, 20],
          [1, 20],
          [1, 20],
        ],
        ([a, b, c]) => {
          if (i === 0) {
            return {
              ...blank(b, `${a} × ${b} ＝ □ × ${a}`),
              law: { kind: "exchange", a, b, c },
            };
          }
          if (i === 1 && b * c <= 100) {
            return {
              ...blank(
                c,
                `${a} × ${b * c} ＝（${a} × ${b}）× □`,
                op("/", lit(b * c), lit(b)),
              ),
              law: { kind: "associate", a, b, c },
            };
          }
          if (i === 2 && b + c <= 100) {
            return {
              ...blank(c, `${a} ×（${b} ＋ ${c}）＝ ${a} × ${b} ＋ ${a} × □`),
              law: { kind: "distribute", a, b, c },
            };
          }
          return null;
        },
        ["exchange", "associate", "distribute"][i],
      ),
    );
  }
  if (id === "G5-N01") {
    return [
      domain([[0, 9999]], ([n]) =>
        special(id, "parity", [String(n)], { type: "parity" }),
      ),
    ];
  }
  if (id === "G5-N02") {
    return [
      domain([[1, 60]], ([n]) =>
        special(id, "divisors", [String(n)], { type: "set" }),
      ),
    ];
  }
  if (id === "G5-N03") {
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
  }
  if (id === "G5-N04" || id === "G5-N05") {
    return [
      domain(
        [
          [1, id === "G5-N04" ? 100 : 30],
          [1, id === "G5-N04" ? 100 : 30],
        ],
        (v) => special(id, id === "G5-N04" ? "gcd" : "lcm", v.map(String), I),
      ),
    ];
  }
  if (id === "G5-N07") {
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
  }
  if (id === "G5-N08" || id === "G5-N09") {
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
          return id === "G5-N09"
            ? compare(rat(n, d), rat(m, e), [`${n}/${d}`, `${m}/${e}`])
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
  }
  if (id === "G5-N10") {
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
  }
  if (id === "G5-N11") {
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
  }
  if (id === "G5-N12") {
    return [
      domain(
        [
          [0, 99],
          [1, 99],
        ],
        ([a, d]) => A("/", a, d, FS),
      ),
    ];
  }
  if (id === "G5-N13" || id === "G6-N02") {
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
          if (kind === "fraction" && [a, b, x].some((n) => n > 20 * d)) {
            return null;
          }
          if (
            grade === 6 &&
            kind === "decimal" &&
            [a, b, x].every((n) => n % 10 === 0)
          ) {
            return null;
          }
          const val = (n: number): ExprLiteral =>
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
  }
  if (["G5-C06", "G5-C07", "G5-C08"].includes(id)) {
    const signs: readonly ArithmeticOp[] =
      id === "G5-C08" ? ["+", "-"] : [id === "G5-C06" ? "+" : "-"];
    return signs.map((sign) =>
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
          ) {
            return null;
          }
          const mixed = (num: number, den: number): ExprLiteral =>
            lit(
              rat(num, den),
              num > den
                ? `${Math.floor(num / den)}と${num % den}/${den}`
                : `${num}/${den}`,
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
  }
  if (id === "G5-C09") return exprDomains("decimal");
  if (id === "G6-N01") {
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
  }
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
          let a: ExprLiteral;
          let b: ExprLiteral;
          if (k < 3) {
            const [d, n, m] = v;
            if (n > 5 * d) return null;
            a = F(n, d);
            b = lit(m);
          } else {
            const [d, e, n, m] = v;
            if (k >= 5 && (n >= 4 * d || m >= 4 * e || (n <= d && m <= e))) {
              return null;
            }
            if (k % 2 === 0 && !m) return null;
            const f = (num: number, den: number): ExprLiteral =>
              k >= 5 && num > den
                ? lit(rat(num, den), `${Math.floor(num / den)}と${num % den}/${den}`)
                : F(num, den);
            a = f(n, d);
            b = f(m, e);
          }
          return arithmetic(id, op(k % 2 ? "*" : "/", a, b), FS);
        },
      ),
    ];
  }
  if (id === "G6-C07") return exprDomains("fraction");
  if (id === "G6-C08") {
    const ops: readonly ArithmeticOp[] = ["+", "-", "*", "/"];
    return ops.map((sign) =>
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
  }
  throw Error(`Generator missing: ${id}`);
}

export function domains(
  id: ChallengeId,
  options: ChallengeOptions = {},
): DomainSpec[] {
  const original = baseDomains(id, options);
  if (!KZWritten.ids.includes(id) || options.written === undefined) {
    return original;
  }
  const mode = options.written;
  if (!["none", "some", "mixed"].includes(mode)) {
    throw Error("筆算の条件をたしかめてね。");
  }
  const available = KZWritten.available(id, options.remainder || "mixed");
  if (mode !== "mixed" && !available.includes(mode)) {
    throw Error("この組合せでは問題を作れません。");
  }
  const modes: readonly ("none" | "some")[] =
    mode === "mixed" ? available : [mode];
  return original.flatMap((d) =>
    modes.flatMap((condition) => {
      if (
        ["carry", "no-carry"].includes(d.bucket) &&
        (d.bucket === "carry") !== (condition === "some")
      ) {
        return [];
      }
      if (d.bucket === "zero" && condition === "some") return [];
      if (
        ["G4-C04", "G4-C06"].includes(id) &&
        d.bucket === "none" &&
        condition === "some"
      ) {
        return [];
      }
      return [
        {
          ...d,
          bucket: `${d.bucket}:written-${condition}`,
          ...(id === "G5-C03"
            ? {
                sample: (r: Rng): bigint => {
                  const divisor = randInt(r, 1, 9999);
                  const stepVal = divisor / Number(gcd(divisor, 1000));
                  const dividend =
                    stepVal * randInt(r, 1, Math.floor(99999 / stepVal));
                  return BigInt(dividend - 1) + BigInt(divisor - 1) * 99999n;
                },
              }
            : {}),
          make: (values: number[]): Question | null => {
            const q = d.make(values);
            return q && KZWritten.classify(q).has === (condition === "some")
              ? q
              : null;
          },
        },
      ];
    }),
  );
}

export function decode(d: DomainSpec, rank: bigint): number[] {
  let cur = rank;
  return d.dims.map(([lo, hi]) => {
    const n = BigInt(hi - lo + 1);
    const v = Number(cur % n) + lo;
    cur /= n;
    return v;
  });
}

export function atRank(d: DomainSpec, rank: bigint): Question | null {
  try {
    const q = d.make(decode(d, rank));
    return q ? complete(q, d.bucket) : null;
  } catch {
    return null;
  }
}

function randomRank(d: DomainSpec, r: Rng): bigint {
  if (d.sample) return d.sample(r);
  let x = 0n;
  for (const [lo, hi] of d.dims) {
    x = x * BigInt(hi - lo + 1) + BigInt(randInt(r, 0, hi - lo));
  }
  return x % d.size;
}

export function createGenerator(seed = 1): GeneratorState {
  return { rngState: seed >>> 0 || 1, ids: {} };
}

export function generate(
  id: ChallengeId,
  options: ChallengeOptions = {},
  state: GeneratorState = createGenerator(),
): Question {
  if (!BY_ID[id]) throw Error("Unknown challenge");
  const ds = domains(id, options);
  const r = rng(state.rngState);
  const key = JSON.stringify([id, options]);
  const s = (state.ids[key] ||= { round: [], buckets: {}, last: null });
  if (!s.round.length) {
    s.round = shuffle(
      ds.flatMap((d, i) => Array<number>(d.weight || 1).fill(i)),
      r,
    );
  }
  const bi = s.round.shift();
  if (bi === undefined) throw Error("この条件では問題を作れません");
  const d = ds[bi];
  const b = (s.buckets[bi] ||= { used: [], cursor: "0", cycle: 0 });
  const used = new Set<string>(b.used);
  let q: Question | null = null;
  let rank: bigint | null = null;
  for (let i = 0; i < 128; i++) {
    const x = randomRank(d, r);
    const candidate = atRank(d, x);
    if (
      candidate &&
      candidate.canonicalKey !== undefined &&
      !used.has(candidate.canonicalKey) &&
      candidate.canonicalKey !== s.last
    ) {
      q = candidate;
      rank = x;
      break;
    }
  }
  if (!q) {
    let scanned = 0n;
    let x = BigInt(b.cursor);
    let repeat: { candidate: Question; x: bigint } | null = null;
    while (scanned < d.size) {
      const candidate = atRank(d, x);
      if (
        candidate &&
        candidate.canonicalKey !== undefined &&
        !used.has(candidate.canonicalKey)
      ) {
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
      let first: { candidate: Question; x: bigint } | null = null;
      for (let scanX = 0n; scanX < d.size; scanX++) {
        const candidate = atRank(d, scanX);
        if (candidate) {
          first ||= { candidate, x: scanX };
          if (candidate.canonicalKey !== s.last) {
            q = candidate;
            rank = scanX;
            break;
          }
        }
      }
      if (!q && first) {
        q = first.candidate;
        rank = first.x;
      }
      if (!q || rank === null) throw Error("この条件では問題を作れません");
    }
  }
  if (rank === null) throw Error("この条件では問題を作れません");
  const canonicalKey = q.canonicalKey || "";
  b.used.push(canonicalKey);
  b.cursor = String((rank + 1n) % d.size);
  s.last = canonicalKey;
  state.rngState = r.state;
  q.cycleId = b.cycle;
  return q;
}
