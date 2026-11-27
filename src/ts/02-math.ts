/* Exact BigInt rationals, PRNG, input normalization, judging, and shared math helpers. */
import { isRecord, specOf } from "./00-prelude.ts";
import type {
  AnswerSpec,
  ArithmeticOp,
  ChallengeSpec,
  CompareSymbol,
  ExprBinary,
  ExprLiteral,
  ExprNode,
  FractionForm,
  JudgeResult,
  NormalizedAnswer,
  NormalizedFraction,
  NumericInput,
  ParityValue,
  Question,
  QuestionValidation,
  QuotientExpected,
  Rational,
  RawAnswerInput,
  RawAnswerObject,
  RawFractionInput,
  Rng,
} from "../types/contracts.d.ts";

const abs = (n: bigint): bigint => (n < 0n ? -n : n);

export function gcd(
  a: number | bigint | string,
  b: number | bigint | string,
): bigint {
  let x = abs(BigInt(a));
  let y = abs(BigInt(b));
  while (y) {
    [x, y] = [y, x % y];
  }
  return x;
}

export const lcm = (
  a: number | bigint | string,
  b: number | bigint | string,
): bigint => (BigInt(a) / gcd(a, b)) * BigInt(b);

export function rat(
  n: number | bigint | string,
  d: number | bigint | string = 1,
): Rational {
  let num = BigInt(n);
  let den = BigInt(d);
  if (!den) throw Error("分母は0にできません");
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  return { n: String(num / g), d: String(den / g) };
}

export function number(s: NumericInput): Rational {
  if (s && typeof s === "object") return rat(s.n, s.d);
  const text = String(s);
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw Error("数字をたしかめてね");
  const [i, f = ""] = text.split(".");
  return rat(i + f, 10n ** BigInt(f.length));
}

export function calc(
  operator: ArithmeticOp,
  a: NumericInput,
  b: NumericInput,
): Rational {
  const av = number(a);
  const bv = number(b);
  const an = BigInt(av.n);
  const ad = BigInt(av.d);
  const bn = BigInt(bv.n);
  const bd = BigInt(bv.d);
  if (operator === "+") return rat(an * bd + bn * ad, ad * bd);
  if (operator === "-") return rat(an * bd - bn * ad, ad * bd);
  if (operator === "*") return rat(an * bn, ad * bd);
  if (operator === "/") return rat(an * bd, ad * bn);
  throw Error("Unknown operation");
}

export const cmp = (a: NumericInput, b: NumericInput): -1 | 0 | 1 => {
  const v = calc("-", a, b);
  return BigInt(v.n) < 0n ? -1 : BigInt(v.n) > 0n ? 1 : 0;
};

export const decimal = (coeff: number | bigint, scale: number): string => {
  const s = String(coeff).padStart(scale + 1, "0");
  return scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s;
};

