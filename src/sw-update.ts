/**
 * Intent: Reliably apply a pending service-worker update without blanking the page
 * Context: Called from main.ts onNeedRefresh; the actual location.reload() is performed by
 *   workbox-window once the new SW takes control after we trigger skip-waiting (apply())
 * Pattern: Pure scheduler with injectable timing primitives so the gating logic is unit-testable
 *   without a real DOM, service worker, or browser paint loop
 * Future: If a stuck waiting-SW ever needs a hard timeout fallback, add it here behind a dep
 *   rather than reintroducing inline timing logic in main.ts
 */

export interface SwUpdateScheduler {
  /** True when the document is currently hidden (backgrounded tab / PWA). */
  isHidden: () => boolean;
  /** Register a one-shot callback fired the next time the document becomes visible. */
  onVisible: (cb: () => void) => void;
  /** Schedule a callback on the next animation frame. */
  raf: (cb: () => void) => void;
  /** Trigger the update (sends skip-waiting → workbox-window reloads the page). */
  apply: () => void;
}

// Apply a waiting SW update only once the page is visible and a real paint has
// completed — otherwise workbox-window's reload races first paint (blank page on
// iOS Safari) or never fires at all in a hidden tab (rAF is paused while hidden).
export function scheduleSwUpdate(deps: SwUpdateScheduler): void {
  let applied = false;
  const applyOnce = (): void => {
    if (applied) return;
    applied = true;
    deps.apply();
  };

  // Two frames: the first rAF runs before the upcoming paint; the second runs
  // after it, guaranteeing the page has actually rendered before we reload.
  const applyAfterPaint = (): void => deps.raf(() => deps.raf(applyOnce));

  if (deps.isHidden()) {
    deps.onVisible(applyAfterPaint);
  } else {
    applyAfterPaint();
  }
}
