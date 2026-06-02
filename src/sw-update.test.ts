import { describe, it, expect, vi } from 'vitest';
import { scheduleSwUpdate, type SwUpdateScheduler } from './sw-update';

/** Test harness with controllable visibility, a manual rAF queue, and a spy apply(). */
function harness(startHidden: boolean) {
  const state = { hidden: startHidden };
  let visibleCb: (() => void) | null = null;
  const rafQueue: Array<() => void> = [];
  const apply = vi.fn();

  const deps: SwUpdateScheduler = {
    isHidden: () => state.hidden,
    onVisible: (cb) => { visibleCb = cb; },
    raf: (cb) => { rafQueue.push(cb); },
    apply,
  };

  return {
    deps,
    apply,
    pendingFrames: () => rafQueue.length,
    /** Run every currently-queued frame callback (callbacks may enqueue more). */
    flushFrame: () => rafQueue.splice(0).forEach((cb) => cb()),
    becomeVisible: () => { state.hidden = false; visibleCb?.(); },
  };
}

describe('scheduleSwUpdate', () => {
  it('applies only after two animation frames when visible', () => {
    const h = harness(false);
    scheduleSwUpdate(h.deps);

    // First frame scheduled, nothing applied yet.
    expect(h.pendingFrames()).toBe(1);
    expect(h.apply).not.toHaveBeenCalled();

    // After the first frame runs, a second frame is scheduled (still pre-paint).
    h.flushFrame();
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.pendingFrames()).toBe(1);

    // After the second frame — a real paint has happened — the update applies.
    h.flushFrame();
    expect(h.apply).toHaveBeenCalledTimes(1);
  });

  it('waits for visibility before scheduling frames when hidden', () => {
    const h = harness(true);
    scheduleSwUpdate(h.deps);

    // Hidden: no frames scheduled (rAF is paused), nothing applied.
    expect(h.pendingFrames()).toBe(0);
    expect(h.apply).not.toHaveBeenCalled();

    // Once visible, the post-paint frame gating kicks in.
    h.becomeVisible();
    expect(h.pendingFrames()).toBe(1);
    h.flushFrame();
    expect(h.apply).not.toHaveBeenCalled(); // still pre-paint after one frame
    h.flushFrame();
    expect(h.apply).toHaveBeenCalledTimes(1);
  });

  it('applies at most once even if frame callbacks fire repeatedly', () => {
    const state = { hidden: false };
    const rafQueue: Array<() => void> = [];
    const apply = vi.fn();
    const deps: SwUpdateScheduler = {
      isHidden: () => state.hidden,
      onVisible: () => undefined,
      // Pathological rAF that invokes each callback twice.
      raf: (cb) => { rafQueue.push(cb); },
      apply,
    };

    scheduleSwUpdate(deps);
    // Drain, double-invoking every callback to simulate a misbehaving loop.
    while (rafQueue.length > 0) {
      const cb = rafQueue.shift()!;
      cb();
      cb();
    }
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
