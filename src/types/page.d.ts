// The elements of Kazohe's page (src/shell.html) found by selector: each id of the page, and each
// other written selector that finds one element. Made by scripts/page-types.mjs from src/shell.html
// and src/ts/1*.ts; do not edit manually: `node scripts/page-types.mjs --write`.
// Types only; the built product contains none of this.
export interface PageElements {
  "#announcer": HTMLDivElement;
  "#app": HTMLElement;
  "#dialog": HTMLDialogElement;
  "#dialog-actions": HTMLDivElement;
  "#dialog-body": HTMLDivElement;
  "#dialog-title": HTMLHeadingElement;
  "#kazohe-app": HTMLScriptElement;
  "#kazohe-core": HTMLScriptElement;
  "#start-dock-root": HTMLDivElement;
  "#storage-warning": HTMLParagraphElement;
}
export type PageElement<S extends string> = S extends keyof PageElements
  ? PageElements[S]
  : HTMLElement | null;
export type PageFinder = <S extends string>(selector: S) => PageElement<S>;
