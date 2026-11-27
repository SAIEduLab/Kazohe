// Deterministic behaviour snapshot of a Kazohe product HTML (<script id="kazohe-core">).
// Evaluates all 101 challenges across deterministic seeds and written-condition variants,
// judging, hints, teaching steps & explanations, written classification, grade 1..6 language
// rules, and backup validation. Normalizes only the APP_VERSION producer string so a pure
// patch bump + refactor yields zero diff.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import cp from "node:child_process";
import { fileURLToPath } from "node:url";

export const fixedClockMs = 0;
export const SNAPSHOT_SEEDS = Object.freeze([20260925, 20260926, 20260927]);
export const intendedChangesFile =
  "tests/manifests/intended-behaviour-changes.json";
export const intendedChangesSchema = "kazohe-intended-behaviour-changes-v1";

// Node permission confinement for child processes running product code or tree contracts:
// read-only everywhere, write-only to explicitly listed output files, no child/worker spawn.
export const confined = (writable) => [
  "--permission",
  "--allow-fs-read=*",
  ...writable.map((file) => "--allow-fs-write=" + file),
];

export function runLimited(args, limitMs, what, writable) {
  const r = cp.spawnSync(process.execPath, [...confined(writable), ...args], {
    encoding: "utf8",
    timeout: limitMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error?.code === "ETIMEDOUT" || r.signal)
    throw new Error(what + " did not finish within " + limitMs / 1000 + " s");
  if (r.error) throw r.error;
  if (r.status !== 0)
    throw new Error(
      what +
        " failed (exit " +
        r.status +
        "): " +
        (r.stderr || "").trim().slice(-2000),
    );
}

export function runLimitedAsync(
  args,
  limitMs,
  what,
  writable,
  { signal } = {},
) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, [...confined(writable), ...args], {
      timeout: limitMs,
      signal,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let aborted = null;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text) => {
      stderr = (stderr + text).slice(-64 * 1024);
    });
    child.on("error", (error) => {
      if (error.name === "AbortError") aborted = error;
      else reject(error);
    });
    child.on("close", (status, killedBy) => {
      if (aborted) reject(aborted);
      else if (killedBy)
        reject(
          new Error(what + " did not finish within " + limitMs / 1000 + " s"),
        );
      else if (status !== 0)
        reject(
          new Error(
            what +
              " failed (exit " +
              status +
              "): " +
              stderr.trim().slice(-2000),
          ),
        );
      else resolve();
    });
  });
}

export function coreScriptOf(html) {
  const m = String(html ?? "").match(
    /<script id="kazohe-core">([\s\S]*?)<\/script>/,
  );
  return m ? m[1] : null;
}

export function productScriptsOf(html) {
  const source = String(html ?? "");
  const extract = (id) => {
    const open = `<script id="${id}">`;
    const start = source.indexOf(open);
    if (start < 0) return null;
    const bodyStart = start + open.length;
    const end = source.indexOf("</script>", bodyStart);
    if (end < 0) return null;
    const firstLine = source.slice(0, bodyStart).split("\n").length;
    return { script: source.slice(bodyStart, end), firstLine };
  };
  return { core: extract("kazohe-core"), app: extract("kazohe-app") };
}

export function normalizedCoreScript(html) {
  const core = coreScriptOf(html);
  if (core === null) return null;
  return core.replace(
    /const APP_VERSION\s*=\s*["']\d+\.\d+\.\d+["']\s*;/,
    'const APP_VERSION = "<APP_VERSION>";',
  );
}

// Loads <script id="kazohe-core"> in a fresh VM context with no performance global
// and (by default) a fixed Date.now clock. Includes structuredClone for core cloning.
export function productApi(html, { fixedClock = true } = {}) {
  const coreSource = coreScriptOf(html);
  if (!coreSource) return null;
  const context = vm.createContext({
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Uint32Array,
    ArrayBuffer,
    structuredClone,
  });
  if (fixedClock)
    vm.runInContext(`Date.now = () => ${fixedClockMs};`, context, {
      timeout: 5000,
    });
  vm.runInContext(
    coreSource +
      ";globalThis.__kazohe={KZ:typeof KZ!=='undefined'?KZ:null,KZTeaching:typeof KZTeaching!=='undefined'?KZTeaching:null,KZLanguage:typeof KZLanguage!=='undefined'?KZLanguage:null,KZWritten:typeof KZWritten!=='undefined'?KZWritten:null};",
    context,
    { timeout: 30000 },
  );
  const api = context.__kazohe;
  return api?.KZ?.CATALOG && api.KZ.generate ? api : null;
}

function normalizeProducer(value, appVersion) {
  if (!appVersion || typeof appVersion !== "string") return value;
  const walk = (v) => {
    if (typeof v === "string") {
      if (v === appVersion) return "<APP_VERSION>";
      if (v.includes(`v${appVersion}`))
        return v.replaceAll(`v${appVersion}`, "v<APP_VERSION>");
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, val]) => [k, walk(val)]),
      );
    return v;
  };
  return walk(value);
}

