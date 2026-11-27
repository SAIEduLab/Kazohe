/* Welcome, play, results, settings, event dispatch, and startup wiring for #kazohe-app. */
import { KZTeaching } from "./04-teaching.ts";
import { KZ } from "./07-run-and-save.ts";
import { KZUI } from "./10-view.ts";
import {
  $,
  adapter,
  announce,
  answerFields,
  app,
  appState,
  button,
  challengeLabelNodes,
  challengeOf,
  confirmAction,
  dismiss,
  dockRoot,
  drawBars,
  el,
  errorMessage,
  focusFirst,
  isControlDisabled,
  math,
  modal,
  now,
  panel,
  percent,
  persist,
  positionStartDock,
  reviewSolution,
  saveName,
  solution,
  solutionNavigation,
  syncSelection,
  text,
  tone,
  writtenRows,
} from "./11-app-helpers.ts";
import type { ElChild } from "./11-app-helpers.ts";
import { menu, recommendation, returnButton } from "./12-app-menu.ts";
import type {
  ChallengeId,
  KazoheTestHooks,
  KazoheWindow,
  RawAnswerObject,
  RunEvent,
  SupportClass,
} from "../types/contracts.d.ts";

const kazoheWindow: KazoheWindow = window;
const testHooks: KazoheTestHooks | null = kazoheWindow.__KAZOHE_TEST__ ?? null;

const TERMINAL_LABELS: Readonly<
  Record<"correct" | "help" | "unanswered", string>
> = {
  correct: "せいかい",
  help: "助けてもらった",
  unanswered: "未回答",
};

function welcome(): HTMLElement {
  const input = el("input", {
    id: "name",
    maxlength: "60",
    autocomplete: "off",
    "aria-label": "なまえ（入れなくてもいいよ）",
    autofocus: "",
  });
  return panel(
    [
      text("h2", "さあ、はじめよう。"),
      text(
        "p",
        "けいさんも、かずのことも。じぶんのペースで れんしゅうしよう。",
      ),
      el("label", { class: "field", for: "name" }, [
        text("span", "なまえ（入れなくてもいいよ）"),
        input,
      ]),
      el("div", { class: "actions" }, [
        button(
          "はじめる",
          () => {
            saveName(input.value);
            appState.saved.settings.onboarded = true;
            appState.activeScreen = "menu";
            persist();
            render();
            focusFirst();
          },
          { class: "primary", "data-testid": "welcome-start" },
        ),
        button(
          "スキップ",
          () => {
            appState.saved.settings.onboarded = true;
            appState.activeScreen = "menu";
            persist();
            render();
            focusFirst();
          },
          { "data-testid": "skip" },
        ),
      ]),
    ],
    "welcome",
  );
}

function start(): void {
  const begin = (): void => {
    const nextRun = KZ.createRun(
      appState.config,
      testHooks?.seed ?? Date.now(),
      now(),
    );
    if (testHooks?.fixedQuestion && nextRun.currentQuestion) {
      const q = KZ.complete(KZ.clone(testHooks.fixedQuestion));
      q.questionId = nextRun.currentQuestion.questionId;
      nextRun.currentQuestion = q;
      nextRun.records[0].question = q;
    }
    appState.run = nextRun;
    appState.activeScreen = "play";
    appState.result = null;
    appState.finishSaved = false;
    render();
    focusFirst();
  };
  if (appState.saved.practiceCheckpoint) {
    confirmAction(
      "つづきを置きかえますか？",
      "新しいれんしゅうを はじめると、保存していた つづきは消えます。",
      () => {
        appState.saved.practiceCheckpoint = null;
        persist();
        begin();
      },
    );
  } else {
    begin();
  }
}

function resumeCheckpoint(): void {
  if (!appState.saved.practiceCheckpoint) return;
  const restored = KZ.clone(appState.saved.practiceCheckpoint);
  appState.run = restored;
  appState.config = KZ.clone(restored.config);
  syncSelection();
  persist();
  restored.lastNow = now();
  restored.pauseReasons = [];
  appState.finishSaved = false;
  appState.activeScreen = restored.finishedOnce ? "result" : "play";
  if (restored.finishedOnce) {
    finish();
  } else {
    render();
    focusFirst();
  }
}

