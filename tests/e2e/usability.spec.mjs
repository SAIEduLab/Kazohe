import { test, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { K, htmlPath } from "../../scripts/load-inline-core.mjs";
import { hash } from "../../scripts/report.mjs";
import { rawAnswer } from "../../scripts/independent-math-oracle.mjs";
import { representatives } from "../fixtures/representatives.mjs";
const url = pathToFileURL(htmlPath).href,
  fixtures = representatives(K);
const snap = (page) => page.evaluate(() => window.kazoheTest.snapshot());
let navigation = 0;
async function setup(page) {
  await page.addInitScript(() => {
    if (location.protocol !== "file:") return;
    localStorage.clear();
    window.__KAZOHE_TEST__ = JSON.parse(
      decodeURIComponent(location.hash.slice(1) || "%7B%7D"),
    );
  });
}
async function open(page, id = null, extra = {}) {
  const opts = {
    seed: 20260925,
    ...(id
      ? {
          initialConfig: { selectedIds: [id], mode: "practice", quantity: 10 },
          fixedQuestion: fixtures[id].question,
        }
      : {}),
    ...extra,
  };
  await page.goto(
    url +
      "?case=" +
      encodeURIComponent(id || "menu") +
      "&visit=" +
      ++navigation +
      "#" +
      encodeURIComponent(JSON.stringify(opts)),
  );
  await page.getByTestId("skip").click();
  if (id) await page.getByTestId("start").click();
}
test.beforeEach(async ({ page }) => {
  await setup(page);
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push(e.message));
  await page.route(/^https?:/, (r) => {
    page.__errors.push(r.request().url());
    return r.abort();
  });
});
test.afterEach(async ({ page }) => expect(page.__errors).toEqual([]));

