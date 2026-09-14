import { describe, it, expect } from 'vitest';
import { shouldSaveDownloadedRegion } from './offline-download';

describe('shouldSaveDownloadedRegion', () => {
  it('rejects a download where every tile request failed', () => {
    // Provider outage / captive portal: done reaches total with nothing newly
    // fetched and nothing pre-cached — must NOT be recorded as a saved region.
    expect(shouldSaveDownloadedRegion({ total: 20, done: 20, cached: 0, failed: 20 })).toBe(false);
  });

  it('rejects a cancelled download that fetched nothing new', () => {
    expect(shouldSaveDownloadedRegion({ total: 20, done: 5, cached: 5, failed: 0 })).toBe(false);
  });

  it('accepts a fully successful download', () => {
    expect(shouldSaveDownloadedRegion({ total: 20, done: 20, cached: 0, failed: 0 })).toBe(true);
  });

  it('accepts a partial download that still cached some new tiles', () => {
    expect(shouldSaveDownloadedRegion({ total: 20, done: 10, cached: 2, failed: 1 })).toBe(true);
  });

  it('rejects a re-download where every tile was already in the region cache', () => {
    // Nothing newly fetched — tiles are already covered by an existing saved region,
    // so this selection shouldn't mint a redundant zero-new-tiles entry.
    expect(shouldSaveDownloadedRegion({ total: 20, done: 20, cached: 20, failed: 0 }, true))
      .toBe(false);
  });

  it('records an all-cached download that no saved region accounts for', () => {
    // localStorage cleared while region-tiles survived, so the tiles are protected but
    // listed nowhere. Without a manifest entry they are invisible in "Saved regions" and
    // can never be deleted — region-tiles has no expiry (ADR-007), so that entry is the
    // only handle on them.
    expect(shouldSaveDownloadedRegion({ total: 20, done: 20, cached: 20, failed: 0 }, false))
      .toBe(true);
  });

  it('records a completed run that mixed cached tiles with failures', () => {
    expect(shouldSaveDownloadedRegion({ total: 20, done: 20, cached: 15, failed: 5 })).toBe(true);
  });

  it('defaults to recording when coverage is unknown', () => {
    // The default matters: an omitted argument must not silently strand tiles.
    expect(shouldSaveDownloadedRegion({ total: 20, done: 20, cached: 20, failed: 0 })).toBe(true);
  });

  it('still rejects a cancelled run even when some tiles were already cached', () => {
    // The user stopped it; a partial row nobody asked for is worse than none.
    expect(shouldSaveDownloadedRegion({ total: 20, done: 8, cached: 8, failed: 0 })).toBe(false);
  });
});
