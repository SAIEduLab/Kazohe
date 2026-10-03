/* Classify the actual column work, independently of the generated bucket. */
const KZWritten = (() => {
  const ids = Object.freeze([
    "G2-C01",
    "G2-C02",
    "G2-C03",
    "G2-C04",
    "G2-C05",
    "G2-C06",
    "G3-C01",
    "G3-C02",
    "G3-C03",
    "G3-C04",
    "G3-C05",
    "G3-C06",
    "G3-C07",
    "G3-C08",
    "G3-C11",
    "G3-C12",
    "G4-C04",
    "G4-C05",
    "G4-C06",
    "G4-C07",
    "G4-C08",
    "G4-C09",
    "G4-C10",
    "G4-C11",
    "G4-C12",
    "G5-C01",
    "G5-C02",
    "G5-C03",
    "G5-C04",
    "G5-C05",
  ]);
  const fixed = Object.freeze({
    "G2-C01": "none",
    "G2-C02": "some",
    "G2-C03": "none",
    "G2-C04": "some",
  });
  const pairs = Object.freeze({
    "G2-C01": ["G2-C01", "G2-C02"],
    "G2-C02": ["G2-C01", "G2-C02"],
    "G2-C03": ["G2-C03", "G2-C04"],
    "G2-C04": ["G2-C03", "G2-C04"],
  });
  const coefficient = (value, scale) => {
    const v = KZ.number(value);
    return (BigInt(v.n) * 10n ** BigInt(scale)) / BigInt(v.d);
  };
  function add(values) {
    let carry = 0n,
      found = false;
    values = values.map(BigInt);
    while (values.some((v) => v !== 0n)) {
      const sum = values.reduce((s, v) => s + (v % 10n), carry);
      carry = sum / 10n;
      found ||= carry > 0n;
      values = values.map((v) => v / 10n);
    }
    return found;
  }
  function subtract(a, b) {
    let borrowed = 0n,
      found = false;
    a = BigInt(a);
    b = BigInt(b);
    while (a || b) {
      borrowed = (a % 10n) - borrowed < b % 10n ? 1n : 0n;
      found ||= borrowed === 1n;
      a /= 10n;
      b /= 10n;
    }
    return found;
  }
  function classify(q) {
    const ast = q.expressionAST;
    if (!ast?.op || !ids.includes(q.challengeId))
      throw Error("筆算の条件をたしかめてね。");
    const av = KZ.evaluate(ast.args[0]),
      bv = KZ.evaluate(ast.args[1]);
    const sa = KZ.decimalPlaces(av),
      sb = KZ.decimalPlaces(bv);
    const result = {
      operation: ast.op,
      partialProductCarry: false,
      partialSumCarry: false,
      divisionBorrow: false,
      has: false,
    };
    if (ast.op === "+" || ast.op === "-") {
      const scale = Math.max(sa, sb),
        a = coefficient(av, scale),
        b = coefficient(bv, scale);
      result.has = ast.op === "+" ? add([a, b]) : subtract(a, b);
    } else if (ast.op === "*") {
      const a = coefficient(av, sa),
        b = coefficient(bv, sb),
        partials = [];
      let shift = 1n;
      for (const digit of String(b).split("").reverse().map(BigInt)) {
        let incoming = 0n;
        for (const value of String(a).split("").reverse().map(BigInt)) {
          incoming = (value * digit + incoming) / 10n;
          result.partialProductCarry ||= incoming > 0n;
        }
        partials.push(a * digit * shift);
        shift *= 10n;
      }
      result.partialSumCarry = add(partials);
      result.has = result.partialProductCarry || result.partialSumCarry;
    } else if (ast.op === "/") {
      // The same scale change as the school algorithm: make only the divisor an integer.
      // Transferring a remainder to the next place and multiplication carries are separate operations.
      const divisor = coefficient(bv, sb),
        moved = KZ.calc("*", av, KZ.rat(10n ** BigInt(sb)));
      const integer = q.answerSpec.type === "quotient" || q.integerQuotient;
      const places = integer
        ? 0
        : q.roundPlaces !== undefined
          ? q.roundPlaces + 1
          : KZ.decimalPlaces(KZ.evaluate(ast));
      if (!Number.isFinite(places)) throw Error("わり算のけたをたしかめてね。");
      const [whole, fraction = ""] = KZ.format(moved, "decimal").split(".");
      const source = whole + fraction.padEnd(places, "0").slice(0, places);
      let remainder = 0n;
      for (const digit of source) {
        const current = remainder * 10n + BigInt(digit),
          product = (current / divisor) * divisor;
        result.divisionBorrow ||= subtract(current, product);
        remainder = current - product;
      }
      result.has = result.divisionBorrow;
    } else throw Error("筆算の条件をたしかめてね。");
    return result;
  }
  function available(id, remainder = "mixed") {
    if (fixed[id]) return [fixed[id]];
    // With a two-digit dividend, an exact division has no earlier subtraction
    // that can borrow. The final subtraction removes the entire partial dividend.
    if (["G4-C04", "G4-C06"].includes(id) && remainder === "none")
      return ["none"];
    return ["none", "some"];
  }
  function label(id) {
    if (
      [
        "G4-C04",
        "G4-C05",
        "G4-C06",
        "G4-C07",
        "G4-C11",
        "G4-C12",
        "G5-C03",
        "G5-C04",
        "G5-C05",
      ].includes(id)
    )
      return "途中のひき算のくり下がり";
    return [
      "G2-C03",
      "G2-C04",
      "G2-C06",
      "G3-C02",
      "G3-C04",
      "G3-C12",
      "G4-C09",
    ].includes(id)
      ? "くり下がり"
      : "くり上がり";
  }
  return Object.freeze({ ids, fixed, pairs, classify, available, label });
})();
