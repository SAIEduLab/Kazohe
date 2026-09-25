import { readFileSync, writeFileSync } from "node:fs";
const read = (p) => readFileSync(p, "utf8");
const core = read("src/core.js").replace(
  "__KAZOHE_CATALOG__",
  () => read("src/catalog.json"),
);
const html = read("src/shell.html")
  .replace("/* STYLE */", () => read("src/style.css"))
  .replace("/* CORE */", () => core)
  .replace("/* APP */", () => read("src/view.js") + "\n" + read("src/app.js"));
if (process.argv.includes("--check")) {
  if (read("Kazohe.html") !== html)
    throw Error(
      "Kazohe.html differs from the local sources. Run npm run build.",
    );
  console.log("Embedded HTML matches sources.");
} else writeFileSync("Kazohe.html", html);
