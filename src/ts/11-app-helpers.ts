/* Shared DOM, modal, audio, teaching-review, and answer-input helpers for #kazohe-app. */
import { KZTeaching } from "./04-teaching.ts";
import { KZ } from "./07-run-and-save.ts";
import { KZUI } from "./10-view.ts";
import type {
  ApplyResultOutput,
  ChallengeId,
  ChallengeSpec,
  Domain,
  Grade,
  Question,
  RawAnswerObject,
  RawFractionInput,
  RunConfig,
  RunState,
  SaveData,
  ScreenName,
  StorageAdapter,
  StorageLike,
} from "../types/contracts.d.ts";
import type { PageElement, PageFinder } from "../types/page.d.ts";

export type ElChild = Node | string | null | undefined;
export type ElAttrValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ((event: Event) => void);
export type ElAttrs = Record<string, ElAttrValue>;

export interface AppState {
  saved: SaveData;
  config: RunConfig;
  run: RunState | null;
  result: ApplyResultOutput | null;
  activeScreen: ScreenName;
  grade: Grade;
  category: Domain;
  multiGrade: boolean;
  multiSelect: boolean;
  selectedGrades: Set<Grade>;
  activeInput: HTMLInputElement | null;
  feedbackTimer: number | undefined;
  finishSaved: boolean;
  returnFocus: Element | null;
  closeDialog: (() => void) | null;
  audioContext: AudioContext | null;
  draft: RawAnswerObject | null;
  currentRead: (() => RawAnswerObject) | null;
  draftQuestionId: string | null;
  solutionQuestionId: string | null;
  solutionStep: number;
  reviewQuestionId: string | null;
  readonly reviewSteps: Map<string, number>;
}

export const $: PageFinder = (selector) =>
  document.querySelector(selector) as PageElement<typeof selector>;

export const app = $("#app");
export const dockRoot = $("#start-dock-root");
export const dialog = $("#dialog");
export const announcer = $("#announcer");
export const now = (): number => performance.now();

let languageReady = false;

