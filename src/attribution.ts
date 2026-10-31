/**
 * Intent: Build the per-provider credits in the map's attribution line, each linking to that
 *   source's own documentation — the style's colour key where one is published
 * Context: Consumed by map.ts, which passes the result as each tile layer's `attribution`;
 *   Leaflet refcounts those strings by exact text, so each credit must be built once
 * Pattern: Pure string builder — no DOM, so the markup is unit-testable
 * Future: Credits are literals in map.ts; nothing user-supplied is interpolated, so this does no
 *   escaping. If a credit ever carries runtime data, escape it here (see html.ts).
 */

/**
 * One provider credit, with the provider's own name as the link.
 *
 * The name carries the link rather than an added "key" or "more info" word: the attribution line
 * is a licence obligation that already wraps to two lines on a phone, and six credits with a
 * second clause each would cost another line of map.
 *
 * `target="_blank"` with `rel="noopener noreferrer"` — a reader may be mid-route when they tap a
 * credit, and navigating the app away to a third-party page would tear down the map and its GPS
 * watch, leaving the back button as the only way home.
 *
 * @param label  The provider name as it should read in the credit.
 * @param href   The page a reader following the credit wants: colour key, dataset, or licence.
 * @param title  Hover/assistive text saying what is on the other end, since "CyclOSM" alone does
 *               not tell anyone that the link explains the colours.
 */
export function sourceCredit(label: string, href: string, title: string): string {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer" title="${title}">${label}</a>`;
}
