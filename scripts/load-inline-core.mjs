import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
export const htmlPath = resolve(process.env.APP_HTML || "Kazohe.html");
export const html = readFileSync(htmlPath, "utf8");
export const coreSource = html.match(
  /<script id="kazohe-core">([\s\S]*?)<\/script>/,
)?.[1];
if (!coreSource) throw Error("Final HTML core missing");
const context = vm.createContext({ TextEncoder });
vm.runInContext(coreSource + ";globalThis.result=KZ;", context, {
  filename: htmlPath,
  timeout: 10000,
});
export const K = context.result;