function finish(): void {
  if (appState.finishSaved || !appState.run) return;
  appState.finishSaved = true;
  appState.reviewSteps.clear();
  appState.reviewQuestionId = null;
  clearTimeout(appState.feedbackTimer);
  const outcome = KZ.applyResult(appState.saved, appState.run);
  appState.result = outcome;
  appState.saved = outcome.saved;
  persist();
  appState.activeScreen = "result";
  render();
  focusFirst();
  announce("れんしゅうが おわりました。");
}

function updateClock(): void {
  const n = $("#clock");
  if (n && appState.run) {
    n.textContent =
      appState.run.config.mode === "time"
        ? `${Math.ceil((appState.run.activeTimeRemainingMs ?? 0) / 1000)}びょう`
        : "なし";
  }
}

function dispatch(event: RunEvent): void {
  const before = appState.run;
  if (!before || before.finishedOnce) return;
  const next = KZ.reduceRun(before, event, now());
  appState.run = next;
  if (
    event.type === "SUBMIT" &&
    !next.notice?.includes("入れて") &&
    next.phase !== before.phase
  ) {
    appState.currentRead = null;
    appState.draft = null;
  }
  if (next.finishedOnce) {
    finish();
    return;
  }
  if (
    (event.type === "SUBMIT" &&
      next.phase === "CORRECT_FEEDBACK" &&
      before.phase === "QUESTION") ||
    (event.type === "HELP" &&
      next.phase === "SOLUTION_READING" &&
      before.phase === "QUESTION")
  ) {
    appState.saved.practiceCheckpoint = KZ.checkpoint(next);
    persist();
  }
  if (event.type === "TICK") {
    updateClock();
    return;
  }
  if (event.type === "SUBMIT" && next.notice) announce(next.notice);
  const phaseChanged = before.phase !== next.phase;
  render();
  if (
    phaseChanged ||
    ["RESUME", "HINT_CONTINUE", "SOLUTION_NEXT", "SUBMIT"].includes(event.type)
  ) {
    focusFirst();
  }
  if (
    (phaseChanged || event.type === "END_CANCEL") &&
    (next.phase === "CORRECT_FEEDBACK" || next.phase === "WRONG_FEEDBACK")
  ) {
    const correct = next.phase === "CORRECT_FEEDBACK";
    const qid = next.currentQuestion?.questionId;
    tone(correct);
    appState.feedbackTimer = window.setTimeout(
      () => dispatch({ type: "FEEDBACK_DONE", questionId: qid }),
      correct ? 760 : 380,
    );
  }
}

function end(): void {
  dispatch({ type: "END_CONFIRM" });
  confirmAction(
    "ここで おわる？",
    "こたえていない もんだいは、未回答として きろくするよ。",
    () => dispatch({ type: "END_ACCEPT" }),
    () => dispatch({ type: "END_CANCEL" }),
  );
}