test("TC-U01 simple menu selection and visible start at four widths", async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1366]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await open(page);
    await expect(page.getByTestId("start")).toBeInViewport({ ratio: 1 });
    await expect(page.locator('[data-testid="mode"]')).toBeHidden();
    await page.locator('[data-category="計算"]').click();
    await page.locator('[data-challenge="G1-C03"]').check();
    expect((await snap(page)).config.selectedIds).toEqual(["G1-C03"]);
    await expect(page.getByTestId("selection-summary")).toContainText(
      "くりあがり",
    );
    await expect(page.getByTestId("start")).toBeInViewport({ ratio: 1 });
    await page.getByTestId("start").click();
    expect((await snap(page)).run.currentQuestion.challengeId).toBe("G1-C03");
  }
});
test("TC-U02 multiple grades, explicit selected contents, scroll and keyboard focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.locator('[data-grade="3"]').click();
  await page.locator('[data-category="計算"]').click();
  await page.locator('[data-menu-details="selection"]>summary').click();
  await page.getByTestId("multiple-select").click();
  const item = page.locator('[data-challenge="G3-C08"]');
  await item.scrollIntoViewIfNeeded();
  await item.focus();
  const y = await page.evaluate(() => scrollY);
  await page.keyboard.press("Space");
  await expect(item).toBeFocused();
  expect(Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThan(2);
  await page.getByTestId("multiple-grades").click();
  await page.locator('[data-grade="2"]').click();
  await page.locator('[data-challenge="G2-C08"]').check();
  expect((await snap(page)).config.selectedIds.sort()).toEqual([
    "G2-C08",
    "G3-C08",
  ]);
  await page.locator('[data-menu-details="chosen"]>summary').click();
  await expect(page.getByTestId("selected-challenges")).toContainText("九九");
  await page.getByTestId("start").click();
  expect((await snap(page)).run.config.languageGrade).toBe(2);
});
test("TC-U03 support opening, stopped clock and nearby controls", async ({
  page,
}) => {
  await page.clock.install();
  for (const width of [320, 390, 768, 1366]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await open(page, "G1-C03", {
      initialConfig: {
        selectedIds: ["G1-C03"],
        mode: "time",
        timeLimitMs: 60000,
      },
    });
    const gap = await page.evaluate(
      () =>
        document.querySelector('[data-testid="answer"]').getBoundingClientRect()
          .top -
        document
          .querySelector('[data-testid="problem"]')
          .getBoundingClientRect().bottom,
    );
    expect(gap).toBeLessThan(35);
    await page.getByTestId("help").click();
    await expect(page.locator("[data-support-focus]")).toBeInViewport();
    await expect(page.locator("[data-support-focus]")).toBeFocused();
    const time = (await snap(page)).run.activeTimeRemainingMs;
    await page.clock.runFor(15000);
    expect((await snap(page)).run.activeTimeRemainingMs).toBe(time);
    await page.getByTestId("next").click();
    await expect(page.getByTestId("answer-value")).toBeFocused();
    for (let i = 0; i < 2; i++) {
      await page.getByTestId("answer-value").fill("999");
      await page.getByTestId("submit").click();
      await page.clock.runFor(400);
    }
    await expect(page.locator("[data-support-focus]")).toBeInViewport();
    const hintTime = (await snap(page)).run.activeTimeRemainingMs;
    await page.clock.runFor(5000);
    expect((await snap(page)).run.activeTimeRemainingMs).toBe(hintTime);
    await page.getByTestId("hint-continue").click();
    await expect(page.getByTestId("answer-value")).toBeFocused();
  }
});
test("TC-U04 TC-U05 all 101 skills, generated input variants and written coordinates at four widths", async ({
  page,
}, info) => {
  test.setTimeout(600000);
  const cases = Object.values(fixtures).map((f) => f.question);
  for (const id of ["G1-N02", "G2-N02"]) {
    const g = K.createGenerator(43);
    let q;
    for (let i = 0; i < 40; i++) {
      q = K.generate(id, {}, g);
      if (q.answerSpec.type === "blocks") break;
    }
    expect(q.answerSpec.type).toBe("blocks");
    cases.push(q);
  }
  cases.push(
    K.complete(
      K.arithmetic(
        "G5-C04",
        K.op("/", K.lit("7.3"), K.lit("4")),
        { type: "quotient", decimalRemainder: true },
        { written: true },
      ),
    ),
  );
  const rows = [],
    inputTypes = new Set(),
    writtenIds = new Set();
  for (const width of [320, 390, 768, 1366]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    for (const q of cases) {
      await open(page, q.challengeId, { fixedQuestion: q });
      inputTypes.add(q.answerSpec.type);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        q.challengeId + " question overflow",
      ).toBe(true);
      const qSlash = await page
        .getByTestId("problem")
        .evaluate((n) => /\d\s*\/\s*\d/.test(n.textContent));
      expect(qSlash, q.prompt).toBe(false);
      const fractions = await page
        .getByTestId("problem")
        .locator(".math-fraction")
        .evaluateAll((xs) =>
          xs.map((n) => {
            const a = n
                .querySelector(".math-numerator")
                .getBoundingClientRect(),
              b = n.querySelector(".math-denominator").getBoundingClientRect();
            return (
              a.bottom <= b.top + 1 &&
              Math.abs((a.left + a.right - b.left - b.right) / 2) < 1
            );
          }),
        );
      expect(fractions.every(Boolean)).toBe(true);
      await page.getByTestId("help").click();
      await expect(page.locator("[data-support-focus]")).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        q.challengeId + " support overflow",
      ).toBe(true);
      expect(
        await page
          .locator(".support")
          .evaluate((n) => /\d\s*\/\s*\d/.test(n.textContent)),
        q.challengeId + " fraction slash",
      ).toBe(false);
      if (q.challengeId === "G1-C05") {
        const frames = page.locator(".support .ten-frame");
        expect(await frames.first().locator(".removed").count()).toBe(
          Number(K.evaluate(q.expressionAST.args[1]).n),
        );
        expect(await frames.nth(1).locator(".removed").count()).toBe(0);
      }
      if (q.challengeId === "G4-N01") {
        expect(
          await page.locator(".support .large-number").count(),
        ).toBeGreaterThan(0);
        for (const group of await page
          .locator(".support .number-group")
          .allTextContents())
          expect(group.length).toBeLessThanOrEqual(4);
      }
      const geometry = await page
        .locator(".written-board")
        .evaluateAll((boards) =>
          boards.map((board) => {
            const rows = [...board.querySelectorAll(".written-row")],
              centers = new Map(),
              errors = [];
            for (const row of rows) {
              const cells = [...row.querySelectorAll(".written-cell")],
                rect = row.getBoundingClientRect();
              if (
                Math.abs(
                  rect.width -
                    cells.reduce(
                      (sum, n) => sum + n.getBoundingClientRect().width,
                      0,
                    ),
                ) > 1
              )
                errors.push("line-width");
              for (const cell of cells) {
                const r = cell.getBoundingClientRect(),
                  c = cell.dataset.column,
                  x = (r.left + r.right) / 2;
                if (centers.has(c) && Math.abs(x - centers.get(c)) > 1)
                  errors.push("column-shift");
                centers.set(c, x);
                if (getComputedStyle(cell).borderRightStyle !== "dashed")
                  errors.push("no-guide");
              }
              if (
                Math.abs(
                  rect.height -
                    parseFloat(
                      getComputedStyle(board).getPropertyValue("--row"),
                    ) *
                      parseFloat(
                        getComputedStyle(document.documentElement).fontSize,
                      ),
                ) > 1
              )
                errors.push("explanation-stretches-row");
            }
            const hook = board.querySelector(".division-hook"),
              roof = board.querySelector(".division-roof");
            if (hook) {
              const a = hook.getBoundingClientRect(),
                b = roof.getBoundingClientRect();
              if (Math.abs(a.right - b.left) > 2 || Math.abs(a.top - b.top) > 2)
                errors.push("disconnected-hook");
            }
            if (board.querySelector(".written-notes,.written-caption"))
              errors.push("explanation-inside-calculation");
            const wrap = board.closest(".written-wrap"),
              notes = wrap.querySelector(".written-notes"),
              figure = wrap.querySelector(".written-figure");
            if (notes) {
              const a = figure.getBoundingClientRect(),
                b = notes.getBoundingClientRect();
              if (b.left >= a.right - 1) {
                if (b.left - a.right > 25) errors.push("far-notes");
              } else if (b.top - a.bottom > 20) errors.push("far-notes-below");
            }
            return { errors, columns: centers.size, rows: rows.length };
          }),
        );
      for (const g of geometry)
        expect(g.errors, `${q.challengeId} ${width}`).toEqual([]);
      if (q.written) writtenIds.add(q.challengeId);
      rows.push({
        id: q.challengeId,
        width,
        input: q.answerSpec.type,
        geometry,
      });
      if (
        info.project.name === "chromium" &&
        [320, 1366].includes(width) &&
        ["G4-C12", "G3-C02", "G3-C07", "G5-C04", "G5-N08", "G1-C03"].includes(
          q.challengeId,
        )
      ) {
        const dir = "reports/screens/v02";
        mkdirSync(dir, { recursive: true });
        await page.screenshot({
          path: `${dir}/${q.challengeId}-${width}-${rows.length}.png`,
          fullPage: true,
        });
      }
    }
  }
  expect(inputTypes.size).toBe(9);
  expect(writtenIds.size).toBe(30);
  mkdirSync("reports/layout", { recursive: true });
  writeFileSync(
    `reports/layout/${info.project.name}.json`,
    JSON.stringify(
      {
        htmlSha256: hash,
        browser: info.project.name,
        version: page.context().browser().version(),
        rows,
      },
      null,
      2,
    ),
  );
});
test("TC-U06 decimal columns, division hook and borrowing above original digits", async ({
  page,
}) => {
  await open(page, "G4-C12");
  const hookShape = await page
    .locator(".division-hook path")
    .evaluate((path) => {
      const length = path.getTotalLength(),
        points = Array.from({ length: 101 }, (_, i) =>
          path.getPointAtLength((length * i) / 100),
        );
      const low = points.filter((p) => p.y > 40),
        middle = points.filter((p) => p.y > 18 && p.y < 26);
      return {
        low: Math.min(...low.map((p) => p.x)),
        middle: Math.max(...middle.map((p) => p.x)),
        top: points[0].x,
      };
    });
  expect(hookShape.middle).toBeGreaterThan(hookShape.low + 8);
  expect(Math.abs(hookShape.low - hookShape.top)).toBeLessThan(4);
  await page.getByTestId("help").click();
  const columns = await page.locator(".written-row").evaluateAll((rows) =>
    rows.map((r) => ({
      kind: r.dataset.rowKind,
      values: [...r.querySelectorAll(".written-cell")].map(
        (n) => n.dataset.value,
      ),
      points: r.querySelectorAll(".decimal-mark").length,
    })),
  );
  expect(columns.find((r) => r.kind === "quotient").values).toEqual([
    "1",
    "7",
    "5",
  ]);
  expect(columns.find((r) => r.kind === "dividend").values).toEqual([
    "7",
    "0",
    "0",
  ]);
  expect(columns.find((r) => r.kind === "dividend").points).toBe(1);
  expect(
    columns.some(
      (r) => JSON.stringify(r.values) === JSON.stringify(["3", "0", ""]),
    ),
  ).toBe(true);
  await open(page, "G3-C02");
  await page.getByTestId("help").click();
  const board = page.getByTestId("written-board");
  await expect(page.locator(".written-notes")).toContainText(
    "百の位から1を借り、一の位を13",
  );
  expect(
    await board.locator(".written-row").first().getAttribute("data-row-kind"),
  ).toBe("annotation");
  expect(await board.locator(".regrouped").count()).toBe(3);
});
test("TC-U07 low grade common wording and human readable wrong-answer review", async ({
  page,
}) => {
  await page.clock.install();
  await open(page, "G1-C03");
  await expect(page.locator(".play-stats")).toContainText("とくてん");
  await expect(page.locator(".play-stats")).toContainText("れんぞく");
  await page.getByTestId("answer-value").fill("14");
  await page.getByTestId("submit").click();
  await page.clock.runFor(400);
  await page.getByTestId("help").click();
  await page.getByTestId("next").click();
  await page.getByTestId("end").click();
  await page.getByTestId("confirm-accept").click();
  await page.getByTestId("details").locator("summary").first().click();
  await expect(page.locator(".review-item").first()).toContainText(
    "はじめの こたえ：14",
  );
  expect(await page.locator(".review-item").first().innerText()).not.toMatch(
    /"value"|\{"|未回答|誤答|Score/,
  );
  await open(page, "G5-C06");
  await page.getByTestId("answer-numerator").fill("99");
  await page.getByTestId("answer-denominator").fill("11");
  await page.getByTestId("submit").click();
  await page.clock.runFor(400);
  await page.getByTestId("end").click();
  await page.getByTestId("confirm-accept").click();
  await page.getByTestId("details").locator("summary").first().click();
  await expect(
    page.locator(".review-item .math-fraction").first(),
  ).toBeVisible();
  expect(await page.locator(".review-item").innerText()).not.toMatch(
    /"numerator"|99\/11/,
  );
});
test("TC-U08 place-value labels and corresponding common-denominator fields", async ({
  page,
}) => {
  const gen = K.createGenerator(3);
  let q;
  for (let i = 0; i < 20; i++) {
    q = K.generate("G2-N02", {}, gen);
    if (q.answerSpec.type === "blocks") break;
  }
  await open(page, "G2-N02", { fixedQuestion: q });
  for (const width of [320, 390, 768, 1366]) {
    await page.setViewportSize({ width, height: 844 });
    const positions = await page
      .locator(".blocks-answer input")
      .evaluateAll((xs) =>
        xs.map((x) => {
          const r = x.getBoundingClientRect();
          return { top: r.top, width: r.width };
        }),
      );
    expect(
      Math.max(...positions.map((x) => x.top)) -
        Math.min(...positions.map((x) => x.top)),
    ).toBeLessThan(1);
    expect(positions.every((x) => x.width >= 44)).toBe(true);
  }
  const labels = await page
    .locator(".blocks-answer input")
    .evaluateAll((xs) => xs.map((x) => x.getAttribute("aria-label")));
  const units = labels.map((s) => Number(s.match(/[\d.]+/)?.[0] || 1));
  expect(units).toEqual([...units].sort((a, b) => b - a));
  const raw = rawAnswer(q);
  for (let i = 0; i < raw.values.length; i++)
    await page.getByTestId("answer-block-" + i).fill(String(raw.values[i]));
  await page.getByTestId("submit").click();
  expect((await snap(page)).run.records[0].terminal).toBe("correct");
  await open(page, "G5-N08");
  await expect(page.locator(".common-answer")).toHaveCount(2);
  await expect(page.locator(".common-answer").first()).toContainText("1つめ");
  await expect(page.locator(".common-answer").last()).toContainText("2つめ");
  await expect(page.locator(".common-original .math-fraction")).toHaveCount(2);
});
test("TC-U09 visible initial fraction target, form switch, caret editing and next field", async ({
  page,
}) => {
  await open(page, "G5-C06");
  await page.locator('[data-key="7"]').click();
  await expect(page.getByTestId("answer-numerator")).toHaveValue("7");
  await expect(page.getByTestId("answer-whole")).toHaveValue("");
  await page.getByTestId("next-field").click();
  await expect(page.getByTestId("answer-denominator")).toBeFocused();
  await page.locator('[data-key="8"]').click();
  await expect(page.getByTestId("answer-denominator")).toHaveValue("8");
  await page.getByLabel("答えの形", { exact: true }).selectOption("integer");
  await page.locator('[data-key="4"]').click();
  await expect(page.getByTestId("answer-whole")).toHaveValue("4");
  await page.getByTestId("answer-whole").fill("123");
  await page.getByTestId("answer-whole").selectText();
  await page.locator('[data-key="7"]').click();
  await expect(page.getByTestId("answer-whole")).toHaveValue("7");
  await page.getByTestId("answer-whole").fill("123");
  await page
    .getByTestId("answer-whole")
    .evaluate((n) => n.setSelectionRange(1, 2));
  await page.locator('[data-key="back"]').click();
  await expect(page.getByTestId("answer-whole")).toHaveValue("13");
  await open(page, "G1-N01");
  await expect(page.locator("[data-key]")).toHaveCount(0);
  await open(page, "G5-N01");
  await expect(page.locator("[data-key]")).toHaveCount(0);
});
test("TC-U10 input error focus, visible duplicates and pending last divisor", async ({
  page,
}) => {
  await open(page, "G1-C03");
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("answer-value")).toBeFocused();
  await page.keyboard.type("15");
  await expect(page.getByTestId("answer-value")).toHaveValue("15");
  expect((await snap(page)).run.records[0].wrongAttempts).toBe(0);
  await open(page, "G5-N02");
  const q = (await snap(page)).run.currentQuestion,
    values = rawAnswer(q).values;
  await page.getByTestId("answer-set-value").fill(String(values[0]));
  await page.getByTestId("add-number").click();
  await page.getByTestId("answer-set-value").fill(String(values[0]));
  await page.getByTestId("add-number").click();
  await expect(page.locator(".inline-error")).toContainText("1かいだけ");
  for (const v of values.slice(1, -1)) {
    await page.getByTestId("answer-set-value").fill(String(v));
    await page.getByTestId("add-number").click();
  }
  await page.getByTestId("answer-set-value").fill(String(values.at(-1)));
  await page.getByTestId("submit").click();
  expect((await snap(page)).run.records[0].terminal).toBe("correct");
});
test("TC-U11 correct feedback, 3 5 8 streaks, progress and achievement result", async ({
  page,
}) => {
  await page.clock.install();
  await open(page, "G1-C03");
  for (let i = 1; i <= 10; i++) {
    const q = (await snap(page)).run.currentQuestion;
    await page.getByTestId("answer-value").fill(String(rawAnswer(q).value));
    await page.getByTestId("submit").click();
    await expect(page.getByTestId("success-feedback")).toBeVisible();
    if ([3, 5, 8].includes(i))
      await expect(page.getByTestId("success-detail")).toContainText(
        `${i}れんぞく！`,
      );
    await expect(page.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      String(i),
    );
    await page.clock.runFor(800);
  }
  await expect(page.locator(".achievement-ribbon")).toContainText(
    "10もん できた",
  );
  expect((await snap(page)).result.metrics.correctProblems).toBe(10);
});
test("TC-U12 effects off, sound off and reduced motion retain clear feedback", async ({
  page,
}) => {
  await page.clock.install();
  await open(page);
  await page.locator('[data-menu-details="options"]>summary').click();
  if (
    (await page.getByTestId("sound-toggle").getAttribute("aria-pressed")) ===
    "true"
  )
    await page.getByTestId("sound-toggle").click();
  if (
    (await page.getByTestId("effects-toggle").getAttribute("aria-pressed")) ===
    "true"
  )
    await page.getByTestId("effects-toggle").click();
  await page.locator('[data-category="計算"]').click();
  await page.locator('[data-challenge="G1-C03"]').check();
  await page.getByTestId("start").click();
  let q = (await snap(page)).run.currentQuestion;
  await page.getByTestId("answer-value").fill(String(rawAnswer(q).value));
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("success-feedback")).toBeVisible();
  await expect(page.locator(".celebrate")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "G1-C03");
  q = (await snap(page)).run.currentQuestion;
  await page.getByTestId("answer-value").fill(String(rawAnswer(q).value));
  await page.getByTestId("submit").click();
  expect(
    await page
      .locator(".success-mark")
      .evaluate((n) => getComputedStyle(n).animationName),
  ).toBe("none");
  await expect(page.getByTestId("success-feedback")).toBeVisible();
});
