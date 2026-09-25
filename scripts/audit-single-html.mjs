import assert from "node:assert/strict";
import { parse } from "parse5";
import * as css from "css-tree";
import { parse as parseJS } from "acorn";
import { html, htmlPath } from "./load-inline-core.mjs";
import { suite } from "./report.mjs";
const s = suite("single-html");
const walk = (n, fn) => {
  fn(n);
  for (const v of Object.values(n))
    if (v && typeof v === "object")
      for (const x of Array.isArray(v) ? v : [v])
        if (x && typeof x === "object" && x.type) walk(x, fn);
};
export function assertSingle(document) {
  const tree = parse(document),
    scripts = [],
    styles = [];
  function visit(n) {
    const attrs = Object.fromEntries(
      (n.attrs || []).map((a) => [a.name, a.value]),
    );
    if (
      [
        "script",
        "img",
        "iframe",
        "audio",
        "video",
        "source",
        "embed",
        "object",
      ].includes(n.tagName)
    )
      assert(
        !attrs.src && !attrs.data && !attrs.srcset,
        `${n.tagName} external source`,
      );
    if (n.tagName === "link")
      assert(
        ![
          "stylesheet",
          "preload",
          "modulepreload",
          "icon",
          "prefetch",
          "dns-prefetch",
          "preconnect",
        ].includes(attrs.rel),
      );
    if (attrs.style) styles.push(attrs.style);
    if (n.tagName === "style")
      styles.push(n.childNodes.map((c) => c.value || "").join(""));
    if (n.tagName === "script")
      scripts.push(n.childNodes.map((c) => c.value || "").join(""));
    (n.childNodes || []).forEach(visit);
  }
  visit(tree);
  for (const style of styles)
    css.walk(css.parse(style), (n) => {
      assert(n.type !== "Url", "CSS URL dependency");
      assert(!(n.type === "Atrule" && n.name === "import"), "CSS import");
    });
  for (const script of scripts)
    walk(parseJS(script, { ecmaVersion: "latest" }), (n) => {
      assert(!["ImportExpression", "ImportDeclaration"].includes(n.type));
      if (n.type === "CallExpression" || n.type === "NewExpression") {
        const name = n.callee.name || n.callee.property?.name;
        assert(
          ![
            "fetch",
            "XMLHttpRequest",
            "WebSocket",
            "EventSource",
            "Worker",
            "SharedWorker",
            "importScripts",
            "eval",
            "Function",
            "sendBeacon",
          ].includes(name),
          `network/dynamic execution ${name}`,
        );
      }
      if (n.type === "MemberExpression")
        assert(n.property?.name !== "serviceWorker", "Service Worker");
    });
  assert.equal(scripts.length, 2);
  return { scripts: scripts.length, styles: styles.length };
}
s.check("TC-B16", () => assertSingle(html));
s.check("TC-B18", () => {
  assert(htmlPath.endsWith("Kazohe.html"));
  assert(html.includes("かぞへ v0.2"));
  assert(!html.includes("かぞへ.html"));
  assert(!/\/\* (?:STYLE|CORE|APP|CATALOG) \*\//.test(html));
});
s.check("single-html-negative-control", () => {
  assert.throws(() =>
    assertSingle(
      html.replace("</head>", '<script src="external.js"></script></head>'),
    ),
  );
  assert.throws(() =>
    assertSingle(html.replace("</style>", "a{background:url(x.png)}</style>")),
  );
});
s.done();
