// Shared domain, curriculum, teaching, persistence, and UI contracts for Kazohe.
// Types only; the built product contains none of this.

export type Grade = 1 | 2 | 3 | 4 | 5 | 6;

export type Domain = "数" | "計算";

export type TimeClass = "short" | "long";

export type SourceCode =
  | "M1A1"
  | "M1A2"
  | "M2A1"
  | "M2A2"
  | "M2A3"
  | "M3A1"
  | "M3A2"
  | "M3A3"
  | "M3A4"
  | "M3A5"
  | "M3A6"
  | "M3A7"
  | "M4A1"
  | "M4A2"
  | "M4A3"
  | "M4A4"
  | "M4A5"
  | "M4A6"
  | "M4A7"
  | "M5A1"
  | "M5A2"
  | "M5A3"
  | "M5A4"
  | "M5A5"
  | "M5A6"
  | "M6A1"
  | "M6A2";

export type ChallengeId =
  | "G1-N01"
  | "G1-N02"
  | "G1-N03"
  | "G1-C01"
  | "G1-C02"
  | "G1-C03"
  | "G1-C04"
  | "G1-C05"
  | "G1-C06"
  | "G1-C07"
  | "G1-C08"
  | "G1-C09"
  | "G2-N01"
  | "G2-N02"
  | "G2-N03"
  | "G2-C01"
  | "G2-C02"
  | "G2-C03"
  | "G2-C04"
  | "G2-C05"
  | "G2-C06"
  | "G2-C07"
  | "G2-C08"
  | "G2-C09"
  | "G2-C10"
  | "G3-N01"
  | "G3-N02"
  | "G3-N03"
  | "G3-N04"
  | "G3-N05"
  | "G3-N06"
  | "G3-C01"
  | "G3-C02"
  | "G3-C03"
  | "G3-C04"
  | "G3-C05"
  | "G3-C06"
  | "G3-C07"
  | "G3-C08"
  | "G3-C09"
  | "G3-C10"
  | "G3-C11"
  | "G3-C12"
  | "G3-C13"
  | "G3-C14"
  | "G3-C15"
  | "G4-N01"
  | "G4-N02"
  | "G4-N03"
  | "G4-N04"
  | "G4-N05"
  | "G4-N06"
  | "G4-C01"
  | "G4-C02"
  | "G4-C03"
  | "G4-C04"
  | "G4-C05"
  | "G4-C06"
  | "G4-C07"
  | "G4-C08"
  | "G4-C09"
  | "G4-C10"
  | "G4-C11"
  | "G4-C12"
  | "G4-C13"
  | "G4-C14"
  | "G4-C15"
  | "G4-C16"
  | "G4-C17"
  | "G5-N01"
  | "G5-N02"
  | "G5-N03"
  | "G5-N04"
  | "G5-N05"
  | "G5-N06"
  | "G5-N07"
  | "G5-N08"
  | "G5-N09"
  | "G5-N10"
  | "G5-N11"
  | "G5-N12"
  | "G5-N13"
  | "G5-C01"
  | "G5-C02"
  | "G5-C03"
  | "G5-C04"
  | "G5-C05"
  | "G5-C06"
  | "G5-C07"
  | "G5-C08"
  | "G5-C09"
  | "G6-N01"
  | "G6-N02"
  | "G6-C01"
  | "G6-C02"
  | "G6-C03"
  | "G6-C04"
  | "G6-C05"
  | "G6-C06"
  | "G6-C07"
  | "G6-C08";

export type AnswerKind =
  | "integer"
  | "decimal"
  | "fraction"
  | "quotient"
  | "common"
  | "blocks"
  | "set"
  | "compare"
  | "parity";

export type TaskKind =
  | "arithmetic"
  | "compare"
  | "parity"
  | "divisors"
  | "gcd"
  | "lcm"
  | "round"
  | "fraction"
  | "reciprocal"
  | "common"
  | "blocks";

export type BackupTopKey =
  | "format"
  | "appVersion"
  | "schemaVersion"
  | "settings"
  | "bestRecords"
  | "recommendation"
  | "returnStack"
  | "practiceCheckpoint";

