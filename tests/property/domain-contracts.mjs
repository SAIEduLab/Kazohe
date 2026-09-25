import assert from "node:assert/strict";
import { fraction, astValue } from "../../scripts/independent-math-oracle.mjs";

// Specification bounds, independently checked against generated operands.
const pairs = {
  "G1-C02": [0, 9, 0, 9],
  "G1-C03": [1, 9, 1, 9],
  "G1-C04": [0, 10, 0, 10],
  "G1-C05": [11, 18, 1, 9],
  "G2-C01": [10, 99, 10, 99],
  "G2-C02": [10, 99, 10, 99],
  "G2-C03": [10, 99, 1, 99],
  "G2-C04": [10, 198, 1, 99],
  "G2-C05": [100, 999, 1, 99],
  "G2-C06": [100, 999, 1, 99],
  "G2-C08": [1, 9, 1, 9],
  "G2-C09": [10, 19, 2, 5],
  "G3-C01": [100, 999, 1, 999],
  "G3-C02": [100, 999, 1, 999],
  "G3-C03": [1000, 9999, 1, 9999],
  "G3-C04": [1000, 9999, 1, 9999],
  "G3-C05": [10, 99, 0, 9],
  "G3-C06": [100, 999, 0, 9],
  "G3-C07": [10, 99, 10, 99],
  "G3-C08": [100, 999, 10, 99],
  "G3-C09": [0, 89, 1, 9],
  "G3-C10": [10, 99, 2, 9],
  "G3-C11": [0, "9.9", 0, "9.9"],
  "G3-C12": [0, "9.9", 0, "9.9"],
  "G4-C04": [10, 99, 1, 9],
  "G4-C05": [100, 999, 1, 9],
  "G4-C06": [10, 99, 10, 99],
  "G4-C07": [100, 999, 10, 99],
  "G4-C08": [0, "99.999", 0, "99.999"],
  "G4-C09": [0, "99.999", 0, "99.999"],
  "G4-C10": ["0.01", "99.99", 1, 99],
  "G4-C11": ["0.01", "99.99", 1, 9],
  "G4-C12": [1, 999, 2, 99],
  "G5-C01": [1, 999, "0.01", "9.99"],
  "G5-C02": ["0.01", "99.99", "0.01", "99.99"],
  "G5-C03": ["0.01", "999.99", "0.01", "99.99"],
  "G5-C04": [0, "99.99", "0.1", "9.9"],
  "G5-C05": [1, "99.99", "0.1", "9.9"],
};
const compare = (a, b) => {
  const [n, d] = fraction(a),
    [m, e] = fraction(b);
  return n * e < m * d ? -1 : n * e > m * d ? 1 : 0;
};
const span = (v, lo, hi) =>
  assert(
    compare(v, lo) >= 0 && compare(v, hi) <= 0,
    `${JSON.stringify(v)} outside ${lo}..${hi}`,
  );
