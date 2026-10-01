export async function completeSolution(page) {
  await page.evaluate(() => {
    for (let i = 0; i < 500; i++) {
      const next = document.querySelector('[data-testid="solution-forward"]');
      if (!next || next.disabled) {
        document
          .querySelector("[data-support-focus]")
          ?.scrollIntoView({ block: "start" });
        return;
      }
      next.click();
    }
    throw Error("Solution navigation did not terminate");
  });
}
