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
  const signs = { "+": "＋", "-": "−", "*": "×", "/": "÷" };
  const show = (v) =>
    KZ.format(v, Number.isFinite(KZ.decimalPlaces(v)) ? "decimal" : "fraction");
  const rawFraction = (node) => {
    const v = KZ.evaluate(node),
      label = node.label || "";
    const mixed = label.match(/^(\d+)と(\d+)\/(\d+)$/);
    const fraction = label.match(/^(\d+)\/(\d+)$/);
    if (mixed)
      return {
        n: BigInt(mixed[1]) * BigInt(mixed[3]) + BigInt(mixed[2]),
        d: BigInt(mixed[3]),
        mixed,
      };
    if (fraction) return { n: BigInt(fraction[1]), d: BigInt(fraction[2]) };
    return { n: BigInt(v.n), d: BigInt(v.d) };
  };
  function explain(q) {
    const out = [],
      id = q.challengeId,
      ast = q.expressionAST;
    const emit = (text, extra = {}) =>
      out.push({ kind: "text", text, ...extra });
    const numericText = (v) =>
      typeof v === "object" ? KZ.format(v) : String(v);
    const checked = (text, op, a, b, value, extra = {}) =>
      emit(text, {
        check: {
          op,
          a: numericText(a),
          b: numericText(b),
          result: numericText(value),
        },
        ...extra,
      });
    const reduce = (n, d) => {
      const g = KZ.gcd(n, d);
      if (g > 1n) {
        const candidates = [];
        emit(`約分に使う数を探すため、分子${n}を整数のかけ算の組に分ける。`);
        if (n === 0n) {
          emit(
            `分子0は${d}で割っても0。分母${d}も${d}で割れるので、0/${d}＝0/1にできる。`,
          );
          candidates.push(d);
        }
        for (let factor = 1n; factor * factor <= n; factor++)
          if (n % factor === 0n) {
            const partner = n / factor;
            candidates.push(factor, partner);
            checked(
              `${factor}×${partner}＝${n}。${factor}と${partner}で分子を割れる。`,
              "*",
              factor,
              partner,
              n,
            );
          }
        const shared = [...new Set(candidates.map(String))]
          .map(BigInt)
          .filter((factor) => d % factor === 0n)
          .sort((a, b) => (a < b ? -1 : 1));
        emit(
          `その中で分母${d}も割り切れる数は${shared.join("、")}。この中の${g}を使えば、一度で約分できる。`,
        );
        emit(`${n}と${d}を両方わり切れる数を探す。${g}なら両方をわり切れる。`, {
          intent: "common-factor",
        });
        checked(`分子は${n}÷${g}＝${n / g}。`, "/", n, g, n / g);
        checked(
          `分母も同じ${g}でわる：${d}÷${g}＝${d / g}。分数の大きさは変わらない。`,
          "/",
          d,
          g,
          d / g,
        );
        emit(`${n}/${d}＝${n / g}/${d / g}。`, { intent: "reduction" });
      } else
        emit(
          `${n}と${d}を両方わる1より大きい整数はないので、これ以上約分しない。`,
        );
    };
    const convert = (node) => {
      const f = rawFraction(node),
        v = KZ.evaluate(node);
      if (f.mixed) {
        const [, w, n, d] = f.mixed;
        emit(
          `${node.label}を、1/${d}が何個かで考える。整数1は1/${d}が${d}個。`,
        );
        checked(
          `整数${w}は${w}×${d}＝${BigInt(w) * BigInt(d)}個分。`,
          "*",
          w,
          d,
          BigInt(w) * BigInt(d),
        );
        checked(
          `残り${n}個を合わせる：${BigInt(w) * BigInt(d)}＋${n}＝${f.n}。だから${node.label}＝${f.n}/${f.d}。`,
          "+",
          BigInt(w) * BigInt(d),
          n,
          f.n,
        );
      } else if (
        !node.label?.includes("/") &&
        v.d !== "1" &&
        KZ.decimalPlaces(v) <= 4
      ) {
        const s = KZ.format(v, "decimal"),
          scale = places(v),
          d = 10n ** BigInt(scale),
          n = coefficient(v, scale);
        emit(`${s}は1/${d}が${n}個分。小数を分数にすると${n}/${d}。`);
        reduce(n, d);
        emit(`この先は${s}＝${v.n}/${v.d}として計算する。`, {
          intent: "conversion",
        });
      } else if (f.d === 1n)
        emit(`整数${f.n}は${f.n}/1。分母1の分数としても表せる。`);
      return f;
    };
    const common = (a, b, forced) => {
      const d = forced ? BigInt(forced) : KZ.lcm(a.d, b.d);
      if (a.d !== b.d) {
        emit(
          `1/${a.d}と1/${b.d}は1個分の大きさが違う。分母をそろえてから個数を計算する。`,
          { intent: "common-unit" },
        );
        for (const divisor of [a.d, b.d]) {
          const multiples = [];
          for (let n = divisor; n <= d; n += divisor) multiples.push(n);
          emit(`${divisor}の倍数を順に見る：${multiples.join("、")}。`);
        }
        emit(
          `${a.d}と${b.d}の共通の倍数を探す。${d}は${a.d}×${d / a.d}と${b.d}×${d / b.d}の両方で作れる。`,
          { intent: "denominator-choice" },
        );
      } else
        emit(
          `どちらも1/${d}が1個分。分母${d}はそのまま、分子の個数を計算する。`,
        );
      for (const v of [a, b])
        if (v.d !== d) {
          const m = d / v.d;
          checked(
            `分母は${v.d}×${m}＝${d}。分子も同じ${m}倍にする。`,
            "*",
            v.d,
            m,
            d,
          );
          checked(
            `分子は${v.n}×${m}＝${v.n * m}。${v.n}/${v.d}＝${v.n * m}/${d}。`,
            "*",
            v.n,
            m,
            v.n * m,
            { intent: "equivalence" },
          );
        }
      return { d, an: a.n * (d / a.d), bn: b.n * (d / b.d) };
    };
    const rounding = (value, p) => {
      const rounded = KZ.roundExact(value, p),
        unit = 10n ** BigInt(-p),
        n = BigInt(value),
        digit = (n / (unit / 10n)) % 10n;
      emit(`${place(-p)}まで残す。その1つ右の${place(-p - 1)}の数字で決める。`);
      emit(
        `${value}の${place(-p - 1)}は${digit}。${digit >= 5n ? "5以上なので、残す数を1増やす" : "5未満なので、残す数はそのまま"}。`,
        { intent: "round-decision" },
      );
      emit(
        `残すまとまりは${n / unit}${digit >= 5n ? `＋1＝${n / unit + 1n}` : "のまま"}。右の位を0にして${rounded.n}。`,
        { intent: "round-result" },
      );
    };
    const divisors = (n) => {
      const found = [];
      emit(`${n}をかけ算の2つの整数の組に分ける。割り切れる整数が約数になる。`);
      for (let a = 1n; a * a <= n; a++) {
        const b = n / a,
          rem = n % a;
        if (rem)
          emit(
            `${n}÷${a}＝${b} あまり${rem}。割り切れないので${a}は約数に入れない。`,
          );
        else {
          found.push(a, b);
          checked(
            `${a}×${b}＝${n}。${a}${a === b ? "" : `と${b}`}は約数。`,
            "*",
            a,
            b,
            n,
          );
        }
      }
      emit(
        `これ以上は同じ組を逆に探すことになる。重複を取り、小さい順に並べる。`,
      );
      return [...new Set(found.map(String))].sort((a, b) =>
        BigInt(a) < BigInt(b) ? -1 : 1,
      );
    };
    if (q.task === "compare") {
      emit(
        `${q.labels?.[0] || show(q.values[0])}と${q.labels?.[1] || show(q.values[1])}を比べる。どこが同じで、どこが違うか順に確かめる。`,
        { intent: "focus" },
      );
      if (["G3-N06", "G5-N09"].includes(id)) {
        const a = rawFraction(KZ.lit(q.values[0], q.labels?.[0])),
          b = rawFraction(KZ.lit(q.values[1], q.labels?.[1]));
        const { d, an, bn } = common(a, b);
        emit(
          `同じ1/${d}の個数を比べる：${an} ${an < bn ? "＜" : an > bn ? "＞" : "＝"} ${bn}。`,
          { intent: "comparison" },
        );
      } else {
        const scale = Math.max(...q.values.map(places)),
          values = q.values.map((v) => decimal(coefficient(v, scale), scale));
        if (scale)
          emit(
            `小数の右に0を補っても大きさは変わらない。${q.values.map((v, i) => `${show(v)}＝${values[i]}`).join("、")}。小数点をそろえる。`,
          );
        const a = values[0].replace(".", ""),
          b = values[1].replace(".", "");
        if (a.length !== b.length)
          emit(
            `左は${a.length - scale}桁、右は${b.length - scale}桁の整数部分。大きい位まである方が大きい。`,
          );
        else
          for (let i = 0; i < a.length; i++) {
            emit(
              `${place(a.length - i - 1, scale)}は${a[i]}と${b[i]}。${a[i] === b[i] ? (i + 1 < a.length ? "同じなので次の位を見る。" : "最後まで同じなので、2つの数は同じ。") : `${a[i]}${a[i] < b[i] ? "＜" : "＞"}${b[i]}なので、ここで大小が決まる。`}`,
              { intent: "comparison" },
            );
            if (a[i] !== b[i]) break;
          }
      }
    } else if (q.task === "blocks") {
      emit(`${q.prompt}。まとまりの大きさごとに分けて考える。`, {
        intent: "focus",
      });
      const units =
        id === "G1-N02"
          ? [10n, 1n]
          : id === "G2-N02"
            ? [1n, 10n, 100n, 1000n]
            : [1n, 10000n, 100000000n, 1000000000000n];
      let rest = q.values.reduce((sum, v, i) => sum + BigInt(v) * units[i], 0n);
      for (const i of units
        .map((_, i) => i)
        .sort((a, b) => (units[a] > units[b] ? -1 : 1))) {
        const u = units[i],
          count = rest / u,
          next = rest % u;
        emit(
          `${rest}の中から${u}のまとまりを取り出す。${count > 0n && count <= 9n ? `${Array(Number(count)).fill(String(u)).join("＋")}＝${count * u}` : `${u}のまとまり${count}個で${count * u}`}。だから${q.answerSpec.labels[i]}は${count}個。${count === 0n ? "このまとまりがないので0を書く。" : "対応する欄へ個数を書く。"}`,
        );
        if (u > 1n)
          emit(
            `${rest}−${count * u}＝${next}。取り出したまとまりを除いた${next}を、次の小さいまとまりに分ける。`,
          );
        rest = next;
      }
    } else if (q.task === "parity") {
      const n = BigInt(q.values[0]),
        r = n % 2n;
      emit(`${n}を2個ずつの組に分けられるか確かめる。`, { intent: "focus" });
      emit(
        `${n}＝2×${n / 2n}${r ? "＋1" : ""}。${r ? "1個余るので奇数" : "余りが0なので偶数"}。${n === 0n ? "0も2×0で表せる。" : ""}`,
      );
    } else if (["divisors", "gcd", "lcm"].includes(q.task)) {
      if (q.task === "lcm") {
        emit(
          `${q.values.join("と")}の倍数を小さい順に作り、最初に同じになる数を探す。`,
          { intent: "focus" },
        );
        const end = BigInt(q.expectedExactValue.n);
        for (const n of q.values.map(BigInt))
          for (let i = 1n; n * i <= end; i++)
            checked(
              `${n}の${i}番目の正の倍数：${n}×${i}＝${n * i}。`,
              "*",
              n,
              i,
              n * i,
            );
        emit(`両方に最初に出てきた数が${end}。これが最小公倍数。`);
      } else {
        const sets = q.values.map((n) => divisors(BigInt(n)));
        sets.forEach((ds, i) =>
          emit(`${q.values[i]}の約数：${ds.join("、")}。`),
        );
        if (q.task === "gcd") {
          const both = sets[0].filter((x) => sets[1].includes(x));
          emit(`両方にある約数は${both.join("、")}。共通のものだけを残す。`);
          emit(`この中で一番大きい${both.at(-1)}が最大公約数。`);
        }
      }
    } else if (q.task === "round") rounding(q.values[0], q.places);
    else if (q.task === "common") {
      emit(`${q.labels.join("と")}の1個分を同じ大きさにする。`, {
        intent: "focus",
      });
      common(...q.values.map((v, i) => rawFraction(KZ.lit(v, q.labels[i]))));
    } else if (q.task === "reciprocal") {
      emit(`${q.labels[0]}にかけて1になる数を探す。`, { intent: "focus" });
      const f = convert(KZ.lit(q.values[0], q.labels[0]));
      emit(`${f.n}/${f.d}の分子と分母を入れ替えると${f.d}/${f.n}。`);
      emit(
        `${f.n}/${f.d}×${f.d}/${f.n}＝${f.n * f.d}/${f.d * f.n}＝1。だから逆数になる。`,
      );
      if (KZ.gcd(f.n, f.d) > 1n) reduce(f.d, f.n);
    } else if (q.task === "fraction") {
      const n = BigInt(q.original.n),
        d = BigInt(q.original.d);
      emit(`${q.prompt}。1個分の大きさと、その個数を確かめる。`, {
        intent: "focus",
      });
      if (id === "G5-N10") {
        const v = KZ.format(q.original, "decimal"),
          scale = places(q.original),
          denominator = 10n ** BigInt(scale),
          numerator = coefficient(q.original, scale);
        emit(
          scale
            ? `${v}は1/${denominator}が${numerator}個分。分母を${denominator}、分子を${numerator}にする。`
            : `${v}は1が${v}個。分母1の分数で${v}/1。`,
        );
        if (scale) reduce(numerator, denominator);
      } else if (q.answerSpec.form === "mixed") {
        emit(
          `1/${d}が${d}個集まると1になる。${n}個の中に、このまとまりをいくつ作れるか調べる。`,
        );
        emit(
          `${n}÷${d}＝${n / d} あまり${n % d}。1のまとまりが${n / d}個、1/${d}が${n % d}個残る。`,
        );
        emit(
          `整数部分${n / d}と残り${n % d}/${d}を合わせ、${n / d}と${n % d}/${d}。分母${d}は変えない。`,
        );
      } else if (id === "G4-N06") {
        checked(
          `整数${n / d}は1/${d}が${n / d}×${d}＝${(n / d) * d}個分。`,
          "*",
          n / d,
          d,
          (n / d) * d,
        );
        checked(
          `残り${n % d}個を合わせる：${(n / d) * d}＋${n % d}＝${n}。だから${n}/${d}。`,
          "+",
          (n / d) * d,
          n % d,
          n,
        );
      } else if (q.answerSpec.reduced) reduce(n, d);
      else {
        emit(`全体を1として、同じ大きさに${d}つに分ける。1個分は1/${d}。`, {
          diagram: [[0, Number(d)]],
        });
        emit(`そのうち${n}個分なので、分子は${n}、分母は${d}。${n}/${d}。`, {
          diagram: [[Number(n), Number(d)]],
        });
      }
    } else if (ast) {
      if (
        !ast.op &&
        !q.sequence &&
        !q.unitFraction &&
        !q.law &&
        id !== "G5-N11" &&
        !q.diagram
      ) {
        emit(
          `${q.prompt}。示された数${show(KZ.evaluate(ast))}と、答えを入れる場所を確かめる。`,
        );
        out.push({ kind: "answer", text: `こたえ：${KZ.answerText(q)}` });
        return out;
      }
      const av = ast.op ? KZ.evaluate(ast.args[0]) : KZ.evaluate(ast),
        bv = ast.op ? KZ.evaluate(ast.args[1]) : null;
      const a = Number(av.n),
        b = bv ? Number(bv.n) : 0;
      emit(
        q.unknown !== undefined
          ? `${q.prompt}。□が表す数を確かめてから、計算の式を作る。`
          : `${q.prompt}。どのまとまり・計算から考えるか確かめる。`,
        { intent: "focus" },
      );
      if (q.sequence) {
        const index = q.prompt.split(/[、,]/).findIndex((x) => x.includes("□"));
        const i = index < 0 ? 1 : index;
        emit(
          `となりは1だけ違う。${i === 0 ? `右の${q.sequence[1]}の1つ前なので、1を引く` : `左の${q.sequence[i - 1]}の1つ後なので、1を足す`}。`,
        );
        emit(
          i === 0
            ? `${q.sequence[1]}−1＝${q.sequence[0]}。`
            : `${q.sequence[i - 1]}＋1＝${q.sequence[i]}。`,
        );
        emit(`${q.sequence.join(" → ")}と1ずつ続くことを確かめる。`);
      } else if (id === "G1-N02" || id === "G2-N02") {
        const total = BigInt(q.expectedExactValue.n),
          units = id === "G1-N02" ? [10n, 1n] : [1000n, 100n, 10n, 1n];
        const terms = (node) =>
          node.op === "+" ? node.args.flatMap(terms) : [node];
        for (const term of terms(ast)) {
          if (term.op === "*") {
            const values = term.args.map(KZ.evaluate).map((v) => BigInt(v.n));
            const u =
              values.find((v) => [1n, 10n, 100n, 1000n].includes(v)) ||
              values[0];
            const count = values[values.indexOf(u) === 0 ? 1 : 0];
            emit(
              `${u}が${count}個。${count >= 10n ? "10個ずつのまとまりと残りへ分けてから、数を求める。" : count > 0n ? `${Array(Number(count)).fill(String(u)).join("＋")}＝${u * count}。` : "このまとまりは0個なので0。"}`,
            );
            if (count >= 10n) {
              emit(
                `${count}個を10個ずつに分ける：${count}＝${count / 10n}×10＋${count % 10n}。`,
              );
              emit(
                `${u}が10個で${u * 10n}。${count / 10n}組を1つ上の位へ移し、${u}が${count % 10n}個残る。`,
              );
            }
          } else
            emit(`ばらの1は${show(KZ.evaluate(term))}個。まとまりと合わせる。`);
        }
        for (const u of units)
          emit(`${u}が${(total / u) % 10n}個で${((total / u) % 10n) * u}。`);
        emit(
          `${units.map((u) => ((total / u) % 10n) * u).join("＋")}＝${total}。まとまりとばらを合わせる。`,
        );
      } else if (id === "G4-N02") {
        emit(`一・万・億・兆のまとまりに分ける。それぞれ4桁分の場所を使う。`);
        const n = BigInt(q.expectedExactValue.n),
          groups = [];
        for (let p = 3; p >= 0; p--)
          groups.push(
            String((n / 10000n ** BigInt(p)) % 10000n).padStart(4, "0"),
          );
        emit(
          `兆｜億｜万｜一の順に${groups.join("｜")}。ない位も0で場所を埋める。`,
        );
      } else if (["G3-N03", "G4-N03"].includes(id)) {
        const unit = KZ.evaluate(ast.args[ast.op === "/" ? 1 : 0]),
          count = ast.op === "/" ? q.expectedExactValue : bv,
          total = ast.op === "/" ? av : q.expectedExactValue;
        emit(`1は${show(unit)}が${unit.d}個。整数部分をこの単位の個数へ直す。`);
        const s = places(unit),
          c = coefficient(total, s),
          chunks = String(c)
            .split("")
            .map((x, i, arr) => BigInt(x) * 10n ** BigInt(arr.length - i - 1));
        chunks.forEach((x, i) => {
          const digit = BigInt(String(c)[i]),
            perDigit = 10n ** BigInt(chunks.length - i - 1);
          emit(
            `${place(chunks.length - i - 1, s)}の1は、${show(unit)}が${perDigit}個分。この位の数字は${digit}。`,
          );
          checked(
            `${digit}×${perDigit}＝${x}。だから、この位の部分は${show(unit)}が${x}個分。`,
            "*",
            digit,
            perDigit,
            x,
          );
        });
        emit(
          `${chunks.join("＋")}＝${count.n}個。${show(total)}は${show(unit)}が${count.n}個分。`,
        );
        if (ast.op === "*")
          checked(
            `${show(unit)}×${show(count)}＝${show(total)}。個数を数に戻す。`,
            "*",
            unit,
            count,
            total,
          );
      } else if (["G3-N02", "G5-N06"].includes(id)) {
        const power = Number(bv.n),
          times = String(power).length - 1;
        emit(
          `${power}は10を${times}回かけた数。${ast.op === "*" ? "10倍" : "10分の1"}を${times}回行う。`,
        );
        let value = av;
        for (let i = 0; i < times; i++) {
          const next = KZ.calc(ast.op, value, 10);
          checked(
            `${show(value)}${signs[ast.op]}10＝${show(next)}。各位の値が${ast.op === "*" ? "10倍になり、1つ左の位へ" : "10分の1になり、1つ右の位へ"}移る。`,
            ast.op,
            value,
            10,
            next,
          );
          value = next;
        }
      } else if (id === "G4-N05") {
        const [[n, d], [nn, dd]] = q.diagram,
          factor = dd / d;
        emit(`${n}/${d}の大きさを変えず、分母${dd}の分数にしたい。`, {
          diagram: [[n, d]],
        });
        checked(
          `分母は${d}×${factor}＝${dd}。各部分を${factor}つに分ける。`,
          "*",
          d,
          factor,
          dd,
          { diagram: [[n, d]] },
        );
        checked(
          `分子も${n}×${factor}＝${nn}。ぬった範囲は同じで、${nn}個分になる。`,
          "*",
          n,
          factor,
          nn,
          { diagram: [[nn, dd]] },
        );
        emit(`${n}/${d}＝${nn}/${dd}。`, {
          diagram: [
            [n, d],
            [nn, dd],
          ],
        });
      } else if (q.unitFraction) {
        const { n, d } = q.unitFraction;
        emit(`1個分は1/${d}。それを${n}個集める。`, {
          diagram: [[0, Number(d)]],
        });
        emit(
          `1/${d}が${n}個なので${n}/${d}。分母は1個分の大きさを表すから変えない。`,
          { diagram: [[Number(n), Number(d)]] },
        );
      } else if (id === "G5-N03") {
        emit(`正の倍数は1倍から数える。0はこの並びに入れない。`);
        for (let i = 1; i <= b; i++)
          checked(`${i}番目は${a}×${i}＝${a * i}。`, "*", a, i, a * i);
      } else if (q.law) {
        const { a, b, c, kind } = q.law;
        if (kind === "associate") {
          emit(`${b * c}を${b}と何をかけた数かで考える。`);
          checked(
            `${b * c}÷${b}＝${c}なので、${b * c}＝${b}×${c}。`,
            "/",
            b * c,
            b,
            c,
          );
          emit(
            `${a}×（${b}×${c}）＝（${a}×${b}）×${c}。かけるまとまりを変えても積は同じ。`,
          );
        } else if (kind === "exchange")
          emit(
            `${a}×${b}の2つの数の順を入れ替えると${b}×${a}。積は同じなので、対応する数を□へ入れる。`,
          );
        else {
          emit(
            `${a}を（${b}＋${c}）にかけるので、${b}と${c}の両方に${a}をかける。`,
          );
          emit(
            `${a}×（${b}＋${c}）＝${a}×${b}＋${a}×${c}。2つ目の積の数と□を対応させる。`,
          );
        }
      } else if (["G1-C01", "G1-C09", "G2-C10", "G3-C15"].includes(id)) {
        if (["G1-C01", "G1-C09"].includes(id))
          emit(
            `全部${a}から、分かっている${b}を除いた残りが□。だから${a}−${b}を計算する。`,
          );
        else if (id === "G2-C10")
          emit(
            ast.op === "+"
              ? `引く前の□を求める。残った${a}に、取った${b}を戻すので、たし算になる。`
              : `全部${a}から、分かっている部分${b}を除くと□の部分が残る。だからひき算になる。`,
          );
        else
          emit(
            ast.op === "*"
              ? `わられる数は、1つ分と組数を合わせた全体。${a}が${b}個分なのでかけ算になる。`
              : `${q.prompt}の1つ分・組数・全体を確かめる。全体${a}を分かっている${b}で分けるので、わり算になる。`,
          );
        checked(
          `${a}${signs[ast.op]}${b}＝${show(KZ.evaluate(ast))}。`,
          ast.op,
          av,
          bv,
          KZ.evaluate(ast),
        );
        emit(
          `□に${KZ.answerText(q)}を戻して、元の式の左右が同じになるか確かめる。`,
        );
      } else if (
        [
          "G1-C02",
          "G1-C03",
          "G1-C04",
          "G1-C05",
          "G1-C06",
          "G1-C07",
          "G2-C08",
          "G2-C09",
          "G2-C07",
          "G3-C09",
          "G3-C10",
        ].includes(id)
      ) {
        const picture = (text, stage, extra = {}) =>
          emit(text, {
            kind: "counters",
            operation: ast.op,
            a,
            b,
            splitTen: id === "G1-C05",
            pictureStage: stage,
            ...extra,
          });
        if (["G1-C02", "G1-C03", "G1-C04", "G1-C05", "G2-C08"].includes(id))
          picture(
            `${a}${ast.op === "*" ? `が1つ分。${b}組を作る` : `個が初めの数。${b}個を${ast.op === "+" ? "合わせる" : "取る"}`}。`,
            "before",
          );
        if (id === "G1-C03") {
          const need = 10 - a;
          emit(
            `${a}を10にするにはあと${need}。だから${b}から${need}を取り分ける。`,
          );
          emit(
            `${b}は${need}と${b - need}。${a}＋${need}＝10。残り${b - need}をまだ使わずに残す。`,
          );
          picture(
            `10と残り${b - need}を合わせる：10＋${b - need}＝${a + b}。`,
            "after",
          );
        } else if (id === "G1-C05") {
          emit(
            `ばらの${a - 10}だけでは${b}個を取れない。${a}を10と${a - 10}に分け、10の方から取る。`,
          );
          picture(
            `10−${b}＝${10 - b}。別に残した${a - 10}も、そのままある。`,
            "after",
          );
          checked(
            `10から残った${10 - b}と、元からの${a - 10}を合わせる：${10 - b}＋${a - 10}＝${a - b}。`,
            "+",
            10 - b,
            a - 10,
            a - b,
          );
        } else if (id === "G2-C08") {
          for (let i = 1; i <= b; i++)
            picture(
              `${a}が${i}組で${Array(i).fill(a).join("＋")}＝${a * i}。${i < b ? `次はもう1組、${a}を足す。` : "全部の組を数えた。"}`,
              "groups",
              { visibleGroups: i },
            );
        } else if (["G1-C06", "G1-C07"].includes(id)) {
          if (a % 10 === 0 && b % 10 === 0) {
            const count = ast.op === "+" ? a / 10 + b / 10 : a / 10 - b / 10;
            emit(
              `${a}は10のまとまりが${a / 10}個、${b}は${b / 10}個。ばらはどちらも0。`,
            );
            checked(
              `まとまりの個数を計算する：${a / 10}${signs[ast.op]}${b / 10}＝${count}個。`,
              ast.op,
              a / 10,
              b / 10,
              count,
            );
            emit(
              `10のまとまりが${count}個なので${count * 10}。ばらの位は0を残す。`,
            );
          } else {
            const tens = a - (a % 10),
              ones = a % 10,
              value = ast.op === "+" ? ones + b : ones - b;
            emit(`${a}は${tens}と${ones}。${tens}のまとまりはそのまま残す。`);
            checked(
              `ばらの数だけ計算する：${ones}${signs[ast.op]}${b}＝${value}。`,
              ast.op,
              ones,
              b,
              value,
            );
            checked(
              `${tens}と${value}を合わせる：${tens}＋${value}＝${a + (ast.op === "+" ? b : -b)}。`,
              "+",
              tens,
              value,
              a + (ast.op === "+" ? b : -b),
            );
          }
        } else if (id === "G2-C07") {
          emit(
            `${a}は100が${a / 100}個、${b}は100が${b / 100}個。100を1つ分として個数を計算する。`,
          );
          const count = Number(q.expectedExactValue.n) / 100;
          checked(
            `${a / 100}${signs[ast.op]}${b / 100}＝${count}個。`,
            ast.op,
            a / 100,
            b / 100,
            count,
          );
          if (count >= 10) {
            emit(
              `${count}個を${Math.floor(count / 10) * 10}個と${count % 10}個へ分ける。100が10個で1000になる。`,
            );
            emit(
              `1000が${Math.floor(count / 10)}個で${Math.floor(count / 10) * 1000}、100が${count % 10}個で${(count % 10) * 100}。`,
            );
            checked(
              `2つを合わせる：${Math.floor(count / 10) * 1000}＋${(count % 10) * 100}＝${count * 100}。`,
              "+",
              Math.floor(count / 10) * 1000,
              (count % 10) * 100,
              count * 100,
            );
          } else emit(`100が${count}個で${count * 100}。`);
        } else if (id === "G2-C09" || id === "G3-C10") {
          const left = id === "G2-C09" ? 10 : a - (a % 10),
            right = a - left;
          emit(
            `${a}を${left}と${right}に分ける。両方を同じ${b}${ast.op === "*" ? "組分にする" : "組へ分ける"}。`,
          );
          const x = id === "G2-C09" ? left * b : left / b,
            y = id === "G2-C09" ? right * b : right / b;
          checked(`${left}${signs[ast.op]}${b}＝${x}。`, ast.op, left, b, x);
          checked(`${right}${signs[ast.op]}${b}＝${y}。`, ast.op, right, b, y);
          checked(
            `分けて計算した2つを合わせる：${x}＋${y}＝${x + y}。`,
            "+",
            x,
            y,
            x + y,
          );
        } else if (id === "G3-C09") {
          const count = Math.floor(a / b),
            product = count * b,
            r = a - product;
          checked(
            `${b}×${count}＝${product}で${a}を超えない。`,
            "*",
            b,
            count,
            product,
          );
          checked(
            `次の${count + 1}組では${b}×${count + 1}＝${b * (count + 1)}で${a}を超える。だから${count}組まで。`,
            "*",
            b,
            count + 1,
            b * (count + 1),
          );
          checked(`${a}−${product}＝${r}が余り。`, "-", a, product, r);
          emit(`${r}＜${b}なので、もう1組は作れない。`);
        } else {
          if (ast.op === "+")
            emit(
              `${a}からあと${b}個数える：${Array.from({ length: b }, (_, i) => a + i + 1).join("、")}。`,
            );
          picture(
            `${a}${signs[ast.op]}${b}＝${ast.op === "+" ? a + b : a - b}。${ast.op === "+" ? "合わせた個数" : "取った個数と残った個数"}を確かめる。`,
            "after",
          );
        }
      } else if (id === "G5-N12") {
        emit(`1を${b}等分すると、1つ分は1/${b}。`);
        emit(
          `${a}を同じように分けると、1人に1/${b}が${a}個ずつ。だから${a}/${b}。`,
        );
        if (q.answerSpec.reduced && KZ.gcd(a, b) > 1n)
          reduce(BigInt(a), BigInt(b));
      } else {
        if (q.roundOperands)
          q.roundOperands.forEach((v) => rounding(v.original, v.places));
        if (["G5-N13", "G6-N02"].includes(id))
          emit(
            `${id === "G5-N13" ? "△" : "x"}の場所を、指定された数へ置き換える。計算する式は${KZ.expression(ast)}。`,
            { intent: "substitution" },
          );
        if (id === "G5-N11" && !ast.op) {
          emit(
            `${av.n}/${av.d}は${av.n}÷${av.d}で求められる。小数まで割り進める。`,
          );
          const inner = {
            ...q,
            written: true,
            expressionAST: KZ.op("/", KZ.lit(av.n), KZ.lit(av.d)),
            answerSpec: { type: "decimal" },
            expectedExactValue: av,
            challengeId: "G4-C12",
          };
          for (const state of steps(inner).slice(0, -1)) out.push(state);
        } else {
          let working = clone(ast);
          const walk = (node, path = []) => {
            if (!node.op) return;
            node.args.forEach((v, i) => walk(v, [...path, i]));
            let current = working;
            for (const i of path) current = current.args[i];
            const op = current.op,
              left = KZ.evaluate(current.args[0]),
              right = KZ.evaluate(current.args[1]),
              value = KZ.evaluate(current);
            emit(
              `${KZ.expression(current)}を先に計算する。${node.group ? "かっこの中を先に求める。" : ["*", "/"].includes(op) ? "かけ算・わり算を、たし算・ひき算より先に求める。" : "同じ順序の計算は左から進める。"}`,
              { intent: "operation-focus" },
            );
            if (
              q.answerSpec.type === "fraction" &&
              (left.d !== "1" ||
                right.d !== "1" ||
                current.args.some((x) => x.label?.includes("/")))
            ) {
              const x = convert(current.args[0]),
                y = convert(current.args[1]);
              let n, d;
              if (["+", "-"].includes(op)) {
                const c = common(x, y, q.displayDenominator);
                n = c.an + (op === "+" ? c.bn : -c.bn);
                d = c.d;
                checked(
                  `1/${d}の個数を計算する：${c.an}${signs[op]}${c.bn}＝${n}。だから${n}/${d}。`,
                  op,
                  c.an,
                  c.bn,
                  n,
                  { intent: "fraction-operation" },
                );
              } else {
                let yn = y.n,
                  yd = y.d;
                if (op === "/") {
                  emit(
                    `割る数${y.n}/${y.d}を1にしたい。その逆数${y.d}/${y.n}をかけると1になる。両方に同じ数をかけても商は変わらない。`,
                    { intent: "reciprocal-reason" },
                  );
                  emit(
                    `${x.n}/${x.d}÷${y.n}/${y.d}＝${x.n}/${x.d}×${y.d}/${y.n}。`,
                    { intent: "reciprocal-operation" },
                  );
                  [yn, yd] = [y.d, y.n];
                } else
                  emit(
                    `1/${x.d}の${yn}/${yd}倍を考える。1個を${yd}等分し、その${yn}個分を取るので、分母も掛ける。`,
                  );
                n = x.n * yn;
                d = x.d * yd;
                checked(`分子どうし：${x.n}×${yn}＝${n}。`, "*", x.n, yn, n);
                checked(
                  `分母どうし：${x.d}×${yd}＝${d}。積は${n}/${d}。`,
                  "*",
                  x.d,
                  yd,
                  d,
                  { intent: "fraction-operation" },
                );
              }
              if (q.answerSpec.reduced && KZ.gcd(n, d) > 1n) reduce(n, d);
              emit(
                `${KZ.expression(current)}＝${q.displayDenominator ? `${n}/${d}` : KZ.format(value)}。`,
              );
            } else
              checked(
                `${KZ.expression(current)}＝${show(value)}。`,
                op,
                left,
                right,
                value,
              );
            const replacement = KZ.lit(
              value,
              q.answerSpec.type === "fraction" ? KZ.format(value) : show(value),
            );
            if (path.length) {
              let parent = working;
              for (const i of path.slice(0, -1)) parent = parent.args[i];
              parent.args[path.at(-1)] = replacement;
              emit(
                `求めた数を元の場所へ戻す。次の式は${KZ.expression(working)}。`,
                { intent: "expression-replacement" },
              );
            } else working = replacement;
          };
          walk(ast);
        }
      }
    }
    out.push({
      kind: "answer",
      text: `こたえ：${KZ.answerText(q)}`,
      ...(q.diagram ? { diagram: q.diagram } : {}),
    });
    return out;
  }
  function hint(q) {
    let focus;
    if (q.written) {
      const ast = q.expressionAST,
        a = KZ.evaluate(ast.args[0]),
        b = KZ.evaluate(ast.args[1]),
        scale = Math.max(places(a), places(b));
      if (["+", "-"].includes(ast.op)) {
        const x = Number(coefficient(a, scale) % 10n),
          y = Number(coefficient(b, scale) % 10n);
        focus = `まず${place(0, scale)}の${x}${signs[ast.op]}${y}を見よう。${ast.op === "-" && x < y ? `${x}では${y}を引けないね。左の位から借りられるか確かめよう。左の位の1は、この位では10だよ。` : "この位の答えを考えてから、次の位へ進もう。"}`;
      } else if (ast.op === "*")
        focus =
          places(a) + places(b)
            ? `${show(a)}と${show(b)}を整数にして計算すると、それぞれ何倍になるかな。積を最後にその倍率で戻そう。`
            : `まず一の位の${coefficient(a, 0) % 10n}に、かける数の一の位${coefficient(b, 0) % 10n}をかけよう。`;
      else
        focus = places(b)
          ? `${show(b)}を整数にするには何倍かな。${show(a)}も同じ倍率にすると、何個分かは変わらないよ。`
          : `${show(a)}の左の位から見よう。${show(b)}を何組作れるか、次の1組では多くならないかも確かめよう。`;
    } else {
      const ast = q.expressionAST,
        left = ast?.op ? KZ.evaluate(ast.args[0]) : null,
        right = ast?.op ? KZ.evaluate(ast.args[1]) : null;
      focus = explain(q)[0].text;
      if (q.task === "compare")
        focus = `${q.labels?.[0] || show(q.values[0])}と${q.labels?.[1] || show(q.values[1])}は、どこまで同じかな。最初に違う位、または同じ1個分の個数を探そう。`;
      else if (q.task === "fraction")
        focus = ["G2-N03", "G3-N05"].includes(q.challengeId)
          ? `${q.prompt}。全体を1として、同じ大きさにいくつに分けたかな。そのうち何個分を見ているか数えよう。`
          : q.challengeId === "G5-N10"
            ? `${q.prompt}。小数の最後の位は、1をいくつに分けた1個分かな。その個数を分子、分けた数を分母にしよう。`
            : q.answerSpec.reduced
              ? `${q.original.n}と${q.original.d}を両方割り切れる整数を探そう。同じ数で両方を割れば、大きさを変えずに表せるよ。`
              : q.answerSpec.form === "mixed"
                ? `1/${q.original.d}が${q.original.d}個で1になるよ。${q.original.n}個から1のまとまりをいくつ作れ、何個残るかな。`
                : `整数1は1/${q.original.d}が何個分かな。整数の分と、残りの分数の個数を合わせよう。`;
      else if (q.task === "common")
        focus = `分母${q.values[0].d}と${q.values[1].d}の倍数を並べると、最初に共通する数はどれかな。その分母へ変える倍率も確かめよう。`;
      else if (q.task === "parity")
        focus = `${q.values[0]}を2個ずつの組にすると、最後に1個余るかな。0も、余りがあるかで考えよう。`;
      else if (left && right) {
        const a = show(left),
          b = show(right),
          id = q.challengeId;
        if (["G1-C02", "G1-C04"].includes(id))
          focus = `初めに${a}個あるよ。${b}個を${ast.op === "+" ? "合わせた" : "取った"}後の個数を、順に数えてみよう。`;
        else if (id === "G1-C03")
          focus = `${a}を10にするには、あといくつかな。${b}をその数と残りに分けると、10のまとまりを作れるよ。`;
        else if (id === "G1-C05")
          focus = `${a}のばらの数だけで${b}を取れるかな。10のまとまりから取った残りと、元からのばらを区別しよう。`;
        else if (id === "G2-C08")
          focus = `${a}が1組分で、${b}組あるよ。${a}のだんを忘れたら、1組ずつ${a}を足して確かめよう。`;
        else if (["G3-N03", "G4-N03"].includes(id)) {
          const unit = KZ.evaluate(ast.args[ast.op === "/" ? 1 : 0]);
          focus = `1は${show(unit)}が何個分かな。整数部分と小数部分を、同じ${show(unit)}の個数に直して合わせよう。`;
        } else if (["G3-N02", "G5-N06"].includes(id))
          focus = `${b}は10を何回かけた数かな。${a}の各位を、その回数だけ${ast.op === "*" ? "10倍" : "10分の1"}にしよう。`;
        else if (["G2-C09", "G3-C10"].includes(id))
          focus = `${a}を十のまとまりと残りに分け、それぞれを同じ${b}${ast.op === "*" ? "組分にする" : "組に分ける"}とどうなるかな。最後に2つを合わせよう。`;
        else if (id === "G5-N12")
          focus = `1を${b}等分した1個分を考えよう。${a}を同じように等分すると、その1個分が何個ずつになるかな。`;
        else if (["G5-N13", "G6-N02"].includes(id))
          focus = `${q.prompt}。まず${id === "G5-N13" ? "△" : "x"}の場所を示し、指定された数へ書き換えよう。その後、先に求める部分を選ぼう。`;
        else if (
          ["G1-C08", "G4-C15", "G4-C16", "G5-C09", "G6-C07", "G6-C08"].includes(
            id,
          ) &&
          ast.args.some((node) => node.op)
        ) {
          const first = (node) =>
            node.op ? node.args.map(first).find(Boolean) || node : null;
          focus = `${q.prompt}。まず${KZ.expression(first(ast))}を求めよう。求めた数を元の場所へ戻し、残った式を確かめてから次へ進もう。`;
        } else if (q.answerSpec.type === "fraction") {
          const conversion = (node) =>
            node.op
              ? node.args.some(conversion)
              : node.label?.includes("と") ||
                (!node.label?.includes("/") && KZ.evaluate(node).d !== "1");
          const unitA = rawFraction(ast.args[0]),
            unitB = rawFraction(ast.args[1]);
          focus = conversion(ast)
            ? `${KZ.expression(ast)}。帯分数や小数を、1個分の大きさと個数が分かる分数へ直そう。その数がどこから来たか、順に確かめよう。`
            : ["+", "-"].includes(ast.op)
              ? unitA.d === unitB.d
                ? `${KZ.expression(ast)}。どちらも1/${unitA.d}が1個分。分母${unitA.d}をそのままにして、分子の個数を${ast.op === "+" ? "合わせる" : "引く"}とどうなるかな。`
                : `${KZ.expression(ast)}。1個分の大きさが同じかな。分母が違うので共通の倍数を探し、そろえた後の分子の個数を計算しよう。`
              : `${KZ.expression(ast)}。それぞれの分数の1個分と個数を確かめよう。${ast.op === "/" ? "わる数に何をかけると1になるかな。その数を両方にかけると商は変わらないよ。" : "分子をかけると個数、分母をかけると分け方がどう変わるかな。"}`;
        }
      }
    }
    return `${focus} ${KZ.generalHint(q)}`;
  }
  function steps(q) {
    if (!q.written) return explain(q);
    const ast = q.expressionAST;
    const av = KZ.evaluate(ast.args[0]),
      bv = KZ.evaluate(ast.args[1]);
    const sa = places(av),
      sb = places(bv);
    const result = [],
      board = { op: ast.op, cols: 2, rows: [] };
    const push = (text, check, meta = {}) =>
      result.push({
        text,
        kind: "text",
        board: clone(board),
        ...(check ? { check } : {}),
        ...meta,
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
      if (scale)
        push(
          `${KZ.format(av, "decimal")}＝${decimal(a, scale)}、${KZ.format(bv, "decimal")}＝${decimal(b, scale)}。右に0を補っても大きさは同じ。小数点をそろえ、同じ大きさの位で計算する。`,
        );
      let carry = 0;
      for (let i = size - 1; i >= 0; i--) {
        const col = offset + i;
        board.focus = col;
        if (ast.op === "-") {
          if (aa[i] < bb[i]) {
            push(
              `${place(size - i - 1, scale)}は今${aa[i]}。${aa[i]}から${bb[i]}は引けないので、左の位から借りられるか見よう。`,
              undefined,
              {
                intent: "borrow-need",
                column: col,
                current: aa[i],
                subtract: bb[i],
              },
            );
            let j = i - 1;
            while (j >= 0 && aa[j] === 0) {
              board.focus = offset + j;
              push(
                `${place(size - j - 1, scale)}も0なので、ここからは借りられない。もう1つ左の位を見よう。`,
                undefined,
                { intent: "borrow-search", column: offset + j, current: 0 },
              );
              j--;
            }
            if (j < 0) throw Error("Teaching borrow underflow");
            board.focus = offset + j;
            push(
              `${place(size - j - 1, scale)}には${aa[j]}あるので、ここから1を渡せる。隣の位へ順に移そう。`,
              undefined,
              { intent: "borrow-donor", column: offset + j, current: aa[j] },
            );
            // Across zeros, move one place at a time; old states never become extra rows.
            for (let k = j; k < i; k++) {
              const from = place(size - k - 1, scale),
                to = place(size - k - 2, scale),
                oldFrom = aa[k],
                oldTo = aa[k + 1];
              push(
                `${from}の1は、${to}では10と同じ大きさ。この10を${to}へ移そう。`,
                undefined,
                { intent: "borrow-unit", from: offset + k, to: offset + k + 1 },
              );
              aa[k]--;
              aa[k + 1] += 10;
              mark(top, offset + k, aa[k], true);
              mark(top, offset + k + 1, aa[k + 1], true);
              board.focus = offset + k + 1;
              push(
                `${from}は${oldFrom}−1＝${aa[k]}。${to}は${oldTo}＋10＝${aa[k + 1]}。同時に交換するので、合わせた大きさは変わらない。`,
                {
                  op: "+",
                  a: String(oldTo),
                  b: "10",
                  result: String(aa[k + 1]),
                },
                {
                  intent: "borrow-exchange",
                  from: offset + k,
                  to: offset + k + 1,
                  currentDigits: [...aa],
                },
              );
            }
          }
          const value = aa[i] - bb[i];
          board.focus = col;
          answer.digits[col] = String(value);
          push(
            `${place(size - i - 1, scale)}：今の${aa[i]}から${bb[i]}を引くと${value}。${aa[i]}−${bb[i]}＝${value}。${value}を書く。${i ? `次は${place(size - i, scale)}。今は${aa[i - 1]}${aa[i - 1] < bb[i - 1] ? `なので${bb[i - 1]}を引けない。左の位を見よう。` : `から${bb[i - 1]}を引こう。`}` : "すべての位を計算できた。"}`,
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
          push(
            `${place(size - i - 1, scale)}：${aa[i]}＋${bb[i]}${previous ? `＋${previous}（右の位から来たまとまり）` : ""}＝${sum}。`,
            {
              op: "+",
              a: String(aa[i] + bb[i]),
              b: String(previous),
              result: String(sum),
            },
            { intent: "column-sum", column: col },
          );
          if (sum >= 10)
            push(
              `${sum}は10と${sum % 10}。この位の10個を、左の${place(size - i, scale)}の1個にまとめる。`,
              undefined,
              { intent: "carry-unit", column: col },
            );
          answer.digits[col] = String(sum % 10);
          carry = Math.floor(sum / 10);
          if (carry) mark(top, col - 1, carry);
          push(
            `${place(size - i - 1, scale)}に${sum % 10}を書く。${carry ? `左の${place(size - i, scale)}へ1をくり上げる。次はその1も足す。` : i ? `次は${place(size - i, scale)}の${aa[i - 1]}と${bb[i - 1]}を足す。` : "すべての位を計算できた。"}`,
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
      if (ast.op === "-" && answer.digits[0] === "0")
        push(
          "答えのいちばん左の0は省いて書ける。途中の位の0は、その場所を保つために残す。",
        );
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
          ? "元の小数の式を確認する。整数の式に直して計算し、その倍率を最後に戻す。"
          : "一の位から、位ごとにかける。",
      );
      if (sa + sb) {
        push(
          `${KZ.format(av, "decimal")}を${10 ** sa}倍して${a}、${KZ.format(bv, "decimal")}を${10 ** sb}倍して${b}にする。作業する積は${10 ** sa}×${10 ** sb}＝${10 ** (sa + sb)}倍になる。`,
        );
        top.digits = String(a);
        board.rows[1].digits = String(b);
        board.caption = `整数に直した式：${a}×${b}。元の積の${10 ** (sa + sb)}倍を求めている。`;
        push(
          `ここからは作業用の整数の式${a}×${b}を筆算する。位の名前も、この整数の位を表す。最後に積を${10 ** (sa + sb)}で割って元に戻す。`,
          undefined,
          { intent: "integer-working-form" },
        );
      }
      const partials = [];
      for (let shift = 0; shift < bb.length; shift++) {
        top.annotations = {};
        const row = { digits: blank(), shift, line: shift === 0 };
        board.rows.push(row);
        partials.push(row);
        if (shift)
          push(
            `${place(shift)}の${bb[shift]}は${bb[shift] * 10 ** shift}。${a}×${bb[shift]}の${10 ** shift}倍なので、部分積は${place(shift)}から書く。`,
          );
        let carry = 0;
        for (let i = 0; i < aa.length; i++) {
          const value = aa[i] * bb[shift] + carry,
            previous = carry;
          const col = board.cols - 1 - i - shift;
          board.focus = col;
          push(
            `${aa[i]}×${bb[shift]}${previous ? `＋${previous}（右の位からのまとまり）` : ""}＝${value}。`,
            {
              op: "+",
              a: String(aa[i] * bb[shift]),
              b: String(previous),
              result: String(value),
            },
            { intent: "product-sum" },
          );
          if (value >= 10)
            push(
              `${value}は${Math.floor(value / 10)}個の10と${value % 10}。10のまとまりを左の位へ渡す。`,
              undefined,
              { intent: "carry-unit" },
            );
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
            i + 1 === aa.length
              ? `この部分積の左端まで計算した。${value}を対応する位に書く。${carry ? "10のまとまりも、その左の位に書く。" : ""}`
              : `${value % 10}を書く。${carry ? `${carry}を左の位へくり上げ、次の積へ足す。` : "次の位をかける。"}`,
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
          const terms = partials.map((row) => row.digits[col] || "0");
          board.focus = col;
          push(
            `${place(board.cols - col - 1)}の部分積をたす：${terms.join("＋")}${previous ? `＋${previous}（くり上がり）` : ""}＝${sum}。`,
            {
              op: "+",
              a: String(add),
              b: String(previous),
              result: String(sum),
            },
            { intent: "partial-sum", terms, column: col },
          );
          if (sum >= 10)
            push(
              `${sum}は10と${sum % 10}。10を左の位の1として渡す。`,
              undefined,
              { intent: "carry-unit" },
            );
          answer.digits[col] = String(sum % 10);
          carry = Math.floor(sum / 10);
          if (carry && col > 0) mark(partials[0], col - 1, carry);
          push(
            `${place(board.cols - col - 1)}に${sum % 10}を書く。${carry ? "左の位へ1をくり上げ、次の列で足す。" : ""}`,
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
        const originalProduct = decimal(product, sa + sb);
        push(
          `整数の式で求めた${product}は、元の積の${10 ** (sa + sb)}倍。${product}÷${10 ** (sa + sb)}＝${originalProduct}なので、小数点を${sa + sb}けた戻す。`,
        );
        for (const row of partials) {
          const effective = Array.isArray(row.digits)
            ? row.digits.map((digit) => digit || "0").join("")
            : row.digits;
          row.digits = decimal(BigInt(effective), sa + sb);
        }
        top.digits = KZ.format(av, "decimal");
        board.rows[1].digits = KZ.format(bv, "decimal");
        answer.digits = originalProduct;
        delete board.focus;
        board.caption =
          "元の小数の式に戻した筆算。部分積も元の大きさで表している。";
        push(
          `元の式に戻す：${KZ.format(av, "decimal")}×${KZ.format(bv, "decimal")}＝${originalProduct}。`,
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
      if (sb)
        board.caption = `両方を${10 ** sb}倍した筆算：${KZ.format(movedA, "decimal")}÷${divisor}。商の個数は元の式と同じ。`;
      push(
        sb
          ? `${KZ.format(bv, "decimal")}を整数にするため、両方を${10 ** sb}倍する。同じ倍率なら何個分かは変わらない。${KZ.format(av, "decimal")}÷${KZ.format(bv, "decimal")}＝${KZ.format(movedA, "decimal")}÷${divisor}。`
          : "わる数と、わられる数を書き、左の位から計算する。",
      );
      if (tail.length > (parts[1] || "").length) {
        push(
          `${KZ.format(movedA, "decimal")}＝${dividend}。小数まで割り進めるために0を補える。数の大きさは変わらない。${q.roundPlaces !== undefined ? `小数第${q.roundPlaces}位まで丸めるには、もう1つ右の位まで求めておく。` : ""}`,
          undefined,
          { intent: "decimal-extension" },
        );
      }
      if (tail)
        push(
          `商の小数点は、割られる数の小数点の真上。同じ位の答えを、その位へ書く。`,
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
          push(
            `${place(source.length - i, tail.length)}の余り${remainder}を、次の${place(source.length - i - 1, tail.length)}の個数へ直すと${remainder}×10＝${remainder * 10n}。次の数字${source[i]}の分を合わせる。`,
            {
              op: "*",
              a: String(remainder),
              b: "10",
              result: String(remainder * 10n),
            },
            { intent: "lower-unit" },
          );
          previousRow.digits = String(partial);
          previousRow.trailing = trailing;
          push(
            `${remainder * 10n}＋${source[i]}＝${partial}。これが「次の数字を下ろす」という操作。`,
            {
              op: "+",
              a: String(remainder * 10n),
              b: source[i],
              result: String(partial),
            },
            { intent: "lower-combine" },
          );
        }
        board.focus = offset + i;
        if (digit || started || i >= parts[0].length - 1) {
          started = true;
          if (divisor >= 10n && partial >= divisor) {
            const power = 10n ** BigInt(String(divisor).length - 1),
              leading = (divisor / power) * power;
            let trial = partial / leading;
            if (trial > 9n) trial = 9n;
            push(
              `${divisor}をおよそ${leading}として考える。${partial}÷${leading}から、商は${trial}くらいと見当を付ける。実際の積で確かめよう。`,
              undefined,
              { intent: "quotient-estimate" },
            );
            while (trial > digit) {
              quotient.digits[offset + i] = String(trial);
              push(
                `${divisor}×${trial}＝${divisor * trial}は${partial}より大きい。試した${trial}では多い。1小さくして試そう。`,
                {
                  op: "*",
                  a: String(divisor),
                  b: String(trial),
                  result: String(divisor * trial),
                },
              );
              trial--;
              quotient.digits[offset + i] = String(trial);
              push(
                `仮の商を${trial}に直した。次は${divisor}×${trial}を確かめる。`,
                undefined,
                { intent: "quotient-adjustment" },
              );
            }
          }
          push(
            `${divisor}×${digit}＝${product}は${partial}以下。${digit === 0n ? `${partial}では1組分の${divisor}を作れないので、この位の商は0。0を省くと位が変わってしまう。` : `${divisor}×${digit + 1n}＝${divisor * (digit + 1n)}は${partial}を超えるので、${digit}組まで。`}`,
            {
              op: "*",
              a: String(divisor),
              b: String(digit),
              result: String(product),
            },
            { intent: "quotient-choice" },
          );
          quotient.digits[offset + i] = String(digit);
          push(
            `${place(source.length - i - 1, tail.length)}の商として${digit}を書く。今見ている割られる数の位の真上に立てる。`,
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
          if (i + 1 === source.length)
            push(
              `余り${rem}は割る数${divisor}より小さい。${integerQuotient ? "商は整数までなので、ここで止める。" : rem === 0n ? "余りが0になったので割り切れた。" : "求める位まで計算できた。"}`,
            );
        } else {
          push(
            `${place(source.length - i - 1, tail.length)}の${partial}では、${divisor}を1組作れない。次の位まで合わせて見る。`,
            undefined,
            { intent: "division-start-search" },
          );
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
        const last = quotient.digits[offset + parts[0].length + q.roundPlaces],
          target =
            quotient.digits[offset + parts[0].length + q.roundPlaces - 1];
        push(
          `小数第${q.roundPlaces}位まで残す。1つ右の小数第${q.roundPlaces + 1}位は${last}。${Number(last) >= 5 ? `5以上なので、残す位の${target}を1増やす。9ならさらに左へくり上がる。` : "5未満なので、残す位はそのまま。"}`,
          undefined,
          { intent: "round-decision" },
        );
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
      if (sb && integerQuotient) {
        const value = KZ.calc(
            "-",
            av,
            KZ.calc("*", bv, KZ.rat(q.expectedExactValue.quotient)),
          ),
          movedRemainder = KZ.calc("*", value, 10n ** BigInt(sb));
        push(
          `作業の余り${KZ.format(movedRemainder, "decimal")}も元の余りの${10 ** sb}倍。${KZ.format(movedRemainder, "decimal")}÷${10 ** sb}＝${KZ.format(value, "decimal")}に戻す。商の個数は変わらない。`,
          undefined,
          { intent: "remainder-unit" },
        );
        const originalScale = Math.max(sa, sb),
          originalProduct = KZ.calc(
            "*",
            bv,
            KZ.rat(q.expectedExactValue.quotient),
          );
        const originalDividend = decimal(
          coefficient(av, originalScale),
          originalScale,
        );
        board.cols = Math.max(
          2,
          originalDividend.replace(".", "").length,
          String(q.expectedExactValue.quotient).length + originalScale,
        );
        board.rows = [
          {
            digits: String(q.expectedExactValue.quotient),
            quotient: true,
            trailing: originalScale,
          },
          {
            digits: originalDividend,
            dividend: originalDividend,
            divisor: KZ.format(bv, "decimal"),
          },
          {
            digits: decimal(
              coefficient(originalProduct, originalScale),
              originalScale,
            ),
            sign: "−",
            underline: true,
            stage: "product",
          },
          {
            digits: decimal(coefficient(value, originalScale), originalScale),
            stage: "remainder",
          },
        ];
        delete board.focus;
        board.caption =
          "元の数で商と余りを確かめた筆算。途中の整数の計算は「もどる」で確かめられる。";
        push(
          `元の数では、${KZ.format(av, "decimal")}−${KZ.format(originalProduct, "decimal")}＝${KZ.format(value, "decimal")}。この余りは${KZ.format(bv, "decimal")}より小さい。`,
        );
      }
      for (const t of q.solutionTrace || [])
        if (t.kind === "text" && /たしかめ：|余りの小数点/.test(t.text))
          push(t.text);
    }
    push(`こたえ：${KZ.answerText(q)}`);
    return result;
  }
  return Object.freeze({ steps, explain, hint });
})();