export function challengeOf(id: ChallengeId): ChallengeSpec {
  const found = KZ.BY_ID[id];
  if (!found) throw Error("チャレンジをえらんでね。");
  return found;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isControlDisabled(element: Element): boolean {
  return (
    (element instanceof HTMLButtonElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement) &&
    element.disabled
  );
}

export function uiGrade(): number {
  if (!languageReady) return 1;
  if (appState.activeScreen === "play" || appState.activeScreen === "result") {
    return appState.run?.config.languageGrade || 1;
  }
  const grades: number[] = [
    ...(appState.multiGrade ? appState.selectedGrades : [appState.grade]),
    ...appState.config.selectedIds.map((id) => challengeOf(id).grade),
  ];
  return grades.length ? Math.min(...grades) : appState.grade;
}

export const warn = (s: string): void => {
  const n = $("#storage-warning");
  n.hidden = false;
  n.textContent = KZUI.readable(s, uiGrade());
};

function resolveStorage(): StorageLike {
  try {
    return window.localStorage;
  } catch {
    return {
      getItem(): string | null {
        throw Error("blocked");
      },
      setItem(): void {
        throw Error("blocked");
      },
      removeItem(): void {
        throw Error("blocked");
      },
    };
  }
}

export const adapter: StorageAdapter = KZ.storageAdapter(resolveStorage(), warn);

const initialSaved = adapter.load();
const initialConfig = KZ.clone(initialSaved.settings.config);
const initialFirst = challengeOf(initialConfig.selectedIds[0]);

export const appState: AppState = {
  saved: initialSaved,
  config: initialConfig,
  run: null,
  result: null,
  activeScreen: initialSaved.settings.onboarded ? "menu" : "welcome",
  grade: initialFirst.grade,
  category: initialFirst.category,
  multiGrade: false,
  multiSelect: initialConfig.selectedIds.length > 1,
  selectedGrades: new Set<Grade>(
    initialConfig.selectedIds.map((id) => challengeOf(id).grade),
  ),
  activeInput: null,
  feedbackTimer: undefined,
  finishSaved: false,
  returnFocus: null,
  closeDialog: null,
  audioContext: null,
  draft: null,
  currentRead: null,
  draftQuestionId: null,
  solutionQuestionId: null,
  solutionStep: 0,
  reviewQuestionId: null,
  reviewSteps: new Map<string, number>(),
};

// A restored/recommended configuration replaces every selection control.
// Browsing a grade or category still remains independent during menu edits.
export function syncSelection(): void {
  const first = challengeOf(appState.config.selectedIds[0]);
  appState.grade = first.grade;
  appState.category = first.category;
  appState.selectedGrades = new Set<Grade>(
    appState.config.selectedIds.map((id) => challengeOf(id).grade),
  );
  appState.multiSelect = appState.config.selectedIds.length > 1;
  appState.multiGrade = appState.selectedGrades.size > 1;
}

syncSelection();
languageReady = true;

export const persist = (): void => {
  if (appState.config.selectedIds.length) {
    appState.saved.settings.config = appState.config;
  }
  adapter.write(appState.saved);
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: ElAttrs = {},
  children: ElChild | readonly ElChild[] = [],
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key.startsWith("on") && typeof value === "function") {
      n.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (typeof value === "function") {
      continue;
    } else if (key === "text") {
      n.textContent = attrs["data-user-text"]
        ? String(value)
        : KZUI.readable(String(value), uiGrade());
    } else if (key === "class") {
      n.className = String(value);
    } else if (key === "checked") {
      if (n instanceof HTMLInputElement) n.checked = Boolean(value);
    } else if (key === "disabled") {
      if (
        n instanceof HTMLButtonElement ||
        n instanceof HTMLInputElement ||
        n instanceof HTMLSelectElement ||
        n instanceof HTMLOptionElement
      ) {
        n.disabled = Boolean(value);
      }
    } else if (key === "hidden") {
      n.hidden = Boolean(value);
    } else if (key === "value") {
      if (
        n instanceof HTMLInputElement ||
        n instanceof HTMLSelectElement ||
        n instanceof HTMLOptionElement ||
        n instanceof HTMLTextAreaElement
      ) {
        n.value = String(value);
      }
    } else {
      const str = String(value);
      n.setAttribute(
        key,
        ["aria-label", "title", "placeholder"].includes(key)
          ? KZUI.readable(str, uiGrade())
          : str,
      );
    }
  }
  const items = Array.isArray(children) ? children : [children];
  for (const child of items) {
    if (child !== null && child !== undefined) {
      n.append(
        typeof child === "string"
          ? document.createTextNode(KZUI.readable(child, uiGrade()))
          : child,
      );
    }
  }
  return n;
}

export const button = (
  label: string,
  action: (event: Event) => void,
  attrs: ElAttrs = {},
): HTMLButtonElement =>
  el("button", {
    type: "button",
    text: KZUI.readable(label, uiGrade()),
    onClick: action,
    ...attrs,
  });

export const text = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  s: string,
  attrs: ElAttrs = {},
): HTMLElementTagNameMap[K] =>
  el(tag, {
    text: attrs["data-user-text"] ? s : KZUI.readable(s, uiGrade()),
    ...attrs,
  });

export const math = (
  s: unknown,
  attrs: Record<string, string | number> = {},
): HTMLSpanElement => KZUI.math(s, uiGrade(), attrs);

export const panel = (
  children: ElChild | readonly ElChild[],
  cls = "",
): HTMLElement => el("section", { class: "panel " + cls }, children);

export const announce = (s: string): void => {
  announcer.textContent = KZUI.readable(s, uiGrade());
};