export function decimalPlaces(a: NumericInput): number {
  let d = BigInt(number(a).d);
  let twos = 0;
  let fives = 0;
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

export function format(
  a: NumericInput,
  kind: "fraction" | "decimal" = "fraction",
): string {
  const v = number(a);
  if (v.d === "1") return v.n;
  if (kind === "decimal") {
    const s = decimalPlaces(v);
    if (!Number.isFinite(s)) throw Error("Non-terminating decimal");
    return decimal((BigInt(v.n) * 10n ** BigInt(s)) / BigInt(v.d), s)
      .replace(/0+$/, "")
      .replace(/\.$/, "");
  }
  return `${v.n}/${v.d}`;
}

export function roundExact(a: NumericInput, places: number): Rational {
  const v = number(a);
  const unit = 10n ** BigInt(Math.abs(places));
  const n = BigInt(v.n) * (places >= 0 ? unit : 1n);
  const d = BigInt(v.d) * (places < 0 ? unit : 1n);
  const rounded = (n * 2n + d) / (2n * d);
  return places >= 0 ? rat(rounded, unit) : rat(rounded * unit);
}

export const coefficient = (value: NumericInput, scale: number): bigint => {
  const v = number(value);
  return (BigInt(v.n) * 10n ** BigInt(scale)) / BigInt(v.d);
};

export interface AlignedWrittenDigits {
  scale: number;
  a: bigint;
  b: bigint;
  size: number;
  aa: number[];
  bb: number[];
}

export function alignWrittenDigits(
  av: Rational,
  bv: Rational,
  sa: number,
  sb: number,
): AlignedWrittenDigits {
  const scale = Math.max(sa, sb);
  const a = coefficient(av, scale);
  const b = coefficient(bv, scale);
  const size = Math.max(String(a).length, String(b).length, scale + 1);
  const aa = String(a).padStart(size, "0").split("").map(Number);
  const bb = String(b).padStart(size, "0").split("").map(Number);
  return { scale, a, b, size, aa, bb };
}

export const placeName = (column: number, scale = 0): string =>
  column < scale
    ? `小数第${scale - column}位`
    : `${["一", "十", "百", "千", "万"][column - scale] || 10 ** (column - scale)}の位`;

export const OP_SIGNS: Readonly<Record<ArithmeticOp, string>> = Object.freeze({
  "+": "＋",
  "-": "−",
  "*": "×",
  "/": "÷",
});

export const lit = (v: NumericInput, label?: string): ExprLiteral => ({
  value: number(v),
  ...(label ? { label } : {}),
});

export const op = (
  operator: ArithmeticOp,
  a: ExprNode,
  b: ExprNode,
  group = false,
): ExprBinary => ({
  op: operator,
  args: [a, b],
  group,
});

export function evaluate(ast: ExprNode): Rational {
  if (ast.value) return number(ast.value);
  const v = calc(ast.op, evaluate(ast.args[0]), evaluate(ast.args[1]));
  if (BigInt(v.n) < 0n) throw Error("Negative intermediate");
  return v;
}

export function expression(ast: ExprNode): string {
  if (ast.value) {
    return (
      ast.label ||
      format(ast.value, decimalPlaces(ast.value) <= 4 ? "decimal" : "fraction")
    );
  }
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
    .join(` ${OP_SIGNS[ast.op]} `);
  return ast.group ? `（${str}）` : str;
}

export function rng(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return {
    next(): number {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    },
    get state(): number {
      return s >>> 0;
    },
  };
}

export function shuffle<T>(a: readonly T[], r: Rng): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const randInt = (r: Rng, min: number, max: number): number =>
  min + Math.floor(r.next() * (max - min + 1));

export function carry(a: number, b: number): boolean {
  let c = 0;
  let found = false;
  let x = a;
  let y = b;
  while (x || y) {
    const t = (x % 10) + (y % 10) + c;
    c = t >= 10 ? 1 : 0;
    found ||= !!c;
    x = Math.floor(x / 10);
    y = Math.floor(y / 10);
  }
  return found;
}

export function borrow(a: number, b: number): boolean {
  let c = 0;
  let found = false;
  let x = a;
  let y = b;
  while (x || y) {
    c = (x % 10) - c < y % 10 ? 1 : 0;
    found ||= !!c;
    x = Math.floor(x / 10);
    y = Math.floor(y / 10);
  }
  return found;
}

export function isRational(v: unknown): v is Rational {
  return isRecord(v) && typeof v.n === "string" && typeof v.d === "string";
}

export function isQuotientExpected(v: unknown): v is QuotientExpected {
  return (
    isRecord(v) && typeof v.quotient === "string" && isRational(v.remainder)
  );
}

export function isRationalArray(v: unknown): v is Rational[] {
  return Array.isArray(v) && v.every((item) => isRational(item));
}

export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === "string");
}

export function isCompareSymbol(v: unknown): v is CompareSymbol {
  return v === "<" || v === "=" || v === ">";
}

export function isParityValue(v: unknown): v is ParityValue {
  return v === "even" || v === "odd";
}

export function isFractionForm(v: unknown): v is FractionForm {
  return v === "fraction" || v === "mixed" || v === "integer";
}

export function expectRational(v: unknown): Rational {
  if (!isRational(v)) throw Error("有理数の形式をたしかめてね。");
  return v;
}

export function expectQuotient(v: unknown): QuotientExpected {
  if (!isQuotientExpected(v)) throw Error("商とあまりの形式をたしかめてね。");
  return v;
}

export function expectNumeric(v: unknown): NumericInput {
  if (
    typeof v === "number" ||
    typeof v === "bigint" ||
    typeof v === "string" ||
    isRational(v)
  ) {
    return v;
  }
  throw Error("数字をたしかめてね");
}

