// Narrowed standard library declarations so library functions that return `any` return `unknown` instead.
// Types only; the built product contains none of this.
interface JSON {
  parse(
    text: string,
    reviver?: (this: unknown, key: string, value: unknown) => unknown,
  ): unknown;
}
interface ArrayConstructor {
  isArray<T>(
    value: T,
  ): value is Extract<T, readonly unknown[]> extends never
    ? T & unknown[]
    : Extract<T, readonly unknown[]>;
}
interface ObjectConstructor {
  freeze<T>(o: T): Readonly<T>;
  getPrototypeOf(value: unknown): object | null;
  hasOwn(o: object, v: unknown): boolean;
  values<T>(o: { [s: string]: T } | ArrayLike<T>): T[];
  values(o: {}): unknown[];
  entries<T>(o: { [s: string]: T } | ArrayLike<T>): [string, T][];
  entries(o: {}): [string, unknown][];
}
interface Array<T> {
  includes(searchElement: unknown, fromIndex?: number): boolean;
  indexOf(searchElement: unknown, fromIndex?: number): number;
  filter(
    predicate: BooleanConstructor,
  ): Exclude<T, false | null | undefined | 0 | 0n | "">[];
}
interface ReadonlyArray<T> {
  includes(searchElement: unknown, fromIndex?: number): boolean;
  indexOf(searchElement: unknown, fromIndex?: number): number;
  filter(
    predicate: BooleanConstructor,
  ): Exclude<T, false | null | undefined | 0 | 0n | "">[];
}
interface Set<T> {
  has(value: unknown): boolean;
  delete(value: unknown): boolean;
}
interface ReadonlySet<T> {
  has(value: unknown): boolean;
}
interface Map<K, V> {
  has(key: unknown): boolean;
  get(key: unknown): V | undefined;
  delete(key: unknown): boolean;
}
interface ReadonlyMap<K, V> {
  has(key: unknown): boolean;
  get(key: unknown): V | undefined;
}
interface Promise<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null,
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?:
      | ((reason: unknown) => TResult | PromiseLike<TResult>)
      | undefined
      | null,
  ): Promise<T | TResult>;
}
interface RegExp {
  test(string: unknown): boolean;
}
type OlderAudioGlobal = typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};
declare function clearTimeout(timeout: unknown): void;
declare function clearInterval(interval: unknown): void;
declare function parseFloat(string: string | number): number;
interface CSSStyleDeclaration {
  setProperty(
    property: `--${string}`,
    value: string | number | null,
    priority?: string,
  ): void;
  setProperty(
    property: string,
    value: string | null,
    priority?: string,
  ): void;
}
interface String {
  replace<A extends unknown[]>(
    searchValue: string | RegExp,
    replacer: (substring: string, ...args: A) => string | number,
  ): string;
}
