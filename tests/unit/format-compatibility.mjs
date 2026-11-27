// Producer-independent format compatibility checks:
// Derives a candidate product HTML with APP_VERSION replaced (e.g. '9.9.9'), verifies
// round-trip backup compatibility in both directions, mid-run checkpoint resume across
// releases, v0.2.4-backup.json acceptance, refusal of v0.1 / invalid schema / malformed
// JSON with exact error reasons, and non-corruption of existing localStorage.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { html, K } from "../../scripts/load-inline-core.mjs";
import { rawAnswer } from "../../scripts/independent-math-oracle.mjs";
import { refusedWith } from "../../scripts/refusal.mjs";

const RELEASE_DECL =
  /(const (?:APP_VERSION|PRODUCT_RELEASE)\s*=\s*["'])(\d+\.\d+\.\d+)(["'])/g;
const plain = (value) => JSON.parse(JSON.stringify(value));

function loadCoreFromHtml(productHtml, filename) {
  const match = productHtml.match(
    /<script id="kazohe-core">([\s\S]*?)<\/script>/,
  );
  assert.ok(match, `${filename}: #kazohe-core script missing`);
  const context = vm.createContext({ TextEncoder, structuredClone });
  vm.runInContext(
    `${match[1]};globalThis.result=KZ;globalThis.teaching=KZTeaching;globalThis.language=KZLanguage;globalThis.written=KZWritten;`,
    context,
    { filename, timeout: 10000 },
  );
  return {
    K: context.result,
    Teaching: context.teaching,
    Language: context.language,
    Written: context.written,
  };
}

function deriveCandidateHtml(sourceHtml, candidateVersion) {
  const matches = [...sourceHtml.matchAll(RELEASE_DECL)];
  assert.equal(
    matches.length,
    1,
    "expected exactly one APP_VERSION/PRODUCT_RELEASE declaration in product HTML",
  );
  const currentVersion = matches[0][2];
  assert.notEqual(
    currentVersion,
    candidateVersion,
    "candidate version must differ from current product version",
  );
  const derived = sourceHtml.replace(
    RELEASE_DECL,
    (_all, prefix, _ver, suffix) => `${prefix}${candidateVersion}${suffix}`,
  );
  assert.notEqual(derived, sourceHtml, "candidate HTML must differ");
  return { currentVersion, derived };
}

function makeMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function answerCorrectly(api, run) {
  let r = api.reduceRun(
    run,
    {
      type: "SUBMIT",
      questionId: run.currentQuestion.questionId,
      raw: rawAnswer(run.currentQuestion),
    },
    1000,
  );
  r = api.reduceRun(r, { type: "FEEDBACK_DONE" }, 2000);
  return r;
}

function completeRun(api, run) {
  let r = run;
  while (r.phase !== "RESULT") {
    r = answerCorrectly(api, r);
  }
  return r;
}

function createSampleSaveWithCheckpoint(api, name) {
  let saved = api.emptySave();
  saved.settings.name = name;
  saved.settings.onboarded = true;
  saved.settings.config = api.normalizeConfig({
    selectedIds: ["G4-C07"],
    optionsById: { "G4-C07": { remainder: "none" } },
    mode: "practice",
    quantity: 10,
    timeLimitMs: null,
    languageGrade: 4,
  });
  // Record one completed best score.
  const finished = completeRun(
    api,
    api.createRun(saved.settings.config, 202611, 0),
  );
  saved = api.applyResult(saved, finished).saved;
  // Create a mid-run practice checkpoint after 2 answered questions.
  let inProgress = api.createRun(saved.settings.config, 202622, 0);
  inProgress = answerCorrectly(api, inProgress);
  inProgress = answerCorrectly(api, inProgress);
  assert.equal(inProgress.phase, "QUESTION");
  assert.equal(inProgress.records.length, 3);
  saved.practiceCheckpoint = api.checkpoint(inProgress);
  return saved;
}

export function runFormatCompatibilityChecks() {
  const candidateVersion = K.APP_VERSION === "9.9.9" ? "8.8.8" : "9.9.9";
  const { currentVersion, derived } = deriveCandidateHtml(
    html,
    candidateVersion,
  );
  const candidate = loadCoreFromHtml(derived, `Kazohe_${candidateVersion}.html`);

  // 1. Producer version differs while save-format contract remains identical.
  assert.equal(K.APP_VERSION, currentVersion);
  assert.equal(candidate.K.APP_VERSION, candidateVersion);
  assert.equal(K.VERSION, "0.2");
  assert.equal(candidate.K.VERSION, K.VERSION);
  assert.equal(K.STORAGE_KEY, candidate.K.STORAGE_KEY);

  // 2. Save/export in candidate ('9.9.9') -> load & resume in current product.
  const candidateSave = createSampleSaveWithCheckpoint(
    candidate.K,
    "候補テスト",
  );
  const candidateJson = JSON.stringify(candidateSave);
  const loadedInCurrent = K.validateBackup(candidateJson);
  assert.deepEqual(plain(loadedInCurrent), plain(candidateSave));
  assert.equal(loadedInCurrent.appVersion, "0.2");
  assert.ok(loadedInCurrent.practiceCheckpoint);
  const resumedInCurrent = completeRun(K, loadedInCurrent.practiceCheckpoint);
  assert.equal(resumedInCurrent.phase, "RESULT");
  assert.equal(resumedInCurrent.records.length, 10);
  assert.ok(resumedInCurrent.score > 0);
  const afterCurrentFinish = K.applyResult(
    loadedInCurrent,
    resumedInCurrent,
  ).saved;
  assert.equal(afterCurrentFinish.practiceCheckpoint, null);
  assert.ok(Object.keys(afterCurrentFinish.bestRecords).length >= 1);

  // 3. Save/export in current product -> load & resume in candidate ('9.9.9').
  const currentSave = createSampleSaveWithCheckpoint(K, "現行テスト");
  const currentJson = JSON.stringify(currentSave);
  const loadedInCandidate = candidate.K.validateBackup(currentJson);
  assert.deepEqual(plain(loadedInCandidate), plain(currentSave));
  const resumedInCandidate = completeRun(
    candidate.K,
    loadedInCandidate.practiceCheckpoint,
  );
  assert.equal(resumedInCandidate.phase, "RESULT");
  assert.equal(resumedInCandidate.records.length, 10);
  assert.equal(resumedInCandidate.score, resumedInCurrent.score);

  // 4. Historical v0.2.4-backup.json acceptance and checkpoint resume in both builds.
  const historicalJson = readFileSync(
    "tests/fixtures/v0.2.4-backup.json",
    "utf8",
  );
  for (const api of [K, candidate.K]) {
    const parsed = api.validateBackup(historicalJson);
    assert.equal(parsed.format, "kazohe-backup");
    assert.equal(parsed.appVersion, "0.2");
    assert.equal(parsed.schemaVersion, 1);
    assert.ok(parsed.practiceCheckpoint);
    const finished = completeRun(api, parsed.practiceCheckpoint);
    assert.equal(finished.phase, "RESULT");
    assert.equal(finished.records.length, 10);
    const updated = api.applyResult(parsed, finished).saved;
    assert.ok(api.validateBackup(JSON.stringify(updated)));
  }

  // 5. Refusal of v0.1, wrong schemaVersion, wrong format, prototype pollution,
  //    extra keys, >16 MiB payload, and malformed JSON with exact error reasons.
  const baseObj = K.validateBackup(currentJson);
  const mutateJson = (fn) => {
    const copy = structuredClone(baseObj);
    fn(copy);
    return JSON.stringify(copy);
  };
  for (const api of [K, candidate.K]) {
    assert.throws(
      () => api.validateBackup(mutateJson((o) => { o.appVersion = "0.1"; })),
      refusedWith({ message: /対応していないバージョンです。/ }),
    );
    assert.throws(
      () => api.validateBackup(mutateJson((o) => { o.appVersion = candidateVersion; })),
      refusedWith({ message: /対応していないバージョンです。/ }),
    );
    assert.throws(
      () => api.validateBackup(mutateJson((o) => { o.schemaVersion = 2; })),
      refusedWith({ message: /対応していないバージョンです。/ }),
    );
    assert.throws(
      () => api.validateBackup(mutateJson((o) => { o.format = "other-app"; })),
      refusedWith({ message: /対応していないバージョンです。/ }),
    );
    assert.throws(
      () => api.validateBackup(mutateJson((o) => { o.unexpectedField = true; })),
      refusedWith({ message: /バックアップの形式が正しくありません。/ }),
    );
    assert.throws(
      () => api.validateBackup('{"__proto__":{"polluted":true}}'),
      refusedWith({ message: /不正なキーです。/ }),
    );
    assert.throws(
      () => api.validateBackup("{not valid json"),
      { name: "SyntaxError", message: /Expected property name|JSON/i },
    );
    assert.throws(
      () => api.validateBackup(currentJson.slice(0, -10)),
      { name: "SyntaxError", message: /Unexpected end|Unterminated|JSON/i },
    );
    assert.throws(
      () => api.validateBackup(" ".repeat(16 * 1024 * 1024 + 1)),
      refusedWith({ message: /JSONは16 MiBまでです。/ }),
    );
  }

  // 6. Non-corruption of existing localStorage on refused writes and corrupt reads.
  const storage = makeMemoryStorage({ "unrelated:key": "keep-me" });
  const notices = [];
  const adapter = K.storageAdapter(storage, (msg) => notices.push(msg));
  assert.equal(adapter.available, true);
  assert.equal(adapter.write(currentSave), true);
  const persistedBefore = storage.getItem(K.STORAGE_KEY);
  assert.equal(persistedBefore, JSON.stringify(currentSave));

  // Writing an incompatible older-format object or corrupted structure must fail without touching storage.
  const incompatibleBackup = structuredClone(currentSave);
  incompatibleBackup.appVersion = "0.1";
  assert.equal(adapter.write(incompatibleBackup), false);
  assert.equal(storage.getItem(K.STORAGE_KEY), persistedBefore);
  assert.equal(storage.getItem("unrelated:key"), "keep-me");
  assert.ok(notices.length >= 1);

  // Loading corrupted localStorage returns emptySave() and preserves unrelated keys.
  const corruptStorage = makeMemoryStorage({
    [K.STORAGE_KEY]: '{"format":"kazohe-backup","appVersion":"0.1","schemaVersion":1}',
    "unrelated:key": "still-here",
  });
  const corruptNotices = [];
  const corruptAdapter = K.storageAdapter(corruptStorage, (msg) =>
    corruptNotices.push(msg),
  );
  const fallback = corruptAdapter.load();
  assert.deepEqual(plain(fallback), plain(K.emptySave()));
  assert.equal(corruptStorage.getItem("unrelated:key"), "still-here");
  assert.ok(corruptNotices.length >= 1);

  // Cross-release storageAdapter handoff: written by candidate ('9.9.9'), loaded by current.
  const sharedStorage = makeMemoryStorage();
  const candidateAdapter = candidate.K.storageAdapter(sharedStorage);
  assert.equal(candidateAdapter.write(candidateSave), true);
  const currentAdapter = K.storageAdapter(sharedStorage);
  assert.deepEqual(plain(currentAdapter.load()), plain(candidateSave));

  return {
    currentVersion,
    candidateVersion,
    checks: 6,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const summary = runFormatCompatibilityChecks();
  console.log(
    `format-compatibility: PASS (${summary.currentVersion} <-> ${summary.candidateVersion})`,
  );
}
