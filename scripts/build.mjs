import { readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import {
  appVersion,
  htmlName,
  isProductHtml,
  assertCurrentArtifact,
} from "./artifact.mjs";
const read = (p) => readFileSync(p, "utf8");
const core =
  read("src/language.js").replace("__KAZOHE_LANGUAGE__", () =>
    read("src/language.json"),
  ) +
  "\n" +
  read("src/written.js") +
  "\n" +
  read("src/core.js").replace("__KAZOHE_CATALOG__", () =>
    read("src/catalog.json"),
  ) +
  "\n" +
  read("src/teaching.js");
const html = read("src/shell.html")
  .replace("/* STYLE */", () => read("src/style.css"))
  .replace("/* CORE */", () => core)
  .replace("/* APP */", () => read("src/view.js") + "\n" + read("src/app.js"))
  .replaceAll("__KAZOHE_VERSION__", appVersion);
const stamp = (text) =>
  text
    .replace(/Kazohe(?:_\d+_\d+_\d+)?\.html/g, htmlName)
    .replace(
      /<!-- APP_VERSION -->.*?<!-- \/APP_VERSION -->/g,
      `<!-- APP_VERSION -->${appVersion}<!-- /APP_VERSION -->`,
    );
if (process.argv.includes("--check")) {
  assertCurrentArtifact();
  if (read(htmlName) !== html)
    throw Error(
      `${htmlName} differs from the local sources. Run npm run build.`,
    );
  for (const path of [
    "index.html",
    "README.md",
    "docs/verification.md",
    "tests/fixtures/implementation-map.json",
  ])
    if (read(path) !== stamp(read(path)))
      throw Error(`${path}: stale product reference`);
  console.log("Embedded HTML matches sources.");
} else {
  writeFileSync(htmlName, html);
  // Only product HTMLs in the repository root are replaced; source/site HTMLs are preserved.
  for (const name of readdirSync("."))
    if (isProductHtml(name) && name !== htmlName) unlinkSync(name);
  for (const path of [
    "index.html",
    "README.md",
    "docs/verification.md",
    "tests/fixtures/implementation-map.json",
  ])
    writeFileSync(path, stamp(read(path)));
  assertCurrentArtifact();
}
