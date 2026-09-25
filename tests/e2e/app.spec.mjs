import { test, expect } from "@playwright/test";
import {
  mkdtempSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { K, htmlPath } from "../../scripts/load-inline-core.mjs";
import { hash } from "../../scripts/report.mjs";
import { rawAnswer } from "../../scripts/independent-math-oracle.mjs";
import { representatives } from "../fixtures/representatives.mjs";
const fixtures = representatives(K),
  solo = mkdtempSync(join(tmpdir(), "kazohe-audit-"));
copyFileSync(htmlPath, join(solo, "Kazohe.html"));
const url = pathToFileURL(join(solo, "Kazohe.html")).href;
const config = (id) => ({ selectedIds: [id], mode: "practice", quantity: 10 });
async function open(page, options = {}) {
  await page.addInitScript(
    (opts) => {
      window.__KAZOHE_TEST__ = opts;
    },
    { seed: 20260925, ...options },
  );
  await page.goto(url);
  if (await page.getByTestId("skip").isVisible())
    await page.getByTestId("skip").click();
}
async function start(page, id = "G1-C01", options = {}) {
  await open(page, { initialConfig: config(id), ...options });
  await page.getByTestId("start").click();
}
async function snapshot(page) {
  return page.evaluate(() => window.kazoheTest.snapshot());
}
async function fill(page, q, raw = rawAnswer(q), touch = false) {
  const s = q.answerSpec;
  const put = async (testId, value) => {
    if (touch) {
      await page.getByTestId(testId).tap();
      for (const c of String(value))
        await page.locator(`[data-key="${c}"]`).tap();
    } else await page.getByTestId(testId).fill(String(value));
  };
  if (s.type === "integer" || s.type === "decimal")
    await put("answer-value", raw.value);
  else if (s.type === "quotient") {
    await put("answer-quotient", raw.quotient);
    await put("answer-remainder", raw.remainder);
  } else if (s.type === "fraction" || s.type === "common") {
    const one = async (r, suffix = "") => {
      const form = page.getByLabel("答えの形" + suffix, { exact: true });
      if (await form.isVisible()) await form.selectOption(r.form || "fraction");
      else await expect(form).toHaveValue(r.form || "fraction");
      if (r.form === "integer" || r.form === "mixed")
        await put("answer-whole" + suffix, r.whole);
      if (r.form !== "integer") {
        await put("answer-numerator" + suffix, r.numerator);
        await put("answer-denominator" + suffix, r.denominator);
      }
    };
    if (s.type === "common") {
      await one(raw.first, "-first");
      await one(raw.second, "-second");
    } else await one(raw);
  } else if (s.type === "compare" || s.type === "parity")
    await page.locator(`[data-choice="${raw.value}"]`).click();
  else if (s.type === "blocks") {
    for (let i = 0; i < raw.values.length; i++)
      await put("answer-block-" + i, raw.values[i]);
  } else {
    for (const v of raw.values) {
      await put("answer-set-value", v);
      if (touch) await page.getByTestId("add-number").tap();
      else await page.getByTestId("add-number").click();
    }
  }
}
test.beforeEach(async ({ page }) => {
  const failures = [];
  await page.routeWebSocket(/.*/, (socket) => {
    failures.push("WebSocket " + socket.url());
    socket.close();
  });
  page.on("pageerror", (e) => failures.push(e.message));
  page.on("websocket", (socket) => failures.push("WebSocket " + socket.url()));
  await page.route(/^https?:/, (route) => {
    failures.push("request " + route.request().url());
    return route.abort();
  });
  page.__failures = failures;
});
test.afterEach(async ({ page }, info) => {
  expect(page.__failures).toEqual([]);
  await info.attach("environment", {
    body: JSON.stringify({
      htmlSha256: hash,
      browser: info.project.name,
      version: page.context().browser().version(),
      pageErrorsAndRequests: page.__failures,
    }),
    contentType: "application/json",
  });
});
test("TC-B01 TC-B02 TC-B03 TC-B07 TC-B11 end to end keyboard, retry, hint, help, pause, result", async ({
  page,
}) => {
  await page.clock.install();
  await start(page);
  let r = (await snapshot(page)).run;
  await fill(page, r.currentQuestion);
  await page.getByTestId("answer-value").press("Enter");
  await page.clock.runFor(800);
  await page.getByTestId("answer-value").fill("99999");
  await page.getByTestId("answer-value").press("Enter");
  await page.clock.runFor(400);
  await page.getByTestId("answer-value").fill("99999");
  await page.getByTestId("submit").click();
  await page.clock.runFor(400);
  await expect(page.getByTestId("hint-continue")).toBeVisible();
  await page.getByTestId("hint-continue").press("Enter");
  r = (await snapshot(page)).run;
  await fill(page, r.currentQuestion);
  await page.getByTestId("submit").click();
  await page.clock.runFor(800);
  await page.getByTestId("help").click();
  await expect(page.getByTestId("next")).toBeVisible();
  await page.getByTestId("next").press("Enter");
  await page.getByTestId("answer-value").fill("14");
  await page.getByTestId("pause").click();
  await expect(page.getByTestId("problem")).toHaveCount(0);
  await page.getByTestId("resume").press("Enter");
  await expect(page.getByTestId("answer-value")).toHaveValue("14");
  await page.getByTestId("end").click();
  await page.getByRole("button", { name: "やめる", exact: true }).click();
  await expect(page.getByTestId("answer-value")).toHaveValue("14");
  await page.getByTestId("end").click();
  await page.getByTestId("confirm-accept").click();
  await expect(page.getByTestId("result")).toBeVisible();
  await page.getByTestId("details").locator("summary").first().press("Enter");
  await expect(page.getByTestId("details")).toContainText(
    "まだ といていない もんだい",
  );
  await page.getByTestId("menu").click();
  await page.getByTestId("settings").press("Enter");
  await page.getByTestId("score-clear").click();
  await page
    .getByRole("button", { name: "やめる", exact: true })
    .press("Enter");
});
test("TC-B04 TC-B06 TC-B12 TC-B14 responsive, written arithmetic, 200 percent, large inputs", async ({
  page,
}, info) => {
  test.setTimeout(240000);
  const ids = [
    "G2-C02",
    "G3-C02",
    "G3-C04",
    "G3-C07",
    "G3-C08",
    "G4-C05",
    "G4-C07",
    "G4-C09",
    "G5-C04",
  ];
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [768, 1024],
    [1366, 768],
  ]) {
    await page.setViewportSize({ width, height });
    for (const id of ids) {
      await page.context().clearCookies();
      await page.addInitScript(() => localStorage.clear());
      await start(page, id, { fixedQuestion: fixtures[id].question });
      await page.getByTestId("help").click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(page.getByTestId("next")).toBeVisible();
      if (
        info.project.name === "chromium" &&
        (width === 320 || width === 1366)
      ) {
        const file = `reports/screens/${id}-${width}.png`;
        mkdirSync("reports/screens", { recursive: true });
        await page.screenshot({ path: file, fullPage: true });
      }
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("TC-B05 TC-B02 TC-B17 all 101 examples: real inputs, judging and complete solutions", async ({
  page,
}, info) => {
  test.setTimeout(420000);
  const ids = Object.keys(fixtures);
  const checked = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  await page.addInitScript(() => {
    if (location.protocol !== "file:") return;
    localStorage.clear();
    window.__KAZOHE_TEST__ = JSON.parse(
      decodeURIComponent(location.hash.slice(1)),
    );
  });
  for (const id of ids) {
    await page.goto(
      url +
        "?challenge=" +
        encodeURIComponent(id) +
        "#" +
        encodeURIComponent(
          JSON.stringify({
            seed: 20260925,
            initialConfig: config(id),
            fixedQuestion: fixtures[id].question,
          }),
        ),
    );
    await page.getByTestId("skip").click();
    await page.getByTestId("start").click();
    const q = (await snapshot(page)).run.currentQuestion;
    await expect(page.getByTestId("problem")).not.toBeEmpty();
    if (info.project.name === "chromium") {
      mkdirSync("reports/screens/catalog", { recursive: true });
      await page
        .locator(".problem-panel")
        .screenshot({ path: `reports/screens/catalog/${id}-question.png` });
    }
    await page.getByTestId("help").click();
    await expect(page.getByTestId("next")).toBeVisible();
    expect(await page.locator(".support").textContent()).toContain("こたえ：");
    if (info.project.name === "chromium")
      await page
        .locator(".support")
        .screenshot({ path: `reports/screens/catalog/${id}-solution.png` });
    await page.getByTestId("next").click();
    await fill(page, (await snapshot(page)).run.currentQuestion);
    await page.getByTestId("submit").click();
    expect((await snapshot(page)).run.records[1].terminal).toBe("correct");
    await expect(page.locator("#storage-warning")).toBeHidden();
    expect(page.__failures).toEqual([]);
    checked.push(id);
  }
  await info.attach("all-challenges", {
    body: JSON.stringify({
      ids: checked,
      htmlSha256: hash,
      browser: page.context().browser().version(),
    }),
    contentType: "application/json",
  });
});

test("TC-B07 keyboard only: Tab Shift+Tab Enter digits Backspace through the full flow", async ({
  page,
}, info) => {
  await page.clock.install();
  await page.addInitScript(() => {
    window.__KAZOHE_TEST__ = {
      seed: 20260925,
      initialConfig: {
        selectedIds: ["G1-C01"],
        mode: "practice",
        quantity: 10,
      },
    };
  });
  await page.goto(url);
  const tabTo = async (id) => {
    for (let i = 0; i < 200; i++) {
      const found = await page.evaluate(
        (id) =>
          id === "cancel"
            ? document.activeElement?.textContent === "やめる"
            : document.activeElement?.getAttribute("data-testid") === id,
        id,
      );
      if (found) return;
      const reverse = await page.evaluate((id) => {
        const root = document.querySelector("dialog[open]") || document;
        const order = [
          ...root.querySelectorAll("button,input,select,summary,[tabindex]"),
        ].filter(
          (n) => !n.disabled && n.tabIndex >= 0 && n.getClientRects().length,
        );
        const target = order.findIndex((n) =>
          id === "cancel"
            ? n.textContent === "やめる"
            : n.getAttribute("data-testid") === id,
        );
        const current = order.indexOf(document.activeElement);
        return current >= 0 && target >= 0 && target < current;
      }, id);
      await page.keyboard.press(reverse ? "Shift+Tab" : "Tab");
    }
    throw Error(`Keyboard cannot reach ${id}`);
  };
  const activate = async (id) => {
    await tabTo(id);
    await page.keyboard.press("Enter");
  };
  const typeAnswer = async (value) => {
    await tabTo("answer-value");
    const length = (await page.getByTestId("answer-value").inputValue()).length;
    for (let i = 0; i < length; i++) await page.keyboard.press("Backspace");
    await page.keyboard.type(String(value));
    await page.keyboard.press("Enter");
  };
  await activate("skip");
  await activate("start");
  await tabTo("answer-value");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("answer-value")).toBeFocused();
  if (info.project.name === "chromium")
    await page.screenshot({
      path: "reports/screens/keyboard-focus.png",
      fullPage: true,
    });
  await typeAnswer(rawAnswer((await snapshot(page)).run.currentQuestion).value);
  await page.clock.runFor(800);
  for (let i = 0; i < 2; i++) {
    await typeAnswer("999");
    await page.clock.runFor(400);
  }
  await activate("hint-continue");
  await activate("help");
  await activate("next");
  await activate("pause");
  await activate("resume");
  await activate("end");
  await activate("cancel");
  await activate("end");
  await activate("confirm-accept");
  await expect(page.getByTestId("result")).toBeVisible();
  await activate("menu");
  await activate("settings");
  await activate("score-clear");
  await activate("cancel");
  await expect(page.locator("dialog")).not.toBeVisible();
});

test("TC-B12 TC-B14 long names, maximum numbers, large scores and enlarged result", async ({
  page,
}, info) => {
  let run = K.createRun(
    { selectedIds: ["G6-C08"], mode: "practice", quantity: null },
    12345,
    0,
  );
  for (let i = 0; i < 150; i++) {
    run = K.reduceRun(
      run,
      {
        type: "SUBMIT",
        questionId: run.currentQuestion.questionId,
        raw: rawAnswer(run.currentQuestion),
      },
      0,
    );
    run = K.reduceRun(run, { type: "FEEDBACK_DONE" }, 0);
  }
  expect(run.score).toBeGreaterThanOrEqual(100000);
  const saved = K.emptySave();
  saved.settings.name = "あいうえお".repeat(6);
  saved.settings.onboarded = true;
  saved.settings.config = run.config;
  saved.practiceCheckpoint = K.checkpoint(run);
  K.validateBackup(JSON.stringify(saved));
  await page.addInitScript(
    ({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)),
    { key: K.STORAGE_KEY, saved },
  );
  await page.setViewportSize({ width: 320, height: 568 });
  await open(page);
  await page.getByTestId("continue-practice").click();
  await expect(page.getByTestId("score")).toHaveText(String(run.score));
  await page.getByTestId("end").click();
  await page.getByTestId("confirm-accept").click();
  await expect(page.getByTestId("result")).toContainText(saved.settings.name);
  const fits = async () =>
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  await fits();
  if (info.project.name === "chromium")
    await page.screenshot({
      path: "reports/screens/large-result-320.png",
      fullPage: true,
    });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  await page.getByTestId("details").locator("summary").first().click();
  await fits();
  if (info.project.name === "chromium")
    await page.screenshot({
      path: "reports/screens/large-result-200.png",
      fullPage: true,
    });
  const maximumInteger = K.complete(
    K.special(
      "G4-N01",
      "compare",
      [K.rat("9999999999999999"), K.rat("9999999999999998")],
      { type: "compare" },
      { numberBlocks: true },
    ),
  );
  const maximumMixed = K.complete(
    K.arithmetic(
      "G5-C08",
      K.op(
        "+",
        K.lit(K.rat(65, 11), "5と10/11"),
        K.lit(K.rat(71, 12), "5と11/12"),
      ),
      { type: "fraction", reduced: true },
    ),
  );
  for (const q of [maximumInteger, maximumMixed]) {
    await page.addInitScript(() => localStorage.clear());
    await page.setViewportSize({ width: 320, height: 568 });
    await start(page, q.challengeId, { fixedQuestion: q });
    if (q === maximumMixed)
      await fill(page, q, {
        form: "mixed",
        whole: "11",
        numerator: "109",
        denominator: "132",
      });
    await fits();
    if (info.project.name === "chromium")
      await page.screenshot({
        path: `reports/screens/maximum-${q.challengeId}.png`,
        fullPage: true,
      });
  }
});
test.describe("touch emulation", () => {
  test.use({ hasTouch: true });
  test("TC-B08 touch keypad handles quotient, mixed fractions, common denominator and sets", async ({
    page,
  }) => {
    await page.clock.install();
    for (const id of ["G5-C04", "G4-N06", "G5-N08", "G5-N02"]) {
      await page.addInitScript(() => localStorage.clear());
      await start(page, id, { fixedQuestion: fixtures[id].question });
      await fill(
        page,
        (await snapshot(page)).run.currentQuestion,
        undefined,
        true,
      );
      await page.getByTestId("submit").tap();
      expect((await snapshot(page)).run.records[0].terminal).toBe("correct");
    }
  });
});

test("TC-B12 TC-F17 recommendation selection and return preserve the original challenge", async ({
  page,
}, info) => {
  await page.clock.install();
  await page.setViewportSize({ width: 320, height: 568 });
  await start(page, "G3-C02");
  for (let i = 0; i < 10; i++) {
    await page.getByTestId("help").click();
    await page.getByTestId("next").click();
  }
  await expect(page.getByTestId("result")).toBeVisible();
  await expect(page.getByTestId("recommendation")).toBeVisible();
  const original = (await snapshot(page)).run.config;
  const target = K.BY_ID["G3-C02"].fallbackParent;
  if (info.project.name === "chromium")
    await page.screenshot({
      path: "reports/screens/recommendation-320.png",
      fullPage: true,
    });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (info.project.name === "chromium")
    await page.screenshot({
      path: "reports/screens/recommendation-200.png",
      fullPage: true,
    });
  await page.getByTestId("recommendation").click();
  await page.getByTestId("start").click();
  expect((await snapshot(page)).run.config.selectedIds).toEqual([target]);
  await page.getByTestId("end").click();
  await page.getByTestId("confirm-accept").click();
  await page
    .getByRole("button", { name: "さっきのチャレンジにもどる" })
    .click();
  await page.getByTestId("start").click();
  expect((await snapshot(page)).run.config).toEqual(original);
});
test("TC-B09 TC-B10 reduced motion and blocked audio", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.AudioContext = class {
      constructor() {
        throw Error("audio blocked");
      }
    };
  });
  await start(page);
  await fill(page, (await snapshot(page)).run.currentQuestion);
  await page.getByTestId("submit").click();
  expect((await snapshot(page)).run.records[0].terminal).toBe("correct");
  expect(
    await page
      .locator(".problem-panel")
      .evaluate((n) => getComputedStyle(n).animationName),
  ).toBe("none");
});
test("TC-B13 TC-P19 TC-P20 TC-P27 backup export, replacement, cancellation and reset", async ({
  page,
}) => {
  await start(page);
  await page.getByTestId("end").click();
  await page.getByTestId("confirm-accept").click();
  await page.getByTestId("menu").click();
  await page.getByTestId("settings").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export").click();
  const file = await download;
  const path = await file.path();
  const data = JSON.parse(readFileSync(path, "utf8"));
  expect(data.appVersion).toBe("0.2");
  data.settings.name = "復元テスト";
  const json = Buffer.from(JSON.stringify(data));
  await page.getByTestId("import").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: json,
  });
  await page.getByRole("button", { name: "やめる", exact: true }).click();
  expect((await snapshot(page)).saved.settings.name).not.toBe("復元テスト");
  await page.getByTestId("settings").click();
  await page.getByTestId("import").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: json,
  });
  await page.getByTestId("confirm-accept").click();
  await expect(
    page.getByText("復元テスト さん", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => localStorage.setItem("other-app:test", "keep"));
  await page.getByTestId("settings").click();
  await page.getByTestId("reset").click();
  await page.getByTestId("confirm-accept").click();
  await expect(page.getByTestId("skip")).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("other-app:test")),
  ).toBe("keep");
});
test("TC-P14 TC-P15 TC-P25 TC-P26 TC-B03 persistence and rejected storage", async ({
  page,
  browser,
}) => {
  await page.clock.install();
  await start(page);
  await fill(page, (await snapshot(page)).run.currentQuestion);
  await page.getByTestId("submit").click();
  await page.clock.runFor(800);
  const current = (await snapshot(page)).run.currentQuestion;
  await page.getByTestId("answer-value").fill("9999");
  await page.getByTestId("submit").click();
  await page.clock.runFor(400);
  await page.reload();
  await page.getByTestId("continue-practice").click();
  let r = (await snapshot(page)).run;
  expect(r.records[1].wrongAttempts).toBe(0);
  expect(r.currentQuestion.canonicalKey).toBe(current.canonicalKey);
  await page.getByTestId("help").click();
  await page.reload();
  await page.getByTestId("continue-practice").click();
  r = (await snapshot(page)).run;
  expect(r.records.filter((x) => x.terminal === "help")).toHaveLength(1);
  const ctx = await browser.newContext(),
    blocked = await ctx.newPage();
  await blocked.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  await start(blocked);
  await expect(blocked.locator("#storage-warning")).toContainText(
    "保存できません",
  );
  await blocked.getByTestId("help").click();
  await expect(blocked.getByTestId("next")).toBeVisible();
  await ctx.close();
});
test("TC-T08 TC-T13 TC-T15 exact timer boundary and time run discard", async ({
  page,
}) => {
  await page.clock.install();
  await start(page, "G1-C01", {
    initialConfig: {
      selectedIds: ["G1-C01"],
      mode: "time",
      timeLimitMs: 30000,
    },
  });
  await page.clock.runFor(30000);
  await expect(page.getByTestId("result")).toBeVisible();
  const score = (await snapshot(page)).run.score;
  expect(score).toBe(0);
  await page.reload();
  await expect(page.getByTestId("continue-practice")).toHaveCount(0);
});
test("TC-B11 accessible labels and automated accessibility", async ({
  page,
}) => {
  await start(page, "G5-N08", { fixedQuestion: fixtures["G5-N08"].question });
  await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
  const results = await page.evaluate(async () => {
    const r = await window.axe.run(document, {
      rules: { "color-contrast": { enabled: true } },
    });
    return r.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    }));
  });
  expect(results).toEqual([]);
});
