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

/**
 * Schedule a service-worker update so the ensuing reload never races first paint.
 *
 * Two failure modes this guards against — both surface as "the page doesn't load
 * until the user manually reloads":
 *
 *  1. A single requestAnimationFrame fires *before* the frame's paint, so applying
 *     the update there lets workbox-window reload the page before Leaflet has
 *     painted → a blank page on iOS Safari. We wait for two frames so a real paint
 *     has completed before the reload is triggered.
 *  2. requestAnimationFrame is paused while the document is hidden, so an update
 *     that lands in a backgrounded tab/PWA would never apply. We defer to the next
 *     visibility change before scheduling the frames.
 *
 * apply() is invoked at most once.
 */
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
