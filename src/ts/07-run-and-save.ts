/* Run state machine, metrics, fallback evaluation, persistence, backup validation, and KZ API. */
import {
  APP_VERSION,
  BY_ID,
  CATALOG,
  REMAINDER_IDS,
  STORAGE_KEY,
  VERSION,
  clone,
  isChallengeId,
  isGrade,
  isRecord,
  specOf,
} from "./00-prelude.ts";
import {
  answerText,
  borrow,
  calc,
  carry,
  cmp,
  decimal,
  decimalPlaces,
  evaluate,
  expression,
  format,
  gcd,
  generalHint,
  judge,
  lcm,
  lit,
  normalizeInput,
  number,
  op,
  rat,
  rng,
  roundExact,
  shuffle,
  validateQuestion,
} from "./02-math.ts";
import { KZWritten } from "./03-written.ts";
import {
  arithmetic,
  buildHint,
  buildSolution,
  complete,
  special,
} from "./05-solutions.ts";
import {
  atRank,
  createGenerator,
  decode,
  domains,
  generate,
} from "./06-generators.ts";
import type {
  AnswerKind,
  ApplyResultOutput,
  BackupSettingsKey,
  BackupTopKey,
  ChallengeId,
  ChallengeOptions,
  EndReason,
  FallbackEvaluation,
  FallbackRecommendation,
  KZApi,
  MetricsCounterKey,
  OptionsById,
  PauseReason,
  Question,
  RawAnswerInput,
  RemainderMode,
  Rng,
  RunConfig,
  RunConfigInput,
  RunEvent,
  RunMetrics,
  RunRecord,
  RunState,
  SaveData,
  StorageAdapter,
  StorageLike,
  SupportClass,
  TaskKind,
  WrittenMode,
} from "../types/contracts.d.ts";

const BACKUP_TOP_KEYS: readonly BackupTopKey[] = [
  "format",
  "appVersion",
  "schemaVersion",
  "settings",
  "bestRecords",
  "recommendation",
  "returnStack",
  "practiceCheckpoint",
];

const BACKUP_SETTINGS_KEYS: readonly BackupSettingsKey[] = [
  "name",
  "sound",
  "effects",
  "onboarded",
  "config",
];

const METRICS_COUNTER_KEYS: readonly MetricsCounterKey[] = [
  "displayN",
  "presented",
  "unshown",
  "learningN",
  "unansweredN",
  "correctProblems",
  "helpProblems",
  "mistakeEvents",
  "hintProblems",
  "firstCorrectProblems",
  "finalSelfCorrectProblems",
  "repeatedWrongProblems",
  "unansweredProblems",
  "learningUnansweredCount",
];

const ANSWER_KINDS: readonly AnswerKind[] = [
  "integer",
  "decimal",
  "fraction",
  "quotient",
  "common",
  "blocks",
  "set",
  "compare",
  "parity",
];

const TASK_KINDS: readonly TaskKind[] = [
  "arithmetic",
  "compare",
  "parity",
  "divisors",
  "gcd",
  "lcm",
  "round",
  "fraction",
  "reciprocal",
  "common",
  "blocks",
];

function isRemainderMode(v: unknown): v is RemainderMode {
  return v === "none" || v === "some" || v === "mixed";
}

function isWrittenMode(v: unknown): v is WrittenMode {
  return v === "none" || v === "some" || v === "mixed";
}

function isSupportClass(v: unknown): v is SupportClass {
  return v === "independent" || v === "supported";
}

function isEndReason(v: unknown): v is EndReason {
  return v === "completed" || v === "manual" || v === "natural-timeout";
}

function isAnswerKind(v: unknown): v is AnswerKind {
  return typeof v === "string" && ANSWER_KINDS.includes(v);
}

function isTaskKind(v: unknown): v is TaskKind {
  return typeof v === "string" && TASK_KINDS.includes(v);
}

function isChallengeOptions(v: unknown): v is ChallengeOptions {
  if (!isRecord(v)) return false;
  if (
    v.table !== undefined &&
    v.table !== null &&
    typeof v.table !== "number"
  ) {
    return false;
  }
  if (v.remainder !== undefined && !isRemainderMode(v.remainder)) return false;
  if (v.written !== undefined && !isWrittenMode(v.written)) return false;
  return true;
}

function isRunConfigInput(v: unknown): v is RunConfigInput {
  if (!isRecord(v)) return false;
  if (v.mode !== "practice" && v.mode !== "time") return false;
  if (
    v.selectedIds !== undefined &&
    (!Array.isArray(v.selectedIds) ||
      v.selectedIds.some((id) => typeof id !== "string"))
  ) {
    return false;
  }
  if (v.quantity !== undefined && v.quantity !== null && typeof v.quantity !== "number") {
    return false;
  }
  if (
    v.timeLimitMs !== undefined &&
    v.timeLimitMs !== null &&
    typeof v.timeLimitMs !== "number"
  ) {
    return false;
  }
  if (v.optionsById !== undefined) {
    if (!isRecord(v.optionsById)) return false;
    for (const val of Object.values(v.optionsById)) {
      if (val !== undefined && !isChallengeOptions(val)) return false;
    }
  }
  return true;
}

