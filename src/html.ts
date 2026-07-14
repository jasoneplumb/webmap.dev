/**
 * Intent: Shared HTML-safety helper for the app's innerHTML sinks (Leaflet popups/tooltips, custom widgets)
 * Context: Previously duplicated privately in geocoding.ts and guidance.ts; hoisted when the cue-events
 *          overlay became the third consumer (first user-controlled string rendered from a picked file)
 * Pattern: Escape at the sink — build labels as plain text, escape once before handing to innerHTML
 * Future: If a rich-content popup ever needs markup plus user text, switch that call site to element
 *         construction with textContent instead of extending this helper
 */

// Escape text for safe insertion into innerHTML
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
