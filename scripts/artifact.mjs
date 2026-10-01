import { readFileSync, readdirSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const appVersion = JSON.parse(
  readFileSync("package.json", "utf8"),
).version;
export function filename(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw Error("Product version must be major.minor.patch");
  return `Kazohe_${version.replaceAll(".", "_")}.html`;
}
export const htmlName = filename(appVersion);
export const isProductHtml = (name) =>
  name === "Kazohe.html" || /^Kazohe_\d+_\d+_\d+\.html$/.test(name);
export function assertCurrentArtifact(names = readdirSync(".")) {
  const products = names.filter(isProductHtml);
  if (products.length !== 1 || products[0] !== htmlName)
    throw Error(`Expected only ${htmlName}; found ${products.join(", ")}`);
  return htmlName;
}
export function artifactAt(ref) {
  const git = (args) =>
    execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
  const version = JSON.parse(git(["show", `${ref}:package.json`])).version;
  const names = git(["ls-tree", "--name-only", ref])
    .trim()
    .split("\n")
    .filter(isProductHtml);
  const expected = filename(version);
  const legacy = /^0\.(?:1\.\d+|2\.[01])$/.test(version);
  if (
    names.length !== 1 ||
    (names[0] !== expected && !(legacy && names[0] === "Kazohe.html"))
  )
    throw Error(`Invalid product artifact at ${ref}: ${names.join(", ")}`);
  return { version, name: names[0], html: git(["show", `${ref}:${names[0]}`]) };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  assertCurrentArtifact();
  if (process.argv.includes("--github-env"))
    appendFileSync(
      process.env.GITHUB_ENV,
      `APP_HTML=${htmlName}\nAPP_VERSION=${appVersion}\n`,
    );
  else console.log(htmlName);
}