function play(): ElChild[] {
  const run = appState.run;
  if (!run || !run.currentQuestion) return [];
  const q = run.currentQuestion;
  const rec = run.records.at(-1);
  if (!rec) return [];
  const paused = run.pauseReasons.includes("manual");
  const support = ["HINT_READING", "SOLUTION_READING"].includes(run.phase);
  const disabled = run.phase !== "QUESTION" || run.pauseReasons.length > 0;
  const metrics = KZ.runMetrics(run);
  const promptText = q.prompt ?? "";
  const playStats: readonly [string, string | number][] = [
    [
      "のこり",
      run.config.mode === "time"
        ? Math.ceil((run.activeTimeRemainingMs ?? 0) / 1000) + "びょう"
        : "なし",
    ],
    ["せいかい", metrics.correctProblems],
    ["ミス", metrics.mistakeEvents],
    ["コンボ", run.streak],
    ["Score", run.score],
  ];
  const nodes: ElChild[] = [
    el("div", { class: "topline" }, [
      el("div", {}, [
        text("p", `${challengeOf(q.challengeId).grade}ねんの れんしゅう`, {
          class: "eyebrow",
        }),
        el(
          "h2",
          { class: "challenge-heading" },
          challengeLabelNodes(q.challengeId),
        ),
      ]),
      el("div", { class: "actions" }, [
        button("ひとやすみ", () => dispatch({ type: "PAUSE" }), {
          disabled: run.phase !== "QUESTION" || paused,
          "data-testid": "pause",
        }),
        button("おわる", end, { "data-testid": "end" }),
      ]),
    ]),
    el("div", { class: "progress-heading" }, [
      text(
        "strong",
        `${run.records.length}${run.config.quantity ? " / " + run.config.quantity : ""}もんめ`,
      ),
      text(
        "span",
        run.streak >= 3
          ? `${run.streak}れんぞく！ とくてん${run.streak >= 8 ? 3 : run.streak >= 5 ? 2 : 1.5}ばい`
          : "ひとつずつ いこう",
        { "data-testid": "streak-label" },
      ),
    ]),
    el(
      "div",
      {
        class: "progress-track",
        role: "progressbar",
        "aria-label": "おわった もんだい",
        "aria-valuemin": "0",
        "aria-valuemax": String(run.config.quantity || run.records.length),
        "aria-valuenow": String(run.records.filter((r) => r.terminal).length),
      },
      [
        el("span", {
          style: `width:${Math.min(100, (100 * run.records.filter((r) => r.terminal).length) / (run.config.quantity || run.records.length))}%`,
        }),
      ],
    ),
    el(
      "div",
      { class: "stats play-stats" },
      playStats.map(([label, value], i) =>
        el("div", { class: "stat" }, [
          text("small", label),
          text(
            "strong",
            String(value),
            i === 0
              ? { id: "clock" }
              : i === 4
                ? { class: "score", "data-testid": "score" }
                : {},
          ),
        ]),
      ),
    ),
  ];
  if (paused) {
    nodes.push(
      panel(
        [
          text("h2", "ひとやすみ"),
          text("p", "⏸ とまっています", { class: "pause-notice" }),
          button("つづける", () => dispatch({ type: "RESUME" }), {
            class: "primary",
            "data-testid": "resume",
            autofocus: "",
          }),
        ],
        "pause-panel",
      ),
    );
    return nodes;
  }
  if (support) {
    appState.currentRead = null;
    const qid = q.questionId ?? null;
    if (appState.solutionQuestionId !== qid) {
      appState.solutionQuestionId = qid;
      appState.solutionStep = 0;
    }
    const teaching = KZTeaching.steps(q);
    const moveSolution = (delta: number): void => {
      appState.solutionStep = Math.max(
        0,
        Math.min(appState.solutionStep + delta, teaching.length - 1),
      );
      render();
      announce(
        `${appState.solutionStep + 1}／${teaching.length}。${teaching[appState.solutionStep].text}`,
      );
      app
        .querySelector('[data-testid="solution-explanation"]')
        ?.scrollIntoView({ block: "nearest" });
    };
    nodes.push(
      panel(
        [
          text("p", "⏸ じかんは とまっているよ", {
            class: "support-status",
          }),
          text(
            "h2",
            run.phase === "HINT_READING"
              ? "ここから かんがえてみよう"
              : "いっしょに やってみよう",
            { tabindex: "-1", "data-support-focus": "" },
          ),
          math(promptText, {
            class: "math-text support-question",
            "data-testid": "support-question",
          }),
          run.phase === "HINT_READING"
            ? el("div", { class: "hint-card" }, math(KZ.buildHint(q)))
            : solution(q, appState.solutionStep),
          run.phase === "SOLUTION_READING"
            ? solutionNavigation(
                appState.solutionStep,
                teaching.length,
                moveSolution,
              )
            : null,
          button(
            run.phase === "HINT_READING" ? "つづける" : "つぎのもんだいへ",
            () =>
              dispatch({
                type:
                  run.phase === "HINT_READING"
                    ? "HINT_CONTINUE"
                    : "SOLUTION_NEXT",
                questionId: q.questionId,
              }),
            {
              class: "primary",
              "data-testid":
                run.phase === "HINT_READING" ? "hint-continue" : "next",
            },
          ),
        ],
        "support-panel",
      ),
    );
    return nodes;
  }
  const fields = answerFields(q, disabled);
  const submit = (): void =>
    dispatch({
      type: "SUBMIT",
      raw: fields.raw(),
      questionId: q.questionId,
    });
  appState.currentRead = fields.raw;
  fields.box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.repeat && e.target instanceof HTMLInputElement) {
      e.preventDefault();
      submit();
    }
  });
  const prompt = el(
    "div",
    {
      class: "problem" + (promptText.length > 40 ? " compact" : ""),
      "data-testid": "problem",
    },
    [
      math(promptText),
      q.numberBlocks
        ? text(
            "p",
            (q.values ?? [])
              .map((v) => KZ.format(v).replace(/\B(?=(\d{4})+(?!\d))/g, " "))
              .join(" ／ "),
            { class: "number-groups" },
          )
        : null,
    ],
  );
  const correct = run.phase === "CORRECT_FEEDBACK";
  const wrong = run.phase === "WRONG_FEEDBACK";
  const feedback = correct
    ? el(
        "div",
        { class: "success-feedback", "data-testid": "success-feedback" },
        [
          text("span", "◎", { class: "success-mark", "aria-hidden": "true" }),
          text(
            "strong",
            ["できた！", "そのちょうし！", "ばっちり！", "やったね！"][
              metrics.correctProblems % 4
            ],
          ),
          text(
            "span",
            [3, 5, 8].includes(run.streak)
              ? `${run.streak}れんぞく！ とくてん${run.streak === 3 ? 1.5 : run.streak === 5 ? 2 : 3}ばい`
              : `＋${rec.earnedPoints}てん`,
            { "data-testid": "success-detail" },
          ),
          ...Array.from({ length: 8 }, (_, i) =>
            text("i", i % 2 ? "●" : "✦", {
              class: "spark",
              style: `--i:${i}`,
              "aria-hidden": "true",
            }),
          ),
        ],
      )
    : null;
  const problem = panel(
    [
      prompt,
      q.written ? writtenRows(q) : null,
      ...drawBars(q.diagram ?? []),
      q.instruction
        ? el("p", { class: "answer-instruction" }, math(q.instruction))
        : null,
      fields.box,
      text("p", run.notice || "", {
        class: "feedback" + (wrong ? " wrong" : ""),
        "data-testid": "feedback",
        role: "status",
      }),
      feedback,
      rec.hintShown && run.phase === "QUESTION"
        ? el("p", { class: "hint-reminder" }, math(KZ.buildHint(q)))
        : null,
    ],
    "problem-panel",
  );
  if (
    appState.saved.settings.effects &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    problem.classList.add(correct ? "celebrate" : wrong ? "shake" : "steady");
  }
  const visibleInputs = (): HTMLInputElement[] =>
    [...fields.box.querySelectorAll("input")].filter(
      (n) => !n.closest("[hidden]") && !n.disabled,
    );
  const keypress = (value: string): void => {
    if (disabled) return;
    if (
      !appState.activeInput?.isConnected ||
      appState.activeInput.closest("[hidden]")
    ) {
      appState.activeInput = visibleInputs()[0] ?? null;
    }
    const n = appState.activeInput;
    if (!n) return;
    const a = n.selectionStart ?? n.value.length;
    const b = n.selectionEnd ?? a;
    n.focus({ preventScroll: true });
    if (value === "back") {
      n.setRangeText("", a === b ? Math.max(0, a - 1) : a, b, "end");
    } else if (n.value.length - (b - a) < 40) {
      n.setRangeText(value, a, b, "end");
    }
    n.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const numeric = !["compare", "parity"].includes(q.answerSpec.type);
  const keypad = panel(
    [
      numeric
        ? text(
            "p",
            appState.activeInput
              ? (appState.activeInput.getAttribute("aria-label") ?? "") +
                  "に いれるよ"
              : "こたえを いれよう",
            { class: "keypad-note", "data-active-target": "" },
          )
        : text("p", "えらんだら「こたえる」を おしてね", {
            class: "keypad-note",
          }),
      numeric
        ? el("div", { class: "keypad" }, [
            ...[
              "7",
              "8",
              "9",
              "4",
              "5",
              "6",
              "1",
              "2",
              "3",
              ".",
              "0",
              "back",
            ].map((k) =>
              button(k === "back" ? "⌫" : k, () => keypress(k), {
                disabled:
                  disabled ||
                  (k === "." && appState.activeInput?.inputMode !== "decimal"),
                "aria-label": k === "back" ? "1文字消す" : k,
                "data-key": k,
                onPointerDown: (e) => e.preventDefault(),
              }),
            ),
          ])
        : null,
      numeric && fields.box.querySelectorAll("input").length > 1
        ? button(
            "つぎの らんへ →",
            () => {
              const xs = visibleInputs();
              const idx = appState.activeInput
                ? xs.indexOf(appState.activeInput)
                : -1;
              xs[(idx + 1) % xs.length]?.focus({
                preventScroll: true,
              });
            },
            { disabled, "data-testid": "next-field", class: "next-field" },
          )
        : null,
      button("こたえる", submit, {
        class: "submit",
        disabled,
        "data-testid": "submit",
      }),
      button(
        "こまったら助けて",
        () => dispatch({ type: "HELP", questionId: q.questionId }),
        { disabled, "data-testid": "help", class: "help-button" },
      ),
      text(
        "p",
        "たすけてもらうと このもんだいは0てん。ときかたを いっしょに みよう。",
        { class: "keypad-note help-note" },
      ),
    ],
    "keypad-panel",
  );
  nodes.push(el("div", { class: "play-grid" }, [problem, keypad]));
  return nodes;
}

