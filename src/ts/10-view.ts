/* Display-only helpers. Embedded in the final HTML; no runtime dependencies. */
import { KZLanguage } from "./01-language.ts";
import { KZTeaching } from "./04-teaching.ts";
import { KZ } from "./07-run-and-save.ts";
import type {
  AnswerSpec,
  ChallengeId,
  KZUIApi,
  Question,
  RawAnswerObject,
  RawFractionInput,
  TeachingStep,
  WrittenBoard,
  WrittenRow,
} from "../types/contracts.d.ts";

type ViewChild = Node | string | null | undefined;

export const KZUI: KZUIApi = (() => {
  const node = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, string | number> = {},
    children: ViewChild | readonly ViewChild[] = [],
  ): HTMLElementTagNameMap[K] => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      n.setAttribute(k, String(v));
    }
    const items = Array.isArray(children) ? children : [children];
    for (const c of items) {
      if (c !== null && c !== undefined) {
        n.append(typeof c === "string" ? document.createTextNode(c) : c);
      }
    }
    return n;
  };
  const readable = KZLanguage.readable;
  function math(
    value: unknown,
    grade = 6,
    attrs: Record<string, string | number> = {},
  ): HTMLSpanElement {
    const s = readable(value, grade);
    const out = node("span", { class: "math-text", ...attrs });
    const pattern = /(?:(\d+)と)?(\d+|□)\/(\d+|□)/g;
    const appendText = (text: string): void => {
      let end = 0;
      for (const m of text.matchAll(/(?<![\d.])\d{5,}(?![\d.])/g)) {
        const index = m.index ?? 0;
        out.append(text.slice(end, index));
        const groups = m[0].match(/\d{1,4}(?=(?:\d{4})*$)/g) ?? [];
        out.append(
          node(
            "span",
            { class: "large-number", "aria-label": m[0] },
            groups.map((part) =>
              node(
                "span",
                { class: "number-group", "aria-hidden": "true" },
                part,
              ),
            ),
          ),
        );
        end = index + m[0].length;
      }
      out.append(text.slice(end));
    };
    let end = 0;
    for (const m of s.matchAll(pattern)) {
      const index = m.index ?? 0;
      appendText(s.slice(end, index));
      const f = node(
        "span",
        {
          class: "math-fraction",
          role: "math",
          "aria-label": `${m[3]}ぶんの${m[2]}`,
        },
        [
          node(
            "span",
            { class: "math-numerator", "aria-hidden": "true" },
            m[2],
          ),
          node(
            "span",
            { class: "math-denominator", "aria-hidden": "true" },
            m[3],
          ),
        ],
      );
      out.append(
        m[1]
          ? node(
              "span",
              {
                class: "math-mixed",
                role: "math",
                "aria-label": `${m[1]}と${m[3]}ぶんの${m[2]}`,
              },
              [node("span", { "aria-hidden": "true" }, m[1]), f],
            )
          : f,
      );
      end = index + m[0].length;
    }
    appendText(s.slice(end));
    return out;
  }
  const exampleCache = new Map<ChallengeId, string>();
  function example(id: ChallengeId): string {
    const cached = exampleCache.get(id);
    if (cached !== undefined) return cached;
    const prompt = KZ.generate(id, {}, KZ.createGenerator(20260925)).prompt ?? "";
    exampleCache.set(id, prompt);
    return prompt;
  }
  function splitDigits(value: string | readonly string[]): {
    digits: string[];
    points: number[];
  } {
    const raw = Array.isArray(value) ? value : [...String(value)];
    const digits: string[] = [];
    const points: number[] = [];
    for (const c of raw) {
      if (c === ".") points.push(digits.length - 1);
      else digits.push(String(c));
    }
    return { digits, points };
  }
  function divisionHook(): SVGSVGElement {
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    for (const [k, v] of Object.entries({
      viewBox: "0 0 24 44",
      class: "division-hook",
      "aria-hidden": "true",
      preserveAspectRatio: "none",
    })) {
      svg.setAttribute(k, v);
    }
    const path = document.createElementNS(svgNs, "path");
    path.setAttribute("d", "M1 1 H24 M1 1 C19 9 19 35 1 43");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    svg.append(path);
    return svg;
  }
  function written(
    q: Question,
    complete = false,
    grade = 6,
    state: WrittenBoard | null = null,
  ): HTMLDivElement {
    const ast = q.expressionAST;
    if (!ast || !ast.op) throw Error("筆算の式をたしかめてね。");
    const division = ast.op === "/";
    let model: WrittenBoard | null =
      state || (complete ? (KZTeaching.steps(q).at(-1)?.board ?? null) : null);
    if (!model) {
      let a = KZ.format(KZ.evaluate(ast.args[0]), "decimal");
      let b = KZ.format(KZ.evaluate(ast.args[1]), "decimal");
      if (["+", "-"].includes(ast.op)) {
        const scale = Math.max(
          (a.split(".")[1] || "").length,
          (b.split(".")[1] || "").length,
        );
        const pad = (v: string): string =>
          scale
            ? v.split(".")[0] + "." + (v.split(".")[1] || "").padEnd(scale, "0")
            : v;
        a = pad(a);
        b = pad(b);
      }
      const rows: WrittenRow[] = division
        ? [
            { digits: "", quotient: true },
            { digits: a, dividend: a, divisor: b },
          ]
        : [
            { digits: a },
            {
              digits: b,
              sign: ast.op === "+" ? "＋" : ast.op === "-" ? "−" : "×",
              underline: true,
            },
          ];
      model = {
        rows,
        cols: Math.max(
          2,
          ...rows.map((r) => splitDigits(r.digits).digits.length),
        ),
      };
    }
    const { rows, cols } = model;
    const divisor = rows.find((r) => r.divisor)?.divisor;
    const board = node("div", {
      class: "written-board" + (division ? " division-board" : ""),
      style: `--cols:${cols};--prefix:${division ? Math.max(2.6, String(divisor ?? "").length * 0.65 + 1.15) : 1.3}em`,
      "data-testid": "written-board",
      "aria-label": readable("筆算", grade),
    });
    for (const [rowIndex, r] of rows.entries()) {
      const parts = splitDigits(r.digits);
      const start = cols - parts.digits.length - (r.trailing || 0);
      const annotated =
        complete &&
        ((!division && rowIndex === 0) ||
          Object.keys(r.annotations ?? {}).length > 0);
      const numeric = node("div", {
        class:
          "written-row" +
          (r.line && !rows[rowIndex - 1]?.underline ? " line" : "") +
          (r.underline ? " underline" : "") +
          (r.dividend ? " division-roof" : "") +
          (annotated ? " annotated-row" : ""),
        "data-row-kind": r.dividend
          ? "dividend"
          : r.quotient
            ? "quotient"
            : "digits",
        "data-stage": r.stage || "",
      });
      for (let i = 0; i < cols; i++) {
        const at = i - start;
        const value = parts.digits[at] ?? "";
        const annotation = r.annotations?.[i];
        const cell = node(
          "span",
          {
            class:
              "written-cell" +
              (annotation?.crossed ? " regrouped" : "") +
              (model.focus === i ? " teaching-focus" : ""),
            "data-column": i,
            "data-value": value,
          },
          node("span", { class: "written-digit" }, value),
        );
        if (annotation) {
          cell.append(
            node(
              "span",
              {
                class: "written-annotation",
                "data-annotation-value": annotation.value,
                "aria-label": readable(`この位は${annotation.value}`, grade),
              },
              annotation.value,
            ),
          );
        }
        if (parts.points.includes(at) || Boolean(r.points?.includes(i))) {
          cell.append(
            node(
              "span",
              {
                class: "decimal-mark",
                "aria-label": readable("小数点", grade),
              },
              ".",
            ),
          );
        }
        numeric.append(cell);
      }
      const prefix = node(
        "span",
        { class: "written-prefix" },
        r.divisor ? [math(r.divisor, grade), divisionHook()] : r.sign || "",
      );
      board.append(
        node(
          "div",
          {
            class:
              "written-equation" + (annotated ? " annotated-equation" : ""),
          },
          [prefix, numeric],
        ),
      );
    }
    const figure = node(
      "div",
      {
        class: "written-figure",
        tabindex: "0",
        "aria-label": readable("筆算。点線ごとに同じ位がならびます。", grade),
      },
      board,
    );
    return node(
      "div",
      {
        class:
          "written-wrap " + (complete ? "teaching-written" : "problem-written"),
      },
      [
        figure,
        model.caption
          ? node(
              "p",
              { class: "written-caption" },
              readable(model.caption, grade),
            )
          : null,
      ],
    );
  }
  function counters(step: TeachingStep, grade: number): HTMLDivElement {
    const a = step.a ?? 0;
    const b = step.b ?? 0;
    const op = step.operation ?? "+";
    const total = op === "*" ? a * b : op === "+" ? a + b : a;
    const visible =
      step.pictureStage === "before"
        ? a
        : step.pictureStage === "groups"
          ? a * (step.visibleGroups ?? 0)
          : total;
    const picture = node("div", {
      class: "counter-picture",
      role: "img",
      "aria-label": readable(step.text, grade),
    });
    const rowSize = op === "*" ? a : 10;
    if (!total) picture.append(node("span", { class: "zero-group" }, "0こ"));
    if (rowSize > 0) {
      for (let start = 0; start < visible; start += rowSize) {
        const count = Math.min(rowSize, visible - start);
        const group = node("div", {
          class: op === "*" ? "counter-group" : "ten-frame",
          style: `--count:${rowSize}`,
        });
        for (let i = 0; i < (op === "*" ? count : 10); i++) {
          const index = start + i;
          const filled = i < count;
          const removed =
            op === "-" &&
            step.pictureStage !== "before" &&
            (step.splitTen ? index < 10 && index >= 10 - b : index >= a - b);
          group.append(
            node(
              "span",
              { class: "counter-slot" },
              filled
                ? node(
                    "span",
                    {
                      class:
                        "counter" +
                        (removed ? " removed" : "") +
                        (op === "+" && index >= a ? " added" : ""),
                    },
                    removed ? "×" : "",
                  )
                : null,
            ),
          );
        }
        picture.append(group);
      }
    }
    return picture;
  }
  function solution(
    q: Question,
    grade: number,
    stepIndex?: number,
  ): HTMLDivElement {
    const steps = KZTeaching.steps(q);
    const index =
      stepIndex === undefined
        ? steps.length - 1
        : Math.max(0, Math.min(stepIndex, steps.length - 1));
    const current = steps[index];
    const complete = index === steps.length - 1;
    const content = node(
      "div",
      {
        class: "support",
        "data-step-index": index,
        "data-step-count": steps.length,
      },
      [node("h3", {}, "いっしょに たしかめよう")],
    );
    if (q.written) {
      content.append(written(q, true, grade, current.board ?? null));
    }
    if (q.task === "compare") {
      const values = q.values ?? [];
      const leftLabel =
        q.labels?.[0] || (values[0] !== undefined ? KZ.format(values[0]) : "");
      const rightLabel =
        q.labels?.[1] || (values[1] !== undefined ? KZ.format(values[1]) : "");
      content.append(
        node(
          "div",
          { class: "teaching-comparison" },
          math(
            `${leftLabel} ${complete ? KZ.answerText(q).split("（")[0] : "□"} ${rightLabel}`,
            grade,
          ),
        ),
      );
    }
    const diagram =
      steps.slice(0, index + 1).findLast((step) => step.diagram)?.diagram ?? [];
    for (const [n, d] of diagram) {
      content.append(
        node(
          "div",
          {
            class: "bar",
            style: `--parts:${d}`,
            role: "img",
            "aria-label": `${d}とうぶんの ${n}つぶん`,
          },
          Array.from({ length: d }, (_, i) =>
            node("span", { class: i < n ? "filled" : "" }),
          ),
        ),
      );
    }
    const list = node("ol", {
      class: "solution-steps",
      start: index + 1,
    });
    const li = node(
      "li",
      { "data-current-step": "true" },
      math(current.text, grade),
    );
    if (current.kind === "counters") li.append(counters(current, grade));
    list.append(li);
    if (!q.written && current.kind !== "counters") {
      const picture = steps
        .slice(0, index + 1)
        .findLast((t) => t.kind === "counters");
      if (picture) {
        content.append(counters(picture, grade));
      }
    }
    content.append(
      node(
        "aside",
        {
          class: "written-notes",
          "aria-label": "ときかた",
          "data-testid": "solution-explanation",
        },
        [
          node("h4", {}, complete ? "こたえを たしかめよう" : "この いって"),
          list,
        ],
      ),
    );
    return content;
  }
  function answer(
    raw: RawAnswerObject | null | undefined,
    spec: AnswerSpec,
  ): string {
    if (!raw) return "—";
    const f = (r: RawFractionInput | undefined): string =>
      r?.form === "integer"
        ? String(r.whole || "□")
        : `${r?.form === "mixed" ? (r.whole || "0") + "と" : ""}${r?.numerator || "□"}/${r?.denominator || "□"}`;
    if (spec.type === "fraction") return f(raw);
    if (spec.type === "common") return `${f(raw.first)} と ${f(raw.second)}`;
    if (spec.type === "quotient") {
      return `${raw.quotient || "□"} あまり ${raw.remainder || "□"}`;
    }
    if (spec.type === "set") {
      return [
        ...(raw.values ?? []),
        ...(String(raw["set-value"] || "").trim() ? [raw["set-value"] ?? ""] : []),
      ].join("、");
    }
    if (spec.type === "blocks") {
      return (spec.labels ?? [])
        .map((label, i) => ({
          label,
          value: raw.values?.[i] || "□",
          place: Number(label.match(/[\d.]+/)?.[0] || 1),
        }))
        .sort((a, b) => b.place - a.place)
        .map((r) => `${r.label}が${r.value}こ`)
        .join("、");
    }
    const labels: Readonly<Record<string, string | undefined>> = {
      "<": "＜",
      ">": "＞",
      "=": "＝",
      even: "偶数（ぐうすう）",
      odd: "奇数（きすう）",
    };
    const key = raw.value;
    return (key !== undefined ? labels[key] : undefined) || String(key ?? "□");
  }
  function localize<T extends HTMLElement>(root: T, grade: number): T {
    const visit = (target: Node): void => {
      if (target.nodeType === 3) {
        target.nodeValue = readable(target.nodeValue ?? "", grade);
      } else if (target instanceof Element) {
        for (const attribute of ["aria-label", "title", "placeholder"]) {
          const val = target.getAttribute(attribute);
          if (val !== null) {
            target.setAttribute(attribute, readable(val, grade));
          }
        }
        for (const child of target.childNodes) {
          visit(child);
        }
      }
    };
    visit(root);
    return root;
  }
  return Object.freeze({
    readable,
    example,
    answer,
    math: (
      value: unknown,
      grade = 6,
      attrs: Record<string, string | number> = {},
    ) => localize(math(value, grade, attrs), grade),
    written: (
      q: Question,
      complete = false,
      grade = 6,
      state: WrittenBoard | null = null,
    ) => localize(written(q, complete, grade, state), grade),
    solution: (q: Question, grade: number, stepIndex?: number) =>
      localize(solution(q, grade, stepIndex), grade),
  });
})();
