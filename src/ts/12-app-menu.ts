/* Menu screen, selection controls, recommendation card, and configuration updates for #kazohe-app. */
import { KZWritten } from "./03-written.ts";
import { KZ } from "./07-run-and-save.ts";
import { KZUI } from "./10-view.ts";
import {
  app,
  appState,
  button,
  challengeAccessibleLabel,
  challengeLabelNodes,
  challengeOf,
  confirmAction,
  el,
  focusFirst,
  math,
  panel,
  persist,
  select,
  syncSelection,
  text,
} from "./11-app-helpers.ts";
import type { ElChild } from "./11-app-helpers.ts";
import type {
  ChallengeId,
  Grade,
  RemainderMode,
  RunConfig,
  RunMode,
  SupportClass,
  WrittenMode,
} from "../types/contracts.d.ts";

export interface MenuCallbacks {
  readonly render: () => void;
  readonly start: () => void;
  readonly resumeCheckpoint: () => void;
  readonly openSettings: () => void;
}

const GRADES: readonly Grade[] = [1, 2, 3, 4, 5, 6];
const SUPPORT_KINDS: readonly (readonly [SupportClass, string])[] = [
  ["independent", "じぶんで"],
  ["supported", "ヒント・たすけあり"],
];

export function setConfig(next: RunConfig, renderScreen: () => void): void {
  const ids = next.selectedIds;
  if (!ids.length) {
    appState.config = { ...next, selectedIds: [] };
    renderScreen();
    return;
  }
  next.optionsById = { ...next.optionsById };
  for (const id of ids) {
    if (
      !appState.config.selectedIds.includes(id) &&
      KZWritten.ids.includes(id) &&
      !Object.hasOwn(KZWritten.fixed, id)
    ) {
      next.optionsById[id] = {
        ...next.optionsById[id],
        written: next.optionsById[id]?.written || "mixed",
      };
    }
  }
  const long = ids.some((id) => challengeOf(id).timeClass === "long");
  if (
    next.mode === "time" &&
    !(long ? [60000, 120000, 180000] : [30000, 60000, 90000]).includes(
      next.timeLimitMs,
    )
  ) {
    next.timeLimitMs = long ? 120000 : 60000;
  }
  appState.config = KZ.normalizeConfig(next);
  persist();
  renderScreen();
}

export function recommendation(renderScreen: () => void): HTMLElement | null {
  const r = appState.saved.recommendation;
  if (!r) return null;
  return panel(
    [
      text("h3", "つぎの おすすめ"),
      text("p", r.reason),
      el("strong", { class: "challenge-label" }, challengeLabelNodes(r.targetId)),
      el("div", { class: "actions" }, [
        button(
          "このれんしゅうを えらぶ",
          () => {
            const next = KZ.recommendConfig(appState.saved, appState.config);
            appState.saved = next.saved;
            appState.config = next.config;
            syncSelection();
            appState.activeScreen = "menu";
            persist();
            renderScreen();
          },
          { "data-testid": "recommendation" },
        ),
        button(
          "おすすめを消す",
          () => {
            appState.saved.recommendation = null;
            persist();
            renderScreen();
            if (appState.activeScreen === "result") {
              const current = appState.reviewQuestionId
                ? app.querySelector(
                    `[data-review-question="${CSS.escape(appState.reviewQuestionId)}"]`,
                  )
                : null;
              const details = app.querySelector("[data-result-details]");
              const review =
                details instanceof HTMLDetailsElement && details.open
                  ? current instanceof HTMLDetailsElement && current.open
                    ? current
                    : app.querySelector("[data-review-question][open]")
                  : null;
              const target =
                review?.querySelector(
                  ".solution-navigation button:not(:disabled)",
                ) || details?.querySelector("summary");
              if (target instanceof HTMLElement) {
                target.focus({ preventScroll: true });
              }
            } else {
              focusFirst();
            }
          },
          { "data-testid": "dismiss-recommendation" },
        ),
      ]),
    ],
    "recommendation",
  );
}

export function returnButton(
  renderScreen: () => void,
): HTMLButtonElement | null {
  return appState.saved.returnStack.length
    ? button(
        "さっきのチャレンジにもどる",
        () => {
          const previous = appState.saved.returnStack.pop();
          if (!previous) return;
          appState.config = previous;
          syncSelection();
          appState.activeScreen = "menu";
          persist();
          renderScreen();
        },
        { "data-testid": "return" },
      )
    : null;
}

