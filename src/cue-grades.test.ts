import { describe, it, expect } from 'vitest';
import {
  hashText,
  parseAllGrades,
  parseGradeStore,
  updateGradeStore,
  effectiveOutcome,
  buildReviews,
  countGraded,
  type GradeMap,
} from './cue-grades';
import type { CueFileFeature, CueProps } from './cue-events';

const T1 = '2026-07-15T22:41:00Z';
const T2 = '2026-07-15T22:45:00Z';

function cueProps(overrides: Partial<CueProps> = {}): CueProps {
  return { kind: 'cue', event_id: 57053650, ...overrides };
}

// Synthetic coordinates only — never real ride geometry.
function cueFeature(overrides: Partial<CueProps> = {}): CueFileFeature {
  return { coordinate: [0.001, 0.0005], properties: cueProps(overrides) };
}

describe('hashText', () => {
  it('is stable for the same text', () => {
    expect(hashText('{"a":1}')).toBe(hashText('{"a":1}'));
  });

  it('differs for different text (same file vs re-export with baked grades)', () => {
    expect(hashText('{"a":1}')).not.toBe(hashText('{"a":2}'));
  });
});

describe('parseGradeStore / updateGradeStore', () => {
  const grades: GradeMap = {
    '57053650': { outcome: 'useful', reviewed_at: T1 },
    '57053651': { outcome: null, reviewed_at: T2 },
  };

  it('round-trips grades for a matching file hash', () => {
    const json = updateGradeStore(null, 'abc123', grades);
    expect(parseGradeStore(json, 'abc123')).toEqual(grades);
  });

  it('returns an empty map when the file hash differs (no cross-file leaks)', () => {
    const json = updateGradeStore(null, 'abc123', grades);
    expect(parseGradeStore(json, 'other')).toEqual({});
  });

  it('preserves other files’ pending grades when writing a new file’s slot', () => {
    // The exact clobber scenario: grade ride A, load ride B without exporting,
    // grade B — A's unexported grades must survive.
    const withA = updateGradeStore(null, 'hashA', grades);
    const gradesB: GradeMap = { '99': { outcome: 'too_late', reviewed_at: T2 } };
    const withBoth = updateGradeStore(withA, 'hashB', gradesB);
    expect(parseGradeStore(withBoth, 'hashA')).toEqual(grades);
    expect(parseGradeStore(withBoth, 'hashB')).toEqual(gradesB);
  });

  it('drops a file’s slot when its grade map empties, keeping the rest', () => {
    const withA = updateGradeStore(null, 'hashA', grades);
    const withBoth = updateGradeStore(withA, 'hashB', { '99': { outcome: 'too_late', reviewed_at: T2 } });
    const cleared = updateGradeStore(withBoth, 'hashB', {});
    expect(parseAllGrades(cleared)).toEqual({ hashA: grades });
  });

  it('returns an empty map on missing or malformed JSON', () => {
    expect(parseGradeStore(null, 'abc123')).toEqual({});
    expect(parseGradeStore('{nope', 'abc123')).toEqual({});
    expect(parseGradeStore('42', 'abc123')).toEqual({});
    expect(parseGradeStore('{"files":7}', 'abc123')).toEqual({});
    // Pre-multi-file envelope shape — treated as an empty store, never a crash
    expect(parseGradeStore('{"fileHash":"abc123","grades":{}}', 'abc123')).toEqual({});
  });

  it('drops individually malformed entries and keeps valid ones', () => {
    const json = JSON.stringify({
      files: {
        abc123: {
          '1': { outcome: 'useful', reviewed_at: T1 },
          '2': { outcome: 'great', reviewed_at: T1 }, // unknown outcome
          '3': { outcome: 'missed_risk', reviewed_at: T1 }, // not gradable from the map
          '4': { outcome: 'too_late' }, // missing reviewed_at
          '5': 'useful', // not an object
          '6': { outcome: null, reviewed_at: T2 }, // Clear tombstone — valid
        },
      },
    });
    expect(parseGradeStore(json, 'abc123')).toEqual({
      '1': { outcome: 'useful', reviewed_at: T1 },
      '6': { outcome: null, reviewed_at: T2 },
    });
  });
});

