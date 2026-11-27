/* Written traces, solution builders, hints, and question completion. */
import {
  answerText,
  calc,
  cmp,
  coefficient,
  decimal,
  decimalPlaces,
  evaluate,
  expectNumeric,
  expectQuotient,
  expectRational,
  expression,
  format,
  gcd,
  isRationalArray,
  lcm,
  number,
  placeName,
  rat,
  roundExact,
} from "./02-math.ts";
import { KZTeaching } from "./04-teaching.ts";
import type {
  AnswerSpec,
  ChallengeId,
  CompareSymbol,
  ExprNode,
  Question,
  Rational,
  SolutionStep,
  TaskKind,
} from "../types/contracts.d.ts";

const LONG_ARITHMETIC =
  /^(G2-C0[1-6]|G3-C0[1-8]|G3-C1[12]|G4-C(?:0[4-9]|1[012])|G5-C0[1-5])$/;

const step = (text: string, extra: Partial<SolutionStep> = {}): SolutionStep => ({
  kind: "text",
  text,
  ...extra,
});

export function writtenTrace(q: Question): SolutionStep[] {
  const ast = q.expressionAST;
  if (!ast?.op || ast.args.some((a) => Boolean(a.op))) return [];
  const av = evaluate(ast.args[0]);
  const bv = evaluate(ast.args[1]);
  const sa = decimalPlaces(av);
  const sb = decimalPlaces(bv);
  if (!Number.isFinite(sa + sb)) return [];
  const trace: SolutionStep[] = [];
  const row = (
    digits: string,
    text: string,
    extra: Partial<SolutionStep> = {},
  ): number => trace.push({ kind: "digits", digits: String(digits), text, ...extra });
  if (ast.op === "+" || ast.op === "-") {
    const scale = Math.max(sa, sb);
    const a = coefficient(av, scale);
    const b = coefficient(bv, scale);
    const size = Math.max(String(a).length, String(b).length, scale + 1);
    const aa = String(a).padStart(size, "0").split("").map(Number);
    const bb = String(b).padStart(size, "0").split("").map(Number);
    row(decimal(a, scale), scale ? "位と小数点をそろえる" : "同じ位をそろえる");
    row(decimal(b, scale), "下の数", {
      sign: ast.op === "+" ? "＋" : "−",
      underline: true,
    });
    let carryIn = 0;
    const out = Array<number>(size).fill(0);
    const carries = Array<string>(size + 1).fill("");
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
    row(decimal(BigInt(out.join("")), scale), "こたえ", { line: true });
  } else if (ast.op === "*") {
    const a = coefficient(av, sa);
    const b = coefficient(bv, sb);
    row(
      String(a),
      sa + sb ? "小数点をいったん外して計算" : "一の位から、位ごとにかける",
    );
    row(String(b), "かける数", { sign: "×", underline: true });
    const digits = String(b).split("").reverse();
    digits.forEach((digit, shift) => {
      if (shift) {
        trace.push(
          step(
            `${placeName(shift)}の${digit}は${BigInt(digit) * 10n ** BigInt(shift)}。かけた答えは${shift}けた左にずらして書く。`,
          ),
        );
      }
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
    if (sa + sb) {
      trace.push(
        step(
          `小数は合わせて${sa + sb}けた。右から${sa + sb}けた目に小数点を戻す。`,
        ),
      );
    }
    if (sa + sb) {
      row(
        decimal(a * b, sa + sb),
        `小数点を${sa + sb}けた戻す。末尾の0は取っても同じ大きさ。`,
        { line: true, decimalResult: true },
      );
    }
  } else {
    const movedA = calc("*", av, rat(10n ** BigInt(sb)));
    const movedD = coefficient(bv, sb);
    if (sb) {
      trace.push(
        step(
          `両方を${10n ** BigInt(sb)}倍：${format(av, "decimal")}÷${format(bv, "decimal")} ＝ ${format(movedA, "decimal")}÷${movedD}`,
        ),
      );
    }
    const quotient = q.answerSpec.type === "quotient" || Boolean(q.integerQuotient);
    const quotientPlaces = quotient
      ? 0
      : q.roundPlaces !== undefined
        ? q.roundPlaces + 1
        : decimalPlaces(evaluate(ast));
    const digits = format(movedA, "decimal").split(".");
    const tail = (digits[1] || "")
      .padEnd(quotientPlaces, "0")
      .slice(0, quotientPlaces);
    const untouched = quotient ? digits[1] || "" : "";
    const dividend = `${digits[0]}${tail || untouched ? "." + (tail || untouched) : ""}`;
    let remainder = 0n;
    let started = false;
    let answer = "";
    const source = digits[0] + tail;
    row(dividend, "わり算の筆算", { divisor: String(movedD), dividend });
    for (let i = 0; i < source.length; i++) {
      const partial = remainder * 10n + BigInt(source[i]);
      const qd = partial / movedD;
      const prod = qd * movedD;
      const rem = partial - prod;
      if (movedD >= 10n && partial >= movedD) {
        const place = 10n ** BigInt(String(movedD).length - 1);
        const leading = (movedD / place) * place;
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
    if (untouched) {
      row(
        `${remainder}.${untouched}`,
        "商は整数まで。小数部分を合わせたあまり。",
        { remainder: true },
      );
    }
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
    if (q.answerSpec.type === "quotient") {
      const qv = expectQuotient(q.expectedExactValue);
      trace.push(
        step(
          `${sa || sb ? "余りの小数点は元の位へ。" : "たしかめ："}${qv.quotient}×${format(bv, "decimal")}＋${format(qv.remainder, "decimal")}＝${format(av, "decimal")}`,
        ),
      );
    }
  }
  return trace;
}

export function buildHint(q: Question): string {
  return KZTeaching.hint(q);
}

export function buildSolution(q: Question): SolutionStep[] {
  if (!q.written) return KZTeaching.explain(q);
  const t: SolutionStep[] = [];
  if (q.task === "arithmetic" && q.expressionAST) {
    const id = q.challengeId;
    const ast = q.expressionAST;
    let elementaryExplanation = false;
    if (
      ast.op &&
      ast.op !== "/" &&
      ["G1-C02", "G1-C03", "G1-C04", "G1-C05", "G1-C09", "G2-C08"].includes(id)
    ) {
      const a = Number(evaluate(ast.args[0]).n);
      const b = Number(evaluate(ast.args[1]).n);
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
      if (ast.op === "*") {
        t.push(step(Array<number>(b).fill(a).join("＋") + `＝${a * b}`));
      }
    }
    if (id === "G1-N02" || id === "G2-N02") {
      const v = BigInt(expectRational(q.expectedExactValue).n);
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
        ast.op === "/"
          ? expectRational(q.expectedExactValue)
          : evaluate(ast.args[1]);
      const total =
        ast.op === "/"
          ? evaluate(ast.args[0])
          : expectRational(q.expectedExactValue);
      t.push(
        step(
          `1は${format(unit, "decimal")}が${unit.d}こ。${format(total, "decimal")}は${format(unit, "decimal")}が${format(count)}こ分。`,
        ),
      );
      elementaryExplanation = true;
    }
    if (id === "G3-C09" && q.answerSpec.type === "quotient" && ast.op) {
      const a = evaluate(ast.args[0]);
      const b = evaluate(ast.args[1]);
      const v = expectQuotient(q.expectedExactValue);
      const product = calc("*", b, v.quotient);
      t.push(
        step(
          `${format(b)}×${v.quotient}＝${format(product)}。${format(a)}−${format(product)}＝${format(v.remainder)}。あまり${format(v.remainder)}は${format(b)}より小さい。`,
        ),
      );
      elementaryExplanation = true;
    }
    if (["G2-C07", "G2-C09", "G3-C10"].includes(id) && ast.op) {
      const a = Number(evaluate(ast.args[0]).n);
      const b = Number(evaluate(ast.args[1]).n);
      if (id === "G2-C07") {
        const expN = Number(expectRational(q.expectedExactValue).n);
        t.push(
          step(
            `100のまとまりで見ると、${a / 100}${ast.op === "+" ? "＋" : "−"}${b / 100}＝${expN / 100}。100が${expN / 100}こ。`,
          ),
        );
      }
      if (id === "G2-C09") {
        t.push(
          step(
            `${a}を10と${a - 10}に分ける。10×${b}＝${10 * b}、${a - 10}×${b}＝${(a - 10) * b}。${10 * b}＋${(a - 10) * b}＝${a * b}。`,
          ),
        );
      }
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
    if (id === "G5-N12" && ast.op) {
      const a = evaluate(ast.args[0]).n;
      const b = evaluate(ast.args[1]).n;
      const g = gcd(a, b);
      t.push(step(`${a}÷${b}は、${a}を${b}等分した大きさなので${a}/${b}。`));
      if (g > 1n) {
        t.push(
          step(`分子と分母を${g}でわる：${BigInt(a) / g}/${BigInt(b) / g}。`),
        );
      }
      elementaryExplanation = true;
    }
    if (q.sequence) {
      t.push(step(`1ずつ ふえるよ。${q.sequence.join(" → ")} のじゅんばん。`));
    }
    if (id === "G4-N05" && q.diagram) {
      const [[n, d], [nextN, nextD]] = q.diagram;
      const factor = nextD / d;
      t.push(
        step(
          `分母は${d}×${factor}＝${nextD}。分子も同じ${factor}倍にする：${n}×${factor}＝${nextN}。${n}/${d}＝${nextN}/${nextD}。`,
        ),
      );
      elementaryExplanation = true;
    }
    if (q.unitFraction) {
      t.push(
        step(
          `1/${q.unitFraction.d} が${q.unitFraction.n}こで ${q.unitFraction.n}/${q.unitFraction.d}。図のぬったところを数えよう。`,
        ),
      );
    }
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
    if (!ast.op && q.challengeId === "G5-N11") {
      const v = ast.value;
      t.push(
        step(
          `${v.n}÷${v.d}＝${format(v, "decimal")}。分子を分母でわると小数になる。`,
        ),
      );
    }
    if (q.roundOperands) {
      q.roundOperands.forEach((v) =>
        t.push(
          step(
            `${v.original} → ${format(roundExact(v.original, v.places))}（指定の位まで）`,
          ),
        ),
      );
    }
    if (q.challengeId === "G1-C03" && ast.op) {
      const a = Number(evaluate(ast.args[0]).n);
      const b = Number(evaluate(ast.args[1]).n);
      const toTen = 10 - a;
      t.push(
        step(
          `${a}＋${toTen}＝10。${b}は${toTen}と${b - toTen}。10＋${b - toTen}＝${a + b}`,
        ),
      );
    }
    if (q.challengeId === "G1-C05" && ast.op) {
      const a = Number(evaluate(ast.args[0]).n);
      const b = Number(evaluate(ast.args[1]).n);
      t.push(
        step(
          `${a}は10と${a - 10}。10−${b}＝${10 - b}。${10 - b}＋${a - 10}＝${a - b}`,
        ),
      );
    }
    const walk = (node: ExprNode): void => {
      if (!node.op) return;
      node.args.forEach(walk);
      const a = evaluate(node.args[0]);
      const b = evaluate(node.args[1]);
      if (
        q.answerSpec.type === "fraction" &&
        (a.d !== "1" ||
          b.d !== "1" ||
          node.args.some((x) => x.label?.includes("/")))
      ) {
        for (const child of node.args) {
          if (child.label?.includes("と")) {
            t.push(
              step(
                `${child.label} ＝ ${q.displayDenominator ? `${(BigInt(evaluate(child).n) * BigInt(q.displayDenominator)) / BigInt(evaluate(child).d)}/${q.displayDenominator}` : format(evaluate(child))}（仮分数にする）`,
              ),
            );
          }
        }
        if (node.op === "+" || node.op === "-") {
          const d = q.displayDenominator
            ? BigInt(q.displayDenominator)
            : lcm(a.d, b.d);
          t.push(
            step(
              `${q.displayDenominator ? `分母${d}はそのまま、分子を計算する` : `分母を${d}にそろえる`}：${(BigInt(a.n) * d) / BigInt(a.d)}/${d} ${node.op === "+" ? "＋" : "−"} ${(BigInt(b.n) * d) / BigInt(b.d)}/${d}`,
            ),
          );
        }
        if (node.op === "/") {
          t.push(step(`わる数の逆数${format(calc("/", 1, b))}をかける。`));
        }
      }
      const value = evaluate(node);
      if (q.answerSpec.reduced && q.answerSpec.type === "fraction") {
        const common = lcm(a.d, b.d);
        const n =
          node.op === "+" || node.op === "-"
            ? (BigInt(a.n) * common) / BigInt(a.d) +
              ((node.op === "+" ? 1n : -1n) * BigInt(b.n) * common) /
                BigInt(b.d)
            : BigInt(a.n) * BigInt(node.op === "*" ? b.n : b.d);
        const d =
          node.op === "+" || node.op === "-"
            ? common
            : BigInt(a.d) * BigInt(node.op === "*" ? b.d : b.n);
        const g = gcd(n, d);
        if (g > 1n) {
          t.push(step(`${n}/${d} の分子と分母を${g}でわる → ${format(value)}。`));
        }
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
        step(`${expression(node)} ＝ ${label}`, {
          value,
          check: { op: node.op, a, b, result: value },
        }),
      );
    };
    if (q.written) t.push(...writtenTrace(q));
    else if (!elementaryExplanation) walk(ast);
    if (q.roundPlaces !== undefined) {
      t.push(
        step(`小数第${q.roundPlaces + 1}位を見て、5以上なら切り上げる。`),
      );
    }
  } else if (q.task === "compare" && q.values) {
    const a = expectNumeric(q.values[0]);
    const b = expectNumeric(q.values[1]);
    if (["G1-N01", "G2-N01", "G3-N01", "G4-N01"].includes(q.challengeId)) {
      t.push(
        step(
          `けたの かずを みよう。同じなら、左の大きいくらいから くらべよう。${format(a)} と ${format(b)}。`,
        ),
      );
    } else if (["G3-N04", "G4-N04"].includes(q.challengeId)) {
      const places = Math.max(decimalPlaces(a), decimalPlaces(b));
      const padded = (v: Rational | string | number | bigint): string => {
        const [i, f = ""] = format(v, "decimal").split(".");
        return i + (places ? "." + f.padEnd(places, "0") : "");
      };
      t.push(
        step(
          `小数点をそろえる：${padded(a)} と ${padded(b)}。左の大きい位からくらべる。`,
        ),
      );
    } else if (q.challengeId === "G3-N06" && q.labels) {
      t.push(
        step(`分母が同じなので、分子をくらべる。${q.labels.join(" と ")}。`),
      );
    } else {
      const ra = number(a);
      const rb = number(b);
      const d = lcm(ra.d, rb.d);
      t.push(
        step(
          `同じ1/${d}のまとまりで見ると、${(BigInt(ra.n) * d) / BigInt(ra.d)} と ${(BigInt(rb.n) * d) / BigInt(rb.d)}。`,
        ),
      );
    }
  } else if (
    (q.task === "divisors" || q.task === "gcd" || q.task === "lcm") &&
    q.values
  ) {
    const ds = (n: string | number): number[] =>
      Array.from({ length: Number(n) }, (_, i) => i + 1).filter(
        (i) => Number(n) % i === 0,
      );
    q.values.forEach((rawN) => {
      const n = typeof rawN === "object" ? rawN.n : rawN;
      t.push(
        step(
          q.task === "lcm"
            ? `${n}の倍数：${Array.from({ length: Number(expectRational(q.expectedExactValue).n) / Number(n) }, (_, i) => Number(n) * (i + 1)).join("、")}`
            : `${n}の約数：${ds(n).join("、")}`,
        ),
      );
    });
  } else if (q.task === "common" && q.values && q.answerSpec.denominator) {
    const expArr = isRationalArray(q.expectedExactValue)
      ? q.expectedExactValue
      : [];
    const denom = BigInt(q.answerSpec.denominator);
    q.values.forEach((rawV, i) => {
      const v = expectRational(rawV);
      t.push(
        step(
          `${v.n}/${v.d} の分子・分母を${denom / BigInt(v.d)}倍 → ${expArr[i].n}/${expArr[i].d}`,
        ),
      );
    });
  } else if (q.task === "fraction" && q.original) {
    if (q.challengeId === "G5-N10") {
      const value = format(q.original, "decimal");
      const places = (value.split(".")[1] || "").length;
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
      const n = BigInt(q.original.n);
      const d = BigInt(q.original.d);
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
  } else if (q.task === "parity" && q.values) {
    const v0 = typeof q.values[0] === "object" ? q.values[0].n : q.values[0];
    t.push(step(`${v0}÷2のあまりは${BigInt(v0) % 2n}。あまり0なら偶数。`));
  } else if (q.task === "reciprocal" && q.values) {
    t.push(
      step(
        `${format(expectNumeric(q.values[0]))} の分子と分母を入れかえる。かけて1になる。`,
      ),
    );
  } else if (q.task === "round" && q.values && q.places !== undefined) {
    const v0 = typeof q.values[0] === "object" ? q.values[0].n : q.values[0];
    t.push(
      step(
        `1つ下の位は${(BigInt(v0) / 10n ** BigInt(-q.places - 1)) % 10n}。5以上なら切り上げる。`,
      ),
    );
  } else if (q.task === "blocks" && q.values && q.answerSpec.labels) {
    const vals = q.values;
    t.push(
      step(
        q.answerSpec.labels
          .map((l, i) => `${l}は${String(vals[i])}こ`)
          .join("、"),
      ),
    );
  }
  t.push({ kind: "answer", text: `こたえ：${answerText(q)}` });
  return t;
}

export function arithmetic(
  id: ChallengeId,
  ast: ExprNode,
  spec: AnswerSpec = { type: "integer" },
  extra: Partial<Question> = {},
): Question {
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

export function special(
  id: ChallengeId,
  task: TaskKind,
  values: (Rational | string | number)[],
  spec: AnswerSpec,
  extra: Partial<Question> = {},
): Question {
  return { challengeId: id, task, values, answerSpec: spec, ...extra };
}

export function complete(q: Question, bucket = "standard"): Question {
  const id = q.challengeId;
  if (q.task === "arithmetic" && q.expressionAST) {
    q.expectedExactValue = evaluate(q.expressionAST);
  }
  q.conditionBucket = bucket;
  q.written = LONG_ARITHMETIC.test(id) && q.task === "arithmetic";
  if (q.task === "compare" && q.values) {
    const symbols: readonly CompareSymbol[] = ["<", "=", ">"];
    const v0 = expectNumeric(q.values[0]);
    const v1 = expectNumeric(q.values[1]);
    q.expectedExactValue = symbols[cmp(v0, v1) + 1];
    q.prompt = `${q.labels?.[0] || format(v0)} □ ${q.labels?.[1] || format(v1)}`;
  }
  if (q.task === "parity" && q.values) {
    const v0 = typeof q.values[0] === "object" ? q.values[0].n : q.values[0];
    q.expectedExactValue = BigInt(v0) % 2n === 0n ? "even" : "odd";
    q.prompt = `${v0} は 偶数（ぐうすう）？ 奇数（きすう）？`;
  }
  if (q.task === "divisors" && q.values) {
    const n = Number(q.values[0]);
    q.expectedExactValue = Array.from({ length: n }, (_, i) => i + 1)
      .filter((i) => n % i === 0)
      .map(String);
    q.prompt = `${n} の正の約数を全部見つけよう`;
  }
  if ((q.task === "gcd" || q.task === "lcm") && q.values) {
    const v0 = typeof q.values[0] === "object" ? q.values[0].n : q.values[0];
    const v1 = typeof q.values[1] === "object" ? q.values[1].n : q.values[1];
    q.expectedExactValue = rat(
      q.task === "gcd" ? gcd(v0, v1) : lcm(v0, v1),
    );
    q.prompt = `${q.values.join(" と ")} の${q.task === "gcd" ? "最大公約数" : "最小公倍数"}`;
  }
  if (q.task === "round" && q.values && q.places !== undefined) {
    const v0 = expectNumeric(q.values[0]);
    q.expectedExactValue = roundExact(v0, q.places);
    const placeLabels: Readonly<Record<number, string>> = {
      1: "十",
      2: "百",
      3: "千",
      4: "万",
    };
    q.prompt = `${String(q.values[0])} を${placeLabels[-q.places]}の位まで四捨五入`;
  }
  if (q.task === "fraction" && q.values) {
    q.expectedExactValue = number(q.values[0]);
  }
  if (q.task === "reciprocal" && q.values && q.labels) {
    q.expectedExactValue = calc("/", 1, q.values[0]);
    q.prompt = `${q.labels[0]} の逆数を求めよう`;
  }
  if (q.task === "common" && q.values && q.labels) {
    const r0 = expectRational(q.values[0]);
    const r1 = expectRational(q.values[1]);
    const d = lcm(r0.d, r1.d);
    q.answerSpec.denominator = String(d);
    q.expectedExactValue = [r0, r1].map((v) => ({
      n: String((BigInt(v.n) * d) / BigInt(v.d)),
      d: String(d),
    }));
    q.prompt = `${q.labels.join(" と ")} を、最小公倍数を分母にして通分`;
  }
  if (
    q.task === "arithmetic" &&
    q.answerSpec.type === "quotient" &&
    q.expressionAST?.op
  ) {
    const a = evaluate(q.expressionAST.args[0]);
    const b = evaluate(q.expressionAST.args[1]);
    const v = calc("/", a, b);
    const quotient = BigInt(v.n) / BigInt(v.d);
    q.expectedExactValue = {
      quotient: String(quotient),
      remainder: calc("-", a, calc("*", b, rat(quotient))),
    };
    q.prompt = expression(q.expressionAST) + "（商は整数まで）";
  }
  if (
    q.task === "arithmetic" &&
    q.roundPlaces !== undefined &&
    q.expressionAST
  ) {
    q.expectedExactValue = roundExact(evaluate(q.expressionAST), q.roundPlaces);
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