export type BackupSettingsKey =
  | "name"
  | "sound"
  | "effects"
  | "onboarded"
  | "config";

export type MetricsCounterKey =
  | "displayN"
  | "presented"
  | "unshown"
  | "learningN"
  | "unansweredN"
  | "correctProblems"
  | "helpProblems"
  | "mistakeEvents"
  | "hintProblems"
  | "firstCorrectProblems"
  | "finalSelfCorrectProblems"
  | "repeatedWrongProblems"
  | "unansweredProblems"
  | "learningUnansweredCount";

export type ArithmeticOp = "+" | "-" | "*" | "/";
export type WrittenMode = "none" | "some" | "mixed";
export type RemainderMode = "none" | "some" | "mixed";
export type RunMode = "practice" | "time";
export type SupportClass = "independent" | "supported";
export type EndReason = "completed" | "manual" | "natural-timeout";
export type RecordTerminal = "correct" | "help" | "unanswered" | null;
export type RecordEndReason = "correct" | "help" | "manual" | "natural-timeout" | null;
export type RunPhase =
  | "PREPARING"
  | "QUESTION"
  | "CORRECT_FEEDBACK"
  | "WRONG_FEEDBACK"
  | "HINT_READING"
  | "SOLUTION_READING"
  | "RESULT";
export type PauseReason =
  | "hidden"
  | "confirm"
  | "manual"
  | "hint"
  | "wrong-animation"
  | "correct-animation"
  | "solution";
export type ScreenName = "welcome" | "menu" | "play" | "result";
export type CompareSymbol = "<" | "=" | ">";
export type ParityValue = "even" | "odd";
export type FractionForm = "fraction" | "mixed" | "integer";

export interface ChallengeSpec {
  readonly id: ChallengeId;
  readonly grade: Grade;
  readonly category: Domain;
  readonly unit: string;
  readonly title: string;
  readonly basePoints: number;
  readonly timeClass: TimeClass;
  readonly fallbackParent: ChallengeId | null;
  readonly prerequisites: readonly ChallengeId[];
  readonly sourceCodes: readonly SourceCode[];
}

export interface LanguageSourceMeta {
  readonly title: string;
  readonly url: string;
  readonly pages: string;
  readonly counts: readonly number[];
}

export interface LanguageData {
  readonly source: LanguageSourceMeta;
  readonly allocations: readonly string[];
  readonly readings: Readonly<Record<string, string>>;
}

export interface LanguageAuditResult {
  readonly valid: boolean;
  readonly rendered: string;
  readonly invalid: string[];
}

export interface KZLanguageApi {
  readonly readable: (value: unknown, grade?: number) => string;
  readonly forbidden: (value: unknown, grade: number) => string[];
  readonly audit: (value: unknown, grade: number) => LanguageAuditResult;
  readonly allocations: readonly string[];
  readonly source: LanguageSourceMeta;
}

export interface WrittenClassification {
  operation: ArithmeticOp;
  partialProductCarry: boolean;
  partialSumCarry: boolean;
  divisionBorrow: boolean;
  has: boolean;
}

export interface KZWrittenApi {
  readonly ids: readonly ChallengeId[];
  readonly fixed: Readonly<Record<string, "none" | "some">>;
  readonly pairs: Readonly<Record<string, readonly [ChallengeId, ChallengeId]>>;
  readonly classify: (q: Question) => WrittenClassification;
  readonly available: (
    id: string,
    remainder?: RemainderMode,
  ) => readonly ("none" | "some")[];
  readonly label: (id: string) => string;
}

export interface Rational {
  n: string;
  d: string;
}

export type NumericInput = Rational | number | bigint | string;

export interface ExprLiteral {
  readonly op?: undefined;
  value: Rational;
  label?: string;
  group?: boolean;
}

export interface ExprBinary {
  readonly value?: undefined;
  op: ArithmeticOp;
  args: [ExprNode, ExprNode];
  group?: boolean;
  label?: string;
}

export type ExprNode = ExprLiteral | ExprBinary;