export function answerText(q: Question): string {
  const v = q.expectedExactValue;
  const s = q.answerSpec;
  if (s.type === "compare") {
    const compareLabels: Readonly<Record<CompareSymbol, string>> = {
      "<": "＜（小さい）",
      ">": "＞（大きい）",
      "=": "＝（同じ）",
    };
    if (!isCompareSymbol(v)) throw Error("比べた答えをたしかめてね。");
    return compareLabels[v];
  }
  if (s.type === "parity") {
    return v === "even" ? "偶数（ぐうすう）" : "奇数（きすう）";
  }
  if (s.type === "quotient") {
    const qv = expectQuotient(v);
    return `${qv.quotient} あまり ${format(qv.remainder, "decimal")}`;
  }
  if (s.type === "common") {
    if (!isRationalArray(v)) throw Error("通分の答えをたしかめてね。");
    return v.map((f) => `${f.n}/${f.d}`).join(" と ");
  }
  if (s.type === "blocks" || s.type === "set") {
    if (!isStringArray(v)) throw Error("答えの並びをたしかめてね。");
    return v.join("、");
  }
  const rv = expectRational(v);
  if (
    s.type === "fraction" &&
    !s.form &&
    !s.reduced &&
    (q.displayDenominator || q.original)
  ) {
    const d = q.displayDenominator || q.original?.d || rv.d;
    return `${(BigInt(rv.n) * BigInt(d)) / BigInt(rv.d)}/${d}`;
  }
  if (s.type === "fraction" && s.denominator) {
    const d = BigInt(s.denominator);
    const n = (BigInt(rv.n) * d) / BigInt(rv.d);
    return s.form === "mixed" ? `${n / d}と${n % d}/${d}` : `${n}/${d}`;
  }
  return format(rv, s.type === "decimal" ? "decimal" : "fraction");
}

