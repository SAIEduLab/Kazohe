// Compare base and candidate in the same browser. A changed image is evidence, not an approval.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { K, htmlPath } from "./load-inline-core.mjs";
import { report, hash } from "./report.mjs";
import { representatives } from "../tests/fixtures/representatives.mjs";
const requestedBase = process.env.VISUAL_BASE_REF;
const git = (args) =>
  execFileSync(
    "git",
    ["-c", `safe.directory=${process.cwd().replaceAll("\\", "/")}`, ...args],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
const candidateCommit = git(["rev-parse", "HEAD^{commit}"]).trim();
const requested = requestedBase && !/^0+$/.test(requestedBase)
  ? requestedBase
  : null;
const fallback = () => {
  const common = git(["merge-base", "HEAD", "origin/main"]).trim();
  return common === candidateCommit ? "HEAD^" : common;
};
const baseCommit = git(["rev-parse", (requested || fallback()) + "^{commit}"]).trim();
assert.notEqual(baseCommit, candidateCommit, "Visual base must be a different commit");
git(["merge-base", "--is-ancestor", baseCommit, candidateCommit]);
const baseHTML = git(["show", baseCommit + ":Kazohe.html"]);
const dir = mkdtempSync(join(tmpdir(), "kazohe-visual-")),
  output = "reports/visual-diff";
mkdirSync(output, { recursive: true });
writeFileSync(join(dir, "base.html"), baseHTML);
const browser = await chromium.launch(),
  cases = [],
  comparisons = [],
  fixtures = representatives(K);
try {
  for (const width of [390, 1366])
    for (const id of [
      "welcome",
      "menu",
      "G1-C03",
      "G2-C02",
      "G3-C02",
      "G3-C07",
      "G4-C12",
      "G5-N08",
      "G6-C05",
    ]) {
      const images = [];
      for (const [name, path] of [
        ["base", join(dir, "base.html")],
        ["candidate", htmlPath],
      ]) {
        const context = await browser.newContext({
            viewport: { width, height: 844 },
            reducedMotion: "reduce",
          }),
          page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route(/^https?:/, (r) => {
          errors.push(r.request().url());
          return r.abort();
        });
        await page.addInitScript(
          (opts) => {
            localStorage.clear();
            window.__KAZOHE_TEST__ = opts;
          },
          {
            seed: 20260925,
            ...(id === "menu" || id === "welcome"
              ? {}
              : {
                  initialConfig: {
                    selectedIds: [id],
                    mode: "practice",
                    quantity: 10,
                  },
                  fixedQuestion: fixtures[id].question,
                }),
          },
        );
        await page.goto(pathToFileURL(path).href);
        if (id !== "welcome") await page.getByTestId("skip").click();
        if (id !== "menu" && id !== "welcome") {
          await page.getByTestId("start").click();
          await page.getByTestId("help").click();
        }
        if (errors.length) throw Error(errors.join("\n"));
        await page.evaluate(() => window.scrollTo(0, 0));
        const file = `${output}/${id}-${width}-${name}.png`;
        const image = await page.screenshot({ path: file, fullPage: true });
        images.push(image.toString("base64"));
        await context.close();
      }
      const context = await browser.newContext(),
        page = await context.newPage();
      const diff = await page.evaluate(async (images) => {
        const load = (src) =>
          new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = reject;
            i.src = "data:image/png;base64," + src;
          });
        const [a, b] = await Promise.all(images.map(load)),
          w = Math.max(a.width, b.width),
          h = Math.max(a.height, b.height);
        function pixels(i) {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const ctx = c.getContext("2d");
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(i, 0, 0);
          return ctx.getImageData(0, 0, w, h);
        }
        const ap = pixels(a),
          bp = pixels(b),
          canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d"),
          out = ctx.createImageData(w, h);
        let changed = 0;
        for (let p = 0; p < ap.data.length; p += 4) {
          const d = Math.max(
            ...[0, 1, 2].map((k) => Math.abs(ap.data[p + k] - bp.data[p + k])),
          );
          if (d > 24) {
            changed++;
            out.data[p] = 215;
            out.data[p + 1] = 55;
            out.data[p + 2] = 95;
          } else {
            const gray = Math.round(
              (bp.data[p] + bp.data[p + 1] + bp.data[p + 2]) / 3,
            );
            out.data[p] =
              out.data[p + 1] =
              out.data[p + 2] =
                Math.round(220 + gray * 0.13);
          }
          out.data[p + 3] = 255;
        }
        ctx.putImageData(out, 0, 0);
        return {
          width: w,
          height: h,
          changedPixels: changed,
          ratio: changed / (w * h),
          image: canvas.toDataURL("image/png").split(",")[1],
        };
      }, images);
      writeFileSync(
        `${output}/${id}-${width}-diff.png`,
        Buffer.from(diff.image, "base64"),
      );
      delete diff.image;
      await context.close();
      comparisons.push({ id, width, ...diff });
    }
  cases.push({
    id: "same-browser-base-candidate-images",
    status: "PASS",
    method: "image-comparison",
    actual: {
      comparisons: comparisons.length,
      changed: comparisons.filter((c) => c.changedPixels).length,
    },
    evidence: output,
  });
  report("visual-diff", cases, {
    baseCommit,
    baseHtmlSha256: createHash("sha256").update(baseHTML).digest("hex"),
    candidateHtmlSha256: hash,
    browser: browser.version(),
    comparisons,
    visualApproval: "NOT_RUN",
    note: "Pixel differences are review material. They never automatically approve a new visual baseline.",
  });
  const rows = comparisons
    .map(
      (c) =>
        `<tr><th>${c.id} / ${c.width}<br>${(c.ratio * 100).toFixed(2)}% changed</th>${["base", "candidate", "diff"].map((n) => `<td><a href="${c.id}-${c.width}-${n}.png"><img alt="${c.id} ${n}" src="${c.id}-${c.width}-${n}.png" width="280"></a></td>`).join("")}</tr>`,
    )
    .join("");
  writeFileSync(
    `${output}/index.html`,
    `<!doctype html><html lang="ja"><meta charset="utf-8"><title>かぞへ 画像比較</title><style>body{font:16px system-ui}table{border-collapse:collapse}td,th{vertical-align:top;border:1px solid #ccc;padding:12px}img{max-width:100%}</style><h1>Base / Candidate / Difference</h1><p>画像差分は変更箇所の資料です。見やすさ・教育上の妥当性を自動認定しません。</p><p>Base ${baseCommit}<br>Candidate HTML ${hash}</p><table>${rows}</table></html>`,
  );
  console.log(
    `Compared ${comparisons.length} screens. Visual approval remains separate.`,
  );
} finally {
  await browser.close();
}