export interface AnswerSpec {
  type: AnswerKind;
  form?: FractionForm;
  denominator?: string;
  reduced?: boolean;
  decimalRemainder?: boolean;
  labels?: string[];
  diagram?: [number, number][];
}

export interface QuotientExpected {
  quotient: string;
  remainder: Rational;
}

export type ExpectedExactValue =
  | Rational
  | CompareSymbol
  | ParityValue
  | string[]
  | Rational[]
  | QuotientExpected;

export interface LawInfo {
  kind: "exchange" | "associate" | "distribute";
  a: number;
  b: number;
  c: number;
}

export interface RoundOperandInfo {
  original: string;
  places: number;
}

export interface UnitFractionInfo {
  n: number;
  d: number;
}

export interface SolutionCheck {
  op: ArithmeticOp;
  a: Rational | string;
  b: Rational | string;
  result: Rational | string;
}

export interface SolutionStep {
  kind: "text" | "answer" | "counters" | "digits" | "borrow";
  text: string;
  value?: Rational | string;
  check?: SolutionCheck;
  intent?: string;
  operation?: "+" | "-" | "*";
  a?: number;
  b?: number;
  count?: number;
  pictureStage?: "before" | "after" | "groups";
  visibleGroups?: number;
  splitTen?: boolean;
  diagram?: [number, number][];
  board?: WrittenBoard;
  digits?: string | string[];
  column?: number;
  sign?: string;
  underline?: boolean;
  line?: boolean;
  annotation?: "borrow" | "carry";
  shift?: number;
  displayDigits?: string;
  trailing?: number;
  sumRow?: boolean;
  decimalResult?: boolean;
  divisor?: string;
  dividend?: string;
  trialAdjustment?: boolean;
  stage?: string;
  firstStep?: boolean;
  finalStep?: boolean;
  remainder?: boolean;
  quotient?: boolean;
  current?: number;
  subtract?: number;
  from?: number;
  to?: number;
  currentDigits?: number[];
  terms?: string[];
}

export interface WrittenAnnotation {
  value: string;
  crossed?: boolean;
}

export interface WrittenRow {
  digits: string | string[];
  sign?: string;
  underline?: boolean;
  line?: boolean;
  quotient?: boolean;
  dividend?: string;
  divisor?: string;
  trailing?: number;
  shift?: number;
  points?: number[];
  stage?: string;
  annotations?: Record<number, WrittenAnnotation>;
}

export interface WrittenBoard {
  op?: ArithmeticOp;
  rows: WrittenRow[];
  cols: number;
  focus?: number;
  caption?: string;
}

export interface TeachingStep {
  kind: "text" | "answer" | "counters";
  text: string;
  board?: WrittenBoard;
  check?: {
    op: ArithmeticOp;
    a: string;
    b: string;
    result: string;
  };
  intent?: string;
  operation?: "+" | "-" | "*";
  a?: number;
  b?: number;
  count?: number;
  pictureStage?: "before" | "after" | "groups";
  visibleGroups?: number;
  splitTen?: boolean;
  diagram?: [number, number][];
  column?: number;
  current?: number;
  subtract?: number;
  from?: number;
  to?: number;
  currentDigits?: number[];
  terms?: string[];
}

export interface KZTeachingApi {
  readonly steps: (q: Question) => TeachingStep[];
  readonly explain: (q: Question) => TeachingStep[];
  readonly hint: (q: Question) => string;
}

export interface Question {
  challengeId: ChallengeId;
  task: TaskKind;
  expressionAST?: ExprNode;
  values?: (Rational | string | number)[];
  labels?: string[];
  answerSpec: AnswerSpec;
  expectedExactValue?: ExpectedExactValue;
  prompt?: string;
  conditionBucket?: string;
  written?: boolean;
  canonicalKey?: string;
  solutionTrace?: SolutionStep[];
  questionId?: string;
  cycleId?: number;
  diagram?: [number, number][];
  displayDenominator?: string;
  instruction?: string;
  integerQuotient?: boolean;
  law?: LawInfo;
  numberBlocks?: boolean;
  original?: Rational;
  places?: number;
  roundOperands?: RoundOperandInfo[];
  roundPlaces?: number;
  sequence?: number[];
  unitFraction?: UnitFractionInfo;
  unknown?: string;
}