function decimalText(K, value) {
  return K.format(value, "decimal");
}

function rawAnswerFor(K, q) {
  const spec = q.answerSpec;
  const expected = q.expectedExactValue;
  if (spec.type === "quotient")
    return {
      quotient: String(expected.quotient),
      remainder: decimalText(K, expected.remainder),
    };
  if (spec.type === "blocks" || spec.type === "set")
    return { values: expected.map(String) };
  if (spec.type === "compare" || spec.type === "parity")
    return { value: expected };
  if (spec.type === "common")
    return {
      first: {
        numerator: String(expected[0].n),
        denominator: String(expected[0].d),
      },
      second: {
        numerator: String(expected[1].n),
        denominator: String(expected[1].d),
      },
    };
  if (spec.type === "fraction") {
    let v = K.rat(expected.n, expected.d);
    if (spec.denominator) {
      const denom = BigInt(spec.denominator);
      v = {
        n: String((BigInt(v.n) * denom) / BigInt(v.d)),
        d: String(denom),
      };
    }
    return {
      form: spec.form || "fraction",
      whole: spec.form === "mixed" ? String(BigInt(v.n) / BigInt(v.d)) : "",
      numerator:
        spec.form === "mixed" ? String(BigInt(v.n) % BigInt(v.d)) : v.n,
      denominator: v.d,
    };
  }
  return { value: decimalText(K, expected) };
}

function wrongRawFor(q) {
  const spec = q.answerSpec;
  const expected = q.expectedExactValue;
  if (spec.type === "compare") return { value: expected === "<" ? ">" : "<" };
  if (spec.type === "parity")
    return { value: expected === "even" ? "odd" : "even" };
  if (spec.type === "quotient") return { quotient: "999999", remainder: "0" };
  if (spec.type === "common")
    return {
      first: { numerator: "1", denominator: "99999" },
      second: { numerator: "1", denominator: "99999" },
    };
  if (spec.type === "fraction")
    return {
      form: "fraction",
      whole: "",
      numerator: "1",
      denominator: "99999",
    };
  if (spec.type === "blocks")
    return { values: spec.labels.map(() => "999999") };
  if (spec.type === "set") return { values: ["999999"] };
  return { value: "999999" };
}

function sampleQuestionRecord(api, q) {
  const { KZ: K, KZTeaching: Teaching, KZWritten: Written } = api;
  const correctRaw = rawAnswerFor(K, q);
  const wrongRaw = wrongRawFor(q);
  const correctJudge = K.judge(q, K.normalizeInput(q.answerSpec, correctRaw));
  const wrongJudge = K.judge(q, K.normalizeInput(q.answerSpec, wrongRaw));
  const invalidJudge = K.judge(q, K.normalizeInput(q.answerSpec, {}));
  const record = {
    question: {
      challengeId: q.challengeId,
      task: q.task,
      prompt: q.prompt,
      expressionAST: q.expressionAST ?? null,
      answerSpec: q.answerSpec,
      expectedExactValue: q.expectedExactValue,
      conditionBucket: q.conditionBucket ?? null,
      written: Boolean(q.written),
      canonicalKey: q.canonicalKey,
      values: q.values ?? null,
      places: q.places ?? null,
      roundPlaces: q.roundPlaces ?? null,
      integerQuotient: Boolean(q.integerQuotient),
      diagram: q.diagram ?? null,
      original: q.original ?? null,
      solutionTrace: q.solutionTrace ?? null,
    },
    answerText: K.answerText(q),
    judge: { correct: correctJudge, wrong: wrongJudge, invalid: invalidJudge },
    hint: K.buildHint(q),
    teachingHint: Teaching?.hint ? Teaching.hint(q) : null,
    explain: Teaching?.explain ? Teaching.explain(q) : null,
    steps: Teaching?.steps ? Teaching.steps(q) : null,
  };
  if (Written?.ids?.includes(q.challengeId))
    record.writtenClassify = Written.classify(q);
  return record;
}