export function select(
  label: string,
  options: readonly (readonly [string | number, string])[],
  value: string | number,
  action: (selectedValue: string) => void,
  attrs: ElAttrs = {},
): HTMLLabelElement {
  const n = el(
    "select",
    {
      onChange: (e) => {
        if (e.target instanceof HTMLSelectElement) action(e.target.value);
      },
      ...attrs,
    },
    options.map(([v, t]) => el("option", { value: v, text: t })),
  );
  n.value = String(value);
  return el("label", { class: "field config-select" }, [
    text("span", label),
    n,
  ]);
}

export function saveName(value: string): void {
  const clean = [...value.replace(/[\u0000-\u001f\u007f]/g, "")]
    .slice(0, 30)
    .join("");
  appState.saved.settings.name = clean;
}

export function focusFirst(): void {
  const visible = (selector: string): HTMLElement | undefined => {
    for (const candidate of app.querySelectorAll(selector)) {
      if (
        candidate instanceof HTMLElement &&
        candidate.getClientRects().length &&
        !isControlDisabled(candidate)
      ) {
        return candidate;
      }
    }
    return undefined;
  };
  const n =
    visible("[data-support-focus]") ||
    visible("[autofocus]") ||
    visible("input:not([type=checkbox]),button:not(:disabled),summary");
  (n || app).focus({ preventScroll: true });
  if (
    appState.activeScreen === "play" &&
    appState.run !== null &&
    ["HINT_READING", "SOLUTION_READING"].includes(appState.run.phase)
  ) {
    $(".support-panel")?.scrollIntoView({ block: "start" });
  }
}

export function modal(
  title: string,
  body: readonly ElChild[],
  actions: readonly ElChild[],
): void {
  if (dialog.open) dialog.close();
  appState.returnFocus = document.activeElement;
  $("#dialog-title").textContent = KZUI.readable(title, uiGrade());
  $("#dialog-body").replaceChildren(
    ...body.filter((x): x is Node | string => x !== null && x !== undefined),
  );
  $("#dialog-actions").replaceChildren(
    ...actions.filter((x): x is Node | string => x !== null && x !== undefined),
  );
  dialog.showModal();
  const target =
    dialog.querySelector("[autofocus]") || dialog.querySelector("button,input");
  if (target instanceof HTMLElement) target.focus();
}

export function dismiss(): void {
  dialog.close();
  if (
    appState.returnFocus instanceof HTMLElement &&
    appState.returnFocus.isConnected
  ) {
    appState.returnFocus.focus();
  }
  const cb = appState.closeDialog;
  appState.closeDialog = null;
  cb?.();
}

dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  dismiss();
});

export function confirmAction(
  title: string,
  message: string,
  accept: () => void,
  cancel: () => void = () => {},
): void {
  let accepted = false;
  appState.closeDialog = () => {
    if (!accepted) cancel();
  };
  modal(
    title,
    [text("p", message)],
    [
      button("やめる", dismiss, { autofocus: "" }),
      button(
        "はい",
        () => {
          accepted = true;
          dismiss();
          accept();
        },
        { class: "primary", "data-testid": "confirm-accept" },
      ),
    ],
  );
}

export function tone(correct: boolean): void {
  if (!appState.saved.settings.sound) return;
  try {
    const audioGlobal: OlderAudioGlobal = globalThis;
    const AudioCtor = audioGlobal.AudioContext || audioGlobal.webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = (appState.audioContext ||= new AudioCtor());
    ctx.resume().catch(() => {});
    (correct ? [523.25, 659.25, 783.99] : [196, 164.81]).forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.09;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.04, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.2);
    });
  } catch {
    /* Audio may be unavailable; the visible feedback remains sufficient. */
  }
}

export function drawBars(items: readonly [number, number][]): HTMLDivElement[] {
  return items.map(([n, d]) =>
    el(
      "div",
      {
        class: "bar",
        style: `--parts:${d}`,
        role: "img",
        "aria-label": `${d}等分の${n}つ分`,
      },
      Array.from({ length: d }, (_, i) =>
        el("span", { class: i < n ? "filled" : "" }),
      ),
    ),
  );
}

export function writtenRows(q: Question, complete = false): HTMLDivElement {
  return KZUI.written(q, complete, uiGrade());
}