function isQuestionShape(v: unknown): v is Question {
  return (
    isRecord(v) &&
    isChallengeId(v.challengeId) &&
    isTaskKind(v.task) &&
    isRecord(v.answerSpec) &&
    isAnswerKind(v.answerSpec.type)
  );
}

function isRawAnswerInput(v: unknown): v is RawAnswerInput {
  return (
    v === null ||
    v === undefined ||
    typeof v === "string" ||
    typeof v === "number" ||
    isRecord(v)
  );
}

function isValidatedSaveData(v: unknown): v is SaveData {
  return (
    isRecord(v) &&
    v.format === "kazohe-backup" &&
    v.appVersion === VERSION &&
    v.schemaVersion === 1 &&
    isRecord(v.settings) &&
    isRecord(v.bestRecords) &&
    Array.isArray(v.returnStack)
  );
}

export function normalizeConfig(c: RunConfigInput): RunConfig {
  const rawIds = [...new Set<string>(c.selectedIds || [])].sort();
  if (!rawIds.length) throw Error("チャレンジをえらんでね。");
  const selectedIds: ChallengeId[] = [];
  for (const id of rawIds) {
    if (!isChallengeId(id) || !BY_ID[id]) {
      throw Error("チャレンジをえらんでね。");
    }
    selectedIds.push(id);
  }
  if (c.mode !== "practice" && c.mode !== "time") {
    throw Error("モードが不正です");
  }
  const long = selectedIds.some((id) => specOf(id).timeClass === "long");
  const quantity =
    c.mode === "practice"
      ? c.quantity === null
        ? null
        : (c.quantity ?? 10)
      : null;
  if (quantity !== null && ![10, 20, 30].includes(quantity)) {
    throw Error("問題数が不正です");
  }
  const timeLimitMs =
    c.mode === "time" ? (c.timeLimitMs ?? (long ? 120000 : 60000)) : null;
  if (
    c.mode === "time" &&
    !(long ? [60000, 120000, 180000] : [30000, 60000, 90000]).includes(
      timeLimitMs,
    )
  ) {
    throw Error("時間が不正です");
  }
  const optionsById: OptionsById = {};
  for (const id of selectedIds) {
    const o = c.optionsById?.[id] || {};
    const next: ChallengeOptions = {};
    if (id === "G2-C08") {
      if (
        o.table !== undefined &&
        o.table !== null &&
        (!Number.isInteger(o.table) || o.table < 1 || o.table > 9)
      ) {
        throw Error("段が不正です");
      }
      next.table = o.table ?? null;
    }
    if (REMAINDER_IDS.includes(id)) {
      if (o.remainder !== undefined && !isRemainderMode(o.remainder)) {
        throw Error("余り条件が不正です");
      }
      next.remainder = o.remainder || "mixed";
    }
    if (o.written !== undefined) {
      if (
        !KZWritten.ids.includes(id) ||
        !isWrittenMode(o.written) ||
        (o.written !== "mixed" &&
          !KZWritten.available(id, next.remainder).includes(o.written))
      ) {
        throw Error("筆算の条件をたしかめてね。");
      }
      next.written = o.written;
    }
    optionsById[id] = next;
  }
  const minGrade = Math.min(...selectedIds.map((id) => specOf(id).grade));
  if (!isGrade(minGrade)) throw Error("学年をたしかめてね。");
  return {
    selectedIds,
    optionsById,
    mode: c.mode,
    quantity,
    timeLimitMs,
    languageGrade: minGrade,
    appVersion: VERSION,
  };
}

export function schedule(
  ids: readonly ChallengeId[],
  count: number,
  r: Rng,
): ChallengeId[] {
  const result: ChallengeId[] = [];
  while (result.length < count) result.push(...shuffle(ids, r));
  return result.slice(0, count);
}

export const scoreCorrect = (
  base: number,
  streak: number,
  hint: boolean,
): number =>
  Math.round(
    base *
      (streak >= 8 ? 3 : streak >= 5 ? 2 : streak >= 3 ? 1.5 : 1) *
      (hint ? 0.5 : 1),
  );

