/* Display-only helpers. Embedded in the final HTML; no runtime dependencies. */
const KZUI = (() => {
  const node = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    for (const c of Array.isArray(children) ? children : [children])
      if (c !== null && c !== undefined)
        n.append(typeof c === "string" ? document.createTextNode(c) : c);
    return n;
  };
  const readable = KZLanguage.readable;
  function math(value, grade = 6, attrs = {}) {
    const s = readable(value, grade),
      out = node("span", { class: "math-text", ...attrs });
    const pattern = /(?:(\d+)と)?(\d+|□)\/(\d+|□)/g;
    const appendText = (text) => {
      let end = 0;
      for (const m of text.matchAll(/(?<![\d.])\d{5,}(?![\d.])/g)) {
        out.append(text.slice(end, m.index));
        out.append(
          node(
            "span",
            { class: "large-number", "aria-label": m[0] },
            m[0]
              .match(/\d{1,4}(?=(?:\d{4})*$)/g)
              .map((part) =>
                node(
                  "span",
                  { class: "number-group", "aria-hidden": "true" },
                  part,
                ),
              ),
          ),
        );
        end = m.index + m[0].length;
      }
      out.append(text.slice(end));
    };
    let end = 0;
    for (const m of s.matchAll(pattern)) {
      appendText(s.slice(end, m.index));
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
      end = m.index + m[0].length;
    }
    appendText(s.slice(end));
    return out;
  }
  const exampleCache = new Map();
  function example(id) {
    if (!exampleCache.has(id))
      exampleCache.set(
        id,
        KZ.generate(id, {}, KZ.createGenerator(20260925)).prompt,
      );
    return exampleCache.get(id);
  }
  function splitDigits(value) {
    const raw = Array.isArray(value) ? value : [...String(value)];
    const digits = [],
      points = [];
    for (const c of raw) {
      if (c === ".") points.push(digits.length - 1);
      else digits.push(String(c));
    }
    return { digits, points };
  }
  function divisionHook() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [k, v] of Object.entries({
      viewBox: "0 0 24 44",
      class: "division-hook",
      "aria-hidden": "true",
      preserveAspectRatio: "none",
    }))
      svg.setAttribute(k, v);
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", "M1 1 H24 M1 1 C19 9 19 35 1 43");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    svg.append(path);
    return svg;
  }
  function written(q, complete = false, grade = 6, state = null) {
    const ast = q.expressionAST,
      division = ast.op === "/";
    let model = state || (complete ? KZTeaching.steps(q).at(-1).board : null);
    if (!model) {
      let a = KZ.format(KZ.evaluate(ast.args[0]), "decimal"),
        b = KZ.format(KZ.evaluate(ast.args[1]), "decimal");
      if (["+", "-"].includes(ast.op)) {
        const scale = Math.max(
          (a.split(".")[1] || "").length,
          (b.split(".")[1] || "").length,
        );
        const pad = (v) =>
          scale
            ? v.split(".")[0] + "." + (v.split(".")[1] || "").padEnd(scale, "0")
            : v;
        a = pad(a);
        b = pad(b);
      }
      const rows = division
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
    const { rows, cols } = model,
      divisor = rows.find((r) => r.divisor)?.divisor;
    const board = node("div", {
      class: "written-board" + (division ? " division-board" : ""),
      style: `--cols:${cols};--prefix:${division ? Math.max(2.6, String(divisor).length * 0.65 + 1.15) : 1.3}em`,
      "data-testid": "written-board",
      "aria-label": readable("筆算", grade),
    });
    for (const [rowIndex, r] of rows.entries()) {
      const parts = splitDigits(r.digits),
        start = cols - parts.digits.length - (r.trailing || 0);
      const annotated =
        complete &&
        ((!division && rowIndex === 0) ||
          Object.keys(r.annotations || {}).length > 0);
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
        const at = i - start,
          value = parts.digits[at] ?? "",
          annotation = r.annotations?.[i];
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
        if (annotation)
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
        if (parts.points.includes(at) || r.points?.includes(i))
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
  function counters(step, grade) {
    const total =
      step.operation === "*"
        ? step.a * step.b
        : step.operation === "+"
          ? step.a + step.b
          : step.a;
    const visible =
      step.pictureStage === "before"
        ? step.operation === "*"
          ? step.a
          : step.a
        : step.pictureStage === "groups"
          ? step.a * step.visibleGroups
          : total;
    const picture = node("div", {
      class: "counter-picture",
      role: "img",
      "aria-label": readable(step.text, grade),
    });
    const rowSize = step.operation === "*" ? step.a : 10;
    if (!total) picture.append(node("span", { class: "zero-group" }, "0こ"));
    for (let start = 0; start < visible; start += rowSize) {
      const count = Math.min(rowSize, visible - start),
        group = node("div", {
          class: step.operation === "*" ? "counter-group" : "ten-frame",
          style: `--count:${rowSize}`,
        });
      for (let i = 0; i < (step.operation === "*" ? count : 10); i++) {
        const index = start + i,
          filled = i < count,
          removed =
            step.operation === "-" &&
            step.pictureStage !== "before" &&
            (step.splitTen
              ? index < 10 && index >= 10 - step.b
              : index >= step.a - step.b);
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
                      (step.operation === "+" && index >= step.a
                        ? " added"
                        : ""),
                  },
                  removed ? "×" : "",
                )
              : null,
          ),
        );
      }
      picture.append(group);
    }
    return picture;
  }
  function solution(q, grade, stepIndex) {
    const steps = KZTeaching.steps(q),
      index =
        stepIndex === undefined
          ? steps.length - 1
          : Math.max(0, Math.min(stepIndex, steps.length - 1));
    const current = steps[index],
      complete = index === steps.length - 1;
    const content = node(
      "div",
      {
        class: "support",
        "data-step-index": index,
        "data-step-count": steps.length,
      },
      [node("h3", {}, "いっしょに たしかめよう")],
    );
    if (q.written) content.append(written(q, true, grade, current.board));
    if (q.task === "compare")
      content.append(
        node(
          "div",
          { class: "teaching-comparison" },
          math(
            `${q.labels?.[0] || KZ.format(q.values[0])} ${complete ? KZ.answerText(q).split("（")[0] : "□"} ${q.labels?.[1] || KZ.format(q.values[1])}`,
            grade,
          ),
        ),
      );
    const diagram =
      steps.slice(0, index + 1).findLast((step) => step.diagram)?.diagram || [];
    for (const [n, d] of diagram)
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
    const list = node("ol", {
      class: "solution-steps",
      start: index + 1,
    });
    for (const t of [current]) {
      const li = node(
        "li",
        { "data-current-step": String(t === current) },
        math(t.text, grade),
      );
      if (t.kind === "counters") li.append(counters(t, grade));
      if (t.kind === "dots")
        li.append(
          counters(
            { operation: "+", a: t.count, b: 0, text: `${t.count}こ` },
            grade,
          ),
        );
      list.append(li);
    }
    if (!q.written && !["counters", "dots"].includes(current.kind)) {
      const picture = steps
        .slice(0, index + 1)
        .findLast((t) => ["counters", "dots"].includes(t.kind));
      if (picture)
        content.append(
          counters(
            picture.kind === "dots"
              ? {
                  operation: "+",
                  a: picture.count,
                  b: 0,
                  text: `${picture.count}こ`,
                }
              : picture,
            grade,
          ),
        );
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
  function answer(raw, spec) {
    if (!raw) return "—";
    const f = (r) =>
      r?.form === "integer"
        ? String(r.whole || "□")
        : `${r?.form === "mixed" ? (r.whole || "0") + "と" : ""}${r?.numerator || "□"}/${r?.denominator || "□"}`;
    if (spec.type === "fraction") return f(raw);
    if (spec.type === "common") return `${f(raw.first)} と ${f(raw.second)}`;
    if (spec.type === "quotient")
      return `${raw.quotient || "□"} あまり ${raw.remainder || "□"}`;
    if (spec.type === "set")
      return [
        ...(raw.values || []),
        ...(String(raw["set-value"] || "").trim() ? [raw["set-value"]] : []),
      ].join("、");
    if (spec.type === "blocks")
      return spec.labels
        .map((label, i) => ({
          label,
          value: raw.values?.[i] || "□",
          place: Number(label.match(/[\d.]+/)?.[0] || 1),
        }))
        .sort((a, b) => b.place - a.place)
        .map((r) => `${r.label}が${r.value}こ`)
        .join("、");
    return (
      {
        "<": "＜",
        ">": "＞",
        "=": "＝",
        even: "偶数（ぐうすう）",
        odd: "奇数（きすう）",
      }[raw.value] || String(raw.value ?? "□")
    );
  }
  function localize(root, grade) {
    const visit = (node) => {
      if (node.nodeType === 3) node.nodeValue = readable(node.nodeValue, grade);
      else if (node.nodeType === 1) {
        for (const attribute of ["aria-label", "title", "placeholder"])
          if (node.hasAttribute(attribute))
            node.setAttribute(
              attribute,
              readable(node.getAttribute(attribute), grade),
            );
        for (const child of node.childNodes) visit(child);
      }
    };
    visit(root);
    return root;
  }
  return Object.freeze({
    readable,
    example,
    answer,
    math: (value, grade = 6, attrs = {}) =>
      localize(math(value, grade, attrs), grade),
    written: (q, complete = false, grade = 6, state = null) =>
      localize(written(q, complete, grade, state), grade),
    solution: (q, grade, stepIndex) =>
      localize(solution(q, grade, stepIndex), grade),
  });
})();
