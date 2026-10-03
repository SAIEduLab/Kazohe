/* Official grade allocation and whole-word readings, embedded for offline use. */
const KZLanguage = (() => {
  const data = __KAZOHE_LANGUAGE__;
  const han = /\p{Script=Han}/u;
  const allowed = Array.from(
    { length: 6 },
    (_, i) => new Set(data.allocations.slice(0, i).join("")),
  );
  const words = Object.keys(data.readings).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
    "g",
  );
  function forbidden(value, grade) {
    if (!Number.isInteger(grade) || grade < 1 || grade > 6)
      throw Error("学年をたしかめてね。");
    return [
      ...new Set(
        [...String(value ?? "")].filter(
          (char) => han.test(char) && !allowed[grade - 1].has(char),
        ),
      ),
    ];
  }
  function readable(value, grade = 6) {
    const text = String(value ?? "");
    return text.replace(pattern, (word) =>
      forbidden(word, grade).length ||
      (grade <= 2 && ["Score", "コンボ"].includes(word))
        ? data.readings[word]
        : word,
    );
  }
  function audit(value, grade) {
    const rendered = readable(value, grade),
      invalid = forbidden(rendered, grade);
    return { valid: invalid.length === 0, rendered, invalid };
  }
  return Object.freeze({
    readable,
    forbidden,
    audit,
    allocations: Object.freeze(data.allocations),
    source: data.source,
  });
})();