function challengeOptions(api, id) {
  const { KZ: K, KZWritten: Written } = api;
  const hasWritten = Boolean(Written?.ids?.includes(id));
  const hasRemainder = Boolean(K.REMAINDER_IDS?.includes(id));
  if (!hasWritten && !hasRemainder) return [{}];
  const out = [];
  const seen = new Set();
  const add = (opt) => {
    const key = JSON.stringify(opt);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(opt);
    }
  };
  const remainders = hasRemainder ? ["mixed", "none", "some"] : [undefined];
  for (const remainder of remainders) {
    if (!hasWritten) {
      add({ remainder });
      continue;
    }
    const avail = Written.available(id, remainder ?? "mixed");
    const writtens = avail.length > 1 ? ["mixed", ...avail] : avail;
    for (const written of writtens) {
      const opt = {};
      if (remainder !== undefined) opt.remainder = remainder;
      if (written !== "mixed" || !Written.fixed?.[id]) opt.written = written;
      add(opt);
    }
  }
  return out;
}

const LANGUAGE_PROBES = Object.freeze([
  "くり上がりのあるたし算とひき算の筆算を練習しよう。",
  "分子と分母を同じ数でわって約分し、通分して計算しよう。",
  "小数のわり算で商を四捨五入し、余りの小数点を確かめよう。",
  "公約数・最大公約数・公倍数・最小公倍数・逆数・帯分数・仮分数。",
  "Score と コンボ を見て、挑戦を続けよう。12 ＋ 34 ＝ 46。",
  "割合と比の値、偶数と奇数、概数、単位量あたりの大きさ。",
]);

