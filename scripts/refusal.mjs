// Shared refusal validator for negative assertions.
// A negative assertion passes only when the checked code refused the input for the
// expected reason; a runtime crash (TypeError, ReferenceError, RangeError, ...) or
// a non-Error value never counts as an expected refusal unless explicitly requested
// as a JSON SyntaxError from malformed input.
const crashes = new Set([
  "TypeError",
  "ReferenceError",
  "RangeError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "InternalError",
]);

const isError = (error) =>
  error instanceof Error ||
  Object.prototype.toString.call(error) === "[object Error]";

export function refusedWith(expected) {
  if (
    !expected ||
    typeof expected !== "object" ||
    (expected.code === undefined && expected.message === undefined)
  ) {
    throw new Error("refusedWith needs the code or the message of the refusal");
  }
  if (expected.name !== undefined && crashes.has(expected.name)) {
    throw new Error("a crash is not a refusal: " + expected.name);
  }
  return (error) =>
    isError(error) &&
    !crashes.has(error.name) &&
    (expected.name === undefined || error.name === expected.name) &&
    (expected.code === undefined || error.code === expected.code) &&
    (expected.message === undefined ||
      (expected.message instanceof RegExp
        ? expected.message.test(String(error.message))
        : error.message === expected.message));
}

export function reasonOf(error) {
  if (!isError(error)) return null;
  return {
    name: String(error.name),
    code: error.code ?? null,
    line: String(error.message ?? "").split("\n")[0],
  };
}