export interface ChallengeOptions {
  table?: number | null;
  remainder?: RemainderMode;
  written?: WrittenMode;
}

export type OptionsById = Record<string, ChallengeOptions>;

export interface RunConfigInput {
  selectedIds?: readonly string[];
  optionsById?: Readonly<Record<string, ChallengeOptions | undefined>>;
  mode: RunMode;
  quantity?: number | null;
  timeLimitMs?: number | null;
}

export interface RunConfig {
  selectedIds: ChallengeId[];
  optionsById: OptionsById;
  mode: RunMode;
  quantity: number | null;
  timeLimitMs: number | null;
  languageGrade: Grade;
  appVersion: string;
}

export interface Rng {
  next(): number;
  readonly state: number;
}

export interface DomainSpec {
  dims: [number, number][];
  make: (values: number[]) => Question | null;
  bucket: string;
  size: bigint;
  weight?: number;
  sample?: (r: Rng) => bigint;
}

export interface GeneratorBucketState {
  cycle: number;
  cursor: string;
  used: string[];
}

export interface GeneratorIdState {
  round: number[];
  buckets: Record<string, GeneratorBucketState>;
  last: string | null;
}

export interface GeneratorState {
  rngState: number;
  ids: Record<string, GeneratorIdState>;
}

export interface RawFractionInput {
  form?: string;
  whole?: string;
  numerator?: string;
  denominator?: string;
}

export interface RawAnswerObject {
  value?: string;
  form?: string;
  whole?: string;
  numerator?: string;
  denominator?: string;
  quotient?: string;
  remainder?: string;
  first?: RawFractionInput;
  second?: RawFractionInput;
  values?: string[];
  "set-value"?: string;
}

export type RawAnswerInput = RawAnswerObject | string | number | null | undefined;

export interface NormalizedFraction {
  value: Rational;
  form: FractionForm;
  n: string;
  d: string;
}

export interface NormalizedAnswer {
  error?: string;
  value?: Rational | CompareSymbol | ParityValue;
  form?: FractionForm;
  n?: string;
  d?: string;
  quotient?: string;
  remainder?: Rational;
  values?: string[] | NormalizedFraction[];
}

export interface JudgeResult {
  correct: boolean;
  inputError?: string;
  reason?: string;
}

export interface QuestionValidation {
  valid: boolean;
  errors: string[];
}

export interface RunRecord {
  questionId: string;
  challengeId: ChallengeId;
  presentationIndex: number;
  question: Question;
  wrongAttempts: number;
  firstWrongAnswer: RawAnswerInput;
  hintShown: boolean;
  helpUsed: boolean;
  terminal: RecordTerminal;
  endReason: RecordEndReason;
  earnedPoints: number;
  streakAfter: number | null;
  normalizedCorrectAnswer?: NormalizedAnswer;
}

export interface RunState {
  runId: string;
  config: RunConfig;
  phase: RunPhase;
  currentQuestion: Question | null;
  records: RunRecord[];
  schedule: ChallengeId[];
  generator: GeneratorState;
  score: number;
  streak: number;
  bestStreak: number;
  activeTimeRemainingMs: number | null;
  pauseReasons: PauseReason[];
  lastNow: number;
  finishedOnce: boolean;
  endReason: EndReason | null;
  notice?: string | null;
}

export type RunEventType =
  | "HIDDEN"
  | "VISIBLE"
  | "END_CONFIRM"
  | "END_CANCEL"
  | "END_ACCEPT"
  | "PAUSE"
  | "RESUME"
  | "HINT_CONTINUE"
  | "FEEDBACK_DONE"
  | "SOLUTION_NEXT"
  | "HELP"
  | "SUBMIT"
  | "TICK";

export interface RunEvent {
  type: RunEventType;
  questionId?: string;
  raw?: RawAnswerInput;
}

