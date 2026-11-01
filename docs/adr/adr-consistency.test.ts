/** Structural checks on `docs/adr/` — the invariants that would have caught the duplicate
 *  ADR-007 (#346) at PR time instead of seven weeks later.
 *
 *  ADR numbers are allocated by filename, so two branches forked at the same highest number
 *  can both claim the next one and still merge without a git conflict: the files have
 *  different names, so git sees two unrelated additions. The index in README.md is the only
 *  shared surface that *would* conflict, and the record that skipped it left its claim
 *  invisible. These tests make the index authoritative in a way git cannot: a record that
 *  does not register itself, or registers under a number someone else holds, fails the suite.
 *
 *  This file lives beside what it guards rather than in `src/`, because it asserts facts
 *  about documentation, not about app code. That also keeps it outside `tsconfig.json`'s
 *  `include: ["src"]` — it reads the filesystem, and the app's type-check has no Node types
 *  (nor should it; `src/` ships to a browser). `vitest.config.ts` and `scripts/*.mjs` sit
 *  outside the type-check for the same reason.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ADR_DIR = dirname(fileURLToPath(import.meta.url));

/** `ADR-007-region-tile-cache.md` -> number 7. Anything in the directory that is not a
 *  numbered record (README.md, this test) is not an ADR and is not checked as one. */
const FILENAME_PATTERN = /^ADR-(\d{3})-[a-z0-9-]+\.md$/;

/** An index row: `7. [ADR-007: Title](ADR-007-region-tile-cache.md) — why it matters` */
const INDEX_ENTRY_PATTERN = /^(\d+)\.\s+\[ADR-(\d{3}):[^\]]*\]\((ADR-\d{3}-[a-z0-9-]+\.md)\)/;

/** The `# ADR-007: ...` heading a record opens with. */
const HEADING_PATTERN = /^#\s+ADR-(\d{3}):/;

interface AdrFile {
  readonly filename: string;
  readonly number: number;
  readonly headingNumber: number | null;
}

const adrFiles: readonly AdrFile[] = readdirSync(ADR_DIR)
  .filter((name) => FILENAME_PATTERN.test(name))
  .sort()
  .map((filename) => {
    // Non-null: the filter above already matched this exact pattern.
    const number = Number(FILENAME_PATTERN.exec(filename)![1]);
    const firstLine = readFileSync(join(ADR_DIR, filename), 'utf8').split('\n', 1)[0] ?? '';
    const heading = HEADING_PATTERN.exec(firstLine);
    return { filename, number, headingNumber: heading ? Number(heading[1]) : null };
  });

interface IndexEntry {
  readonly ordinal: number;
  readonly linkNumber: number;
  readonly target: string;
}

const indexEntries: readonly IndexEntry[] = readFileSync(join(ADR_DIR, 'README.md'), 'utf8')
  .split('\n')
  .flatMap((line) => {
    const match = INDEX_ENTRY_PATTERN.exec(line.trim());
    if (!match) return [];
    return [{ ordinal: Number(match[1]), linkNumber: Number(match[2]), target: match[3]! }];
  });

describe('docs/adr/', () => {
  it('holds at least the records this suite was written against', () => {
    // A zero-length list would make every other assertion here vacuously true — the one
    // way this suite could pass while telling us nothing.
    expect(adrFiles.length).toBeGreaterThanOrEqual(8);
    expect(indexEntries.length).toBeGreaterThanOrEqual(8);
  });

  it('gives every ADR number to exactly one record', () => {
    const byNumber = new Map<number, string[]>();
    for (const { number, filename } of adrFiles) {
      byNumber.set(number, [...(byNumber.get(number) ?? []), filename]);
    }
    const duplicates = [...byNumber.entries()].filter(([, files]) => files.length > 1);
    // Reported as the colliding filenames rather than a bare count, so the failure names
    // the two records a reader has to choose between.
    expect(Object.fromEntries(duplicates)).toEqual({});
  });

  it('opens each record with a heading matching its filename', () => {
    const mismatched = adrFiles
      .filter(({ number, headingNumber }) => headingNumber !== number)
      .map(({ filename, headingNumber }) => `${filename}: heading says ADR-${headingNumber}`);
    expect(mismatched).toEqual([]);
  });

  it('lists every record in the index', () => {
    const indexed = new Set(indexEntries.map((entry) => entry.target));
    const missing = adrFiles.map((f) => f.filename).filter((name) => !indexed.has(name));
    // The exact failure in #346: the heading-source record existed and was cited by
    // CLAUDE.md, but never appeared here, so nothing contested its number.
    expect(missing).toEqual([]);
  });

  it('points every index entry at a record that exists', () => {
    const present = new Set(adrFiles.map((f) => f.filename));
    const dangling = indexEntries.map((e) => e.target).filter((target) => !present.has(target));
    expect(dangling).toEqual([]);
  });

  it('numbers the index to agree with the records it links', () => {
    const inconsistent = indexEntries
      .filter((entry) => entry.ordinal !== entry.linkNumber)
      .map((entry) => `item ${entry.ordinal} links ADR-${entry.linkNumber} (${entry.target})`);
    expect(inconsistent).toEqual([]);
  });

  it('numbers records contiguously from 001, leaving no gap to reuse', () => {
    // A gap is how a number gets quietly recycled: the next author reads the highest
    // number, not the missing one, and a later reader cannot tell a deleted record from
    // a typo. Supersede in place instead -- the status field carries that.
    const numbers = adrFiles.map((f) => f.number);
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
  });
});
