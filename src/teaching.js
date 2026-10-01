/* Chronological teaching states. Each state is complete, so going back restores every mark. */
const KZTeaching = (() => {
  const clone = KZ.clone;
  const places = (value) =>
    (KZ.format(value, "decimal").split(".")[1] || "").length;
  const coefficient = (value, scale) =>
    (BigInt(value.n) * 10n ** BigInt(scale)) / BigInt(value.d);
  const decimal = (value, scale) => {
    const s = String(value).padStart(scale + 1, "0");
    return scale ? s.slice(0, -scale) + "." + s.slice(-scale) : s;
  };
  const place = (column, scale = 0) =>
    column < scale
      ? `小数第${scale - column}位`
      : `${["一", "十", "百", "千", "万"][column - scale] || 10 ** (column - scale)}の位`;
  function steps(q) {
    if (!q.written)
      return q.solutionTrace
        .filter((t) => !["digits", "borrow"].includes(t.kind))
        .map(clone);
    const ast = q.expressionAST;
    const av = KZ.evaluate(ast.args[0]),
      bv = KZ.evaluate(ast.args[1]);
    const sa = places(av),
      sb = places(bv);
    const result = [],
      board = { op: ast.op, cols: 2, rows: [] };
    const push = (text, check) =>
      result.push({
        text,
        kind: "text",
        board: clone(board),
        ...(check ? { check } : {}),
      });
    const blank = () => Array(board.cols).fill("");
    const mark = (row, column, value, crossed = false) => {
      row.annotations ||= {};
      row.annotations[column] = { value: String(value), crossed };
    };
    if (["+", "-"].includes(ast.op)) {
      const scale = Math.max(sa, sb),
        a = coefficient(av, scale),
        b = coefficient(bv, scale);
      const size = Math.max(String(a).length, String(b).length, scale + 1);
      const aa = String(a).padStart(size, "0").split("").map(Number);
      const bb = String(b).padStart(size, "0").split("").map(Number);
      board.cols =
        size + (ast.op === "+" && String(a + b).length > size ? 1 : 0);
      const offset = board.cols - size;
      const top = { digits: decimal(a, scale) },
        answer = { digits: blank(), line: true };
      if (scale) answer.points = [board.cols - scale - 1];
      board.rows = [
        top,
        {
          digits: decimal(b, scale),
          sign: ast.op === "+" ? "＋" : "−",
          underline: true,
        },
        answer,
      ];
      push(
        scale
          ? "小数点と同じ位をそろえる。"
          : "同じ位をそろえ、一の位から計算する。",
      );
      let carry = 0;
      for (let i = size - 1; i >= 0; i--) {
        const col = offset + i;
        if (ast.op === "-") {
          if (aa[i] < bb[i]) {
            let j = i - 1;
            while (aa[j] === 0) j--;
            if (j < 0) throw Error("Teaching borrow underflow");
            // Across zeros, move one place at a time; old states never become extra rows.
            for (let k = j; k < i; k++) {
              aa[k]--;
              aa[k + 1] += 10;
              mark(top, offset + k, aa[k], true);
              mark(top, offset + k + 1, aa[k + 1], true);
              push(
                `${place(size - k - 1, scale)}から1を借り、${place(size - k - 2, scale)}を${aa[k + 1]}にする。`,
              );
            }
          }
          const value = aa[i] - bb[i];
          answer.digits[col] = String(value);
          push(
            `${place(size - i - 1, scale)}：${aa[i]}−${bb[i]}＝${value}。${value}を書く。`,
            {
              op: "-",
              a: String(aa[i]),
              b: String(bb[i]),
              result: String(value),
            },
          );
        } else {
          const sum = aa[i] + bb[i] + carry,
            previous = carry;
          answer.digits[col] = String(sum % 10);
          carry = Math.floor(sum / 10);
          if (carry) mark(top, col - 1, carry);
          push(
            `${place(size - i - 1, scale)}：${aa[i]}＋${bb[i]}${previous ? "＋" + previous : ""}＝${sum}。${sum % 10}を書き、${carry ? "1を左の位へくり上げる。" : "次の位へ進む。"}`,
            {
              op: "+",
              a: String(aa[i] + bb[i]),
              b: String(previous),
              result: String(sum),
            },
          );
        }
      }
      if (carry) {
        answer.digits[0] = String(carry);
        push(`左の位に、くり上がった${carry}を書く。`);
      }
      answer.digits = decimal(ast.op === "+" ? a + b : a - b, scale);
    } else if (ast.op === "*") {
      const a = coefficient(av, sa),
        b = coefficient(bv, sb),
        product = a * b;
      const aa = String(a).split("").reverse().map(Number),
        bb = String(b).split("").reverse().map(Number);
      board.cols = Math.max(
        String(a).length,
        String(b).length,
        String(product).length,
        sa + sb + 1,
      );
      const top = { digits: KZ.format(av, "decimal") };
      board.rows = [
        top,
        { digits: KZ.format(bv, "decimal"), sign: "×", underline: true },
      ];
      push(
        sa + sb
          ? "小数点を残して位をそろえる。まず整数と同じようにかける。"
          : "一の位から、位ごとにかける。",
      );
      const partials = [];
      for (let shift = 0; shift < bb.length; shift++) {
        top.annotations = {};
        const row = { digits: blank(), shift, line: shift === 0 };
        board.rows.push(row);
        partials.push(row);
        if (shift)
          push(
            `${place(shift)}の${bb[shift]}をかける。答えは${shift}けた左から書く。`,
          );
        let carry = 0;
        for (let i = 0; i < aa.length; i++) {
          const value = aa[i] * bb[shift] + carry,
            previous = carry;
          const col = board.cols - 1 - i - shift;
          row.digits[col] = String(value % 10);
          carry = Math.floor(value / 10);
          if (carry && i + 1 < aa.length) mark(top, board.cols - 2 - i, carry);
          if (i + 1 === aa.length && carry) row.digits[col - 1] = String(carry);
          if (i + 1 === aa.length) {
            // Keep one zero for a zero partial product, and omit other leading zeros.
            let first = row.digits.findIndex((v) => v !== "" && v !== "0");
            if (first < 0) first = row.digits.findLastIndex((v) => v !== "");
            for (let column = 0; column < first; column++)
              row.digits[column] = "";
          }
          push(
            `${aa[i]}×${bb[shift]}${previous ? "＋" + previous : ""}＝${value}。${value % 10}を書く。${carry ? carry + "を左の位へくり上げる。" : ""}`,
            {
              op: "+",
              a: String(aa[i] * bb[shift]),
              b: String(previous),
              result: String(value),
            },
          );
        }
      }
      top.annotations = {};
      let answer;
      if (partials.length === 1) answer = partials[0];
      else {
        answer = { digits: blank(), line: true };
        board.rows.push(answer);
        let carry = 0;
        for (let col = board.cols - 1; col >= 0; col--) {
          const add = partials.reduce(
              (sum, row) => sum + Number(row.digits[col] || 0),
              0,
            ),
            previous = carry,
            sum = add + carry;
          answer.digits[col] = String(sum % 10);
          carry = Math.floor(sum / 10);
          if (carry && col > 0) mark(partials[0], col - 1, carry);
          push(
            `${place(board.cols - col - 1)}の部分積をたす。${add}${previous ? "＋" + previous : ""}＝${sum}。${sum % 10}を書く。`,
            {
              op: "+",
              a: String(add),
              b: String(previous),
              result: String(sum),
            },
          );
        }
      }
      answer.digits = String(product);
      if (sa + sb) {
        answer.digits = decimal(product, sa + sb);
        push(
          `小数は合わせて${sa + sb}けた。答えの右から${sa + sb}けた目に小数点を付ける。`,
        );
      }
    } else {
      const movedA = KZ.calc("*", av, KZ.rat(10n ** BigInt(sb))),
        divisor = coefficient(bv, sb);
      const integerQuotient =
        q.answerSpec.type === "quotient" || q.integerQuotient;
      const quotientPlaces = integerQuotient
        ? 0
        : q.roundPlaces !== undefined
          ? q.roundPlaces + 1
          : KZ.decimalPlaces(KZ.evaluate(ast));
      const parts = KZ.format(movedA, "decimal").split(".");
      const tail = (parts[1] || "")
        .padEnd(quotientPlaces, "0")
        .slice(0, quotientPlaces);
      const untouched = integerQuotient ? parts[1] || "" : "";
      const source = parts[0] + tail;
      const dividend =
        parts[0] + (tail || untouched ? "." + (tail || untouched) : "");
      board.cols = Math.max(2, source.length + untouched.length);
      const offset = board.cols - source.length - untouched.length;
      const quotient = { digits: blank(), quotient: true };
      if (tail) quotient.points = [offset + parts[0].length - 1];
      board.rows = [
        quotient,
        { digits: dividend, dividend, divisor: String(divisor) },
      ];
      push(
        sb
          ? `両方の小数点を${sb}けた右へ動かす。${KZ.format(av, "decimal")}÷${KZ.format(bv, "decimal")}＝${KZ.format(movedA, "decimal")}÷${divisor}。`
          : "わる数と、わられる数を書き、左の位から計算する。",
      );
      let remainder = 0n,
        started = false,
        previousRow = null;
      for (let i = 0; i < source.length; i++) {
        const partial = remainder * 10n + BigInt(source[i]),
          digit = partial / divisor,
          product = digit * divisor,
          rem = partial - product;
        const trailing = source.length - i - 1 + untouched.length;
        if (started && previousRow) {
          previousRow.digits = String(partial);
          previousRow.trailing = trailing;
          push(`次の数字${source[i]}を下ろして、${partial}にする。`);
        }
        if (digit || started || i >= parts[0].length - 1) {
          started = true;
          if (divisor >= 10n && partial >= divisor) {
            const power = 10n ** BigInt(String(divisor).length - 1),
              leading = (divisor / power) * power;
            let trial = partial / leading;
            if (trial > 9n) trial = 9n;
            while (trial > digit) {
              quotient.digits[offset + i] = String(trial);
              push(
                `${divisor}×${trial}＝${divisor * trial}は${partial}より大きい。商を${trial - 1n}に直す。`,
                {
                  op: "*",
                  a: String(divisor),
                  b: String(trial),
                  result: String(divisor * trial),
                },
              );
              trial--;
            }
          }
          quotient.digits[offset + i] = String(digit);
          push(
            `${partial}の中に${divisor}は${digit}こ入る。商の同じ位に${digit}を立てる。`,
          );
          board.rows.push({
            digits: String(product),
            trailing,
            sign: "−",
            underline: true,
            stage: "product",
          });
          push(`${divisor}×${digit}＝${product}。位をそろえて下に書く。`, {
            op: "*",
            a: String(divisor),
            b: String(digit),
            result: String(product),
          });
          previousRow = { digits: String(rem), trailing, stage: "remainder" };
          board.rows.push(previousRow);
          push(`${partial}−${product}＝${rem}。引いた答えを書く。`, {
            op: "-",
            a: String(partial),
            b: String(product),
            result: String(rem),
          });
        }
        remainder = rem;
      }
      if (untouched && previousRow) {
        previousRow.digits = `${remainder}.${untouched}`;
        previousRow.trailing = 0;
        push(
          `商は整数まで。小数の部分を合わせ、あまりは${previousRow.digits}。`,
        );
      }
      if (q.roundPlaces !== undefined) {
        quotient.digits = KZ.format(
          KZ.roundExact(KZ.evaluate(ast), q.roundPlaces),
          "decimal",
        );
        quotient.trailing =
          quotientPlaces -
          (quotient.digits.split(".")[1] || "").length +
          untouched.length;
        delete quotient.points;
        push(
          `小数第${q.roundPlaces + 1}位を見て四捨五入する。商は${quotient.digits}。`,
        );
      }
      for (const t of q.solutionTrace)
        if (t.kind === "text" && /たしかめ：|余りの小数点/.test(t.text))
          push(t.text);
    }
    push(q.solutionTrace.at(-1).text);
    return result;
  }
  return Object.freeze({ steps });
})();
