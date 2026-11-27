/* Official grade allocation and whole-word readings, embedded for offline use. */
import languageJson from "../language.json" with { type: "json" };
import type {
  KZLanguageApi,
  LanguageAuditResult,
  LanguageData,
} from "../types/contracts.d.ts";

export const KZLanguage: KZLanguageApi = (() => {
  const data: LanguageData = languageJson;
  const han = /\p{Script=Han}/u;
  const allowed: Set<string>[] = Array.from(
    { length: 6 },
    (_, i) => new Set<string>(data.allocations.slice(0, i).join("")),
  );
  const words = Object.keys(data.readings).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
    "g",
  );
  function forbidden(value: unknown, grade: number): string[] {
    if (!Number.isInteger(grade) || grade < 1 || grade > 6) {
      throw Error("学年をたしかめてね。");
    }
    return [
      ...new Set<string>(
        [...String(value ?? "")].filter(
          (char) => han.test(char) && !allowed[grade - 1].has(char),
        ),
      ),
    ];
  }
  function readable(value: unknown, grade = 6): string {
    const text = String(value ?? "");
    return text.replace(pattern, (word: string) =>
      forbidden(word, grade).length ||
      (grade <= 2 && ["Score", "コンボ"].includes(word))
        ? (data.readings[word] ?? word)
        : word,
    );
  }
  function audit(value: unknown, grade: number): LanguageAuditResult {
    const rendered = readable(value, grade);
    const invalid = forbidden(rendered, grade);
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