function results(): ElChild[] {
  const run = appState.run;
  const result = appState.result;
  if (!run || !result) return [];
  const m = result.metrics;
  const metricRows: readonly [string, string][] = [
    ["初回正解率", percent(m.firstCorrectProblems, m.learningN)],
    [
      "最終自力正解率（解き直し・ヒント後を含む）",
      percent(m.finalSelfCorrectProblems, m.learningN),
    ],
    [
      "回答回数ベース正答率",
      percent(m.correctProblems, m.correctProblems + m.mistakeEvents),
    ],
    ["無答", String(m.unansweredProblems)],
    ["ヘルプ", String(m.helpProblems)],
    ["ヒント", String(m.hintProblems)],
    ["2回以上まちがえた問題", String(m.repeatedWrongProblems)],
  ];
  const resultStats: readonly [string, number][] = [
    ["せいかい", m.correctProblems],
    ["ミス", m.mistakeEvents],
    ["最大コンボ", run.bestStreak],
  ];
  const detail = el(
    "details",
    {
      class: "result-details",
      "data-testid": "details",
      "data-result-details": "",
    },
    [
      text("summary", "くわしく見る"),
      text(
        "p",
        run.endReason === "manual"
          ? "途中でおわった きろくです。"
          : "この回の きろくです。",
      ),
      el(
        "dl",
        { class: "metrics" },
        metricRows.flatMap(([k, v]) => [text("dt", k), text("dd", v)]),
      ),
      m.exclusions.length
        ? text(
            "p",
            "自然な時間切れの最後の問題は、無答率の判定から除いています。誤答がなければ正解率の判定からも除いています。",
          )
        : null,
      result.excluded.length
        ? el("p", {}, [
            "判定対象外：",
            ...result.excluded.flatMap((id, i) => [
              ...(i ? ["、"] : []),
              ...challengeLabelNodes(id),
            ]),
          ])
        : null,
      m.unshown ? text("p", `未出題のまま終了：${m.unshown}問`) : null,
      ...run.records
        .filter(
          (r) => r.wrongAttempts || r.helpUsed || r.terminal === "unanswered",
        )
        .map((r) => {
          const wrongRaw: RawAnswerObject | null | undefined =
            typeof r.firstWrongAnswer === "object"
              ? r.firstWrongAnswer
              : r.firstWrongAnswer === undefined
                ? undefined
                : { value: String(r.firstWrongAnswer) };
          const terminalLabel = r.terminal ? TERMINAL_LABELS[r.terminal] : "";
          return el("div", { class: "review-item" }, [
            el("h3", {}, math(r.question.prompt ?? "")),
            el(
              "p",
              {},
              math(
                `最初の誤答：${KZUI.answer(wrongRaw, r.question.answerSpec)}`,
              ),
            ),
            el(
              "p",
              {},
              math(`正答：${KZ.answerText(r.question)} ／ ${terminalLabel}`),
            ),
            el("details", { "data-review-question": r.questionId }, [
              text("summary", "とき方を見る", {
                onClick: () => {
                  appState.reviewQuestionId = r.questionId;
                },
              }),
              reviewSolution(r.question),
            ]),
          ]);
        }),
    ],
  );
  const supportClass: SupportClass = run.records.some(
    (r) => r.hintShown || r.helpUsed,
  )
    ? "supported"
    : "independent";
  const bestKey = KZ.bestKey(run.config, supportClass);
  const bestRecord = bestKey ? appState.saved.bestRecords[bestKey] : null;
  return [
    panel(
      [
        text(
          "p",
          appState.saved.settings.name
            ? appState.saved.settings.name + " さんのきろく"
            : "今回のきろく",
          {
            class: "muted",
            "data-user-text": appState.saved.settings.name ? "true" : undefined,
          },
        ),
        text("h2", "おつかれさま！"),
        el("div", { class: "achievement-ribbon" }, [
          text("span", "✦", { "aria-hidden": "true" }),
          text(
            "strong",
            m.correctProblems
              ? `${m.correctProblems}もん できた！`
              : m.helpProblems
                ? `${m.helpProblems}もん ときかたを たしかめた！`
                : "また いっしょに やってみよう",
          ),
        ]),
        text("div", run.score.toLocaleString("ja-JP"), {
          class: "result-score",
          "data-testid": "result-score",
        }),
        text("p", "Score"),
        el(
          "div",
          { class: "stats" },
          resultStats.map(([k, v]) =>
            el("div", { class: "stat" }, [
              text("small", k),
              text("strong", String(v)),
            ]),
          ),
        ),
        text(
          "p",
          result.newBest
            ? "自己ベストを きろくしたよ！"
            : KZ.bestKey(appState.config, "independent")
              ? "この回のScoreをたしかめよう。"
              : "このあそびかたはScoreを表示し、ベストは保存しません。",
        ),
        text(
          "p",
          bestRecord
            ? `自己ベスト：${bestRecord.score}点（${supportClass === "supported" ? "サポートあり" : "サポートなし"}）`
            : "",
          { class: "best-records" },
        ),
        text(
          "p",
          result.insufficient
            ? "判定するには問題数が足りません。"
            : !result.recommendation &&
                m.firstCorrectProblems === m.learningN &&
                m.learningN
              ? "ゆっくりでも正確！"
              : "ひとつずつ、また練習しよう。",
        ),
        el("div", { class: "actions" }, [
          button("もういちど", start, {
            class: "primary",
            "data-testid": "again",
          }),
          button(
            "メニューへ",
            () => {
              appState.run = null;
              appState.result = null;
              appState.activeScreen = "menu";
              render();
              focusFirst();
            },
            { "data-testid": "menu" },
          ),
        ]),
        returnButton(render),
        detail,
      ],
      "result-hero",
    ),
    recommendation(render),
  ];
}