function present(s: RunState): RunState {
  if (s.config.quantity !== null && s.records.length >= s.config.quantity) {
    return finish(s, "completed");
  }
  if (
    s.config.mode === "time" &&
    s.activeTimeRemainingMs !== null &&
    s.activeTimeRemainingMs <= 0
  ) {
    return finish(s, "natural-timeout");
  }
  const i = s.records.length;
  if (!s.schedule[i]) {
    const r = rng(s.generator.rngState);
    s.schedule.push(...shuffle(s.config.selectedIds, r));
    s.generator.rngState = r.state;
  }
  const id = s.schedule[i];
  const q = generate(id, s.config.optionsById[id], s.generator);
  q.questionId = `${s.runId}:${i}`;
  s.currentQuestion = q;
  s.records.push({
    questionId: q.questionId,
    challengeId: id,
    presentationIndex: i,
    question: q,
    wrongAttempts: 0,
    firstWrongAnswer: null,
    hintShown: false,
    helpUsed: false,
    terminal: null,
    endReason: null,
    earnedPoints: 0,
    streakAfter: null,
  });
  s.phase = "QUESTION";
  s.pauseReasons = s.pauseReasons.filter((p) => p === "hidden");
  return s;
}

export function createRun(
  config: RunConfigInput,
  seed = Date.now(),
  now = 0,
): RunState {
  const normalized = normalizeConfig(config);
  const r = rng(seed);
  const s: RunState = {
    runId: `${seed >>> 0}-${Math.floor(now)}`,
    config: normalized,
    phase: "PREPARING",
    currentQuestion: null,
    records: [],
    schedule: normalized.quantity
      ? schedule(normalized.selectedIds, normalized.quantity, r)
      : [],
    generator: createGenerator(r.state),
    score: 0,
    streak: 0,
    bestStreak: 0,
    activeTimeRemainingMs: normalized.timeLimitMs,
    pauseReasons: [],
    lastNow: now,
    finishedOnce: false,
    endReason: null,
  };
  return present(s);
}

function finish(s: RunState, reason: EndReason): RunState {
  if (s.finishedOnce) return s;
  const rec = s.records.at(-1);
  if (rec && !rec.terminal) {
    rec.terminal = "unanswered";
    rec.endReason = reason === "natural-timeout" ? reason : "manual";
  }
  s.phase = "RESULT";
  s.finishedOnce = true;
  s.endReason = reason;
  s.pauseReasons = [];
  return s;
}

export function reduceRun(
  state: RunState,
  event: RunEvent,
  now: number,
): RunState {
  const s = clone(state);
  s.notice = null;
  if (s.finishedOnce) return s;
  if (
    s.config.mode === "time" &&
    s.phase === "QUESTION" &&
    !s.pauseReasons.length &&
    s.activeTimeRemainingMs !== null
  ) {
    s.activeTimeRemainingMs = Math.max(
      0,
      s.activeTimeRemainingMs - Math.max(0, now - s.lastNow),
    );
  }
  s.lastNow = now;
  if (
    s.config.mode === "time" &&
    s.activeTimeRemainingMs !== null &&
    s.activeTimeRemainingMs <= 0
  ) {
    return finish(s, "natural-timeout");
  }
  const addPause = (p: PauseReason): void => {
    if (!s.pauseReasons.includes(p)) s.pauseReasons.push(p);
  };
  const removePause = (p: PauseReason): void => {
    s.pauseReasons = s.pauseReasons.filter((x) => x !== p);
  };
  const rec = s.records.at(-1);
  if (!rec) return s;
  if (event.questionId && event.questionId !== rec.questionId) return s;
  if (event.type === "HIDDEN") {
    addPause("hidden");
    return s;
  }
  if (event.type === "VISIBLE") {
    removePause("hidden");
    return s;
  }
  if (event.type === "END_CONFIRM") {
    addPause("confirm");
    return s;
  }
  if (event.type === "END_CANCEL") {
    removePause("confirm");
    return s;
  }
  if (event.type === "END_ACCEPT") return finish(s, "manual");
  if (event.type === "PAUSE" && s.phase === "QUESTION") {
    addPause("manual");
    return s;
  }
  if (event.type === "RESUME") {
    removePause("manual");
    return s;
  }
  if (event.type === "HINT_CONTINUE" && s.phase === "HINT_READING") {
    removePause("hint");
    s.phase = "QUESTION";
    return s;
  }
  if (event.type === "FEEDBACK_DONE" && s.pauseReasons.includes("confirm")) {
    return s;
  }
  if (event.type === "FEEDBACK_DONE" && s.phase === "WRONG_FEEDBACK") {
    removePause("wrong-animation");
    if (rec.wrongAttempts === 2 && !rec.hintShown) {
      rec.hintShown = true;
      s.phase = "HINT_READING";
      addPause("hint");
    } else {
      s.phase = "QUESTION";
    }
    return s;
  }
  if (
    (event.type === "FEEDBACK_DONE" && s.phase === "CORRECT_FEEDBACK") ||
    (event.type === "SOLUTION_NEXT" && s.phase === "SOLUTION_READING")
  ) {
    removePause("correct-animation");
    removePause("solution");
    return present(s);
  }
  if (s.phase !== "QUESTION" || s.pauseReasons.length || rec.terminal) {
    return s;
  }
  if (event.type === "HELP") {
    rec.helpUsed = true;
    rec.terminal = "help";
    rec.endReason = "help";
    rec.streakAfter = 0;
    s.streak = 0;
    s.phase = "SOLUTION_READING";
    addPause("solution");
    return s;
  }
  if (event.type !== "SUBMIT") return s;
  const parsed = normalizeInput(rec.question.answerSpec, event.raw);
  const result = judge(rec.question, parsed);
  if (result.inputError) {
    s.notice = result.inputError;
    return s;
  }
  if (result.correct) {
    s.streak++;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    rec.earnedPoints = scoreCorrect(
      specOf(rec.challengeId).basePoints,
      s.streak,
      rec.hintShown,
    );
    s.score += rec.earnedPoints;
    rec.terminal = "correct";
    rec.endReason = "correct";
    rec.normalizedCorrectAnswer = parsed;
    rec.streakAfter = s.streak;
    s.phase = "CORRECT_FEEDBACK";
    addPause("correct-animation");
    s.notice = `できた！${rec.wrongAttempts ? " やりなおして せいかい！" : ""} ＋${rec.earnedPoints}点`;
  } else {
    rec.wrongAttempts++;
    rec.firstWrongAnswer ||= clone(event.raw);
    s.streak = 0;
    s.phase = "WRONG_FEEDBACK";
    addPause("wrong-animation");
    s.notice = result.reason || "おしい！ もういちど！";
  }
  return s;
}

