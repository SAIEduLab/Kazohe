import { test, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { K, Teaching, htmlPath } from "../../scripts/load-inline-core.mjs";
import { hash } from "../../scripts/report.mjs";
import { representatives } from "../fixtures/representatives.mjs";
const url = pathToFileURL(htmlPath).href,
  fixtures = representatives(K);
let navigation = 0;
async function open(page, q) {
  await page.goto(
    url +
      `?teaching=${++navigation}#` +
      encodeURIComponent(
        JSON.stringify({
          seed: 42,
          initialConfig: {
            selectedIds: [q.challengeId],
            mode: "practice",
            quantity: 10,
          },
          fixedQuestion: q,
        }),
      ),
  );
  await page.getByTestId("skip").click();
  await page.getByTestId("start").click();
  await page.getByTestId("help").click();
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    window.__KAZOHE_TEST__ = JSON.parse(
      decodeURIComponent(location.hash.slice(1) || "%7B%7D"),
    );
  });
  await page.route(/^https?:/, (r) => r.abort());
});
test("TC-U13 every challenge advances and restores each teaching state without scoring or clock changes", async ({
  page,
}, info) => {
  test.setTimeout(300000);
  await page.clock.install();
  const evidence = [];
  for (const c of K.CATALOG) {
    const q = fixtures[c.id].question;
    await open(page, q);
    const count = Teaching.steps(q).length;
    await expect(page.getByTestId("solution-back")).toBeDisabled();
    const initial = await page.locator(".support").innerHTML();
    const before = await page.evaluate(() => window.kazoheTest.snapshot().run);
    if (count > 1) {
      await page.getByTestId("solution-forward").click();
      await expect(page.getByTestId("solution-progress")).toHaveText(
        `2／${count}`,
      );
      await page.getByTestId("solution-back").click();
      expect(await page.locator(".support").innerHTML()).toBe(initial);
    }
    const geometry = await page.evaluate(() => {
      const errors = [],
        heights = [],
        states = [];
      for (let step = 0; step < 500; step++) {
        const board = document.querySelector(".written-board");
        if (board) {
          if (board.querySelector(".written-row.annotation"))
            errors.push("stacked-history");
          const centers = new Map();
          for (const cell of board.querySelectorAll(".written-cell")) {
            const rect = cell.getBoundingClientRect(),
              x = rect.left + rect.width / 2,
              col = cell.dataset.column;
            if (centers.has(col) && Math.abs(centers.get(col) - x) > 1)
              errors.push("column-shift");
            centers.set(col, x);
            const note = cell.querySelector(".written-annotation"),
              digit = cell.querySelector(".written-digit");
            if (note) {
              const a = note.getBoundingClientRect(),
                b = digit.getBoundingClientRect();
              if (
                a.bottom > b.top + 1 ||
                a.left < rect.left - 1 ||
                a.right > rect.right + 1
              )
                errors.push("annotation-overlap");
            }
          }
          heights.push(board.getBoundingClientRect().height);
          states.push(board.innerHTML);
        }
        const next = document.querySelector('[data-testid="solution-forward"]');
        if (next.disabled) break;
        next.click();
        if (step === 499) throw Error("Nonterminating teaching steps");
      }
      return { errors, heights, states: states.length };
    });
    expect(geometry.errors, c.id).toEqual([]);
    if (q.written && ["+", "-"].includes(q.expressionAST.op))
      expect(new Set(geometry.heights).size, c.id).toBe(1);
    await expect(page.getByTestId("solution-forward")).toBeDisabled();
    await page.clock.runFor(1000);
    const after = await page.evaluate(() => window.kazoheTest.snapshot().run);
    expect(after.score).toBe(before.score);
    expect(after.activeTimeRemainingMs).toBe(before.activeTimeRemainingMs);
    expect(after.records).toEqual(before.records);
    await page.evaluate(() => {
      for (let i = 0; i < 500; i++) {
        const b = document.querySelector('[data-testid="solution-back"]');
        if (b.disabled) return;
        b.click();
      }
      throw Error("Back navigation did not terminate");
    });
    expect(await page.locator(".support").innerHTML(), c.id).toBe(initial);
    evidence.push({ id: c.id, count, geometry });
  }
  mkdirSync("reports/teaching", { recursive: true });
  writeFileSync(
    `reports/teaching/all-challenges-${info.project.name}.json`,
    JSON.stringify({ hash, evidence }, null, 2),
  );
});
test("TC-U14 textbook written calculations include integer/decimal edge cases at both widths", async ({
  page,
}, info) => {
  test.setTimeout(300000);
  const examples = [
    ["sub-324", "G3-C02", "-", "324", "166"],
    ["sub-9910", "G3-C04", "-", "9910", "9541"],
    ["sub-zeros", "G3-C04", "-", "1000", "1"],
    ["add-carry", "G3-C01", "+", "999", "1"],
    ["mul-carry", "G3-C07", "*", "987", "6"],
    ["mul-partials", "G3-C08", "*", "306", "20"],
    ["mul-two", "G3-C08", "*", "87", "76"],
    ["div-zero", "G4-C05", "/", "824", "4"],
    ["decimal-sub", "G4-C02", "-", "10.01", "0.99"],
    ["decimal-add", "G4-C01", "+", "0.99", "0.01"],
    ["decimal-mul", "G5-C01", "*", "1.25", "0.4"],
    ["decimal-div", "G5-C03", "/", "7", "4"],
    ["decimal-shift", "G5-C03", "/", "4.2", "0.24"],
    ["division-trial", "G4-C06", "/", "832", "26"],
    ["integer-remainder", "G4-C06", "/", "832", "27", { type: "quotient" }],
    [
      "decimal-remainder",
      "G5-C04",
      "/",
      "7.6",
      "1.4",
      { type: "quotient", decimalRemainder: true },
    ],
    ["divisor-larger", "G5-C03", "/", "1.2", "4"],
    [
      "rounded-quotient",
      "G5-C05",
      "/",
      "2",
      "3",
      { type: "decimal" },
      { roundPlaces: 2 },
    ],
  ];
  for (const width of [320, 1366]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [
      name,
      id,
      op,
      a,
      b,
      spec = { type: "decimal" },
      options = {},
    ] of examples) {
      const q = K.complete(
        K.arithmetic(id, K.op(op, K.lit(a), K.lit(b)), spec, {
          written: true,
          ...options,
        }),
      );
      await open(page, q);
      const count = Teaching.steps(q).length;
      for (let i = 0; i < count; i++) {
        expect(await page.locator(".written-row.annotation").count()).toBe(0);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        if (info.project.name === "chromium") {
          mkdirSync(`reports/teaching/${name}-${width}`, { recursive: true });
          await page.locator(".support").screenshot({
            path: `reports/teaching/${name}-${width}/step-${String(i).padStart(2, "0")}.png`,
          });
        }
        if (i + 1 < count) await page.getByTestId("solution-forward").click();
      }
      await expect(page.locator(".support")).toContainText(K.answerText(q));
      if (op === "-")
        expect(await page.locator(".written-row").count()).toBe(3);
    }
  }
});
test("TC-U15 start remains actionable in short viewports, zoom and transformed content containers", async ({
  page,
}, info) => {
  for (const [width, height] of [
    [320, 240],
    [568, 220],
    [1366, 400],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(url + `?start=${++navigation}`);
    await page.getByTestId("skip").click();
    await page.evaluate(() => {
      const app = document.getElementById("app");
      app.style.transform = "translateZ(0)";
      app.style.overflow = "hidden";
      document.documentElement.style.fontSize = "24px";
    });
    await page.locator('[data-category="計算"]').click();
    await page.locator('[data-challenge="G1-C03"]').check();
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await expect(page.getByTestId("start")).toBeInViewport({ ratio: 1 });
    await page.getByTestId("start").click();
    expect(
      (await page.evaluate(() => window.kazoheTest.snapshot())).run
        .currentQuestion.challengeId,
    ).toBe("G1-C03");
  }
  if (info.project.name === "chromium") {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url + `?start=${++navigation}`);
    await page.getByTestId("skip").click();
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    await expect(page.getByTestId("start")).toBeInViewport({ ratio: 1 });
    await page.getByTestId("start").click();
  }
});