export function menu(callbacks: MenuCallbacks): ElChild[] {
  const { render: renderScreen, start, resumeCheckpoint, openSettings } =
    callbacks;
  const updateConfig = (next: RunConfig): void => setConfig(next, renderScreen);
  const selected = new Set<ChallengeId>(appState.config.selectedIds);
  const long = appState.config.selectedIds.some(
    (id) => challengeOf(id).timeClass === "long",
  );
  const conditionNodes: HTMLElement[] = appState.config.selectedIds.flatMap(
    (id) => {
      const writtenControls: HTMLElement[] = [];
      if (KZWritten.ids.includes(id)) {
        const pair = Object.hasOwn(KZWritten.pairs, id)
          ? KZWritten.pairs[id]
          : undefined;
        if (!pair || id === pair.find((value) => selected.has(value))) {
          const available = KZWritten.available(
            id,
            appState.config.optionsById[id]?.remainder,
          );
          const fixedMode = Object.hasOwn(KZWritten.fixed, id)
            ? KZWritten.fixed[id]
            : undefined;
          const selectedMode: WrittenMode = pair
            ? pair.every((value) => selected.has(value))
              ? "mixed"
              : fixedMode || "mixed"
            : appState.config.optionsById[id]?.written || "mixed";
          writtenControls.push(
            select(
              (pair
                ? id === "G2-C01" || id === "G2-C02"
                  ? "2けたのたし算"
                  : "2けたのひき算"
                : challengeOf(id).title) +
                "の " +
                KZWritten.label(id),
              [
                ["none", "なし"],
                ["some", "あり"],
                ["mixed", "どちらも"],
              ],
              selectedMode,
              (value) => {
                const nextWritten: WrittenMode =
                  value === "none" || value === "some" ? value : "mixed";
                if (pair) {
                  const ids = appState.config.selectedIds.filter(
                    (selectedId) => !pair.includes(selectedId),
                  );
                  ids.push(
                    ...(nextWritten === "mixed"
                      ? pair
                      : pair.filter(
                          (valueId) => KZWritten.fixed[valueId] === nextWritten,
                        )),
                  );
                  updateConfig({ ...appState.config, selectedIds: ids });
                } else {
                  updateConfig({
                    ...appState.config,
                    optionsById: {
                      ...appState.config.optionsById,
                      [id]: {
                        ...appState.config.optionsById[id],
                        written: nextWritten,
                      },
                    },
                  });
                }
              },
              { "data-testid": `written-option-${pair ? pair[0] : id}` },
            ),
          );
          if (pair && selectedMode === "mixed") {
            writtenControls.push(
              text("p", "「あり」と「なし」の2つのチャレンジから出すよ。", {
                class: "condition-note",
              }),
            );
          }
          if (!pair && available.length === 1) {
            const control = writtenControls[0]?.querySelector("select");
            if (control) {
              for (const option of control.options) {
                option.disabled = option.value === "some";
              }
            }
            writtenControls.push(
              text(
                "p",
                "このあまりなしの条件では、途中のひき算でくり下がりは起こらないよ。「どちらも」でも、なしの問題になるよ。",
                {
                  class: "condition-note",
                  "data-testid": `written-unavailable-${id}`,
                },
              ),
            );
          }
        }
      }
      if (id === "G2-C08") {
        return [
          select(
            "九九のだん",
            [
              [0, "ぜんぶ"],
              ...Array.from(
                { length: 9 },
                (_, i): [number, string] => [i + 1, `${i + 1}のだん`],
              ),
            ],
            appState.config.optionsById[id]?.table || 0,
            (v) =>
              updateConfig({
                ...appState.config,
                optionsById: {
                  ...appState.config.optionsById,
                  [id]: { table: Number(v) || null },
                },
              }),
            { "data-testid": "table-option" },
          ),
        ];
      }
      if (KZ.REMAINDER_IDS.includes(id)) {
        return [
          ...writtenControls,
          select(
            challengeOf(id).title + "の あまり",
            [
              ["none", "あまりなし"],
              ["some", "あまりあり"],
              ["mixed", "まぜる"],
            ],
            appState.config.optionsById[id]?.remainder || "mixed",
            (v) => {
              const nextRemainder: RemainderMode =
                v === "none" || v === "some" ? v : "mixed";
              updateConfig({
                ...appState.config,
                optionsById: {
                  ...appState.config.optionsById,
                  [id]: {
                    ...appState.config.optionsById[id],
                    remainder: nextRemainder,
                    ...(appState.config.optionsById[id]?.written === "some" &&
                    !KZWritten.available(id, nextRemainder).includes("some")
                      ? { written: "none" }
                      : {}),
                  },
                },
              });
            },
            { "data-testid": `remainder-option-${id}` },
          ),
        ];
      }
      return writtenControls;
    },
  );
  const mode = select(
    "あそびかた",
    [
      ["practice", "れんしゅう"],
      ["time", "タイムアタック"],
    ],
    appState.config.mode,
    (v) => {
      const nextMode: RunMode = v === "time" ? "time" : "practice";
      updateConfig({
        ...appState.config,
        mode: nextMode,
        quantity: 10,
        timeLimitMs: long ? 120000 : 60000,
      });
    },
    { "data-testid": "mode" },
  );
  const timeLimitMs = appState.config.timeLimitMs ?? (long ? 120000 : 60000);
  const quantity =
    appState.config.mode === "practice"
      ? select(
          "もんだいのかず",
          [
            [10, "10もん"],
            [20, "20もん"],
            [30, "30もん"],
            [0, "むせいげん"],
          ],
          appState.config.quantity ?? 0,
          (v) =>
            updateConfig({ ...appState.config, quantity: Number(v) || null }),
          { "data-testid": "quantity" },
        )
      : select(
          "じかん",
          (long ? [60, 120, 180] : [30, 60, 90]).map(
            (n): [number, string] => [n * 1000, `${n}びょう`],
          ),
          timeLimitMs,
          (v) => updateConfig({ ...appState.config, timeLimitMs: Number(v) }),
          { "data-testid": "time-limit" },
        );
  const best = appState.config.selectedIds.length
    ? SUPPORT_KINDS.map(([kind, label]) => {
        const key = KZ.bestKey(appState.config, kind);
        const r = key ? appState.saved.bestRecords[key] : null;
        return text(
          "p",
          `${label}の いちばんのきろく：${key ? (r ? r.score + "てん" : "これから！") : "このあそびかたは とくてんのみ"}`,
        );
      })
    : [];
  const nodes: ElChild[] = [
    el("div", { class: "menu-heading" }, [
      el("div", {}, [
        text("p", "きょうの れんしゅう", { class: "eyebrow" }),
        text("h2", "なにを といてみる？"),
        text("p", "ひとつずつ、「できた！」を ふやそう。", {
          class: "menu-intro",
        }),
      ]),
      button("せってい", openSettings, {
        "data-testid": "settings",
        class: "quiet-button",
      }),
    ]),
    appState.saved.settings.name
      ? el("p", {
          text: appState.saved.settings.name + " さん",
          class: "name-label",
          "data-user-text": "true",
        })
      : null,
  ];
  if (appState.saved.practiceCheckpoint) {
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
                    appState.saved.practiceCheckpoint = null;
                    persist();
                    renderScreen();
                  },
                ),
              { "data-testid": "discard-practice" },
            ),
          ]),
        ],
        "resume-card",
      ),
    );
  }
  nodes.push(recommendation(renderScreen), returnButton(renderScreen));
  const grades = el(
    "div",
    { class: "grade-grid", "aria-label": "がくねん" },
    GRADES.map((g) =>
      button(
        `${g}ねん`,
        () => {
          if (appState.multiGrade) {
            if (appState.selectedGrades.has(g)) {
              appState.selectedGrades.delete(g);
            } else {
              appState.selectedGrades.add(g);
            }
            updateConfig({
              ...appState.config,
              selectedIds: appState.config.selectedIds.filter((id) =>
                appState.selectedGrades.has(challengeOf(id).grade),
              ),
            });
          } else {
            appState.grade = g;
            appState.selectedGrades = new Set<Grade>([g]);
            updateConfig({
              ...appState.config,
              selectedIds: appState.config.selectedIds.filter(
                (id) => challengeOf(id).grade === g,
              ),
            });
          }
        },
        {
          "data-grade": g,
          "aria-pressed": appState.multiGrade
            ? appState.selectedGrades.has(g)
            : appState.grade === g,
        },
      ),
    ),
  );
  const list = el(
    "div",
    {
      class: "challenge-list" + (appState.multiGrade ? " many-grades" : ""),
      "data-testid": "challenge-select",
    },
    KZ.CATALOG.filter((c) =>
      appState.multiGrade
        ? appState.selectedGrades.has(c.grade)
        : c.grade === appState.grade,
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
            "aria-label": challengeAccessibleLabel(c.id),
            onChange: (e) => {
              if (!(e.target instanceof HTMLInputElement)) return;
              const ids = new Set<ChallengeId>(
                appState.multiSelect ? appState.config.selectedIds : [],
              );
              if (e.target.checked) ids.add(c.id);
              else ids.delete(c.id);
              updateConfig({ ...appState.config, selectedIds: [...ids] });
            },
          }),
          el("span", { class: "challenge-copy" }, [
            el("strong", { class: "challenge-label" }, [
              appState.multiGrade ? `${c.grade}ねん・` : null,
              ...challengeLabelNodes(c.id),
            ]),
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
  if (!list.children.length) {
    list.append(text("p", "がくねんを えらんでね。"));
  }
  nodes.push(
    panel(
      [
        text("h3", "1　がくねんを えらぼう", { class: "step-label" }),
        grades,
        el("div", { class: "list-heading" }, [
          text(
            "h3",
            appState.multiSelect
              ? "2　いくつか えらぼう"
              : "2　やってみたい もんだいは？",
            { class: "step-label" },
          ),
          text("span", appState.multiSelect ? "いくつでもOK" : "1つ えらんでね", {
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
                appState.multiSelect ? "1つずつ えらぶ" : "いくつか えらぶ",
                () => {
                  appState.multiSelect = !appState.multiSelect;
                  if (!appState.multiSelect) {
                    appState.multiGrade = false;
                    const firstId = appState.config.selectedIds[0];
                    appState.grade = firstId
                      ? challengeOf(firstId).grade
                      : appState.grade;
                    appState.selectedGrades = new Set<Grade>([appState.grade]);
                    updateConfig({
                      ...appState.config,
                      selectedIds: appState.config.selectedIds.slice(0, 1),
                    });
                  } else {
                    renderScreen();
                  }
                },
                {
                  "aria-pressed": appState.multiSelect,
                  "data-testid": "multiple-select",
                },
              ),
              button(
                "がくねんを いくつか えらぶ",
                () => {
                  appState.multiGrade = !appState.multiGrade;
                  appState.multiSelect ||= appState.multiGrade;
                  appState.selectedGrades = new Set<Grade>(
                    appState.multiGrade
                      ? appState.config.selectedIds.map(
                          (id) => challengeOf(id).grade,
                        )
                      : [appState.grade],
                  );
                  if (!appState.selectedGrades.size) {
                    appState.selectedGrades.add(appState.grade);
                  }
                  renderScreen();
                },
                {
                  "aria-pressed": appState.multiGrade,
                  "data-testid": "multiple-grades",
                },
              ),
              button(
                "ぜんぶの がくねんから",
                () => {
                  appState.multiGrade = true;
                  appState.multiSelect = true;
                  appState.selectedGrades = new Set<Grade>(GRADES);
                  updateConfig({
                    ...appState.config,
                    selectedIds: KZ.CATALOG.map((c) => c.id),
                  });
                },
                { "data-testid": "all-grades" },
              ),
              button("えらびなおす", () =>
                updateConfig({ ...appState.config, selectedIds: [] }),
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
        `えらんだものを みる（${appState.config.selectedIds.length}こ）`,
      ),
      el(
        "div",
        { class: "chosen-chips", "data-testid": "selected-challenges" },
        appState.config.selectedIds.map((id) =>
          el(
            "button",
            {
              type: "button",
              onClick: () =>
                updateConfig({
                  ...appState.config,
                  selectedIds: appState.config.selectedIds.filter(
                    (x) => x !== id,
                  ),
                }),
              "data-remove-challenge": id,
              "aria-label": challengeAccessibleLabel(id) + "を はずす",
            },
            [`${challengeOf(id).grade}ねん・`, ...challengeLabelNodes(id), " ×"],
          ),
        ),
      ),
    ],
  );
  if (appState.config.selectedIds.length > 1) chosen.open = true;
  nodes.push(
    chosen,
    el(
      "details",
      { "data-menu-details": "options", class: "menu-details play-options" },
      [
        text(
          "summary",
          `あそびかたを かえる　${appState.config.mode === "practice" ? (appState.config.quantity ? appState.config.quantity + "もん" : "むせいげん") : timeLimitMs / 1000 + "びょう"}`,
        ),
        el("div", { class: "options" }, [mode, quantity, ...conditionNodes]),
        el("div", { class: "sound-options actions" }, [
          button(
            appState.saved.settings.sound ? "♪ おと あり" : "♪ おと なし",
            () => {
              appState.saved.settings.sound = !appState.saved.settings.sound;
              persist();
              renderScreen();
            },
            {
              "aria-pressed": appState.saved.settings.sound,
              "data-testid": "sound-toggle",
            },
          ),
          button(
            appState.saved.settings.effects ? "✦ うごき あり" : "✦ うごき なし",
            () => {
              appState.saved.settings.effects =
                !appState.saved.settings.effects;
              persist();
              renderScreen();
            },
            {
              "aria-pressed": appState.saved.settings.effects,
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
          appState.config.selectedIds.length === 1
            ? el(
                "strong",
                { class: "challenge-label" },
                challengeLabelNodes(appState.config.selectedIds[0]),
              )
            : text(
                "strong",
                appState.config.selectedIds.length
                  ? `${appState.config.selectedIds.length}この れんしゅう`
                  : "もんだいを えらんでね",
              ),
          text(
            "small",
            appState.config.mode === "practice"
              ? `${appState.config.quantity ? appState.config.quantity + "もん" : "むせいげん"}・じかんを きにせず`
              : `${timeLimitMs / 1000}びょう・タイムアタック`,
          ),
        ],
      ),
      button("はじめる！ →", start, {
        "data-testid": "start",
        class: "primary start-button",
        disabled: !appState.config.selectedIds.length,
      }),
    ]),
  );
  return nodes;
}