export interface MetricsExclusion {
  questionId: string;
  reason: "natural-timeout";
  learning: boolean;
}

export interface RunMetrics {
  displayN: number;
  presented: number;
  unshown: number;
  learningN: number;
  unansweredN: number;
  correctProblems: number;
  helpProblems: number;
  mistakeEvents: number;
  hintProblems: number;
  firstCorrectProblems: number;
  finalSelfCorrectProblems: number;
  repeatedWrongProblems: number;
  unansweredProblems: number;
  learningUnansweredCount: number;
  exclusions: MetricsExclusion[];
  answerAccuracy: number | null;
}

export interface FallbackRecommendation {
  sourceId: ChallengeId;
  targetId: ChallengeId;
  severity: number;
  conditionCount: number;
  learningN: number;
  reason: string;
}

export interface FallbackEvaluation {
  recommendation: FallbackRecommendation | null;
  excluded: ChallengeId[];
  insufficient: boolean;
}

export interface BestRecord {
  score: number;
  bestStreak: number;
  metrics: RunMetrics;
  config: RunConfig;
  supportClass: SupportClass;
  endReason: EndReason;
}

export interface SaveSettings {
  name: string;
  onboarded: boolean;
  sound: boolean;
  effects: boolean;
  config: RunConfig;
}

export interface SaveData {
  format: "kazohe-backup";
  appVersion: string;
  schemaVersion: 1;
  settings: SaveSettings;
  bestRecords: Record<string, BestRecord>;
  recommendation: FallbackRecommendation | null;
  returnStack: RunConfig[];
  practiceCheckpoint: RunState | null;
}

