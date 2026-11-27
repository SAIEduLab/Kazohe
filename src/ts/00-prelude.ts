import catalogJson from "../catalog.json" with { type: "json" };
import type {
  ChallengeId,
  ChallengeSpec,
  Domain,
  Grade,
  SourceCode,
  TimeClass,
} from "../types/contracts.d.ts";

export const APP_VERSION = "0.2.7";
// Compatibility of saved learning records is independent of the product release.
export const VERSION = "0.2";
export const STORAGE_KEY = "kazohe:v0.2:state";

export const REMAINDER_IDS: readonly ChallengeId[] = [
  "G3-C09",
  "G4-C04",
  "G4-C05",
  "G4-C06",
  "G4-C07",
  "G5-C04",
];

const CHALLENGE_IDS: readonly ChallengeId[] = [
  "G1-N01",
  "G1-N02",
  "G1-N03",
  "G1-C01",
  "G1-C02",
  "G1-C03",
  "G1-C04",
  "G1-C05",
  "G1-C06",
  "G1-C07",
  "G1-C08",
  "G1-C09",
  "G2-N01",
  "G2-N02",
  "G2-N03",
  "G2-C01",
  "G2-C02",
  "G2-C03",
  "G2-C04",
  "G2-C05",
  "G2-C06",
  "G2-C07",
  "G2-C08",
  "G2-C09",
  "G2-C10",
  "G3-N01",
  "G3-N02",
  "G3-N03",
  "G3-N04",
  "G3-N05",
  "G3-N06",
  "G3-C01",
  "G3-C02",
  "G3-C03",
  "G3-C04",
  "G3-C05",
  "G3-C06",
  "G3-C07",
  "G3-C08",
  "G3-C09",
  "G3-C10",
  "G3-C11",
  "G3-C12",
  "G3-C13",
  "G3-C14",
  "G3-C15",
  "G4-N01",
  "G4-N02",
  "G4-N03",
  "G4-N04",
  "G4-N05",
  "G4-N06",
  "G4-C01",
  "G4-C02",
  "G4-C03",
  "G4-C04",
  "G4-C05",
  "G4-C06",
  "G4-C07",
  "G4-C08",
  "G4-C09",
  "G4-C10",
  "G4-C11",
  "G4-C12",
  "G4-C13",
  "G4-C14",
  "G4-C15",
  "G4-C16",
  "G4-C17",
  "G5-N01",
  "G5-N02",
  "G5-N03",
  "G5-N04",
  "G5-N05",
  "G5-N06",
  "G5-N07",
  "G5-N08",
  "G5-N09",
  "G5-N10",
  "G5-N11",
  "G5-N12",
  "G5-N13",
  "G5-C01",
  "G5-C02",
  "G5-C03",
  "G5-C04",
  "G5-C05",
  "G5-C06",
  "G5-C07",
  "G5-C08",
  "G5-C09",
  "G6-N01",
  "G6-N02",
  "G6-C01",
  "G6-C02",
  "G6-C03",
  "G6-C04",
  "G6-C05",
  "G6-C06",
  "G6-C07",
  "G6-C08",
];

const SOURCE_CODES: readonly SourceCode[] = [
  "M1A1",
  "M1A2",
  "M2A1",
  "M2A2",
  "M2A3",
  "M3A1",
  "M3A2",
  "M3A3",
  "M3A4",
  "M3A5",
  "M3A6",
  "M3A7",
  "M4A1",
  "M4A2",
  "M4A3",
  "M4A4",
  "M4A5",
  "M4A6",
  "M4A7",
  "M5A1",
  "M5A2",
  "M5A3",
  "M5A4",
  "M5A5",
  "M5A6",
  "M6A1",
  "M6A2",
];

const CHALLENGE_ID_SET = new Set<string>(CHALLENGE_IDS);
const SOURCE_CODE_SET = new Set<string>(SOURCE_CODES);

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isChallengeId(v: unknown): v is ChallengeId {
  return typeof v === "string" && CHALLENGE_ID_SET.has(v);
}

export function isGrade(v: unknown): v is Grade {
  return v === 1 || v === 2 || v === 3 || v === 4 || v === 5 || v === 6;
}

export function isDomain(v: unknown): v is Domain {
  return v === "数" || v === "計算";
}

export function isTimeClass(v: unknown): v is TimeClass {
  return v === "short" || v === "long";
}

export function isSourceCode(v: unknown): v is SourceCode {
  return typeof v === "string" && SOURCE_CODE_SET.has(v);
}

function parseCatalogEntry(raw: {
  id: string;
  grade: number;
  category: string;
  title: string;
  basePoints: number;
  timeClass: string;
  fallbackParent: string | null;
  prerequisites: string[];
  sourceCodes: string[];
}): ChallengeSpec {
  if (
    !isChallengeId(raw.id) ||
    !isGrade(raw.grade) ||
    !isDomain(raw.category) ||
    !isTimeClass(raw.timeClass)
  ) {
    throw Error("Catalog entry is invalid");
  }
  let fallbackParent: ChallengeId | null = null;
  if (raw.fallbackParent !== null) {
    if (!isChallengeId(raw.fallbackParent)) {
      throw Error("Catalog fallbackParent is invalid");
    }
    fallbackParent = raw.fallbackParent;
  }
  const prerequisites: ChallengeId[] = [];
  for (const pre of raw.prerequisites) {
    if (!isChallengeId(pre)) throw Error("Catalog prerequisite is invalid");
    prerequisites.push(pre);
  }
  const sourceCodes: SourceCode[] = [];
  for (const code of raw.sourceCodes) {
    if (!isSourceCode(code)) throw Error("Catalog sourceCode is invalid");
    sourceCodes.push(code);
  }
  return {
    id: raw.id,
    grade: raw.grade,
    category: raw.category,
    title: raw.title,
    basePoints: raw.basePoints,
    timeClass: raw.timeClass,
    fallbackParent,
    prerequisites,
    sourceCodes,
  };
}

export const CATALOG: readonly ChallengeSpec[] =
  catalogJson.map(parseCatalogEntry);

export const BY_ID: Readonly<Record<string, ChallengeSpec | undefined>> =
  Object.fromEntries(CATALOG.map((c) => [c.id, c]));

export function specOf(id: ChallengeId): ChallengeSpec {
  const found = BY_ID[id];
  if (!found) throw Error("チャレンジをえらんでね。");
  return found;
}

export function clone<T>(x: T): T {
  return structuredClone(x);
}