function settings(): void {
  const name = el("input", {
    value: appState.saved.settings.name,
    maxlength: "60",
    "aria-label": "なまえ",
  });
  const sound = el("input", {
    type: "checkbox",
    checked: appState.saved.settings.sound,
  });
  const effects = el("input", {
    type: "checkbox",
    checked: appState.saved.settings.effects,
  });
  const apply = (): void => {
    saveName(name.value);
    appState.saved.settings.sound = sound.checked;
    appState.saved.settings.effects = effects.checked;
    persist();
    dismiss();
    render();
  };
  const clear = (id: ChallengeId | null): void => {
    dismiss();
    confirmAction(
      "Scoreを消しますか？",
      "名前・せってい・おすすめ・れんしゅうの つづきは残ります。",
      () => {
        appState.saved = KZ.clearScores(appState.saved, id);
        persist();
        render();
      },
    );
  };
  const handleImport = async (e: Event): Promise<void> => {
    if (!(e.target instanceof HTMLInputElement)) return;
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 16 * 1024 * 1024) {
      announce("JSONは16 MiBまでです。");
      return;
    }
    try {
      const data = KZ.validateBackup(await f.text());
      dismiss();
      confirmAction(
        "バックアップに置きかえますか？",
        "今の記録は、読みこんだ記録にすべて置きかわります。",
        () => {
          appState.saved = data;
          appState.config = KZ.clone(appState.saved.settings.config);
          syncSelection();
          appState.activeScreen = appState.saved.settings.onboarded
            ? "menu"
            : "welcome";
          persist();
          render();
        },
      );
    } catch (error) {
      const msg = errorMessage(error);
      announce(msg);
      $("#dialog-body").append(text("p", msg, { role: "alert" }));
    }
  };
  const file = el("input", {
    type: "file",
    accept: ".json,application/json",
    "data-testid": "import",
    "aria-label": "JSONを読みこむ",
    onChange: (e) => {
      void handleImport(e);
    },
  });
  modal(
    "せってい",
    [
      el("label", { class: "field" }, [
        text("span", "なまえ（30文字まで）"),
        name,
      ]),
      el("label", { class: "field" }, [text("span", "音を出す"), sound]),
      el("label", { class: "field" }, [text("span", "演出を出す"), effects]),
      button(
        "このチャレンジのScoreをクリア",
        () => clear(appState.config.selectedIds[0] ?? null),
        {
          disabled: appState.config.selectedIds.length !== 1,
          "data-testid": "score-clear",
        },
      ),
      button("すべてのScoreをクリア", () => clear(null), {
        "data-testid": "all-score-clear",
      }),
      button(
        "すべて初期化",
        () => {
          dismiss();
          confirmAction(
            "すべて初期化しますか？",
            "かぞへの名前・記録・せってい・つづきを消します。",
            () => {
              adapter.reset();
              appState.saved = KZ.emptySave();
              appState.config = KZ.clone(appState.saved.settings.config);
              syncSelection();
              appState.activeScreen = "welcome";
              render();
            },
          );
        },
        { "data-testid": "reset" },
      ),
      el("hr"),
      button(
        "JSONに書き出す",
        () => {
          try {
            const data = JSON.stringify(appState.saved);
            KZ.validateBackup(data);
            const url = URL.createObjectURL(
              new Blob([data], { type: "application/json" }),
            );
            const a = el("a", { href: url, download: "kazohe-backup.json" });
            a.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (error) {
            $("#dialog-body").append(
              text("p", errorMessage(error), { role: "alert" }),
            );
          }
        },
        { "data-testid": "export" },
      ),
      el("label", { class: "field" }, [text("span", "JSONを読みこむ"), file]),
      el("details", {}, [
        text("summary", "このアプリについて・根拠"),
        text("p", "かぞへ（Kazohe）はSAIELが制作・開発しています。"),
        text(
          "p",
          "小学1〜6年の「数と計算」を中心にした練習です。文部科学省の学習指導要領に対応する内容をもとにしています。101チャレンジへの分け方・点数・出題範囲・おすすめは、このアプリ独自の設計です。能力を診断する検査ではありません。",
        ),
        el("a", {
          href: "https://www.mext.go.jp/a_menu/shotou/new-cs/1387014.htm",
          target: "_blank",
          rel: "noopener noreferrer",
          text: "文部科学省：小学校学習指導要領 解説",
        }),
        text(
          "p",
          "1人1端末で使います。ブラウザの設定やファイルの場所によって記録が保存されないことがあります。別の場所やブラウザへ移す前に、JSONに書き出してください。ネットへの送信はしません。",
        ),
        text("p", "MIT License · Copyright (c) 2026 SAIEduLab"),
      ]),
    ],
    [
      button("閉じる", dismiss),
      button("保存する", apply, {
        class: "primary",
        "data-testid": "settings-save",
      }),
    ],
  );
}

