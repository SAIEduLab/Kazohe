import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const url = pathToFileURL(resolve("index.html")).href;

test("TC-D08 public landing page content, responsive layout, keyboard and accessibility", async ({
  page,
}, info) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) failures.push("request " + request.url());
  });

  await page.goto(url);
  expect(failures).toEqual([]);
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page).toHaveTitle(/かぞへ/);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    /width=device-width/,
  );
  await expect(
    page.getByRole("heading", { level: 1, name: /できた！を.*積み重ねる/ }),
  ).toBeVisible();
  await expect(page.getByText("全101チャレンジ")).toBeVisible();
  await expect(page.getByRole("heading", { name: "使い方は、3ステップ。" }))
    .toBeVisible();
  await expect(page.getByRole("heading", { name: "MIT License で公開しています。" }))
    .toBeVisible();

  const start = page.getByRole("link", { name: "かぞへをはじめる" });
  await expect(start).toHaveAttribute("href", "./Kazohe.html");
  await expect(page.getByRole("link", { name: "GitHubを見る" })).toHaveAttribute(
    "href",
    "https://github.com/SAIEduLab/Kazohe",
  );
  await expect(page.getByRole("link", { name: "MIT License を読む" }))
    .toHaveAttribute("href", "./LICENSE");

  for (const [width, height] of [
    [320, 568],
    [768, 1024],
    [1366, 768],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(start).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (info.project.name === "chromium" && (width === 320 || width === 1366)) {
      mkdirSync("reports/screens", { recursive: true });
      await page.screenshot({
        path: `reports/screens/site-${width}.png`,
        fullPage: true,
      });
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "本文へ移動" });
  await expect(skip).toBeFocused();
  expect(
    await skip.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);

  await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      rules: { "color-contrast": { enabled: true } },
    });
    return result.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target),
    }));
  });
  expect(violations).toEqual([]);
  expect(failures).toEqual([]);
});
