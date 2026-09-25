(() => {
  "use strict";
  const app = document.getElementById("app"),
    dialog = document.getElementById("dialog"),
    announcer = document.getElementById("announcer");
  const test = window.__KAZOHE_TEST__ || null,
    now = () => performance.now();
  const el = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith("on"))
        n.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === "text") n.textContent = value;
      else if (key === "class") n.className = value;
      else if (key === "checked" || key === "disabled" || key === "hidden")
        n[key] = !!value;
      else if (key === "value") n.value = value;
      else n.setAttribute(key, value);
    }
    for (const child of Array.isArray(children) ? children : [children])
      if (child !== null && child !== undefined)
        n.append(
          typeof child === "string" ? document.createTextNode(child) : child,
        );
    return n;
  };
  function uiGrade() {
    return (
      (screen === "play" || screen === "result"
        ? run?.config.languageGrade
        : multiGrade
          ? Math.min(...selectedGrades)
          : grade) || 1
    );
  }
  const button = (label, action, attrs = {}) =>
    el("button", {
      type: "button",
      text: KZUI.readable(label, uiGrade()),
      onClick: action,
      ...attrs,
    });
  const text = (tag, s, attrs = {}) =>
    el(tag, { text: KZUI.readable(s, uiGrade()), ...attrs });
  const math = (s, attrs = {}) => KZUI.math(s, uiGrade(), attrs);
  const panel = (children, cls = "") =>
    el("section", { class: "panel " + cls }, children);
  const announce = (s) => {
    announcer.textContent = s;
  };
  const warn = (s) => {
    const n = document.getElementById("storage-warning");
    n.hidden = false;
    n.textContent = s;
  };
  let storage;
  try {
    storage = window.localStorage;
  } catch {
    storage = {
      getItem() {
        throw Error("blocked");
      },
      setItem() {
        throw Error("blocked");
      },
      removeItem() {
        throw Error("blocked");
      },
    };
  }
  const adapter = KZ.storageAdapter(storage, warn);
  let saved = adapter.load(),
    config = KZ.clone(saved.settings.config),
    run = null,
    result = null,
    screen = saved.settings.onboarded ? "menu" : "welcome";
  let grade = KZ.BY_ID[config.selectedIds[0]].grade,
    category = KZ.BY_ID[config.selectedIds[0]].category,
    multiGrade = false,
    multiSelect = config.selectedIds.length > 1,
    selectedGrades = new Set(
      config.selectedIds.map((id) => KZ.BY_ID[id].grade),
    ),
    activeInput = null,
    feedbackTimer = null,
    finishSaved = false;
  let returnFocus = null,
    closeDialog = null,
    audioContext = null,
    draft = null,
    currentRead = null,
    draftQuestionId = null;
  const persist = () => {
    if (config.selectedIds.length) saved.settings.config = config;
    adapter.write(saved);
  };
  const focusFirst = () => {
    const visible = (selector) =>
      [...app.querySelectorAll(selector)].find(
        (n) => n.getClientRects().length && !n.disabled,
      );
    const n =
      visible("[data-support-focus]") ||
      visible("[autofocus]") ||
      visible("input:not([type=checkbox]),button:not(:disabled),summary");
    (n || app).focus({ preventScroll: true });
    if (
      screen === "play" &&
      ["HINT_READING", "SOLUTION_READING"].includes(run?.phase)
    )
      document
        .querySelector(".support-panel")
        ?.scrollIntoView({ block: "start" });
  };
  function modal(title, body, actions) {
    if (dialog.open) dialog.close();
    returnFocus = document.activeElement;
    document.getElementById("dialog-title").textContent = title;
    document.getElementById("dialog-body").replaceChildren(...body);
    document.getElementById("dialog-actions").replaceChildren(...actions);
    dialog.showModal();
    (
      dialog.querySelector("[autofocus]") ||
      dialog.querySelector("button,input")
    ).focus();
  }
  function dismiss() {
    dialog.close();
    returnFocus?.isConnected && returnFocus.focus();
    const cb = closeDialog;
    closeDialog = null;
    cb?.();
  }
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismiss();
  });
  function confirmAction(title, message, accept, cancel = () => {}) {
    let accepted = false;
    closeDialog = () => {
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
  function tone(correct) {
    if (!saved.settings.sound) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioContext ||= new AC();
      audioContext.resume().catch(() => {});
      (correct ? [523.25, 659.25, 783.99] : [196, 164.81]).forEach((f, i) => {
        const o = audioContext.createOscillator(),
          g = audioContext.createGain(),
          t = audioContext.currentTime + i * 0.09;
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.04, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g);
        g.connect(audioContext.destination);
        o.start(t);
        o.stop(t + 0.2);
      });
    } catch {
      /* Audio may be unavailable; the visible feedback remains sufficient. */
    }
  }
  function setConfig(next) {
    const ids = next.selectedIds;
    if (!ids.length) {
      config = { ...next, selectedIds: [] };
      render();
      return;
    }
    const long = ids.some((id) => KZ.BY_ID[id].timeClass === "long");
    if (
      next.mode === "time" &&
      !(long ? [60000, 120000, 180000] : [30000, 60000, 90000]).includes(
        next.timeLimitMs,
      )
    )
      next.timeLimitMs = long ? 120000 : 60000;
    config = KZ.normalizeConfig(next);
    persist();
    render();
  }
  function select(label, options, value, action, attrs = {}) {
    const n = el(
      "select",
      { onChange: (e) => action(e.target.value), ...attrs },
      options.map(([v, t]) => el("option", { value: v, text: t })),
    );
    n.value = String(value);
    return el("label", { class: "field config-select" }, [
      text("span", label),
      n,
    ]);
  }
  function saveName(value) {
    const clean = [...value.replace(/[\u0000-\u001f\u007f]/g, "")]
      .slice(0, 30)
      .join("");
    saved.settings.name = clean;
  }
  function welcome() {
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
              saved.settings.onboarded = true;
              screen = "menu";
              persist();
              render();
              focusFirst();
            },
            { class: "primary", "data-testid": "welcome-start" },
          ),
          button(
            "スキップ",
            () => {
              saved.settings.onboarded = true;
              screen = "menu";
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
  function recommendation() {
    if (!saved.recommendation) return null;
    const r = saved.recommendation;
    return panel(
      [
        text("h3", "つぎの おすすめ"),
        text("p", r.reason),
        text("strong", KZ.BY_ID[r.targetId].title),
        el("div", { class: "actions" }, [
          button(
            "このれんしゅうを えらぶ",
            () => {
              const next = KZ.recommendConfig(saved, config);
              saved = next.saved;
              config = next.config;
              grade = KZ.BY_ID[r.targetId].grade;
              category = KZ.BY_ID[r.targetId].category;
              screen = "menu";
              persist();
              render();
            },
            { "data-testid": "recommendation" },
          ),
          button("おすすめを消す", () => {
            saved.recommendation = null;
            persist();
            render();
          }),
        ]),
      ],
      "recommendation",
    );
  }
  function returnButton() {
    return saved.returnStack.length
      ? button(
          "さっきのチャレンジにもどる",
          () => {
            config = saved.returnStack.pop();
            grade = KZ.BY_ID[config.selectedIds[0]].grade;
            category = KZ.BY_ID[config.selectedIds[0]].category;
            multiSelect = config.selectedIds.length > 1;
            selectedGrades = new Set(
              config.selectedIds.map((id) => KZ.BY_ID[id].grade),
            );
            screen = "menu";
            persist();
            render();
          },
          { "data-testid": "return" },
        )
      : null;
  }
  function menu() {
    const selected = new Set(config.selectedIds);
    const long = config.selectedIds.some(
      (id) => KZ.BY_ID[id].timeClass === "long",
    );
    const conditionNodes = config.selectedIds.flatMap((id) => {
      if (id === "G2-C08")
        return [
          select(
            "九九のだん",
            [
              [0, "ぜんぶ"],
              ...Array.from({ length: 9 }, (_, i) => [i + 1, `${i + 1}のだん`]),
            ],
            config.optionsById[id]?.table || 0,
            (v) =>
              setConfig({
                ...config,
                optionsById: {
                  ...config.optionsById,
                  [id]: { table: Number(v) || null },
                },
              }),
            { "data-testid": "table-option" },
          ),
        ];
      if (KZ.REMAINDER_IDS.includes(id))
        return [
          select(
            KZ.BY_ID[id].title + "の あまり",
            [
              ["none", "あまりなし"],
              ["some", "あまりあり"],
              ["mixed", "まぜる"],
            ],
            config.optionsById[id]?.remainder || "mixed",
            (v) =>
              setConfig({
                ...config,
                optionsById: { ...config.optionsById, [id]: { remainder: v } },
              }),
          ),
        ];
      return [];
    });
    const mode = select(
      "あそびかた",
      [
        ["practice", "れんしゅう"],
        ["time", "タイムアタック"],
      ],
      config.mode,
      (v) =>
        setConfig({
          ...config,
          mode: v,
          quantity: 10,
          timeLimitMs: long ? 120000 : 60000,
        }),
      { "data-testid": "mode" },
    );
    const quantity =
      config.mode === "practice"
        ? select(
            "もんだいのかず",
            [
              [10, "10もん"],
              [20, "20もん"],
              [30, "30もん"],
              [0, "むせいげん"],
            ],
            config.quantity ?? 0,
            (v) => setConfig({ ...config, quantity: Number(v) || null }),
            { "data-testid": "quantity" },
          )
        : select(
            "じかん",
            (long ? [60, 120, 180] : [30, 60, 90]).map((n) => [
              n * 1000,
              `${n}びょう`,
            ]),
            config.timeLimitMs,
            (v) => setConfig({ ...config, timeLimitMs: Number(v) }),
            { "data-testid": "time-limit" },
          );
    const best = config.selectedIds.length
      ? [
          ["independent", "じぶんで"],
          ["supported", "ヒント・たすけあり"],
        ].map(([kind, label]) => {
          const key = KZ.bestKey(config, kind),
            r = key ? saved.bestRecords[key] : null;
          return text(
            "p",
            `${label}の いちばんのきろく：${key ? (r ? r.score + "てん" : "これから！") : "このあそびかたは とくてんのみ"}`,
          );
        })
      : [];
    const nodes = [
      el("div", { class: "menu-heading" }, [
        el("div", {}, [
          text("p", "きょうの れんしゅう", { class: "eyebrow" }),
          text("h2", "なにを といてみる？"),
          text("p", "ひとつずつ、「できた！」を ふやそう。", {
            class: "menu-intro",
          }),
        ]),
        button("せってい", settings, {
          "data-testid": "settings",
          class: "quiet-button",
        }),
      ]),
      saved.settings.name
        ? text("p", saved.settings.name + " さん", { class: "name-label" })
        : null,
    ];
    if (saved.practiceCheckpoint)
      nodes.push(
        panel(
          [
            text("strong", "れんしゅうの つづきがあるよ"),
            el("div", { class: "actions" }, [
              button("つづきから", resumeCheckpoint, {
                class: "primary",
                "data-testid": "continue-practice",
              }),
              button(
                "はじめから",
                () =>
                  confirmAction(
                    "つづきを けしますか？",
                    "まえの れんしゅうの つづきを けします。",
                    () => {
                      saved.practiceCheckpoint = null;
                      persist();
                      render();
                    },
                  ),
                { "data-testid": "discard-practice" },
              ),
            ]),
          ],
          "resume-card",
        ),
      );
    nodes.push(recommendation(), returnButton());
    const grades = el(
      "div",
      { class: "grade-grid", "aria-label": "がくねん" },
      Array.from({ length: 6 }, (_, i) =>
        button(
          `${i + 1}ねん`,
          () => {
            if (multiGrade) {
              selectedGrades.has(i + 1)
                ? selectedGrades.delete(i + 1)
                : selectedGrades.add(i + 1);
              setConfig({
                ...config,
                selectedIds: config.selectedIds.filter((id) =>
                  selectedGrades.has(KZ.BY_ID[id].grade),
                ),
              });
            } else {
              grade = i + 1;
              selectedGrades = new Set([grade]);
              setConfig({
                ...config,
                selectedIds: config.selectedIds.filter(
                  (id) => KZ.BY_ID[id].grade === grade,
                ),
              });
            }
          },
          {
            "data-grade": i + 1,
            "aria-pressed": multiGrade
              ? selectedGrades.has(i + 1)
              : grade === i + 1,
          },
        ),
      ),
    );
    const list = el(
      "div",
      {
        class: "challenge-list" + (multiGrade ? " many-grades" : ""),
        "data-testid": "challenge-select",
      },
      KZ.CATALOG.filter(
        (c) =>
          (multiGrade ? selectedGrades.has(c.grade) : c.grade === grade) &&
          c.category === category,
      ).map((c) =>
        el(
          "label",
          {
            class: "challenge" + (selected.has(c.id) ? " picked" : ""),
            "data-kind": c.category,
          },
          [
            el("input", {
              type: "checkbox",
              checked: selected.has(c.id),
              "data-challenge": c.id,
              "aria-label": KZUI.readable(c.title, uiGrade()),
              onChange: (e) => {
                const ids = new Set(multiSelect ? config.selectedIds : []);
                e.target.checked ? ids.add(c.id) : ids.delete(c.id);
                setConfig({ ...config, selectedIds: [...ids] });
              },
            }),
            el("span", { class: "challenge-copy" }, [
              text(
                "strong",
                `${multiGrade ? c.grade + "ねん・" : ""}${c.title}`,
              ),
              math(KZUI.example(c.id), {
                class: "math-text challenge-example",
                "aria-label": "もんだいのれい",
              }),
              text(
                "small",
                `${c.basePoints}てん ・ ${c.timeClass === "long" ? "じっくり" : "さくさく"}`,
              ),
            ]),
            text("span", selected.has(c.id) ? "✓" : "＋", {
              class: "pick-mark",
              "aria-hidden": "true",
            }),
          ],
        ),
      ),
    );
    if (!list.children.length)
      list.append(text("p", "がくねんを えらんでね。"));
    nodes.push(
      panel(
        [
          text("h3", "1　がくねんを えらぼう", { class: "step-label" }),
          grades,
          el(
            "div",
            { class: "category-tabs" },
            ["計算", "数"].map((c) =>
              button(
                c === "計算" ? "＋ けいさん" : "● かず",
                () => {
                  category = c;
                  render();
                },
                { "aria-pressed": category === c, "data-category": c },
              ),
            ),
          ),
          el("div", { class: "list-heading" }, [
            text(
              "h3",
              multiSelect
                ? "2　いくつか えらぼう"
                : "2　やってみたい もんだいは？",
              { class: "step-label" },
            ),
            text("span", multiSelect ? "いくつでもOK" : "1つ えらんでね", {
              class: "selection-mode",
            }),
          ]),
          list,
          el(
            "details",
            { "data-menu-details": "selection", class: "menu-details" },
            [
              text("summary", "いくつか・ほかのがくねんも えらぶ"),
              el("div", { class: "actions" }, [
                button(
                  multiSelect ? "1つずつ えらぶ" : "いくつか えらぶ",
                  () => {
                    multiSelect = !multiSelect;
                    if (!multiSelect) {
                      multiGrade = false;
                      grade = KZ.BY_ID[config.selectedIds[0]]?.grade || grade;
                      selectedGrades = new Set([grade]);
                      setConfig({
                        ...config,
                        selectedIds: config.selectedIds.slice(0, 1),
                      });
                    } else render();
                  },
                  {
                    "aria-pressed": multiSelect,
                    "data-testid": "multiple-select",
                  },
                ),
                button(
                  "がくねんを いくつか えらぶ",
                  () => {
                    multiGrade = !multiGrade;
                    multiSelect ||= multiGrade;
                    selectedGrades = new Set(
                      multiGrade
                        ? config.selectedIds.map((id) => KZ.BY_ID[id].grade)
                        : [grade],
                    );
                    if (!selectedGrades.size) selectedGrades.add(grade);
                    render();
                  },
                  {
                    "aria-pressed": multiGrade,
                    "data-testid": "multiple-grades",
                  },
                ),
                button(
                  "ぜんぶの がくねんから",
                  () => {
                    multiGrade = true;
                    multiSelect = true;
                    selectedGrades = new Set([1, 2, 3, 4, 5, 6]);
                    setConfig({
                      ...config,
                      selectedIds: KZ.CATALOG.map((c) => c.id),
                    });
                  },
                  { "data-testid": "all-grades" },
                ),
                button("えらびなおす", () =>
                  setConfig({ ...config, selectedIds: [] }),
                ),
              ]),
            ],
          ),
        ],
        "selection-panel",
      ),
    );
    const chosen = el(
      "details",
      { "data-menu-details": "chosen", class: "chosen-details" },
      [
        text(
          "summary",
          `えらんだものを みる（${config.selectedIds.length}こ）`,
        ),
        el(
          "div",
          { class: "chosen-chips", "data-testid": "selected-challenges" },
          config.selectedIds.map((id) =>
            button(
              `${KZ.BY_ID[id].grade}ねん・${KZ.BY_ID[id].title} ×`,
              () =>
                setConfig({
                  ...config,
                  selectedIds: config.selectedIds.filter((x) => x !== id),
                }),
              {
                "data-remove-challenge": id,
                "aria-label": KZUI.readable(
                  KZ.BY_ID[id].title + "を はずす",
                  uiGrade(),
                ),
              },
            ),
          ),
        ),
      ],
    );
    if (config.selectedIds.length > 1) chosen.open = true;
    nodes.push(
      chosen,
      el(
        "details",
        { "data-menu-details": "options", class: "menu-details play-options" },
        [
          text(
            "summary",
            `あそびかたを かえる　${config.mode === "practice" ? (config.quantity ? config.quantity + "もん" : "むせいげん") : config.timeLimitMs / 1000 + "びょう"}`,
          ),
          el("div", { class: "options" }, [mode, quantity, ...conditionNodes]),
          el("div", { class: "sound-options actions" }, [
            button(
              saved.settings.sound ? "♪ おと あり" : "♪ おと なし",
              () => {
                saved.settings.sound = !saved.settings.sound;
                persist();
                render();
              },
              {
                "aria-pressed": saved.settings.sound,
                "data-testid": "sound-toggle",
              },
            ),
            button(
              saved.settings.effects ? "✦ うごき あり" : "✦ うごき なし",
              () => {
                saved.settings.effects = !saved.settings.effects;
                persist();
                render();
              },
              {
                "aria-pressed": saved.settings.effects,
                "data-testid": "effects-toggle",
              },
            ),
          ]),
          el("div", { class: "best-records" }, best),
          text(
            "p",
            "3れんぞくで とくてん1.5ばい、5れんぞくで2ばい、8れんぞくで3ばい。ヒントを みた もんだいは はんぶんの とくてん。",
            { class: "rules-note" },
          ),
        ],
      ),
    );
    nodes.push(
      el("div", { class: "start-dock" }, [
        el(
          "div",
          { class: "start-selection", "data-testid": "selection-summary" },
          [
            text(
              "strong",
              config.selectedIds.length === 1
                ? KZ.BY_ID[config.selectedIds[0]].title
                : config.selectedIds.length
                  ? `${config.selectedIds.length}この れんしゅう`
                  : "もんだいを えらんでね",
            ),
            text(
              "small",
              config.mode === "practice"
                ? `${config.quantity ? config.quantity + "もん" : "むせいげん"}・じかんを きにせず`
                : `${config.timeLimitMs / 1000}びょう・タイムアタック`,
            ),
          ],
        ),
        button("はじめる！ →", start, {
          "data-testid": "start",
          class: "primary start-button",
          disabled: !config.selectedIds.length,
        }),
      ]),
    );
    return nodes;
  }

  function start() {
    const begin = () => {
      run = KZ.createRun(config, test?.seed ?? Date.now(), now());
      if (test?.fixedQuestion) {
        const q = KZ.complete(KZ.clone(test.fixedQuestion));
        q.questionId = run.currentQuestion.questionId;
        run.currentQuestion = q;
        run.records[0].question = q;
      }
      screen = "play";
      result = null;
      finishSaved = false;
      render();
      focusFirst();
    };
    if (saved.practiceCheckpoint)
      confirmAction(
        "つづきを置きかえますか？",
        "新しいれんしゅうを はじめると、保存していた つづきは消えます。",
        () => {
          saved.practiceCheckpoint = null;
          persist();
          begin();
        },
      );
    else begin();
  }
  function resumeCheckpoint() {
    run = KZ.clone(saved.practiceCheckpoint);
    config = run.config;
    run.lastNow = now();
    run.pauseReasons = [];
    finishSaved = false;
    screen = run.finishedOnce ? "result" : "play";
    if (run.finishedOnce) finish();
    else {
      render();
      focusFirst();
    }
  }
  function finish() {
    if (finishSaved) return;
    finishSaved = true;
    clearTimeout(feedbackTimer);
    result = KZ.applyResult(saved, run);
    saved = result.saved;
    persist();
    screen = "result";
    render();
    focusFirst();
    announce("れんしゅうが おわりました。");
  }
  function dispatch(event) {
    if (!run || run.finishedOnce) return;
    const before = run;
    run = KZ.reduceRun(run, event, now());
    if (
      event.type === "SUBMIT" &&
      !run.notice?.includes("入れて") &&
      run.phase !== before.phase
    ) {
      currentRead = null;
      draft = null;
    }
    if (run.finishedOnce) {
      finish();
      return;
    }
    if (
      (event.type === "SUBMIT" &&
        run.phase === "CORRECT_FEEDBACK" &&
        before.phase === "QUESTION") ||
      (event.type === "HELP" &&
        run.phase === "SOLUTION_READING" &&
        before.phase === "QUESTION")
    ) {
      saved.practiceCheckpoint = KZ.checkpoint(run);
      persist();
    }
    if (event.type === "TICK") {
      updateClock();
      return;
    }
    if (event.type === "SUBMIT" && run.notice) announce(run.notice);
    const phaseChanged = before.phase !== run.phase;
    render();
    if (
      phaseChanged ||
      ["RESUME", "HINT_CONTINUE", "SOLUTION_NEXT", "SUBMIT"].includes(
        event.type,
      )
    )
      focusFirst();
    if (
      (phaseChanged || event.type === "END_CANCEL") &&
      (run.phase === "CORRECT_FEEDBACK" || run.phase === "WRONG_FEEDBACK")
    ) {
      const correct = run.phase === "CORRECT_FEEDBACK",
        qid = run.currentQuestion.questionId;
      tone(correct);
      feedbackTimer = setTimeout(
        () => dispatch({ type: "FEEDBACK_DONE", questionId: qid }),
        correct ? 760 : 380,
      );
    }
  }
  function updateClock() {
    const n = document.getElementById("clock");
    if (n && run)
      n.textContent =
        run.config.mode === "time"
          ? `${Math.ceil(run.activeTimeRemainingMs / 1000)}びょう`
          : "なし";
  }
  function end() {
    dispatch({ type: "END_CONFIRM" });
    confirmAction(
      "ここで おわる？",
      "こたえていない もんだいは、未回答として きろくするよ。",
      () => dispatch({ type: "END_ACCEPT" }),
      () => dispatch({ type: "END_CANCEL" }),
    );
  }
  function drawBars(items) {
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
  function writtenRows(q, complete = false) {
    return KZUI.written(q, complete, uiGrade());
  }
  function solution(q) {
    return KZUI.solution(q, uiGrade());
  }
  function answerFields(q, disabled) {
    const s = q.answerSpec,
      box = el("div", { class: "answer-fields", "data-testid": "answer" });
    let raw = () => ({});
    const activate = (n) => {
      activeInput = n;
      box
        .querySelectorAll("input")
        .forEach((x) => x.classList.toggle("active-answer", x === n));
      const target = document.querySelector("[data-active-target]");
      if (target)
        target.textContent = KZUI.readable(
          n.getAttribute("aria-label") + "に いれるよ",
          uiGrade(),
        );
      const point = document.querySelector('[data-key="."]');
      if (point) point.disabled = disabled || n.inputMode !== "decimal";
    };
    const input = (label, key, decimal = false) => {
      let value = draft?.[key] ?? "";
      if (key.includes("-first"))
        value = draft?.first?.[key.replace("-first", "")] ?? "";
      if (key.includes("-second"))
        value = draft?.second?.[key.replace("-second", "")] ?? "";
      if (key.startsWith("block-"))
        value = draft?.values?.[Number(key.slice(6))] ?? "";
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
    const fraction = (suffix = "") => {
      const prefix =
        suffix === "-first"
          ? "1つめの "
          : suffix === "-second"
            ? "2つめの "
            : "";
      const whole = input(prefix + "整数の部分", "whole" + suffix),
        num = input(prefix + "分子（上）", "numerator" + suffix),
        den = input(prefix + "分母（下）", "denominator" + suffix),
        form = el(
          "select",
          { "aria-label": "答えの形" + suffix, disabled },
          [
            ["fraction", "分数"],
            ["mixed", "帯分数"],
            ["integer", "整数"],
          ]
            .filter(([v]) =>
              s.type === "common" || s.form || uiGrade() <= 3
                ? v === (s.form || "fraction")
                : true,
            )
            .map(([v, t]) => el("option", { value: v, text: t })),
        );
      form.value =
        (suffix ? draft?.[suffix.slice(1)]?.form : draft?.form) ||
        s.form ||
        "fraction";
      const f = el("div", { class: "fraction" }, [num.node, den.node]);
      const mixed = el("div", { class: "mixed" }, [whole.node, f]);
      const change = (event) => {
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
      const a = input("商（こたえ）", "quotient"),
        b = input("あまり", "remainder", s.decimalRemainder);
      box.append(a.node, b.node);
      raw = () => ({ quotient: a.n.value, remainder: b.n.value });
    } else if (s.type === "fraction") {
      const f = fraction();
      box.append(f.node);
      raw = f.read;
    } else if (s.type === "common") {
      const a = fraction("-first"),
        b = fraction("-second");
      [a, b].forEach((f, i) =>
        box.append(
          el("div", { class: "common-answer" }, [
            math((q.labels?.[i] || KZ.format(q.values[i])) + " ↓", {
              class: "math-text common-original",
            }),
            f.node,
          ]),
        ),
      );
      raw = () => ({ first: a.read(), second: b.read() });
    } else if (s.type === "blocks") {
      const inputs = s.labels.map((label, i) => input(label, "block-" + i));
      const ordered = inputs
        .map((x, i) => ({
          x,
          place: Number(s.labels[i].match(/[\d.]+/)?.[0] || 1),
        }))
        .sort((a, b) => b.place - a.place);
      ordered.forEach(({ x }) => box.append(x.node));
      box.classList.add("blocks-answer");
      raw = () => ({ values: inputs.map((x) => x.n.value) });
    } else if (s.type === "compare" || s.type === "parity") {
      let value = draft?.value ?? null;
      const choices =
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
      raw = () => ({ value });
    } else if (s.type === "set") {
      const x = input("追加する数", "set-value"),
        chips = el("div", { class: "chips" }),
        values = [...(draft?.values || [])],
        error = text("p", "", { class: "inline-error", role: "alert" });
      const add = () => {
        const parsed = KZ.normalizeInput({ type: "integer" }, x.n.value);
        if (parsed.error) {
          announce(parsed.error);
          error.textContent = KZUI.readable(parsed.error, uiGrade());
          return;
        }
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
      const renderChips = () =>
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
  function play() {
    const q = run.currentQuestion,
      rec = run.records.at(-1),
      paused = run.pauseReasons.includes("manual"),
      support = ["HINT_READING", "SOLUTION_READING"].includes(run.phase),
      disabled = run.phase !== "QUESTION" || run.pauseReasons.length > 0,
      metrics = KZ.runMetrics(run);
    const nodes = [
      el("div", { class: "topline" }, [
        el("div", {}, [
          text("p", `${KZ.BY_ID[q.challengeId].grade}ねんの れんしゅう`, {
            class: "eyebrow",
          }),
          text("h2", KZ.BY_ID[q.challengeId].title),
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
        [
          [
            "のこり",
            run.config.mode === "time"
              ? Math.ceil(run.activeTimeRemainingMs / 1000) + "びょう"
              : "なし",
          ],
          ["せいかい", metrics.correctProblems],
          ["ミス", metrics.mistakeEvents],
          ["コンボ", run.streak],
          ["Score", run.score],
        ].map(([label, value], i) =>
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
      currentRead = null;
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
            math(q.prompt, {
              class: "math-text support-question",
              "data-testid": "support-question",
            }),
            run.phase === "HINT_READING"
              ? el("div", { class: "hint-card" }, math(KZ.buildHint(q)))
              : solution(q),
            button(
              run.phase === "HINT_READING" ? "つづける" : "つぎへ",
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
    const fields = answerFields(q, disabled),
      submit = () =>
        dispatch({
          type: "SUBMIT",
          raw: fields.raw(),
          questionId: q.questionId,
        });
    currentRead = fields.raw;
    fields.box.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.repeat && e.target.tagName === "INPUT") {
        e.preventDefault();
        submit();
      }
    });
    const prompt = el(
      "div",
      {
        class: "problem" + (q.prompt.length > 40 ? " compact" : ""),
        "data-testid": "problem",
      },
      [
        math(q.prompt),
        q.numberBlocks
          ? text(
              "p",
              q.values
                .map((v) => KZ.format(v).replace(/\B(?=(\d{4})+(?!\d))/g, " "))
                .join(" ／ "),
              { class: "number-groups" },
            )
          : null,
      ],
    );
    const correct = run.phase === "CORRECT_FEEDBACK",
      wrong = run.phase === "WRONG_FEEDBACK";
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
        ...drawBars(q.diagram || q.answerSpec.diagram || []),
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
      saved.settings.effects &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      problem.classList.add(correct ? "celebrate" : wrong ? "shake" : "steady");
    const visibleInputs = () =>
      [...fields.box.querySelectorAll("input")].filter(
        (n) => !n.closest("[hidden]") && !n.disabled,
      );
    const keypress = (value) => {
      if (disabled) return;
      if (!activeInput?.isConnected || activeInput.closest("[hidden]"))
        activeInput = visibleInputs()[0];
      if (!activeInput) return;
      const n = activeInput,
        a = n.selectionStart ?? n.value.length,
        b = n.selectionEnd ?? a;
      n.focus({ preventScroll: true });
      if (value === "back")
        n.setRangeText("", a === b ? Math.max(0, a - 1) : a, b, "end");
      else if (n.value.length - (b - a) < 40)
        n.setRangeText(value, a, b, "end");
      n.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const numeric = !["compare", "parity"].includes(q.answerSpec.type);
    const keypad = panel(
      [
        numeric
          ? text(
              "p",
              activeInput
                ? activeInput.getAttribute("aria-label") + "に いれるよ"
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
                    (k === "." && activeInput?.inputMode !== "decimal"),
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
                xs[(xs.indexOf(activeInput) + 1) % xs.length]?.focus({
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

  const percent = (n, d) =>
    d ? `${Math.round((n / d) * 1000) / 10}%（${n}/${d}）` : "—";
  function results() {
    const m = result.metrics;
    const detail = el(
      "details",
      { class: "result-details", "data-testid": "details" },
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
          [
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
          ].flatMap(([k, v]) => [text("dt", k), text("dd", v)]),
        ),
        m.exclusions.length
          ? text(
              "p",
              "自然な時間切れの最後の問題は、無答率の判定から除いています。誤答がなければ正解率の判定からも除いています。",
            )
          : null,
        result.excluded.length
          ? text(
              "p",
              "判定対象外：" +
                result.excluded.map((id) => KZ.BY_ID[id].title).join("、"),
            )
          : null,
        m.unshown ? text("p", `未出題のまま終了：${m.unshown}問`) : null,
        ...run.records
          .filter(
            (r) => r.wrongAttempts || r.helpUsed || r.terminal === "unanswered",
          )
          .map((r) =>
            el("div", { class: "review-item" }, [
              el("h3", {}, math(r.question.prompt)),
              el(
                "p",
                {},
                math(
                  `最初の誤答：${KZUI.answer(r.firstWrongAnswer, r.question.answerSpec)}`,
                ),
              ),
              el(
                "p",
                {},
                math(
                  `正答：${KZ.answerText(r.question)} ／ ${{ correct: "せいかい", help: "助けてもらった", unanswered: "未回答" }[r.terminal]}`,
                ),
              ),
              el("details", {}, [
                text("summary", "とき方を見る"),
                solution(r.question),
              ]),
            ]),
          ),
      ],
    );
    return [
      panel(
        [
          text(
            "p",
            saved.settings.name
              ? saved.settings.name + " さんのきろく"
              : "今回のきろく",
            { class: "muted" },
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
            [
              ["せいかい", m.correctProblems],
              ["ミス", m.mistakeEvents],
              ["最大コンボ", run.bestStreak],
            ].map(([k, v]) =>
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
              : KZ.bestKey(config, "independent")
                ? "この回のScoreをたしかめよう。"
                : "このあそびかたはScoreを表示し、ベストは保存しません。",
          ),
          text(
            "p",
            (() => {
              const support = run.records.some((r) => r.hintShown || r.helpUsed)
                ? "supported"
                : "independent";
              const best = saved.bestRecords[KZ.bestKey(run.config, support)];
              return best
                ? `自己ベスト：${best.score}点（${support === "supported" ? "サポートあり" : "サポートなし"}）`
                : "";
            })(),
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
                run = null;
                result = null;
                screen = "menu";
                render();
                focusFirst();
              },
              { "data-testid": "menu" },
            ),
          ]),
          returnButton(),
          detail,
        ],
        "result-hero",
      ),
      recommendation(),
    ];
  }
  function settings() {
    const name = el("input", {
      value: saved.settings.name,
      maxlength: "60",
      "aria-label": "なまえ",
    });
    const sound = el("input", {
        type: "checkbox",
        checked: saved.settings.sound,
      }),
      effects = el("input", {
        type: "checkbox",
        checked: saved.settings.effects,
      });
    const apply = () => {
      saveName(name.value);
      saved.settings.sound = sound.checked;
      saved.settings.effects = effects.checked;
      persist();
      dismiss();
      render();
    };
    const clear = (id) => {
      dismiss();
      confirmAction(
        "Scoreを消しますか？",
        "名前・せってい・おすすめ・れんしゅうの つづきは残ります。",
        () => {
          saved = KZ.clearScores(saved, id);
          persist();
          render();
        },
      );
    };
    const file = el("input", {
      type: "file",
      accept: ".json,application/json",
      "data-testid": "import",
      "aria-label": "JSONを読みこむ",
      onChange: async (e) => {
        const f = e.target.files[0];
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
              saved = data;
              config = KZ.clone(saved.settings.config);
              screen = saved.settings.onboarded ? "menu" : "welcome";
              persist();
              render();
            },
          );
        } catch (error) {
          announce(error.message);
          document
            .getElementById("dialog-body")
            .append(text("p", error.message, { role: "alert" }));
        }
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
          () => clear(config.selectedIds[0]),
          {
            disabled: config.selectedIds.length !== 1,
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
                saved = KZ.emptySave();
                config = saved.settings.config;
                screen = "welcome";
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
              const data = JSON.stringify(saved);
              KZ.validateBackup(data);
              const url = URL.createObjectURL(
                new Blob([data], { type: "application/json" }),
              );
              const a = el("a", { href: url, download: "kazohe-backup.json" });
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (error) {
              document
                .getElementById("dialog-body")
                .append(text("p", error.message, { role: "alert" }));
            }
          },
          { "data-testid": "export" },
        ),
        el("label", { class: "field" }, [text("span", "JSONを読みこむ"), file]),
        el("details", {}, [
          text("summary", "このアプリについて・根拠"),
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
  function render() {
    const previousScreen = app.dataset.screen,
      focused = document.activeElement;
    const identity = [
      "data-testid",
      "data-challenge",
      "data-grade",
      "data-category",
    ]
      .map((key) => [key, focused?.getAttribute(key)])
      .find(([, v]) => v);
    const selection =
      focused?.tagName === "INPUT"
        ? [focused.selectionStart, focused.selectionEnd]
        : null;
    const scroll = window.scrollY,
      details = [...app.querySelectorAll("[data-menu-details]")].map((n) => [
        n.dataset.menuDetails,
        n.open,
      ]);
    activeInput = null;
    if (
      screen === "play" &&
      draftQuestionId === run.currentQuestion.questionId
    ) {
      if (currentRead) draft = currentRead();
    } else {
      draft = null;
      draftQuestionId = run?.currentQuestion.questionId || null;
    }
    currentRead = null;
    const nodes =
      screen === "welcome"
        ? [welcome()]
        : screen === "menu"
          ? menu()
          : screen === "result"
            ? results()
            : play();
    app.replaceChildren(...nodes.filter(Boolean));
    app.setAttribute("data-screen", screen);
    document.body.dataset.screen = screen;
    document.body.dataset.effects = String(saved.settings.effects);
    if (screen === "result") app.setAttribute("data-testid", "result");
    else app.removeAttribute("data-testid");
    if (previousScreen === screen) {
      if (screen === "menu") {
        for (const [key, open] of details) {
          const n = app.querySelector(`[data-menu-details="${key}"]`);
          if (n) n.open = open;
        }
        window.scrollTo({ top: scroll, behavior: "instant" });
      }
      if (identity) {
        const n = app.querySelector(
          `[${identity[0]}="${CSS.escape(identity[1])}"]`,
        );
        if (n && !n.disabled && n.getClientRects().length) {
          n.focus({ preventScroll: true });
          if (selection && selection[0] !== null)
            n.setSelectionRange(...selection);
        }
      }
    } else window.scrollTo({ top: 0, behavior: "instant" });
  }
  document.addEventListener("visibilitychange", () => {
    if (run && !run.finishedOnce)
      dispatch({ type: document.hidden ? "HIDDEN" : "VISIBLE" });
  });
  setInterval(() => {
    if (run && !run.finishedOnce) dispatch({ type: "TICK" });
  }, 100);
  if (test) {
    if (test.initialConfig) {
      config = KZ.normalizeConfig(test.initialConfig);
      grade = KZ.BY_ID[config.selectedIds[0]].grade;
      category = KZ.BY_ID[config.selectedIds[0]].category;
    }
    Object.defineProperty(window, "kazoheTest", {
      value: Object.freeze({
        core: KZ,
        snapshot: () => KZ.clone({ run, saved, config, screen, result }),
        storageAvailable: () => adapter.available,
      }),
    });
  }
  render();
  focusFirst();
})();
