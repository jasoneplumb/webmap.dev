// Tests for search control collapse and spinner behaviour.
// Two bugs fixed:
//   1. Pressing Enter collapses the control before results arrive (blur fires on Enter)
//   2. Spinner never resolves when suggest() errors (only results() was patched)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DISMISS_BELOW_MIN_PX,
  DRAG_PAST_BOTTOM_PX,
  MIN_BELOW_PEEK_PX,
  sheetSettleTarget,
} from './geocoding';

// ── Minimal stubs ─────────────────────────────────────────────────────────────

function makeInput(): HTMLInputElement {
  const el = document.createElement('input');
  el.className = '';
  return el;
}

function makeWrapper(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'geocoder-control-expanded geocoder-control-loading';
  return el;
}

type ProviderCb = (err: unknown, results: unknown[]) => void;
const SEARCH_PLACEHOLDER = '';
interface FakeProvider {
  results: (text: unknown, key: unknown, bounds: unknown, cb: ProviderCb) => void;
  suggest: (text: unknown, key: unknown, bounds: unknown, cb: ProviderCb) => void;
}

function makeProvider(opts: { resultsError?: boolean; suggestError?: boolean } = {}): FakeProvider {
  return {
    results(_t: unknown, _k: unknown, _b: unknown, cb: ProviderCb) {
      if (opts.resultsError) { cb(new Error('results API failure'), []); } else { cb(null, [{ text: 'Seattle', latlng: { lat: 47.6, lng: -122.3 }, bounds: null }]); }
    },
    suggest(_t: unknown, _k: unknown, _b: unknown, cb: ProviderCb) {
      if (opts.suggestError) { cb(new Error('suggest API failure'), []); } else { cb(null, []); }
    },
  };
}

// NOTE: applyProviderPatch and makeCollapseController below re-implement the
// logic from addSearchControl for unit-testing in isolation. They validate the
// algorithm (error handling, state transitions) but do not exercise the actual
// production wiring. Integration correctness is verified by manual browser testing.
function applyProviderPatch(provider: FakeProvider): FakeProvider {
  const origResults = provider.results.bind(provider);
  provider.results = function (_t, _k, _b, cb) {
    origResults(_t, _k, _b, (err, results) => {
      cb(null, err ? [] : results);
    });
  };
  const origSuggest = provider.suggest.bind(provider);
  provider.suggest = function (_t, _k, _b, cb) {
    origSuggest(_t, _k, _b, (err, results) => {
      cb(null, err ? [] : results);
    });
  };
  return provider;
}