export function solution(q: Question, stepIndex?: number): HTMLDivElement {
  return KZUI.solution(q, uiGrade(), stepIndex);
}

export function solutionNavigation(
  step: number,
  count: number,
  move: (delta: number) => void,
  prefix = "solution",
): HTMLDivElement {
  return el(
    "div",
    {
      class: "solution-navigation",
      role: "group",
      "aria-label": "ときかたを いってずつ",
    },
    [
      button("← もどる", () => move(-1), {
        "data-testid": prefix + "-back",
        disabled: step === 0,
      }),
      text("span", `${step + 1}／${count}`, {
        "data-testid": prefix + "-progress",
        "aria-live": "polite",
      }),
      button("つぎへ →", () => move(1), {
        "data-testid": prefix + "-forward",
        class: "primary",
        disabled: step === count - 1,
      }),
    ],
  );
}

export function reviewSolution(q: Question): HTMLDivElement {
  const viewer = el("div", { class: "review-solution" });
  const teaching = KZTeaching.steps(q);
  const qid = q.questionId ?? "";
  let step = appState.reviewSteps.get(qid) ?? 0;
  const move = (delta = 0): void => {
    const active = document.activeElement;
    const focused =
      active && viewer.contains(active)
        ? active.getAttribute("data-testid")
        : null;
    step = Math.max(0, Math.min(step + delta, teaching.length - 1));
    appState.reviewSteps.set(qid, step);
    viewer.replaceChildren(
      solution(q, step),
      solutionNavigation(step, teaching.length, move, "review-solution"),
    );
    if (focused) {
      const target = viewer.querySelector(`[data-testid="${focused}"]`);
      const nextFocus =
        target && isControlDisabled(target)
          ? target
              .closest(".solution-navigation")
              ?.querySelector("button:not(:disabled)")
          : target;
      if (nextFocus instanceof HTMLElement) {
        nextFocus.focus({ preventScroll: true });
      }
    }
    if (delta) {
      appState.reviewQuestionId = qid;
      announce(`${step + 1}／${teaching.length}。${teaching[step].text}`);
    }
  };
  move();
  return viewer;
}

function fractionFieldValue(
  part: RawFractionInput | undefined,
  field: string,
): string {
  if (!part) return "";
  if (field === "whole") return part.whole ?? "";
  if (field === "numerator") return part.numerator ?? "";
  if (field === "denominator") return part.denominator ?? "";
  return "";
}

function draftFieldValue(draft: RawAnswerObject | null, key: string): string {
  if (!draft) return "";
  if (key.includes("-first")) {
    return fractionFieldValue(draft.first, key.replace("-first", ""));
  }
  if (key.includes("-second")) {
    return fractionFieldValue(draft.second, key.replace("-second", ""));
  }
  if (key.startsWith("block-")) {
    return draft.values?.[Number(key.slice(6))] ?? "";
  }
  if (key === "value") return draft.value ?? "";
  if (key === "quotient") return draft.quotient ?? "";
  if (key === "remainder") return draft.remainder ?? "";
  if (key === "whole") return draft.whole ?? "";
  if (key === "numerator") return draft.numerator ?? "";
  if (key === "denominator") return draft.denominator ?? "";
  if (key === "set-value") return draft["set-value"] ?? "";
  return "";
}

