import { describe, it, expect } from 'vitest';
import { partitionCachedTiles, shouldSaveDownloadedRegion } from './offline-download';

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

describe('partitionCachedTiles', () => {
  /** A Cache stand-in that holds `cached` and records how many lookups run at once. */
  function fakeCache(cached: Iterable<string>) {
    const hits = new Set(cached);
    const stats = { inFlight: 0, maxInFlight: 0, lookups: 0 };
    const cache = {
      async match(url: RequestInfo | URL): Promise<Response | undefined> {
        stats.lookups++;
        stats.inFlight++;
        stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
        await Promise.resolve();
        stats.inFlight--;
        return hits.has(String(url)) ? new Response('tile') : undefined;
      },
    };
    return { cache, stats };
  }

  const urls = Array.from({ length: 10 }, (_, i) => `https://tile/${i}.png`);

  it('returns the uncached URLs in their original order and counts the hits', async () => {
    const { cache } = fakeCache(['https://tile/1.png', 'https://tile/4.png', 'https://tile/9.png']);
    const counts: number[] = [];
    const uncached = await partitionCachedTiles(
      cache, urls, new AbortController().signal, (n) => counts.push(n), 4,
    );
    expect(uncached).toEqual(urls.filter((u) => !/\/(1|4|9)\.png$/.test(u)));
    // One report per chunk of 4: [0..3], [4..7], [8..9].
    expect(counts).toEqual([1, 1, 1]);
  });

  it('runs lookups in parallel within a chunk but never more than the chunk size', async () => {
    const { cache, stats } = fakeCache([]);
    await partitionCachedTiles(cache, urls, new AbortController().signal, () => {}, 4);
    expect(stats.lookups).toBe(10);
    expect(stats.maxInFlight).toBe(4);
  });

  it('stops before the next chunk once aborted, leaving unchecked URLs out', async () => {
    const { cache, stats } = fakeCache([]);
    const controller = new AbortController();
    const uncached = await partitionCachedTiles(cache, urls, controller.signal, () => {
      controller.abort();
    }, 4);
    expect(uncached).toEqual(urls.slice(0, 4));
    expect(stats.lookups).toBe(4);
  });

  it('treats a lookup that rejects as a miss instead of failing the whole chunk', async () => {
    const cache = {
      match(url: RequestInfo | URL): Promise<Response | undefined> {
        if (String(url).endsWith('/2.png')) return Promise.reject(new Error('storage error'));
        return Promise.resolve(String(url).endsWith('/3.png') ? new Response('tile') : undefined);
      },
    };
    const counts: number[] = [];
    const uncached = await partitionCachedTiles(
      cache, urls.slice(0, 4), new AbortController().signal, (n) => counts.push(n),
    );
    expect(uncached).toEqual(urls.slice(0, 3));
    expect(counts).toEqual([1]);
  });

  it('does nothing for an empty selection or an already-aborted signal', async () => {
    const { cache, stats } = fakeCache([]);
    const counts: number[] = [];
    expect(await partitionCachedTiles(cache, [], new AbortController().signal, (n) => counts.push(n))).toEqual([]);
    const controller = new AbortController();
    controller.abort();
    expect(await partitionCachedTiles(cache, urls, controller.signal, (n) => counts.push(n))).toEqual([]);
    expect(stats.lookups).toBe(0);
    expect(counts).toEqual([]);
  });
});