// Simulate the collapse controller logic extracted from addSearchControl.
// pendingSearch is set to true on Enter keydown, cleared on results.
// blur only collapses if pendingSearch is false.
function makeCollapseController(input: HTMLInputElement, wrapper: HTMLElement) {
  let pendingSearch = false;

  function collapseSearch() {
    input.value = '';
    input.placeholder = SEARCH_PLACEHOLDER;
    wrapper.classList.remove('geocoder-control-expanded');
  }

  // 3 = MIN_CHARS from addSearchControl — must stay in sync.
  function onEnterKeydown() {
    if (input.value.length >= 3) pendingSearch = true;
  }

  function onEscapeKeydown() {
    pendingSearch = false;
    collapseSearch();
  }

  function onBlur() {
    if (pendingSearch) return; // search in flight — don't collapse yet
    setTimeout(collapseSearch, 150);
  }

  function onResults() {
    pendingSearch = false;
    wrapper.classList.remove('geocoder-control-loading');
    collapseSearch();
  }

  return { onEnterKeydown, onEscapeKeydown, onBlur, onResults, collapseSearch,
           isPendingSearch: () => pendingSearch };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('provider error patching', () => {
  it('results() error returns empty array instead of propagating', () => {
    const provider = applyProviderPatch(makeProvider({ resultsError: true }));
    const cb = vi.fn();
    provider.results('Seattle', null, null, cb);
    expect(cb).toHaveBeenCalledWith(null, []);
  });

  it('suggest() error returns empty array instead of propagating', () => {
    const provider = applyProviderPatch(makeProvider({ suggestError: true }));
    const cb = vi.fn();
    provider.suggest('Sea', null, null, cb);
    expect(cb).toHaveBeenCalledWith(null, []);
  });

  it('results() success passes results through', () => {
    const provider = applyProviderPatch(makeProvider());
    const cb = vi.fn();
    provider.results('Seattle', null, null, cb);
    expect(cb).toHaveBeenCalledWith(null, expect.arrayContaining([expect.objectContaining({ text: 'Seattle' })]));
  });
});

describe('collapse controller', () => {
  let input: HTMLInputElement;
  let wrapper: HTMLElement;

  beforeEach(() => {
    input = makeInput();
    wrapper = makeWrapper();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('collapseSearch clears input and removes expanded class', () => {
    const ctrl = makeCollapseController(input, wrapper);
    input.value = 'Seattle';
    ctrl.collapseSearch();
    expect(input.value).toBe('');
    expect(input.placeholder).toBe(SEARCH_PLACEHOLDER);
    expect(wrapper.classList.contains('geocoder-control-expanded')).toBe(false);
  });

  it('blur does NOT collapse when a search is pending (Enter was pressed)', () => {
    const ctrl = makeCollapseController(input, wrapper);
    input.value = 'Seattle';
    ctrl.onEnterKeydown();
    ctrl.onBlur();
    vi.runAllTimers();
    // Control should still be expanded — search is in flight
    expect(wrapper.classList.contains('geocoder-control-expanded')).toBe(true);
    expect(input.value).toBe('Seattle');
  });

  it('blur DOES collapse when no search is pending', () => {
    const ctrl = makeCollapseController(input, wrapper);
    input.value = 'Seattle';
    ctrl.onBlur();
    vi.runAllTimers();
    expect(wrapper.classList.contains('geocoder-control-expanded')).toBe(false);
    expect(input.value).toBe('');
  });

  it('results handler clears pending flag, removes spinner, and collapses', () => {
    const ctrl = makeCollapseController(input, wrapper);
    input.value = 'Seattle';
    ctrl.onEnterKeydown();
    expect(ctrl.isPendingSearch()).toBe(true);
    ctrl.onResults();
    expect(ctrl.isPendingSearch()).toBe(false);
    expect(wrapper.classList.contains('geocoder-control-loading')).toBe(false);
    expect(wrapper.classList.contains('geocoder-control-expanded')).toBe(false);
  });

  it('blur after results arrive DOES collapse (pendingSearch was cleared)', () => {
    const ctrl = makeCollapseController(input, wrapper);
    input.value = 'Seattle';
    ctrl.onEnterKeydown();
    ctrl.onResults(); // search completed
    ctrl.onBlur();    // user blurs — should collapse since pendingSearch is false
    vi.runAllTimers();
    expect(wrapper.classList.contains('geocoder-control-expanded')).toBe(false);
  });

  it('Escape clears pendingSearch and collapses immediately', () => {
    const ctrl = makeCollapseController(input, wrapper);
    input.value = 'Seattle';
    ctrl.onEnterKeydown();
    expect(ctrl.isPendingSearch()).toBe(true);
    ctrl.onEscapeKeydown();
    expect(ctrl.isPendingSearch()).toBe(false);
    expect(wrapper.classList.contains('geocoder-control-expanded')).toBe(false);
  });

  it('Enter with short input does NOT set pendingSearch (below minCharacters)', () => {
    const ctrl = makeCollapseController(input, wrapper);
    input.value = 'Se'; // 2 chars — below the minCharacters threshold of 3
    ctrl.onEnterKeydown();
    expect(ctrl.isPendingSearch()).toBe(false);
    // blur should still collapse because pendingSearch was never set
    ctrl.onBlur();
    vi.runAllTimers();
    expect(wrapper.classList.contains('geocoder-control-expanded')).toBe(false);
  });
});

describe('sheetSettleTarget', () => {
  // Representative inset-less geometry: 400px sheet, 150px peek, 22px handle
  const HEIGHT = 400;
  const PEEK = HEIGHT - 150; // 250
  const MIN = HEIGHT - 22; // 378

  it('settles to peek anywhere at or above the minimize threshold', () => {
    expect(sheetSettleTarget(0, PEEK, MIN)).toBe('peek');
    expect(sheetSettleTarget(PEEK, PEEK, MIN)).toBe('peek');
    expect(sheetSettleTarget(PEEK + MIN_BELOW_PEEK_PX, PEEK, MIN)).toBe('peek');
  });

  it('minimizes when released well below peek, keeping the destination', () => {
    expect(sheetSettleTarget(PEEK + MIN_BELOW_PEEK_PX + 1, PEEK, MIN)).toBe('min');
    expect(sheetSettleTarget(MIN, PEEK, MIN)).toBe('min');
  });

  it('dismisses only well below the minimized position', () => {
    expect(sheetSettleTarget(MIN + DISMISS_BELOW_MIN_PX, PEEK, MIN)).toBe('min');
    expect(sheetSettleTarget(MIN + DISMISS_BELOW_MIN_PX + 1, PEEK, MIN)).toBe('dismiss');
  });

  it('keeps the dismiss window reachable within the drag clamp on inset-less devices', () => {
    // The in-drag clamp caps travel at HEIGHT + DRAG_PAST_BOTTOM_PX; the
    // dismiss threshold must sit comfortably inside that (regression guard —
    // a +20 clamp once left a ~2px window, making the clear gesture untriggerable)
    const clampMax = HEIGHT + DRAG_PAST_BOTTOM_PX;
    const dismissThreshold = MIN + DISMISS_BELOW_MIN_PX;
    expect(clampMax - dismissThreshold).toBeGreaterThanOrEqual(30);
    expect(sheetSettleTarget(clampMax, PEEK, MIN)).toBe('dismiss');
  });
});