export function deriveMetrics(
  records: readonly RunRecord[],
  unshownSlots: readonly ChallengeId[] = [],
  endReason: EndReason | null = "manual",
): RunMetrics {
  const m: RunMetrics = {
    displayN: records.length + unshownSlots.length,
    presented: records.length,
    unshown: unshownSlots.length,
    learningN: records.length + unshownSlots.length,
    unansweredN: records.length + unshownSlots.length,
    correctProblems: 0,
    helpProblems: 0,
    mistakeEvents: 0,
    hintProblems: 0,
    firstCorrectProblems: 0,
    finalSelfCorrectProblems: 0,
    repeatedWrongProblems: 0,
    unansweredProblems: unshownSlots.length,
    learningUnansweredCount: unshownSlots.length,
    exclusions: [],
    answerAccuracy: null,
  };
  records.forEach((r) => {
    const correct = r.terminal === "correct";
    const help = r.terminal === "help";
    const unanswered = r.terminal === "unanswered" || !r.terminal;
    m.correctProblems += +correct;
    m.helpProblems += +help;
    m.mistakeEvents += r.wrongAttempts + +help;
    m.hintProblems += +r.hintShown;
    m.firstCorrectProblems += +(correct && !r.wrongAttempts && !r.helpUsed);
    m.finalSelfCorrectProblems += +(correct && !r.helpUsed);
    m.repeatedWrongProblems += +(r.wrongAttempts >= 2);
    m.unansweredProblems += +unanswered;
    m.learningUnansweredCount += +unanswered;
    if (
      unanswered &&
      r.endReason === "natural-timeout" &&
      endReason === "natural-timeout"
    ) {
      m.unansweredN--;
      m.learningUnansweredCount--;
      if (!r.wrongAttempts) m.learningN--;
      m.exclusions.push({
        questionId: r.questionId,
        reason: "natural-timeout",
        learning: !r.wrongAttempts,
      });
    }
  });
  m.answerAccuracy =
    m.correctProblems + m.mistakeEvents
      ? m.correctProblems / (m.correctProblems + m.mistakeEvents)
      : null;
  return m;
}

export function runMetrics(
  s: RunState,
  id: ChallengeId | null = null,
): RunMetrics {
  const records = id
    ? s.records.filter((r) => r.challengeId === id)
    : s.records;
  const slots = s.config.quantity ? s.schedule.slice(s.records.length) : [];
  return deriveMetrics(
    records,
    id ? slots.filter((x) => x === id) : slots,
    s.endReason,
  );
}

export function eligibility(s: RunState, id: ChallengeId): boolean {
  const m = runMetrics(s, id);
  return (
    m.learningN > 0 &&
    (s.config.quantity !== null ||
      s.config.mode === "time" ||
      s.records.length >= 10) &&
    (s.config.selectedIds.length < 2 || m.presented >= 10)
  );
}