export function generalHint(q: Question): string {
  const id = q.challengeId;
  const ast = q.expressionAST;
  const early: Readonly<Record<string, string | undefined>> = {
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
  const fixedHint = early[id];
  if (fixedHint) return fixedHint;
  if (id === "G2-C08" && ast?.op) {
    return `${format(evaluate(ast.args[0]))}の だんを おもいだそう。1つぶんが、いくつぶん あるかな。`;
  }
  if (id === "G2-C10" && ast?.op) {
    return ast.op === "+"
      ? "ひくまえの かずを もとめるよ。のこった かずと、ひいた かずを たそう。"
      : "ぜんぶの かずから、わかっている かずを ひこう。";
  }
  if (id === "G3-C15" && ast?.op) {
    return ast.op === "*"
      ? "わられる数を求めるよ。わる数と商をかけよう。"
      : "かけ算とわり算のつながりを使い、分かっている数でわろう。";
  }
  if (["G3-N03", "G4-N03"].includes(id)) {
    const unit = ast?.op
      ? format(evaluate(ast.args[ast.op === "/" ? 1 : 0]), "decimal")
      : id === "G3-N03"
        ? "0.1"
        : "0.001";
    return `${unit}を1つ分として、何こ分かを数えよう。`;
  }
  if (id === "G5-N10" && q.original) {
    return q.original.d === "1"
      ? "整数は、分母を1にした分数で表せるよ。"
      : "小数点の右のけた数を見よう。1けたなら分母10、2けたなら100、3けたなら1000にするよ。";
  }
  if (id === "G4-C17") {
    return "かける順を入れかえる、まとめる、分けるとき、同じ数がどこにあるか見よう。";
  }
  if (q.task === "compare") {
    if (["G1-N01", "G2-N01", "G3-N01", "G4-N01"].includes(id)) {
      return "まず、けたの かずを くらべよう。同じなら、ひだりの くらいから くらべるよ。";
    }
    if (["G3-N04", "G4-N04"].includes(id)) {
      return "小数点をそろえて、大きい位からくらべよう。";
    }
    return id === "G3-N06"
      ? "分母が同じだから、分子の数をくらべよう。"
      : "分母をそろえて、同じ大きさの1つ分が何こあるかをくらべよう。";
  }
  if (q.task === "parity") return "2でわって あまりがあるかを考えよう。";
  if (q.task === "gcd") {
    return "両方の数の約数を書き、共通する数の中で一番大きいものを探そう。";
  }
  if (q.task === "divisors" && q.values) {
    return `${String(q.values[0])} を1から順にわって、わり切れる数を見つけよう。`;
  }
  if (q.task === "lcm" || q.task === "common") {
    return "それぞれの倍数を小さい順に書いて、はじめて同じになる数を見つけよう。";
  }
  if (q.task === "blocks") {
    return "位ごとに分けよう。空いている位にも0を書くよ。";
  }
  if (q.task === "round") {
    return "求める位の1つ下を見よう。5以上なら切り上げるよ。";
  }
  if (q.task === "reciprocal") {
    return "かけて1になる数を考えよう。帯分数は先に仮分数にするよ。";
  }
  if (q.task === "fraction") {
    return specOf(id).grade <= 2
      ? "おなじ おおきさに わけた ひとつぶんを 見てみよう。"
      : q.answerSpec.form === "mixed"
        ? "分子を分母でわり、整数の部分と残りに分けよう。"
        : q.answerSpec.reduced
          ? "分子と分母を同じ数でわり切れるかな。"
          : "同じ大きさの1つ分が、いくつあるか数えよう。";
  }
  if (q.unknown !== undefined) {
    return "□の場所を見よう。たし算とひき算、かけ算とわり算のつながりを使おう。";
  }
  if (q.roundOperands) {
    return "はじめに、それぞれの数を指定された位まで四捨五入しよう。";
  }
  if (!ast?.op) return "1つ分の大きさと、いくつ分かをたしかめよう。";
  if (ast.args.some((a) => Boolean(a.op))) {
    return "かっこの中が先。そのあと、かけ算・わり算から計算しよう。";
  }
  if (q.answerSpec.type === "fraction") {
    return ast.op === "/"
      ? "わる数を逆数にして、かけ算にしよう。"
      : ast.op === "*"
        ? "分子どうし、分母どうしをかけよう。途中で約分できるかな。"
        : "分母をそろえて、何こ分かを計算しよう。";
  }
  if (ast.op === "+") {
    return q.written
      ? ast.args.some((a) => decimalPlaces(evaluate(a)) > 0)
        ? "位と小数点をそろえて、一番右の位からたそう。"
        : "おなじ くらいを そろえて、いちの くらいから たそう。"
      : "10のまとまりを作れるかな。";
  }
  if (ast.op === "-") {
    return q.written
      ? "同じ位をそろえて、一番右の位からひこう。足りない位は左から借りよう。"
      : "10と のこりに分けて考えよう。";
  }
  if (ast.op === "*") {
    return "かける数を位ごとに分けよう。まず一の位からかけるよ。";
  }
  return decimalPlaces(evaluate(ast.args[1])) > 0
    ? "わる数が整数になるように、両方の小数点を同じだけ動かそう。"
    : "わる数が何こ入るか、九九を使って考えよう。";
}

export function normalizeInput(
  spec: AnswerSpec,
  raw: RawAnswerInput,
): NormalizedAnswer {
  const clean = (v: unknown): string =>
    String(v ?? "")
      .replace(/[０-９]/g, (s: string) => String(s.charCodeAt(0) - 65296))
      .replace(/．/g, ".")
      .trim();
  function numeric(v: unknown, decimalAllowed = false): Rational {
    const cleaned = clean(v);
    if (
      cleaned.length > 40 ||
      !(decimalAllowed ? /^\d+(?:\.\d+)?$/ : /^\d+$/).test(cleaned)
    ) {
      throw Error("数字をさいごまで入れてね。");
    }
    return number(cleaned);
  }
  function fraction(v: RawFractionInput): NormalizedFraction {
    const rawForm = v.form || "fraction";
    if (!isFractionForm(rawForm)) {
      throw Error("答えの形をえらんでね。");
    }
    const form: FractionForm = rawForm;
    if (form === "integer") {
      return { value: numeric(v.whole), form, n: "0", d: "1" };
    }
    const n = numeric(v.numerator).n;
    const d = numeric(v.denominator).n;
    if (d === "0") throw Error("分母は0にできません。");
    const w = form === "mixed" ? numeric(clean(v.whole) || "0").n : "0";
    if (form === "mixed" && BigInt(n) >= BigInt(d)) {
      throw Error("分数の部分を1より小さくしてね。");
    }
    return { value: rat(BigInt(w) * BigInt(d) + BigInt(n), d), form, n, d };
  }
  try {
    const input: RawAnswerObject =
      typeof raw === "object" && raw !== null
        ? raw
        : { value: raw === null || raw === undefined ? undefined : String(raw) };
    if (spec.type === "integer" || spec.type === "decimal") {
      return { value: numeric(input.value, spec.type === "decimal") };
    }
    if (spec.type === "fraction") return fraction(input);
    if (spec.type === "quotient") {
      return {
        quotient: numeric(input.quotient).n,
        remainder: numeric(input.remainder, !!spec.decimalRemainder),
      };
    }
    if (spec.type === "common") {
      return {
        values: [fraction(input.first || {}), fraction(input.second || {})],
      };
    }
    if (spec.type === "blocks") {
      const labels = spec.labels || [];
      return {
        values: labels.map((_, i) => numeric(input.values?.[i]).n),
      };
    }
    if (spec.type === "set") {
      const entries = (input.values || []).map((v) => numeric(v).n);
      if (clean(input["set-value"]) !== "") {
        entries.push(numeric(input["set-value"]).n);
      }
      if (!entries.length) throw Error("数を追加してね。");
      if (new Set<string>(entries).size !== entries.length) {
        throw Error("同じ数は1回だけ入れてね。");
      }
      return {
        values: entries.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)),
      };
    }
    if (spec.type === "compare") {
      if (!isCompareSymbol(input.value)) throw Error("答えをえらんでね。");
      return { value: input.value };
    }
    if (spec.type === "parity") {
      if (!isParityValue(input.value)) throw Error("答えをえらんでね。");
      return { value: input.value };
    }
    throw Error("入力をたしかめてね。");
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function judge(q: Question, p: NormalizedAnswer): JudgeResult {
  if (p.error) return { correct: false, inputError: p.error };
  const s = q.answerSpec;
  const v = q.expectedExactValue;
  const wrong = (reason: string): JudgeResult => ({ correct: false, reason });
  if (s.type === "fraction") {
    if (s.form && p.form !== s.form) return wrong("指定された形に直そう。");
    if (s.denominator && p.d !== s.denominator) {
      return wrong(`分母を${s.denominator}にしよう。`);
    }
    if (
      s.reduced &&
      p.n !== undefined &&
      p.d !== undefined &&
      gcd(p.n, p.d) !== 1n
    ) {
      return wrong("約分しよう。");
    }
  }
  if (s.type === "quotient") {
    const qv = expectQuotient(v);
    return {
      correct:
        p.quotient === qv.quotient &&
        p.remainder !== undefined &&
        cmp(p.remainder, qv.remainder) === 0,
    };
  }
  if (s.type === "common") {
    const rv = isRationalArray(v) ? v : [];
    const pv = p.values || [];
    return {
      correct:
        pv.length === rv.length &&
        pv.every(
          (f, i) =>
            typeof f !== "string" &&
            f.d === s.denominator &&
            cmp(f.value, number(rv[i])) === 0,
        ),
    };
  }
  if (s.type === "blocks" || s.type === "set") {
    return { correct: JSON.stringify(p.values) === JSON.stringify(v) };
  }
  if (s.type === "compare" || s.type === "parity") {
    return { correct: p.value === v };
  }
  return {
    correct:
      isRational(p.value) && isRational(v) && cmp(p.value, v) === 0,
  };
}

export function validateQuestion(
  spec: ChallengeSpec,
  q: Question,
): QuestionValidation {
  const errors: string[] = [];
  if (q.challengeId !== spec.id) errors.push("id");
  const ast = q.expressionAST;
  let v: Rational | undefined;
  try {
    if (ast) v = evaluate(ast);
  } catch {
    errors.push("arithmetic");
  }
  if (!q.prompt || !q.answerSpec || !q.solutionTrace?.length) {
    errors.push("incomplete");
  }
  if (ast?.op && ast.args.every((a) => Boolean(a.value))) {
    const a = Number(evaluate(ast.args[0]).n) / Number(evaluate(ast.args[0]).d);
    const b = Number(evaluate(ast.args[1]).n) / Number(evaluate(ast.args[1]).d);
    const id = spec.id;
    if (
      id === "G2-C05" &&
      (a < 100 || a > 999 || b < 1 || b > 99 || (a % 100) + b >= 100)
    ) {
      errors.push("range");
    }
    if (
      id === "G2-C06" &&
      (a < 100 || a > 999 || b < 1 || b > 99 || a % 100 < b)
    ) {
      errors.push("range");
    }
    if (
      id === "G3-C10" &&
      (a < 10 ||
        a > 99 ||
        b < 2 ||
        b > 9 ||
        Math.floor(a / 10) % b ||
        (a % 10) % b ||
        a / b < 10)
    ) {
      errors.push("range");
    }
    if (
      id === "G1-C03" &&
      (a < 1 || a > 9 || b < 1 || b > 9 || a + b < 11 || a + b > 18)
    ) {
      errors.push("range");
    }
    if (
      id === "G1-C05" &&
      (a < 11 || a > 18 || b < 1 || b > 9 || b <= a % 10)
    ) {
      errors.push("range");
    }
    if (q.unknown !== undefined && ast.op === "*" && (a === 0 || b === 0)) {
      errors.push("nonunique");
    }
  }
  if (q.task === "reciprocal" && q.values && number(q.values[0]).n === "0") {
    errors.push("zero");
  }
  if (v && BigInt(v.n) < 0n) errors.push("negative");
  return { valid: errors.length === 0, errors };
}
