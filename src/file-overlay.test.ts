import { describe, it, expect, vi, beforeEach } from 'vitest';
import L from 'leaflet';
import { createFileBackedOverlay } from './file-overlay';

const STORAGE_KEY = 'test-overlay-geojson';

// Parse contract mirrors the real overlays: JSON array of strings, all-or-nothing.
function parseItems(text: string): string[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('not valid JSON');
  }
  if (!Array.isArray(json) || !json.every((v) => typeof v === 'string')) {
    throw new Error('not a string array');
  }
  return json;
}

function makeOverlay() {
  const showToast = vi.fn();
  const disableOverlay = vi.fn();
  // Real markers in the group so tests can observe old layers being replaced.
  const render = vi.fn((group: L.LayerGroup, features: string[]) => {
    features.forEach(() => group.addLayer(L.marker([0, 0])));
  });
  const overlay = createFileBackedOverlay<string>({
    storageKey: STORAGE_KEY,
    toastPrefix: 'Test overlay',
    parse: parseItems,
    render,
    describeLoad: (features) => `Loaded ${features.length}`,
    showToast,
    disableOverlay,
  });
  return { overlay, showToast, disableOverlay, render };
}

function getPickerInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('file input not created');
  return input;
}

function pickFile(contents: string): void {
  const input = getPickerInput();
  const file = new File([contents], 'data.geojson', { type: 'application/geo+json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

function cancelPick(): void {
  getPickerInput().dispatchEvent(new Event('cancel'));
}

describe('createFileBackedOverlay', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('opens the picker on first add, then renders and persists the picked file', async () => {
    const { overlay, render, showToast, disableOverlay } = makeOverlay();
    overlay.group.fire('add');
    pickFile('["a","b"]');

    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    expect(render).toHaveBeenCalledWith(overlay.group, ['a', 'b']);
    expect(overlay.group.getLayers()).toHaveLength(2);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('["a","b"]');
    expect(showToast).toHaveBeenCalledWith('Loaded 2');
    expect(disableOverlay).not.toHaveBeenCalled();
  });

  it('cancel on the initial pick still disables the overlay', () => {
    const { overlay, disableOverlay } = makeOverlay();
    overlay.group.fire('add');
    cancelPick();
    expect(disableOverlay).toHaveBeenCalledTimes(1);
  });

  it('malformed file on the initial pick disables the overlay and toasts', async () => {
    const { overlay, showToast, disableOverlay } = makeOverlay();
    overlay.group.fire('add');
    pickFile('not json');

    await vi.waitFor(() => expect(disableOverlay).toHaveBeenCalledTimes(1));
    expect(showToast).toHaveBeenCalledWith('Test overlay: not valid JSON');
    expect(overlay.group.getLayers()).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('requestFilePick replaces rendered layers and the persisted copy', async () => {
    const { overlay, render, disableOverlay } = makeOverlay();
    overlay.group.fire('add');
    pickFile('["a","b"]');
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));

    overlay.requestFilePick();
    pickFile('["c"]');

    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    expect(render).toHaveBeenLastCalledWith(overlay.group, ['c']);
    expect(overlay.group.getLayers()).toHaveLength(1); // old layers cleared, not stacked
    expect(localStorage.getItem(STORAGE_KEY)).toBe('["c"]');
    expect(disableOverlay).not.toHaveBeenCalled();
  });

  it('replaces persisted-restored data after a reload', async () => {
    localStorage.setItem(STORAGE_KEY, '["a","b"]');
    const { overlay, render, disableOverlay } = makeOverlay();
    overlay.group.fire('add'); // restores from localStorage, no picker
    expect(render).toHaveBeenCalledTimes(1);

    overlay.requestFilePick();
    pickFile('["c"]');

    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    expect(render).toHaveBeenLastCalledWith(overlay.group, ['c']);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('["c"]');
    expect(disableOverlay).not.toHaveBeenCalled();
  });

  it('cancelling a replacement pick keeps the current data and the overlay on', async () => {
    const { overlay, render, disableOverlay } = makeOverlay();
    overlay.group.fire('add');
    pickFile('["a","b"]');
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));

    overlay.requestFilePick();
    cancelPick();

    expect(disableOverlay).not.toHaveBeenCalled();
    expect(overlay.group.getLayers()).toHaveLength(2);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('["a","b"]');
  });

  it('a malformed replacement file keeps the current data and the overlay on', async () => {
    const { overlay, render, showToast, disableOverlay } = makeOverlay();
    overlay.group.fire('add');
    pickFile('["a","b"]');
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));

    overlay.requestFilePick();
    pickFile('{"not":"an array"}');

    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith('Test overlay: not a string array'));
    expect(disableOverlay).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1); // never re-rendered
    expect(overlay.group.getLayers()).toHaveLength(2);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('["a","b"]');
  });

  it('re-add after data is loaded does not reopen the picker', async () => {
    const { overlay, render } = makeOverlay();
    overlay.group.fire('add');
    pickFile('["a"]');
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));

    const clickSpy = vi.spyOn(getPickerInput(), 'click');
    overlay.group.fire('add');
    expect(clickSpy).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
  });
});
