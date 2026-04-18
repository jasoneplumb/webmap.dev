import { describe, it, expect } from 'vitest';
import { computeSnapPx, PEEK_PX, HALF_VH } from './bottom-sheet';

describe('computeSnapPx', () => {
  const sheetHeight = 720; // 90% of 800px viewport
  const viewportHeight = 800;

  it('hidden: fully off-screen (height + 8)', () => {
    expect(computeSnapPx('hidden', sheetHeight, viewportHeight)).toBe(728);
  });

  it('full: translateY(0) — fully visible', () => {
    expect(computeSnapPx('full', sheetHeight, viewportHeight)).toBe(0);
  });

  it('peek: shows exactly PEEK_PX pixels', () => {
    const px = computeSnapPx('peek', sheetHeight, viewportHeight);
    expect(px).toBe(sheetHeight - PEEK_PX);
    // Visible portion = sheetHeight - px = PEEK_PX
    expect(sheetHeight - px).toBe(PEEK_PX);
  });

  it('half: shows ~45% of viewport height', () => {
    const px = computeSnapPx('half', sheetHeight, viewportHeight);
    const visiblePx = sheetHeight - px;
    expect(visiblePx).toBe(Math.round(viewportHeight * HALF_VH));
  });

  it('snap ordering: hidden > peek > half > full', () => {
    const hidden = computeSnapPx('hidden', sheetHeight, viewportHeight);
    const peek = computeSnapPx('peek', sheetHeight, viewportHeight);
    const half = computeSnapPx('half', sheetHeight, viewportHeight);
    const full = computeSnapPx('full', sheetHeight, viewportHeight);
    expect(hidden).toBeGreaterThan(peek);
    expect(peek).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(full);
  });

  it('works with small viewport (iPhone SE)', () => {
    const smallSheet = Math.round(568 * 0.9); // 511
    const px = computeSnapPx('peek', smallSheet, 568);
    expect(smallSheet - px).toBe(PEEK_PX);
  });

  it('works with large viewport (iPad)', () => {
    const largeSheet = Math.round(1024 * 0.9); // 922
    const px = computeSnapPx('half', largeSheet, 1024);
    expect(largeSheet - px).toBe(Math.round(1024 * HALF_VH));
  });
});