export function evaluateFallback(s: RunState): FallbackEvaluation {
  const candidates: FallbackRecommendation[] = [];
  const excluded: ChallengeId[] = [];
  for (const id of s.config.selectedIds) {
    const m = runMetrics(s, id);
    if (!eligibility(s, id)) {
      excluded.push(id);
      continue;
    }
    const flags = [
      m.unansweredN > 0 && m.learningUnansweredCount * 5 >= m.unansweredN,
      m.helpProblems * 5 >= m.learningN,
      m.repeatedWrongProblems * 5 >= m.learningN,
      m.firstCorrectProblems * 10 < m.learningN * 7,
      m.finalSelfCorrectProblems * 10 < m.learningN * 7,
    ];
    if (!flags.some(Boolean)) continue;
    const severity = Math.max(
      1 - m.firstCorrectProblems / m.learningN,
      1 - m.finalSelfCorrectProblems / m.learningN,
      m.helpProblems / m.learningN,
      m.repeatedWrongProblems / m.learningN,
      m.unansweredN ? m.learningUnansweredCount / m.unansweredN : 0,
    );
    const reason =
      m.unshown && flags[0]
        ? "まだ取り組んでいない問題もあったね。まずこの練習から"
        : [
            "こたえていない問題を、少しずつ練習しよう。",
            "助けてもらったところを、いっしょに練習しよう。",
            "何度かやりなおしたところを練習しよう。",
            "はじめの考え方を、もういちど練習しよう。",
            "こたえまでの道すじを練習しよう。",
          ][flags.findIndex(Boolean)];
    candidates.push({
      sourceId: id,
      targetId: specOf(id).fallbackParent || id,
      severity,
      conditionCount: flags.filter(Boolean).length,
      learningN: m.learningN,
      reason,
    });
  }
  candidates.sort(
    (a, b) =>
      b.severity - a.severity ||
      b.conditionCount - a.conditionCount ||
      b.learningN - a.learningN ||
      a.sourceId.localeCompare(b.sourceId),
  );
  return {
    recommendation: candidates[0] || null,
    excluded,
    insufficient: excluded.length === s.config.selectedIds.length,
  };
}

export function bestKey(
  config: RunConfigInput,
  supportClass: SupportClass,
): string | null {
  const normalized = normalizeConfig(config);
  if (
    normalized.selectedIds.length !== 1 ||
    (normalized.mode === "practice" && normalized.quantity === null)
  ) {
    return null;
  }
  const bestOptions = clone(normalized.optionsById);
  // A legacy unrestricted record and an explicit "both" option describe the same learning condition.
  for (const options of Object.values(bestOptions)) {
    if (options.written === "mixed") delete options.written;
  }
  return JSON.stringify([
    VERSION,
    normalized.selectedIds[0],
    bestOptions,
    normalized.mode,
    normalized.quantity ?? normalized.timeLimitMs,
    supportClass,
  ]);
}

export function emptySave(): SaveData {
  return {
    format: "kazohe-backup",
    appVersion: VERSION,
    schemaVersion: 1,
    settings: {
      name: "",
      onboarded: false,
      sound: true,
      effects: true,
      config: normalizeConfig({
        selectedIds: ["G1-C01"],
        mode: "practice",
        quantity: 10,
      }),
    },
    bestRecords: {},
    recommendation: null,
    returnStack: [],
    practiceCheckpoint: null,
  };
}

export function checkpoint(s: RunState): RunState | null {
  if (s.config.mode !== "practice") return null;
  const c = clone(s);
  const current = c.records.at(-1);
  if (current && !current.terminal) {
    Object.assign(current, {
      wrongAttempts: 0,
      firstWrongAnswer: null,
      hintShown: false,
      helpUsed: false,
      earnedPoints: 0,
    });
    const completed = c.records.slice(0, -1);
    c.streak = completed.at(-1)?.streakAfter || 0;
    c.score = completed.reduce((n, r) => n + r.earnedPoints, 0);
    c.bestStreak = Math.max(0, ...completed.map((r) => r.streakAfter || 0));
  }
  c.pauseReasons = [];
  c.lastNow = 0;
  if (
    current?.terminal &&
    current.terminal !== "unanswered" &&
    !c.finishedOnce
  ) {
    present(c);
  } else if (!c.finishedOnce) {
    c.phase = "QUESTION";
  }
  return c;
}

export function applyResult(saved: SaveData, s: RunState): ApplyResultOutput {
  const next = clone(saved);
  const metrics = runMetrics(s);
  const supportClass: SupportClass = s.records.some(
    (r) => r.hintShown || r.helpUsed,
  )
    ? "supported"
    : "independent";
  const key = bestKey(s.config, supportClass);
  let newBest = false;
  if (
    key &&
    (!next.bestRecords[key] || s.score > next.bestRecords[key].score)
  ) {
    next.bestRecords[key] = {
      score: s.score,
      bestStreak: s.bestStreak,
      metrics,
      config: s.config,
      supportClass,
      endReason: s.endReason || "manual",
    };
    newBest = true;
  }
  const evaluated = evaluateFallback(s);
  if (evaluated.recommendation) {
    next.recommendation = evaluated.recommendation;
  } else if (
    next.recommendation &&
    s.config.selectedIds.includes(next.recommendation.targetId) &&
    eligibility(s, next.recommendation.targetId)
  ) {
    next.recommendation = null;
  }
  if (s.config.mode === "practice") next.practiceCheckpoint = null;
  return { saved: next, newBest, metrics, ...evaluated };
}

