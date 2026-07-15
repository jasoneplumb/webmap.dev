/**
 * Intent: Shared mechanics for overlays backed by a user-supplied GeoJSON file — file picker,
 *         all-or-nothing parse, localStorage persistence, and self-disable on cancel/malformed input
 * Context: Extracted from the squeeze-zones overlay so the cue-events overlay (and future
 *          ride-data overlays) reuse one tested load path instead of duplicating it
 * Pattern: Config object supplies the overlay-specific parts (parse, render, labels); the returned
 *          group lazy-loads on its first 'add' — persisted data first, then a file picker — and
 *          requestFilePick lets the layers control swap in a different file at any time
 * Future: Large files that exceed the localStorage quota only persist for the session; move to
 *         IndexedDB if needed
 */
import L from 'leaflet';

export interface FileOverlayConfig<T> {
  /** localStorage key holding the raw GeoJSON text */
  storageKey: string;
  /** Toast prefix, e.g. 'Squeeze zones' → 'Squeeze zones: not valid JSON' */
  toastPrefix: string;
  /** Parse + validate the file text; throws on any malformed feature (all-or-nothing) */
  parse: (text: string) => T[];
  /** Render parsed features into the (already cleared) group */
  render: (group: L.LayerGroup, features: T[]) => void;
  /** Success-toast text for a freshly picked file, e.g. features => `Loaded ${features.length} …` */
  describeLoad: (features: T[]) => string;
  showToast: (msg: string, durationMs?: number) => void;
  /**
   * Switch the overlay's layers-control checkbox back off (picker cancelled, malformed
   * file). Only called while nothing is loaded yet — a failed replacement pick keeps
   * the current data and leaves the overlay on.
   */
  disableOverlay: () => void;
}

export interface FileBackedOverlay {
  /** The layer group to register with the layers control */
  group: L.LayerGroup;
  /**
   * Open the file picker to load a (different) file. Must be called from a user
   * gesture — a click carries the user activation the picker needs. On success the
   * new data replaces both the rendered layers and the persisted copy; on cancel or
   * a malformed file the current data stays fully intact.
   */
  requestFilePick: () => void;
}

/**
 * Build a layers-control overlay backed by a user-chosen GeoJSON file. The returned
 * group starts empty; on its first 'add' it restores persisted data, or opens a
 * file picker. While nothing is loaded, cancel or a malformed file switches the
 * overlay back off via `disableOverlay` (and a toast explains why); once data is
 * loaded, a failed pick keeps it untouched.
 */
export function createFileBackedOverlay<T>(cfg: FileOverlayConfig<T>): FileBackedOverlay {
  const group = L.layerGroup();
  let loaded = false;
  let fileInput: HTMLInputElement | null = null;

  // Returns the parsed features on success, or null if the text is malformed
  // (after showing a toast). Never partially renders.
  function loadFromText(text: string, persist: boolean): T[] | null {
    let features: T[];
    try {
      features = cfg.parse(text);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : 'invalid file';
      cfg.showToast(`${cfg.toastPrefix}: ${detail}`);
      return null;
    }
    group.clearLayers();
    cfg.render(group, features);
    loaded = true;
    if (persist) {
      try {
        localStorage.setItem(cfg.storageKey, text);
      } catch {
        cfg.showToast(`${cfg.toastPrefix} loaded — too large to save; re-pick the file after a reload`);
      }
    }
    return features;
  }

  function getFileInput(): HTMLInputElement {
    if (fileInput) return fileInput;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.geojson,.json,application/geo+json,application/json';
    input.style.display = 'none';
    input.setAttribute('aria-hidden', 'true');
    document.body.appendChild(input);

    // A pick that fails before anything is loaded switches the overlay off;
    // a failed replacement pick keeps the current data and leaves it on.
    const disableIfNothingLoaded = (): void => {
      if (!loaded) cfg.disableOverlay();
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = ''; // allow re-picking the same file later
      if (!file) {
        disableIfNothingLoaded();
        return;
      }
      // FileReader over File.text() for older-Safari compatibility.
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        const features = loadFromText(text, true);
        if (features === null) {
          disableIfNothingLoaded();
        } else {
          cfg.showToast(cfg.describeLoad(features));
        }
      };
      reader.onerror = () => {
        cfg.showToast(`${cfg.toastPrefix}: could not read file`);
        disableIfNothingLoaded();
      };
      reader.readAsText(file);
    });
    // Fired by modern browsers when the picker is dismissed without a file.
    input.addEventListener('cancel', disableIfNothingLoaded);

    fileInput = input;
    return input;
  }

  group.on('add', () => {
    if (loaded) return;

    let saved: string | null = null;
    try {
      saved = localStorage.getItem(cfg.storageKey);
    } catch { /* localStorage unavailable */ }
    if (saved !== null && loadFromText(saved, false) !== null) return;

    // Opening a file picker needs user activation. The checkbox toggle has it;
    // a persisted-on overlay restored at boot does not — ask for a re-toggle.
    const activation = (navigator as { userActivation?: { isActive?: boolean } }).userActivation;
    if (activation !== undefined && activation.isActive !== true) {
      cfg.showToast(`${cfg.toastPrefix}: toggle the overlay again to choose a GeoJSON file`);
      cfg.disableOverlay();
      return;
    }
    getFileInput().click();
  });

  return {
    group,
    requestFilePick: () => getFileInput().click(),
  };
}