export interface ApplyResultOutput extends FallbackEvaluation {
  saved: SaveData;
  newBest: boolean;
  metrics: RunMetrics;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StorageAdapter {
  readonly available: boolean;
  load(): SaveData;
  write(saved: SaveData): boolean;
  reset(): boolean;
}

export interface KZApi {
  readonly VERSION: string;
  readonly APP_VERSION: string;
  readonly STORAGE_KEY: string;
  readonly CATALOG: readonly ChallengeSpec[];
  readonly BY_ID: Readonly<Record<string, ChallengeSpec | undefined>>;
  readonly REMAINDER_IDS: readonly ChallengeId[];
  readonly clone: <T>(x: T) => T;
  readonly gcd: (a: number | bigint | string, b: number | bigint | string) => bigint;
  readonly lcm: (a: number | bigint | string, b: number | bigint | string) => bigint;
  readonly rat: (n: number | bigint | string, d?: number | bigint | string) => Rational;
  readonly number: (s: NumericInput) => Rational;
  readonly calc: (op: ArithmeticOp, a: NumericInput, b: NumericInput) => Rational;
  readonly cmp: (a: NumericInput, b: NumericInput) => -1 | 0 | 1;
  readonly decimal: (coefficient: number | bigint, scale: number) => string;
  readonly decimalPlaces: (a: NumericInput) => number;
  readonly format: (a: NumericInput, kind?: "fraction" | "decimal") => string;
  readonly roundExact: (a: NumericInput, places: number) => Rational;
  readonly lit: (v: NumericInput, label?: string) => ExprLiteral;
  readonly op: (
    operator: ArithmeticOp,
    a: ExprNode,
    b: ExprNode,
    group?: boolean,
  ) => ExprBinary;
  readonly evaluate: (ast: ExprNode) => Rational;
  readonly expression: (ast: ExprNode) => string;
  readonly rng: (seed: number) => Rng;
  readonly shuffle: <T>(a: readonly T[], r: Rng) => T[];
  readonly carry: (a: number, b: number) => boolean;
  readonly borrow: (a: number, b: number) => boolean;
  readonly domains: (id: ChallengeId, options?: ChallengeOptions) => DomainSpec[];
  readonly decode: (d: DomainSpec, rank: bigint) => number[];
  readonly atRank: (d: DomainSpec, rank: bigint) => Question | null;
  readonly complete: (q: Question, bucket?: string) => Question;
  readonly arithmetic: (
    id: ChallengeId,
    ast: ExprNode,
    spec?: AnswerSpec,
    extra?: Partial<Question>,
  ) => Question;
  readonly special: (
    id: ChallengeId,
    task: TaskKind,
    values: (Rational | string | number)[],
    spec: AnswerSpec,
    extra?: Partial<Question>,
  ) => Question;
  readonly createGenerator: (seed?: number) => GeneratorState;
  readonly generate: (
    id: ChallengeId,
    options?: ChallengeOptions,
    state?: GeneratorState,
  ) => Question;
  readonly buildHint: (q: Question) => string;
  readonly generalHint: (q: Question) => string;
  readonly buildSolution: (q: Question) => SolutionStep[];
  readonly answerText: (q: Question) => string;
  readonly normalizeInput: (spec: AnswerSpec, raw: RawAnswerInput) => NormalizedAnswer;
  readonly judge: (q: Question, p: NormalizedAnswer) => JudgeResult;
  readonly validateQuestion: (spec: ChallengeSpec, q: Question) => QuestionValidation;
  readonly normalizeConfig: (c: RunConfigInput) => RunConfig;
  readonly schedule: (
    ids: readonly ChallengeId[],
    count: number,
    r: Rng,
  ) => ChallengeId[];
  readonly scoreCorrect: (base: number, streak: number, hint: boolean) => number;
  readonly createRun: (
    config: RunConfigInput,
    seed?: number,
    now?: number,
  ) => RunState;
  readonly reduceRun: (state: RunState, event: RunEvent, now: number) => RunState;
  readonly deriveMetrics: (
    records: readonly RunRecord[],
    unshownSlots?: readonly ChallengeId[],
    endReason?: EndReason | null,
  ) => RunMetrics;
  readonly runMetrics: (s: RunState, id?: ChallengeId | null) => RunMetrics;
  readonly eligibility: (s: RunState, id: ChallengeId) => boolean;
  readonly evaluateFallback: (s: RunState) => FallbackEvaluation;
  readonly bestKey: (
    config: RunConfigInput,
    supportClass: SupportClass,
  ) => string | null;
  readonly emptySave: () => SaveData;
  readonly checkpoint: (s: RunState) => RunState | null;
  readonly applyResult: (saved: SaveData, s: RunState) => ApplyResultOutput;
  readonly recommendConfig: (
    saved: SaveData,
    current: RunConfig,
  ) => { saved: SaveData; config: RunConfig };
  readonly clearScores: (saved: SaveData, id?: ChallengeId | null) => SaveData;
  readonly validateBackup: (text: string) => SaveData;
  readonly storageAdapter: (
    storage: StorageLike,
    notify?: (message: string) => void,
  ) => StorageAdapter;
}

export interface KZUIApi {
  readonly readable: (value: unknown, grade?: number) => string;
  readonly example: (id: ChallengeId) => string;
  readonly answer: (raw: RawAnswerObject | null | undefined, spec: AnswerSpec) => string;
  readonly math: (
    value: unknown,
    grade?: number,
    attrs?: Record<string, string | number>,
  ) => HTMLSpanElement;
  readonly written: (
    q: Question,
    complete?: boolean,
    grade?: number,
    state?: WrittenBoard | null,
  ) => HTMLDivElement;
  readonly solution: (
    q: Question,
    grade: number,
    stepIndex?: number,
  ) => HTMLDivElement;
}

export interface KazoheTestHooks {
  readonly seed?: number;
  readonly initialConfig?: RunConfigInput;
  readonly fixedQuestion?: Question;
}

export interface KazoheTestSnapshot {
  readonly run: RunState | null;
  readonly saved: SaveData;
  readonly config: RunConfig;
  readonly screen: ScreenName;
  readonly result: ApplyResultOutput | null;
}

export type KazoheWindow = Window & {
  __KAZOHE_TEST__?: KazoheTestHooks;
  kazoheTest?: {
    readonly core: KZApi;
    readonly snapshot: () => KazoheTestSnapshot;
    readonly storageAvailable: () => boolean;
  };
};
