/**
 * Intent: One shared answer to "is this a desktop/laptop or a handheld?", for the controls whose
 *   default state differs between the two
 * Context: Imported by geocoding.ts (search box starts expanded + focused) and compass.ts (the
 *   rose is not mounted at all); both decisions are documented at their call sites
 * Pattern: Pure predicate over an injected matchMedia, so each decision is testable without a browser
 * Future: Capability queries, not viewport width — if a case ever needs true viewport size, it
 *   belongs beside this rather than replacing it
 */

/**
 * Media query separating mouse/trackpad from touch. Hover and pointer precision, deliberately
 * not viewport width: a narrow laptop window is still a keyboard device, and a large tablet
 * still isn't.
 */
export const POINTER_DEVICE_QUERY = '(hover: hover) and (pointer: fine)';

/**
 * Whether this is a mouse/trackpad device — the app's working definition of "desktop".
 *
 * It is a proxy, and it is wrong for a convertible laptop with a mouse attached: that machine
 * reports hover and a fine pointer while still carrying a touchscreen and possibly a
 * magnetometer. Accepted deliberately — the alternatives (width, user agent) are wrong more
 * often and in less predictable ways.
 *
 * Takes matchMedia as an argument so the decision is testable without a browser.
 */
export function isPointerDevice(
  matchMediaFn: (query: string) => { matches: boolean },
): boolean {
  return matchMediaFn(POINTER_DEVICE_QUERY).matches;
}

/**
 * Convenience wrapper for production call sites, which all ask about the real window.
 *
 * Falls back to false where matchMedia is missing — the test environment's jsdom build has no
 * matchMedia, and this predicate is read on the boot path (consent.ts), where a throw is a blank
 * page with no error route. False is the safe side of the fallback: the compass rose is mounted
 * and the search box starts collapsed and unfocused, so nothing is withheld and nothing grabs
 * focus on a device whose capabilities we could not read.
 */
export function isPointerDeviceNow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return isPointerDevice((q) => window.matchMedia(q));
}
