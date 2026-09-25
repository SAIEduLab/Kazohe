// Deliberately independent of the app's math helpers and expected answers.
export function fraction(value) {
  if (typeof value === "object") return [BigInt(value.n), BigInt(value.d)];
  const s = String(value);
  if (s.includes("/")) return s.split("/").map(BigInt);
  const [i, f = ""] = s.split(".");
  return [BigInt(i + f), 10n ** BigInt(f.length)];
}
export const eq = (a, b) => {
  a = fraction(a);
  b = fraction(b);
  return a[0] * b[1] === b[0] * a[1];
};
export function operation(op, a, b) {
  a = fraction(a);
  b = fraction(b);
  const [n, d] =
    op === "+"
      ? [a[0] * b[1] + b[0] * a[1], a[1] * b[1]]
      : op === "-"
        ? [a[0] * b[1] - b[0] * a[1], a[1] * b[1]]
        : op === "*"
          ? [a[0] * b[0], a[1] * b[1]]
          : [a[0] * b[1], a[1] * b[0]];
  if (!d) throw Error("zero divisor");
  if (n < 0n) throw Error("negative intermediate");
  return { n: String(n), d: String(d) };
}
export function astValue(ast) {
  return (
    ast.value || operation(ast.op, astValue(ast.args[0]), astValue(ast.args[1]))
  );
}
export function reduce(v) {
  const [n, d] = fraction(v);
  let a = n,
    b = d;
  while (b) [a, b] = [b, a % b];
  return { n: String(n / a), d: String(d / a) };
}
export function rounded(v, p) {
  let [n, d] = fraction(v);
  const u = 10n ** BigInt(Math.abs(p));
  if (p < 0) d *= u;
  else n *= u;
  let q = n / d;
  if ((n % d) * 2n >= d) q++;
  return p < 0 ? { n: String(q * u), d: "1" } : { n: String(q), d: String(u) };
}
export function expected(q) {
  const v = q.values;
  if (q.task === "arithmetic") {
    const value = astValue(q.expressionAST);
    if (q.answerSpec.type === "quotient") {
      const [n, d] = fraction(value),
        quotient = n / d;
      return {
        quotient: String(quotient),
        remainder: operation(
          "-",
          astValue(q.expressionAST.args[0]),
          operation("*", String(quotient), astValue(q.expressionAST.args[1])),
        ),
      };
    }
    return q.roundPlaces === undefined ? value : rounded(value, q.roundPlaces);
  }
  if (q.task === "compare") {
    const a = fraction(v[0]),
      b = fraction(v[1]),
      diff = a[0] * b[1] - b[0] * a[1];
    return diff < 0n ? "<" : diff > 0n ? ">" : "=";
  }
  if (q.task === "parity") return BigInt(v[0]) % 2n ? "odd" : "even";
  if (q.task === "divisors") {
    const list = [];
    for (let i = 1n; i <= BigInt(v[0]); i++)
      if (BigInt(v[0]) % i === 0n) list.push(String(i));
    return list;
  }
  if (q.task === "gcd") {
    let result = 1n;
    for (let i = 1n; i <= BigInt(v[0]) && i <= BigInt(v[1]); i++)
      if (BigInt(v[0]) % i === 0n && BigInt(v[1]) % i === 0n) result = i;
    return { n: String(result), d: "1" };
  }
  if (q.task === "lcm") {
    let n = BigInt(v[0]);
    while (n % BigInt(v[1])) n += BigInt(v[0]);
    return { n: String(n), d: "1" };
  }
  if (q.task === "common") {
    let d = BigInt(v[0].d);
    while (d % BigInt(v[1].d)) d += BigInt(v[0].d);
    return v.map((f) => ({
      n: String((BigInt(f.n) * d) / BigInt(f.d)),
      d: String(d),
    }));
  }
  if (q.task === "round") return rounded(v[0], q.places);
  if (q.task === "reciprocal") {
    const [n, d] = fraction(v[0]);
    if (!n) throw Error("zero reciprocal");
    return { n: String(d), d: String(n) };
  }
  if (q.task === "blocks") return v;
  if (q.task === "fraction") return v[0];
  throw Error(q.task);
}
export function decimalString(v) {
  let [n, d] = fraction(v);
  let out = String(n / d),
    r = n % d;
  if (!r) return out;
  out += ".";
  for (let i = 0; r && i < 24; i++) {
    r *= 10n;
    out += String(r / d);
    r %= d;
  }
  if (r) throw Error("nonfinite");
  return out;
}
export function rawAnswer(q, value = expected(q)) {
  const s = q.answerSpec;
  if (s.type === "quotient")
    return {
      quotient: value.quotient,
      remainder: decimalString(value.remainder),
    };
  if (s.type === "blocks" || s.type === "set") return { values: value };
  if (s.type === "compare" || s.type === "parity") return { value };
  if (s.type === "common")
    return {
      first: { numerator: value[0].n, denominator: value[0].d },
      second: { numerator: value[1].n, denominator: value[1].d },
    };
  if (s.type === "fraction") {
    let v = reduce(value);
    if (s.denominator)
      v = {
        n: String((BigInt(v.n) * BigInt(s.denominator)) / BigInt(v.d)),
        d: s.denominator,
      };
    return {
      form: s.form || "fraction",
      whole: s.form === "mixed" ? String(BigInt(v.n) / BigInt(v.d)) : "",
      numerator: s.form === "mixed" ? String(BigInt(v.n) % BigInt(v.d)) : v.n,
      denominator: v.d,
    };
  }
  return { value: decimalString(value) };
}