const integer = (v) => {
  const [n, d] = fraction(v);
  return n % d === 0n;
};
const precision = (v, places) => {
  const [n, d] = fraction(v);
  return (n * 10n ** BigInt(places)) % d === 0n;
};
const leaves = (n) => (n.value ? [n] : n.args.flatMap(leaves));
const nodes = (n) => [n, ...(n.args || []).flatMap(nodes)];
function regroup(a, b, subtraction) {
  for (let power = 10; power <= 100000; power *= 10)
    if (
      subtraction ? a % power < b % power : (a % power) + (b % power) >= power
    )
      return true;
  return false;
}
export function domainContract(q) {
  const id = q.challengeId,
    ast = q.expressionAST;
  if (pairs[id]) {
    const [a, b] = ast.args.map(astValue),
      [al, ah, bl, bh] = pairs[id];
    span(a, al, ah);
    span(b, bl, bh);
    if (
      /^G[12]-C/.test(id) ||
      /^G3-C(?:0\d|10)$/.test(id) ||
      /^G4-C0[4-7]$/.test(id)
    ) {
      assert(integer(a) && integer(b));
      const aa = Number(fraction(a)[0] / fraction(a)[1]),
        bb = Number(fraction(b)[0] / fraction(b)[1]);
      if (["G2-C01", "G2-C03"].includes(id))
        assert(!regroup(aa, bb, ast.op === "-"));
      if (["G2-C02", "G2-C04"].includes(id))
        assert(regroup(aa, bb, ast.op === "-"));
      if (id === "G2-C05") assert((aa % 100) + bb < 100);
      if (id === "G2-C06") assert(aa % 100 >= bb);
      if (id === "G1-C02") span(astValue(ast), 0, 10);
      if (id === "G1-C03") span(astValue(ast), 11, 18);
      if (id === "G1-C05") {
        span(astValue(ast), 0, 9);
        assert(bb > aa % 10);
      }
      if (id === "G3-C10") {
        assert(Math.floor(aa / 10) % bb === 0 && (aa % 10) % bb === 0);
        span(astValue(ast), 10, 99);
      }
      if (id === "G4-C06") assert(compare(a, b) >= 0);
    }
    if (["G3-C11", "G3-C12"].includes(id))
      assert(precision(a, 1) && precision(b, 1));
    if (id === "G3-C11") assert(!integer(a) || !integer(b));
    if (["G4-C08", "G4-C09"].includes(id))
      assert(precision(a, 3) && precision(b, 3));
    if (id === "G4-C08") assert(!precision(a, 1) || !precision(b, 1));
    if (["G4-C11", "G4-C12", "G5-C03"].includes(id))
      assert(precision(astValue(ast), 3));
    if (id === "G4-C12") assert(!integer(astValue(ast)));
    if (["G5-C01", "G5-C02", "G5-C03"].includes(id)) assert(!integer(b));
    if (id === "G5-C02") assert(!integer(a) && precision(astValue(ast), 4));
    if (id === "G5-C05") assert(!precision(astValue(ast), q.roundPlaces));
  }
  const compareMax = {
    "G1-N01": 100,
    "G2-N01": 9999,
    "G3-N01": 99999999,
    "G3-N04": "9.9",
    "G4-N01": "9999999999999999",
    "G4-N04": "99.999",
  };
  if (compareMax[id]) {
    q.values.forEach((v) => span(v, 0, compareMax[id]));
    if (id === "G4-N01")
      assert(q.values.some((v) => compare(v, 100000000) >= 0));
    if (id === "G4-N04")
      for (const label of q.labels || [])
        assert((label.split(".")[1] || "").length <= 3);
  }
  if (id === "G2-N01") {
    const texts = q.values.map((v) => String(fraction(v)[0] / fraction(v)[1]));
    if (q.conditionBucket === "digit-length")
      assert(texts[0].length !== texts[1].length);
    if (q.conditionBucket === "interior-zero")
      assert(texts.some((t) => t.slice(1, -1).includes("0")));
  }
  if (["G3-C13", "G3-C14", "G4-C13", "G4-C14"].includes(id)) {
    const max = id.startsWith("G3") ? 1 : 5;
    ast.args.forEach((n) => span(astValue(n), 0, max));
    assert(q.answerSpec.reduced === false);
    if (id === "G3-C13") span(astValue(ast), 0, 1);
  }
  if (["G4-C15", "G4-C16", "G5-C09", "G6-C07"].includes(id)) {
    const all = nodes(ast),
      terms = leaves(ast),
      kind = id.startsWith("G4")
        ? "integer"
        : id.startsWith("G5")
          ? "decimal"
          : "fraction";
    assert(
      all.filter((n) => n.op).length >= 2 &&
        all.filter((n) => n.op).length <= 3,
    );
    terms.forEach((n) =>
      span(n.value, 0, kind === "integer" ? 100 : kind === "decimal" ? 20 : 5),
    );
    if (kind === "integer") {
      all.forEach((n) => {
        span(astValue(n), 0, 9999);
        assert(integer(astValue(n)));
      });
    }
    if (kind === "decimal") {
      terms.forEach((n) => assert(precision(n.value, 2)));
      all.forEach((n) => assert(precision(astValue(n), 4)));
    }
    if (id === "G4-C15") assert(all.every((n) => !n.group));
    if (id === "G4-C16") assert(all.some((n) => n.group));
  }
  if (["G5-N13", "G6-N02"].includes(id))
    leaves(ast).forEach((n) => span(n.value, 0, 20));
  if (/^G6-C0[1-6]$/.test(id)) {
    const [a, b] = ast.args.map(astValue),
      kind = Number(id.slice(-1));
    if (kind <= 2) {
      span(a, 0, 5);
      span(b, 1, 12);
      assert(integer(b));
    }
    if (kind >= 5) {
      span(a, 0, "3.999");
      span(b, 0, "3.999");
    }
    assert(q.answerSpec.reduced);
  }
  if (ast) nodes(ast).forEach((n) => assert(compare(astValue(n), 0) >= 0));
  if (q.task === "divisors") span(q.values[0], 1, 60);
  if (q.task === "gcd") q.values.forEach((v) => span(v, 1, 100));
  if (q.task === "lcm") q.values.forEach((v) => span(v, 1, 30));
  if (q.task === "reciprocal") assert(compare(q.values[0], 0) > 0);
}
