/**
 * Intent: Shared mechanics for overlays backed by a user-supplied GeoJSON file — file picker,
 *         all-or-nothing parse, localStorage persistence, and self-disable on cancel/malformed input
 * Context: Extracted from the squeeze-zones overlay so the cue-events overlay (and future
 *          ride-data overlays) reuse one tested load path instead of duplicating it
 * Pattern: Config object supplies the overlay-specific parts (parse, render, labels); the returned
 *          LayerGroup lazy-loads on its first 'add' — persisted data first, then a file picker
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
  /** Success-toast text for a freshly picked file, e.g. count => `Loaded ${count} …` */
  describeLoad: (count: number) => string;
  showToast: (msg: string, durationMs?: number) => void;
  /** Switch the overlay's layers-control checkbox back off (picker cancelled, malformed file) */
  disableOverlay: () => void;
}

/**
 * Build a layers-control overlay backed by a user-chosen GeoJSON file. The returned
 * LayerGroup starts empty; on its first 'add' it restores persisted data, or opens a
 * file picker. On cancel or a malformed file the overlay is switched back off via
 * `disableOverlay` (and a toast explains why).
 */
export function createFileBackedOverlay<T>(cfg: FileOverlayConfig<T>): L.LayerGroup {
  const group = L.layerGroup();
  let loaded = false;
  let fileInput: HTMLInputElement | null = null;

  // Returns the feature count on success, or null if the text is malformed
  // (after showing a toast). Never partially renders.
  function loadFromText(text: string, persist: boolean): number | null {
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
    return features.length;
  }

  function getFileInput(): HTMLInputElement {
    if (fileInput) return fileInput;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.geojson,.json,application/geo+json,application/json';
    input.style.display = 'none';
    input.setAttribute('aria-hidden', 'true');
    document.body.appendChild(input);

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = ''; // allow re-picking the same file later
      if (!file) {
        cfg.disableOverlay();
        return;
      }
      // FileReader over File.text() for older-Safari compatibility.
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        const count = loadFromText(text, true);
        if (count === null) {
          cfg.disableOverlay();
        } else {
          cfg.showToast(cfg.describeLoad(count));
        }
      };
      reader.onerror = () => {
        cfg.showToast(`${cfg.toastPrefix}: could not read file`);
        cfg.disableOverlay();
      };
      reader.readAsText(file);
    });
    // Fired by modern browsers when the picker is dismissed without a file.
    input.addEventListener('cancel', () => cfg.disableOverlay());

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

  return group;
}