function backupSnapshot(K) {
  const runCase = (fn) => {
    try {
      return { ok: true, value: fn() };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  };
  const empty = K.emptySave();
  const run = K.createRun(
    {
      selectedIds: ["G4-C07"],
      optionsById: { "G4-C07": { remainder: "none" } },
      mode: "practice",
      quantity: 10,
      languageGrade: 4,
    },
    SNAPSHOT_SEEDS[0],
    fixedClockMs,
  );
  const withCheckpoint = { ...empty, practiceCheckpoint: K.checkpoint(run) };
  return {
    emptyRoundtrip: runCase(() => K.validateBackup(JSON.stringify(empty))),
    checkpointRoundtrip: runCase(() =>
      K.validateBackup(JSON.stringify(withCheckpoint)),
    ),
    wrongFormat: runCase(() =>
      K.validateBackup(JSON.stringify({ ...empty, format: "other" })),
    ),
    wrongVersion: runCase(() =>
      K.validateBackup(JSON.stringify({ ...empty, appVersion: "9.9" })),
    ),
    protoKey: runCase(() =>
      K.validateBackup(
        '{"format":"kazohe-backup","appVersion":"0.2","schemaVersion":1,"__proto__":{"polluted":true}}',
      ),
    ),
    invalidNumber: runCase(() =>
      K.validateBackup(
        JSON.stringify({
          ...empty,
          settings: {
            ...empty.settings,
            config: { ...empty.settings.config, quantity: -5 },
          },
        }),
      ),
    ),
    extraKey: runCase(() =>
      K.validateBackup(JSON.stringify({ ...empty, unexpected: 1 })),
    ),
  };
}

export function behaviourSnapshot(html) {
  let api;
  try {
    api = productApi(html, { fixedClock: true });
  } catch {
    api = null;
  }
  if (!api) return { unavailable: { reason: "the page has no Kazohe API" } };
  const { KZ: K, KZLanguage: Language, KZWritten: Written } = api;
  const appVersion = K.APP_VERSION;
  const snapshot = {};
  snapshot["meta/core"] = {
    catalogIds: K.CATALOG.map((c) => c.id),
    writtenIds: Written?.ids ? [...Written.ids] : [],
    remainderIds: K.REMAINDER_IDS ? [...K.REMAINDER_IDS] : [],
    version: K.VERSION,
    storageKey: K.STORAGE_KEY,
    appVersionValid: /^\d+\.\d+\.\d+$/.test(String(appVersion)),
  };

  for (const challenge of K.CATALOG) {
    const id = challenge.id;
    const seedSamples = SNAPSHOT_SEEDS.map((seed) => {
      const g = K.createGenerator(seed);
      return {
        seed,
        sample: sampleQuestionRecord(api, K.generate(id, {}, g)),
      };
    });
    const variantOpts = challengeOptions(api, id).filter(
      (opt) => Object.keys(opt).length > 0,
    );
    const variants = variantOpts.map((opt) => {
      const g = K.createGenerator(SNAPSHOT_SEEDS[0]);
      return {
        options: opt,
        sample: sampleQuestionRecord(api, K.generate(id, opt, g)),
      };
    });
    const entry = {
      grade: challenge.grade,
      domain: challenge.domain,
      seeds: seedSamples,
      variants,
    };
    if (Written?.ids?.includes(id)) {
      entry.writtenMeta = {
        label: Written.label(id),
        availableMixed: Written.available(id, "mixed"),
        availableNone: Written.available(id, "none"),
        availableSome: Written.available(id, "some"),
      };
    }
    snapshot["skill/" + id] = entry;
  }

  const catalogSamples = K.CATALOG.filter((_, i) => i % 10 === 0).map(
    (c) => c.name,
  );
  const allProbes = [...LANGUAGE_PROBES, ...catalogSamples];
  if (Language?.readable && Language?.forbidden && Language?.audit) {
    for (let grade = 1; grade <= 6; grade++) {
      snapshot["language/grade-" + grade] = allProbes.map((text) => ({
        readable: Language.readable(text, grade),
        forbidden: Language.forbidden(text, grade),
        audit: Language.audit(text, grade),
      }));
    }
  }

  snapshot["backup/cases"] = backupSnapshot(K);
  return normalizeProducer(JSON.parse(JSON.stringify(snapshot)), appVersion);
}

export async function boundedSnapshot(html, limitMs, signal) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kazohe-snapshot-"));
  try {
    const page = path.join(dir, "page.html");
    const record = path.join(dir, "record.json");
    fs.writeFileSync(page, html);
    await runLimitedAsync(
      [fileURLToPath(import.meta.url), "--run", page, record],
      limitMs,
      "the behaviour snapshot",
      [record],
      { signal },
    );
    return JSON.parse(fs.readFileSync(record, "utf8"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function behaviourDifferences(before, after) {
  const ids = [
    ...new Set([...Object.keys(before || {}), ...Object.keys(after || {})]),
  ].sort();
  return ids.filter(
    (id) => JSON.stringify(before?.[id]) !== JSON.stringify(after?.[id]),
  );
}

function assertValid(ok, message) {
  if (!ok) throw new Error(message);
}

export function behaviourIssues(
  differences,
  baseRecord,
  headRecord,
  label = (id) => id,
) {
  const read = (record) => {
    if (!record) return [];
    assertValid(
      record &&
        typeof record === "object" &&
        !Array.isArray(record) &&
        Array.isArray(record.changes) &&
        (record.schema === undefined ||
          record.schema === intendedChangesSchema),
      intendedChangesFile + " has the wrong shape",
    );
    for (const key of Object.keys(record))
      assertValid(
        key === "schema" || key === "changes",
        intendedChangesFile + " has the wrong shape",
      );
    return record.changes.map((c) => {
      const target = c?.case ?? c?.item;
      assertValid(
        typeof target === "string" &&
          target.trim().length > 0 &&
          !(c?.case !== undefined && c?.item !== undefined) &&
          typeof c?.reason === "string" &&
          c.reason.trim().length >= 10,
        intendedChangesFile + ": each change names an item and a reason",
      );
      return { case: target, reason: c.reason };
    });
  };
  const key = (c) => c.case + "\u0000" + c.reason;
  const before = new Set(read(baseRecord).map(key));
  const added = read(headRecord).filter((c) => !before.has(key(c)));
  const recorded = new Set(added.map((c) => c.case));
  const issues = [];
  for (const id of differences)
    if (!recorded.has(id))
      issues.push(
        "the behaviour of " +
          label(id) +
          " changed, and " +
          intendedChangesFile +
          " does not record it",
      );
  for (const c of added)
    if (!differences.includes(c.case))
      issues.push(
        intendedChangesFile +
          " records a change of " +
          label(c.case) +
          ", but its behaviour did not change",
      );
  return { issues, intended: added };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [kind, page, record] = process.argv.slice(2);
  if (kind === "--run") {
    fs.writeFileSync(
      record,
      JSON.stringify(behaviourSnapshot(fs.readFileSync(page, "utf8"))),
    );
  }
}