export function recommendConfig(
  saved: SaveData,
  current: RunConfig,
): { saved: SaveData; config: RunConfig } {
  if (!saved.recommendation) return { saved, config: current };
  const next = clone(saved);
  const id = saved.recommendation.targetId;
  if (
    current.selectedIds.length &&
    (current.selectedIds.length !== 1 || current.selectedIds[0] !== id)
  ) {
    next.returnStack.push(clone(current));
  }
  return {
    saved: next,
    config: normalizeConfig({
      selectedIds: [id],
      mode: "practice",
      quantity: 10,
    }),
  };
}

export function clearScores(
  saved: SaveData,
  id: ChallengeId | null = null,
): SaveData {
  const s = clone(saved);
  s.bestRecords = Object.fromEntries(
    Object.entries(s.bestRecords).filter(
      ([, r]) => Boolean(id) && r.config.selectedIds[0] !== id,
    ),
  );
  return s;
}

export function validateBackup(text: string): SaveData {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > 16 * 1024 * 1024
  ) {
    throw Error("JSONは16 MiBまでです。");
  }
  const obj = JSON.parse(text);
  let nodes = 0;
  function scan(v: unknown, depth = 0, field = ""): void {
    if (++nodes > 1000000 || depth > 80) {
      throw Error("データが大きすぎます。");
    }
    if (v && typeof v === "object") {
      for (const [key, val] of Object.entries(v)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) {
          throw Error("不正なキーです。");
        }
        scan(val, depth + 1, key);
      }
    } else if (
      typeof v === "number" &&
      (!Number.isFinite(v) ||
        (v < 0 && !(field === "places" && [-1, -2, -3, -4].includes(v))) ||
        v > Number.MAX_SAFE_INTEGER)
    ) {
      throw Error("不正な数値です。");
    } else if (typeof v === "string" && v.length > 20000) {
      throw Error("文字列が長すぎます。");
    }
  }
  scan(obj);
  function fail(): never {
    throw Error("バックアップの形式が正しくありません。");
  }
  if (
    !isRecord(obj) ||
    obj.format !== "kazohe-backup" ||
    obj.appVersion !== VERSION ||
    obj.schemaVersion !== 1
  ) {
    throw Error("対応していないバージョンです。");
  }
  const only = (v: unknown, keys: readonly string[]): void => {
    if (!isRecord(v) || Object.keys(v).some((k) => !keys.includes(k))) {
      fail();
    }
  };
  only(obj, BACKUP_TOP_KEYS);
  const set = obj.settings;
  if (
    !isRecord(set) ||
    typeof set.name !== "string" ||
    [...set.name].length > 30 ||
    /[\u0000-\u001f\u007f]/.test(set.name) ||
    ["sound", "effects", "onboarded"].some((k) => typeof set[k] !== "boolean")
  ) {
    fail();
  }
  only(set, BACKUP_SETTINGS_KEYS);
  const conf = (c: unknown): RunConfig => {
    if (!isRunConfigInput(c)) fail();
    const normalized = normalizeConfig(c);
    if (JSON.stringify(normalized) !== JSON.stringify(c)) fail();
    return normalized;
  };
  conf(set.config);
  if (!isRecord(obj.bestRecords) || Object.keys(obj.bestRecords).length > 50000) {
    fail();
  }
  for (const [key, r] of Object.entries(obj.bestRecords)) {
    if (!isRecord(r)) fail();
    const recordConfig = conf(r.config);
    if (
      !isSupportClass(r.supportClass) ||
      bestKey(recordConfig, r.supportClass) !== key ||
      typeof r.score !== "number" ||
      !Number.isSafeInteger(r.score) ||
      r.score < 0 ||
      !isRecord(r.metrics) ||
      typeof r.bestStreak !== "number" ||
      !Number.isSafeInteger(r.bestStreak) ||
      !isEndReason(r.endReason)
    ) {
      fail();
    }
    const m = r.metrics;
    const nums: Record<string, number> = {};
    for (const k of METRICS_COUNTER_KEYS) {
      const val = m[k];
      if (typeof val !== "number" || !Number.isSafeInteger(val) || val < 0) {
        fail();
      }
      nums[k] = val;
    }
    if (
      nums.displayN !== nums.presented + nums.unshown ||
      nums.displayN !==
        nums.correctProblems + nums.helpProblems + nums.unansweredProblems ||
      nums.learningN > nums.displayN ||
      nums.unansweredN > nums.displayN ||
      nums.firstCorrectProblems > nums.finalSelfCorrectProblems ||
      nums.finalSelfCorrectProblems > nums.correctProblems ||
      nums.correctProblems > nums.learningN ||
      nums.helpProblems > nums.learningN ||
      nums.hintProblems > nums.presented ||
      nums.repeatedWrongProblems > nums.presented ||
      nums.learningUnansweredCount > nums.unansweredN
    ) {
      fail();
    }
    const accuracy =
      nums.correctProblems + nums.mistakeEvents
        ? nums.correctProblems / (nums.correctProblems + nums.mistakeEvents)
        : null;
    if (m.answerAccuracy !== accuracy) fail();
  }
  if (!Array.isArray(obj.returnStack) || obj.returnStack.length > 101) fail();
  obj.returnStack.forEach(conf);
  if (obj.recommendation) {
    const r = obj.recommendation;
    if (
      !isRecord(r) ||
      !isChallengeId(r.sourceId) ||
      !BY_ID[r.sourceId] ||
      r.targetId !== (specOf(r.sourceId).fallbackParent || r.sourceId) ||
      typeof r.reason !== "string"
    ) {
      fail();
    }
  }
  const s = obj.practiceCheckpoint;
  if (s) {
    if (!isRecord(s)) fail();
    const sConfig = conf(s.config);
    if (
      sConfig.mode !== "practice" ||
      !Array.isArray(s.records) ||
      !s.records.length ||
      s.records.length > 100000 ||
      !Array.isArray(s.schedule) ||
      s.schedule.some(
        (id) => !isChallengeId(id) || !sConfig.selectedIds.includes(id),
      ) ||
      (sConfig.quantity !== null &&
        (s.schedule.length !== sConfig.quantity ||
          s.records.length > sConfig.quantity))
    ) {
      fail();
    }
    if (
      !isRecord(s.generator) ||
      typeof s.generator.rngState !== "number" ||
      !Number.isInteger(s.generator.rngState) ||
      s.generator.rngState < 1 ||
      s.generator.rngState > 4294967295 ||
      !isRecord(s.generator.ids)
    ) {
      fail();
    }
    for (const [key, g] of Object.entries(s.generator.ids)) {
      const parsedKey = JSON.parse(key);
      if (!Array.isArray(parsedKey) || parsedKey.length < 2) fail();
      const [id, options] = parsedKey;
      if (
        !isChallengeId(id) ||
        !sConfig.selectedIds.includes(id) ||
        !isChallengeOptions(options) ||
        JSON.stringify(options) !== JSON.stringify(sConfig.optionsById[id])
      ) {
        fail();
      }
      const ds = domains(id, options);
      if (!isRecord(g) || !Array.isArray(g.round)) fail();
      const gRound = g.round;
      if (
        gRound.length > ds.reduce((n, d) => n + (d.weight || 1), 0) ||
        gRound.some(
          (i) =>
            typeof i !== "number" ||
            !Number.isInteger(i) ||
            i < 0 ||
            i >= ds.length,
        ) ||
        ds.some(
          (d, i) => gRound.filter((x) => x === i).length > (d.weight || 1),
        ) ||
        !isRecord(g.buckets) ||
        (g.last !== null && typeof g.last !== "string")
      ) {
        fail();
      }
      for (const [index, b] of Object.entries(g.buckets)) {
        if (
          !/^\d+$/.test(index) ||
          !ds[Number(index)] ||
          !isRecord(b) ||
          typeof b.cycle !== "number" ||
          !Number.isSafeInteger(b.cycle) ||
          b.cycle < 0 ||
          typeof b.cursor !== "string" ||
          !/^\d{1,80}$/.test(b.cursor) ||
          BigInt(b.cursor) >= ds[Number(index)].size ||
          !Array.isArray(b.used) ||
          b.used.length > 100000 ||
          new Set<unknown>(b.used).size !== b.used.length ||
          b.used.some((k) => typeof k !== "string")
        ) {
          fail();
        }
      }
    }
    let score = 0;
    let streak = 0;
    let best = 0;
    const runId = typeof s.runId === "string" ? s.runId : "";
    const sRecords = s.records;
    const sSchedule = s.schedule;
    sRecords.forEach((r, i) => {
      if (
        !isRecord(r) ||
        !isChallengeId(r.challengeId) ||
        r.challengeId !== sSchedule[i] ||
        r.questionId !== `${runId}:${i}` ||
        !isQuestionShape(r.question) ||
        r.question.challengeId !== r.challengeId ||
        r.question.questionId !== r.questionId ||
        typeof r.wrongAttempts !== "number" ||
        !Number.isInteger(r.wrongAttempts) ||
        r.wrongAttempts < 0 ||
        typeof r.hintShown !== "boolean" ||
        typeof r.helpUsed !== "boolean" ||
        !["correct", "help", null].includes(r.terminal) ||
        (i < sRecords.length - 1 && !r.terminal)
      ) {
        fail();
      }
      const rebuilt = complete(
        { ...r.question, solutionTrace: undefined },
        r.question.conditionBucket,
      );
      const writtenMode = sConfig.optionsById[r.challengeId]?.written;
      if (
        writtenMode &&
        writtenMode !== "mixed" &&
        KZWritten.classify(rebuilt).has !== (writtenMode === "some")
      ) {
        fail();
      }
      if (
        JSON.stringify(rebuilt.expectedExactValue) !==
          JSON.stringify(r.question.expectedExactValue) ||
        rebuilt.canonicalKey !== r.question.canonicalKey ||
        !validateQuestion(specOf(r.challengeId), rebuilt).valid
      ) {
        fail();
      }
      if (r.wrongAttempts > 0) {
        if (!isRawAnswerInput(r.firstWrongAnswer)) fail();
        const p = normalizeInput(r.question.answerSpec, r.firstWrongAnswer);
        if (p.error || judge(r.question, p).correct) fail();
      } else if (r.firstWrongAnswer !== null) {
        fail();
      }
      if (r.hintShown !== (r.wrongAttempts >= 2)) fail();
      if (r.terminal === "help") {
        if (!r.helpUsed || r.earnedPoints !== 0) fail();
        streak = 0;
      } else if (r.terminal === "correct") {
        if (r.wrongAttempts) streak = 0;
        streak++;
        if (
          r.helpUsed ||
          typeof r.earnedPoints !== "number" ||
          r.earnedPoints !==
            scoreCorrect(specOf(r.challengeId).basePoints, streak, r.hintShown)
        ) {
          fail();
        }
        score += r.earnedPoints;
        best = Math.max(best, streak);
      } else if (
        r.wrongAttempts ||
        r.helpUsed ||
        r.hintShown ||
        r.earnedPoints
      ) {
        fail();
      }
    });
    const lastRec = sRecords.at(-1);
    if (
      score !== s.score ||
      streak !== s.streak ||
      best !== s.bestStreak ||
      s.phase !== (s.finishedOnce ? "RESULT" : "QUESTION") ||
      !Array.isArray(s.pauseReasons) ||
      s.pauseReasons.length ||
      !isRecord(lastRec) ||
      JSON.stringify(s.currentQuestion) !== JSON.stringify(lastRec.question)
    ) {
      fail();
    }
  }
  if (!isValidatedSaveData(obj)) fail();
  return clone(obj);
}