export function answerFields(
  q: Question,
  disabled: boolean,
): { box: HTMLDivElement; raw: () => RawAnswerObject } {
  const s = q.answerSpec;
  const box = el("div", { class: "answer-fields", "data-testid": "answer" });
  let raw: () => RawAnswerObject = () => ({});
  const activate = (n: HTMLInputElement): void => {
    appState.activeInput = n;
    box
      .querySelectorAll("input")
      .forEach((x) => x.classList.toggle("active-answer", x === n));
    const target = $("[data-active-target]");
    if (target) {
      target.textContent = KZUI.readable(
        (n.getAttribute("aria-label") ?? "") + "に いれるよ",
        uiGrade(),
      );
    }
    const point = $('[data-key="."]');
    if (point instanceof HTMLButtonElement) {
      point.disabled = disabled || n.inputMode !== "decimal";
    }
  };
  const input = (
    label: string,
    key: string,
    decimal = false,
  ): { n: HTMLInputElement; node: HTMLLabelElement } => {
    const value = draftFieldValue(appState.draft, key);
    const n = el("input", {
      type: "text",
      value,
      inputmode: decimal ? "decimal" : "numeric",
      autocomplete: "off",
      maxlength: "40",
      "aria-label": label,
      "data-testid": "answer-" + key,
      disabled,
      onFocus: () => {
        activate(n);
      },
    });
    return {
      n,
      node: el("label", { class: "field" }, [text("span", label), n]),
    };
  };
  const fraction = (
    suffix: "" | "-first" | "-second" = "",
  ): { node: HTMLDivElement; read: () => RawFractionInput } => {
    const prefix =
      suffix === "-first"
        ? "1つめの "
        : suffix === "-second"
          ? "2つめの "
          : "";
    const whole = input(prefix + "整数の部分", "whole" + suffix);
    const num = input(prefix + "分子（上）", "numerator" + suffix);
    const den = input(prefix + "分母（下）", "denominator" + suffix);
    const form = el(
      "select",
      { "aria-label": "答えの形" + suffix, disabled },
      [
        ["fraction", "分数"],
        ["mixed", "帯分数"],
        ["integer", "整数"],
      ]
        .filter(([v]) =>
          s.type === "common" ||
          s.form ||
          challengeOf(q.challengeId).grade <= 3
            ? v === (s.form || "fraction")
            : true,
        )
        .map(([v, t]) => el("option", { value: v, text: t })),
    );
    const draftPart =
      suffix === "-first"
        ? appState.draft?.first
        : suffix === "-second"
          ? appState.draft?.second
          : appState.draft;
    form.value = draftPart?.form || s.form || "fraction";
    const f = el("div", { class: "fraction" }, [num.node, den.node]);
    const mixed = el("div", { class: "mixed" }, [whole.node, f]);
    const change = (event?: Event): void => {
      whole.node.hidden = form.value === "fraction";
      f.hidden = form.value === "integer";
      if (event) {
        const next = form.value === "fraction" ? num.n : whole.n;
        activate(next);
        next.focus();
      }
    };
    form.addEventListener("change", change);
    change();
    return {
      node: el("div", {}, [
        el(
          "label",
          { class: "field form-choice", hidden: form.options.length === 1 },
          [text("span", "答えの形"), form],
        ),
        mixed,
      ]),
      read: () => ({
        form: form.value,
        whole: whole.n.value,
        numerator: num.n.value,
        denominator: den.n.value,
      }),
    };
  };
  if (s.type === "integer" || s.type === "decimal") {
    const x = input("こたえ", "value", s.type === "decimal");
    x.n.className = "wide";
    box.append(x.node);
    raw = () => ({ value: x.n.value });
  } else if (s.type === "quotient") {
    const a = input("商（こたえ）", "quotient");
    const b = input("あまり", "remainder", Boolean(s.decimalRemainder));
    box.append(a.node, b.node);
    raw = () => ({ quotient: a.n.value, remainder: b.n.value });
  } else if (s.type === "fraction") {
    const f = fraction();
    box.append(f.node);
    raw = f.read;
  } else if (s.type === "common") {
    const a = fraction("-first");
    const b = fraction("-second");
    const values = q.values ?? [];
    [a, b].forEach((f, i) => {
      const label =
        q.labels?.[i] || (values[i] !== undefined ? KZ.format(values[i]) : "");
      box.append(
        el("div", { class: "common-answer" }, [
          math(label + " ↓", {
            class: "math-text common-original",
          }),
          f.node,
        ]),
      );
    });
    raw = () => ({ first: a.read(), second: b.read() });
  } else if (s.type === "blocks") {
    const labels = s.labels ?? [];
    const inputs = labels.map((label, i) => input(label, "block-" + i));
    const ordered = inputs
      .map((x, i) => ({
        x,
        place: Number(labels[i].match(/[\d.]+/)?.[0] || 1),
      }))
      .sort((a, b) => b.place - a.place);
    ordered.forEach(({ x }) => box.append(x.node));
    box.classList.add("blocks-answer");
    raw = () => ({ values: inputs.map((x) => x.n.value) });
  } else if (s.type === "compare" || s.type === "parity") {
    let value: string | null = appState.draft?.value ?? null;
    const choices: readonly [string, string][] =
      s.type === "compare"
        ? [
            [">", "＞ 大きい"],
            ["<", "＜ 小さい"],
            ["=", "＝ 同じ"],
          ]
        : [
            ["even", "偶数（ぐうすう）"],
            ["odd", "奇数（きすう）"],
          ];
    choices.forEach(([v, t]) =>
      box.append(
        button(
          t,
          () => {
            value = v;
            box
              .querySelectorAll("button")
              .forEach((b) =>
                b.setAttribute(
                  "aria-pressed",
                  String(b.dataset.choice === v),
                ),
              );
          },
          { "aria-pressed": v === value, disabled, "data-choice": v },
        ),
      ),
    );
    raw = () => (value !== null ? { value } : {});
  } else if (s.type === "set") {
    const x = input("追加する数", "set-value");
    const chips = el("div", { class: "chips" });
    const values: string[] = [...(appState.draft?.values ?? [])];
    const error = text("p", "", { class: "inline-error", role: "alert" });
    const renderChips = (): void =>
      chips.replaceChildren(
        ...values.map((v) =>
          button(
            v + " ×",
            () => {
              values.splice(values.indexOf(v), 1);
              renderChips();
            },
            { "aria-label": v + "を消す", disabled },
          ),
        ),
      );
    const add = (): void => {
      const parsed = KZ.normalizeInput({ type: "integer" }, x.n.value);
      if (parsed.error) {
        announce(parsed.error);
        error.textContent = KZUI.readable(parsed.error, uiGrade());
        return;
      }
      if (!parsed.value || typeof parsed.value === "string") return;
      const v = parsed.value.n;
      if (values.includes(v)) {
        announce("同じ数は1回だけだよ。");
        error.textContent = "おなじ かずは 1かいだけだよ。";
        return;
      }
      values.push(v);
      error.textContent = "";
      x.n.value = "";
      renderChips();
      x.n.focus();
    };
    renderChips();
    box.append(
      x.node,
      button("追加", add, { disabled, "data-testid": "add-number" }),
      chips,
      error,
    );
    x.n.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        add();
      }
    });
    raw = () => ({ values, "set-value": x.n.value });
  }
  const first = [...box.querySelectorAll("input")].find(
    (n) => !n.closest("[hidden]"),
  );
  if (first) {
    first.setAttribute("autofocus", "");
    activate(first);
  }
  return { box, raw };
}

export const percent = (n: number, d: number): string =>
  d ? `${Math.round((n / d) * 1000) / 10}%（${n}/${d}）` : "—";

export function positionStartDock(): void {
  const dock = dockRoot.querySelector(".start-dock");
  if (!(dock instanceof HTMLElement)) return;
  const viewport = window.visualViewport;
  const width = viewport?.width || window.innerWidth;
  const height = viewport?.height || window.innerHeight;
  const left = viewport?.offsetLeft || 0;
  const top = viewport?.offsetTop || 0;
  dock.style.setProperty("--dock-width", `${width}px`);
  dock.style.setProperty("--dock-center", `${left + width / 2}px`);
  dock.style.setProperty(
    "--dock-inset",
    `${Math.max(8, window.innerHeight - top - height + 8)}px`,
  );
  dock.classList.toggle("dock-compact", width < 360 || height < 240);
  document.documentElement.style.setProperty(
    "--dock-height",
    `${dock.getBoundingClientRect().height}px`,
  );
}
