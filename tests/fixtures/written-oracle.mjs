/* Test-only oracle: plain decimal strings and columns; no product helpers/buckets. */
export function writtenOracle(q) {
  function decimal(r) {
    let n = BigInt(r.n),
      d = BigInt(r.d),
      scale = 0;
    while (n % d && scale < 12) {
      n *= 10n;
      scale++;
    }
    if (n % d) throw Error("non decimal operand");
    const s = String(n / d).padStart(scale + 1, "0");
    return {
      coefficient: n / d,
      scale,
      whole: scale ? s.slice(0, -scale) : s,
      fraction: scale ? s.slice(-scale) : "",
    };
  }
  function carries(rows) {
    const columns = rows.map((r) => String(r).split("").reverse().map(Number));
    let incoming = 0,
      found = false;
    for (let i = 0; i < Math.max(...columns.map((r) => r.length)); i++) {
      const value = columns.reduce((sum, row) => sum + (row[i] || 0), incoming);
      incoming = Math.floor(value / 10);
      if (incoming) found = true;
    }
    return found;
  }
  function borrows(top, bottom) {
    const a = String(top).split("").reverse().map(Number),
      b = String(bottom).split("").reverse().map(Number);
    let debt = 0,
      found = false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] - debt < (b[i] || 0)) {
        debt = 1;
        found = true;
      } else debt = 0;
    }
    return found;
  }
  const ast = q.expressionAST,
    a = decimal(ast.args[0].value),
    b = decimal(ast.args[1].value);
  const result = {
    has: false,
    partialProductCarry: false,
    partialSumCarry: false,
    divisionBorrow: false,
  };
  if (["+", "-"].includes(ast.op)) {
    const scale = Math.max(a.scale, b.scale),
      left = a.coefficient * 10n ** BigInt(scale - a.scale),
      right = b.coefficient * 10n ** BigInt(scale - b.scale);
    result.has = ast.op === "+" ? carries([left, right]) : borrows(left, right);
  } else if (ast.op === "*") {
    const top = String(a.coefficient).split("").reverse().map(Number),
      bottom = String(b.coefficient).split("").reverse().map(Number),
      rows = [];
    bottom.forEach((multiplier, offset) => {
      let carry = 0;
      for (const value of top) {
        const product = value * multiplier + carry;
        carry = Math.floor(product / 10);
        if (carry) result.partialProductCarry = true;
      }
      rows.push(a.coefficient * BigInt(multiplier) * 10n ** BigInt(offset));
    });
    result.partialSumCarry = carries(rows);
    result.has = result.partialProductCarry || result.partialSumCarry;
  } else {
    // Form the integer divisor and the displayed dividend without using a production conversion.
    const divisor = b.coefficient;
    const moved = decimal({
      n: String(a.coefficient * 10n ** BigInt(b.scale)),
      d: String(10n ** BigInt(a.scale)),
    });
    const integer = q.answerSpec.type === "quotient" || q.integerQuotient;
    let places = 0;
    if (!integer) {
      if (q.roundPlaces !== undefined) places = q.roundPlaces + 1;
      else
        places = decimal({
          n: String(a.coefficient * 10n ** BigInt(b.scale)),
          d: String(b.coefficient * 10n ** BigInt(a.scale)),
        }).scale;
    }
    const digits =
      moved.whole + moved.fraction.padEnd(places, "0").slice(0, places);
    let rest = 0n;
    for (const digit of digits) {
      const subtotal = rest * 10n + BigInt(digit),
        quotient = subtotal / divisor,
        remove = quotient * divisor;
      if (borrows(subtotal, remove)) result.divisionBorrow = true;
      rest = subtotal % divisor;
    }
    result.has = result.divisionBorrow;
  }
  return result;
}

export const writtenCases = [
  ["G3-C01", "+", "199", "1", true],
  ["G3-C02", "-", "1000", "1", true],
  ["G3-C11", "+", "0.9", "0.1", true],
  ["G3-C12", "-", "1", "0.1", true],
  ["G3-C05", "*", "24", "3", true, true, false],
  ["G3-C07", "*", "11", "19", true, false, true],
  ["G3-C07", "*", "12", "12", false, false, false],
  ["G5-C02", "*", "0.11", "0.19", true, false, true],
  ["G4-C04", "/", "20", "3", true],
  ["G4-C04", "/", "22", "3", false],
  ["G4-C05", "/", "105", "3", true],
  ["G4-C07", "/", "312", "12", true],
  ["G4-C06", "/", "72", "24", false],
  ["G4-C11", "/", "1.05", "3", true],
  ["G5-C03", "/", "3.12", "0.12", true],
];
