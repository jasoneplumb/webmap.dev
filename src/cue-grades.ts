/**
 * Intent: Pure state logic for grading cue events on the map — pending review grades layered
 *         over a loaded cue trace, persisted to localStorage keyed by event_id
 * Context: Grades must not leak across files, so the store keys each grade map by a hash of the
 *          raw file text — one slot per file, so grading one ride never clobbers another ride's
 *          unexported grades; a different file (including a re-export with grades baked in)
 *          gets a fresh, empty grade layer and stays fully re-gradable
 * Pattern: Pending grade wins over a file-baked outcome ("latest wins"); Clear stores a null
 *          tombstone so a baked grade reads as ungraded without touching the file; export emits
 *          only non-cleared pending grades in the cue trace schema's reviews[] shape (FR-008)
 * Future: v2 adds map-authored missed-risk markers and marker removal, extending the sidecar
 *         shape with coordinates — tracked in follow-up issues, deliberately not built here
 */
import type { CueFileFeature, CueOutcome, CueProps } from './cue-events';

// Outcomes gradable from the map. missed_risk is deliberately absent: a cue that
// fired was not missed — missed risks become map-authored markers in v2.
export const GRADABLE_OUTCOMES = ['useful', 'false_alarm', 'too_late'] as const;
export type GradableOutcome = (typeof GRADABLE_OUTCOMES)[number];

/** A pending review; outcome null is a Clear tombstone (renders ungraded, omitted from export). */
export interface PendingGrade {
  outcome: GradableOutcome | null;
  reviewed_at: string; // ISO-8601 UTC, set at grading time
}

/** Pending grades keyed by String(event_id). */
export type GradeMap = Record<string, PendingGrade>;

/** One entry of the cue trace schema's reviews[] — the exact export shape. */
export interface Review {
  event_id: number;
  outcome: GradableOutcome;
  reviewed_at: string;
}

// FNV-1a 32-bit over the raw file text — a cheap identity for "same file after
// reload" vs "different file"; not integrity, so collisions are acceptable.
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// Validate one file's raw grade map: malformed entries are dropped, valid ones kept.
function sanitizeGradeMap(raw: unknown): GradeMap {
  if (typeof raw !== 'object' || raw === null) return {};
  const grades: GradeMap = {};
  for (const [id, value] of Object.entries(raw)) {
    const g = value as { outcome?: unknown; reviewed_at?: unknown };
    if (typeof g !== 'object' || g === null) continue;
    const outcomeValid =
      g.outcome === null ||
      (typeof g.outcome === 'string' && (GRADABLE_OUTCOMES as readonly string[]).includes(g.outcome));
    if (!outcomeValid || typeof g.reviewed_at !== 'string') continue;
    grades[id] = { outcome: g.outcome as GradableOutcome | null, reviewed_at: g.reviewed_at };
  }
  return grades;
}

/**
 * Parse the full persisted store: a `{ files: { [fileHash]: GradeMap } }` envelope
 * holding every file's pending grades side by side. Missing/malformed JSON yields
 * an empty store; each file's entries are individually sanitized.
 */
export function parseAllGrades(json: string | null): Record<string, GradeMap> {
  if (json === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  const store = parsed as { files?: unknown };
  if (typeof store !== 'object' || store === null) return {};
  if (typeof store.files !== 'object' || store.files === null) return {};
  const all: Record<string, GradeMap> = {};
  for (const [hash, raw] of Object.entries(store.files)) {
    all[hash] = sanitizeGradeMap(raw);
  }
  return all;
}

/**
 * One file's pending grades from the persisted store. An unknown hash returns an
 * empty map (grades never leak across files).
 */
export function parseGradeStore(json: string | null, fileHash: string): GradeMap {
  return parseAllGrades(json)[fileHash] ?? {};
}

/**
 * Replace one file's slot in the persisted store, preserving every other file's
 * pending grades — grading ride B must never clobber ride A's unexported work.
 * An empty grade map drops the slot so the store doesn't accumulate dead files.
 */
export function updateGradeStore(json: string | null, fileHash: string, grades: GradeMap): string {
  const all = parseAllGrades(json);
  if (Object.keys(grades).length === 0) {
    delete all[fileHash];
  } else {
    all[fileHash] = grades;
  }
  return JSON.stringify({ files: all });
}

/**
 * The outcome a cue point should render with: the pending grade when one exists
 * (a Clear tombstone reads as ungraded), else the file-baked outcome.
 */
export function effectiveOutcome(props: CueProps, grades: GradeMap): CueOutcome | undefined {
  const pending = grades[String(props.event_id)];
  if (pending !== undefined) return pending.outcome ?? undefined;
  return props.outcome;
}

/** Only graded events, in the exact reviews[] shape; Clear tombstones are omitted. */
export function buildReviews(grades: GradeMap): Review[] {
  const reviews: Review[] = [];
  for (const [id, g] of Object.entries(grades)) {
    if (g.outcome === null) continue;
    reviews.push({ event_id: Number(id), outcome: g.outcome, reviewed_at: g.reviewed_at });
  }
  reviews.sort((a, b) => a.event_id - b.event_id);
  return reviews;
}

/** Graded/total across the file's cue points (markers and the track don't count). */
export function countGraded(features: CueFileFeature[], grades: GradeMap): { graded: number; total: number } {
  let graded = 0;
  let total = 0;
  for (const f of features) {
    const p = f.properties;
    if (p.kind !== 'cue') continue;
    total++;
    if (effectiveOutcome(p, grades) !== undefined) graded++;
  }
  return { graded, total };
}