export function storageAdapter(
  storage: StorageLike,
  notify: (message: string) => void = () => {},
): StorageAdapter {
  let available = true;
  const failed = (): void => {
    available = false;
    notify(
      "このブラウザでは記録を保存できません。JSONに書き出して残せます。",
    );
  };
  try {
    storage.setItem(STORAGE_KEY + ":probe", "1");
    if (storage.getItem(STORAGE_KEY + ":probe") !== "1") throw Error("probe");
    storage.removeItem(STORAGE_KEY + ":probe");
  } catch {
    failed();
  }
  return {
    get available(): boolean {
      return available;
    },
    load(): SaveData {
      try {
        const text = storage.getItem(STORAGE_KEY);
        return text ? validateBackup(text) : emptySave();
      } catch {
        failed();
        return emptySave();
      }
    },
    write(saved: SaveData): boolean {
      try {
        const text = JSON.stringify(saved);
        validateBackup(text);
        storage.setItem(STORAGE_KEY, text);
        return true;
      } catch {
        failed();
        return false;
      }
    },
    reset(): boolean {
      try {
        storage.removeItem(STORAGE_KEY);
        return true;
      } catch {
        failed();
        return false;
      }
    },
  };
}

export const KZ: KZApi = Object.freeze({
  VERSION,
  APP_VERSION,
  STORAGE_KEY,
  CATALOG,
  BY_ID,
  REMAINDER_IDS,
  clone,
  gcd,
  lcm,
  rat,
  number,
  calc,
  cmp,
  decimal,
  decimalPlaces,
  format,
  roundExact,
  lit,
  op,
  evaluate,
  expression,
  rng,
  shuffle,
  carry,
  borrow,
  domains,
  decode,
  atRank,
  complete,
  arithmetic,
  special,
  createGenerator,
  generate,
  buildHint,
  generalHint,
  buildSolution,
  answerText,
  normalizeInput,
  judge,
  validateQuestion,
  normalizeConfig,
  schedule,
  scoreCorrect,
  createRun,
  reduceRun,
  deriveMetrics,
  runMetrics,
  eligibility,
  evaluateFallback,
  bestKey,
  emptySave,
  checkpoint,
  applyResult,
  recommendConfig,
  clearScores,
  validateBackup,
  storageAdapter,
});