describe('effectiveOutcome', () => {
  it('returns the file-baked outcome when nothing is pending', () => {
    expect(effectiveOutcome(cueProps({ outcome: 'useful' }), {})).toBe('useful');
    expect(effectiveOutcome(cueProps(), {})).toBeUndefined();
  });

  it('lets a pending grade overwrite a file-baked outcome (latest wins)', () => {
    const grades: GradeMap = { '57053650': { outcome: 'false_alarm', reviewed_at: T1 } };
    expect(effectiveOutcome(cueProps({ outcome: 'useful' }), grades)).toBe('false_alarm');
  });

  it('reads a Clear tombstone as ungraded, even over a baked grade', () => {
    const grades: GradeMap = { '57053650': { outcome: null, reviewed_at: T1 } };
    expect(effectiveOutcome(cueProps({ outcome: 'useful' }), grades)).toBeUndefined();
    expect(effectiveOutcome(cueProps(), grades)).toBeUndefined();
  });

  it('leaves other events untouched', () => {
    const grades: GradeMap = { '999': { outcome: 'too_late', reviewed_at: T1 } };
    expect(effectiveOutcome(cueProps({ outcome: 'useful' }), grades)).toBe('useful');
  });
});

describe('buildReviews', () => {
  it('exports only graded events in the exact reviews[] shape', () => {
    const grades: GradeMap = { '57053650': { outcome: 'useful', reviewed_at: T1 } };
    expect(buildReviews(grades)).toEqual([
      { event_id: 57053650, outcome: 'useful', reviewed_at: T1 },
    ]);
  });

  it('omits Clear tombstones', () => {
    const grades: GradeMap = {
      '1': { outcome: 'too_late', reviewed_at: T1 },
      '2': { outcome: null, reviewed_at: T2 },
    };
    expect(buildReviews(grades)).toEqual([{ event_id: 1, outcome: 'too_late', reviewed_at: T1 }]);
  });

  it('returns an empty array when nothing is graded', () => {
    expect(buildReviews({})).toEqual([]);
    expect(buildReviews({ '1': { outcome: null, reviewed_at: T1 } })).toEqual([]);
  });

  it('sorts by event_id for a deterministic sidecar', () => {
    const grades: GradeMap = {
      '20': { outcome: 'useful', reviewed_at: T1 },
      '3': { outcome: 'false_alarm', reviewed_at: T2 },
    };
    expect(buildReviews(grades).map((r) => r.event_id)).toEqual([3, 20]);
  });
});

describe('countGraded', () => {
  const track: CueFileFeature = {
    coordinates: [[0.001, 0.0005], [0.0012, 0.0006]],
    properties: { kind: 'track' },
  };
  const marker: CueFileFeature = { coordinate: [0.002, 0.001], properties: { kind: 'marker' } };

  it('counts only cue points, not markers or the track', () => {
    const features = [track, marker, cueFeature({ event_id: 1 }), cueFeature({ event_id: 2 })];
    expect(countGraded(features, {})).toEqual({ graded: 0, total: 2 });
  });

  it('counts baked and pending grades, minus Clear tombstones', () => {
    const features = [
      cueFeature({ event_id: 1, outcome: 'useful' }), // baked
      cueFeature({ event_id: 2 }), // pending grade below
      cueFeature({ event_id: 3, outcome: 'too_late' }), // cleared below
      cueFeature({ event_id: 4 }), // ungraded
    ];
    const grades: GradeMap = {
      '2': { outcome: 'false_alarm', reviewed_at: T1 },
      '3': { outcome: null, reviewed_at: T2 },
    };
    expect(countGraded(features, grades)).toEqual({ graded: 2, total: 4 });
  });

  it('handles an empty file', () => {
    expect(countGraded([], {})).toEqual({ graded: 0, total: 0 });
  });
});