function render(): void {
  const previousScreen = app.dataset.screen;
  const focused = document.activeElement;
  let identity: [string, string] | undefined = undefined;
  for (const key of ["data-testid", "data-challenge", "data-grade"]) {
    const v = focused?.getAttribute(key);
    if (v) {
      identity = [key, v];
      break;
    }
  }
  const selection: [number | null, number | null] | null =
    focused instanceof HTMLInputElement
      ? [focused.selectionStart, focused.selectionEnd]
      : null;
  const scroll = window.scrollY;
  const details: [string | undefined, boolean][] = [
    ...app.querySelectorAll<HTMLDetailsElement>("[data-menu-details]"),
  ].map((n) => [n.dataset.menuDetails, n.open]);
  const reviewDetails: [string | null, boolean][] = [
    ...app.querySelectorAll<HTMLDetailsElement>(
      "[data-result-details],[data-review-question]",
    ),
  ].map((n) => [n.getAttribute("data-review-question"), n.open]);
  appState.activeInput = null;
  if (
    appState.activeScreen === "play" &&
    appState.run?.currentQuestion &&
    appState.draftQuestionId === appState.run.currentQuestion.questionId
  ) {
    if (appState.currentRead) appState.draft = appState.currentRead();
  } else {
    appState.draft = null;
    appState.draftQuestionId =
      appState.run?.currentQuestion?.questionId || null;
  }
  appState.currentRead = null;
  const nodes: ElChild[] =
    appState.activeScreen === "welcome"
      ? [welcome()]
      : appState.activeScreen === "menu"
        ? menu({
            render,
            start,
            resumeCheckpoint,
            openSettings: settings,
          })
        : appState.activeScreen === "result"
          ? results()
          : play();
  app.replaceChildren(
    ...nodes.filter((x): x is Node | string => x !== null && x !== undefined),
  );
  // Keep viewport controls outside content containers: transforms/overflow must not trap them.
  const dock = app.querySelector(".start-dock");
  dockRoot.replaceChildren(...(dock ? [dock] : []));
  positionStartDock();
  app.setAttribute("data-screen", appState.activeScreen);
  document.body.dataset.screen = appState.activeScreen;
  document.body.dataset.effects = String(appState.saved.settings.effects);
  if (appState.activeScreen === "result") {
    app.setAttribute("data-testid", "result");
  } else {
    app.removeAttribute("data-testid");
  }
  if (previousScreen === appState.activeScreen) {
    if (appState.activeScreen === "menu") {
      for (const [key, open] of details) {
        if (key === undefined) continue;
        const n = app.querySelector<HTMLDetailsElement>(
          `[data-menu-details="${key}"]`,
        );
        if (n) n.open = open;
      }
      window.scrollTo({ top: scroll, behavior: "instant" });
    }
    if (appState.activeScreen === "result") {
      for (const [key, open] of reviewDetails) {
        const n = app.querySelector<HTMLDetailsElement>(
          key === null
            ? "[data-result-details]"
            : `[data-review-question="${CSS.escape(key)}"]`,
        );
        if (n) n.open = open;
      }
      window.scrollTo({ top: scroll, behavior: "instant" });
    }
    if (identity) {
      let n: Element | null = app.querySelector(
        `[${identity[0]}="${CSS.escape(identity[1])}"]`,
      );
      if (n && isControlDisabled(n) && n.closest(".solution-navigation")) {
        n =
          n
            .closest(".solution-navigation")
            ?.querySelector("button:not(:disabled)") ?? null;
      }
      if (
        n instanceof HTMLElement &&
        !isControlDisabled(n) &&
        n.getClientRects().length
      ) {
        n.focus({ preventScroll: true });
        if (
          n instanceof HTMLInputElement &&
          selection &&
          selection[0] !== null
        ) {
          n.setSelectionRange(selection[0], selection[1]);
        }
      }
    }
  } else {
    window.scrollTo({ top: 0, behavior: "instant" });
  }
}

window.addEventListener("resize", positionStartDock);
window.visualViewport?.addEventListener("resize", positionStartDock);
window.visualViewport?.addEventListener("scroll", positionStartDock);
document.addEventListener("visibilitychange", () => {
  if (appState.run && !appState.run.finishedOnce) {
    dispatch({ type: document.hidden ? "HIDDEN" : "VISIBLE" });
  }
});
window.setInterval(() => {
  if (appState.run && !appState.run.finishedOnce) dispatch({ type: "TICK" });
}, 100);

if (testHooks) {
  if (testHooks.initialConfig) {
    appState.config = KZ.normalizeConfig(testHooks.initialConfig);
    syncSelection();
  }
  Object.defineProperty(kazoheWindow, "kazoheTest", {
    value: Object.freeze({
      core: KZ,
      snapshot: () =>
        KZ.clone({
          run: appState.run,
          saved: appState.saved,
          config: appState.config,
          screen: appState.activeScreen,
          result: appState.result,
        }),
      storageAvailable: () => adapter.available,
    }),
  });
}

render();
focusFirst();
