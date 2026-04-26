/**
 * Intent: Wrap DeviceOrientationEvent with the iOS permission flow + heading extraction
 * Context: Used by compass.ts; iOS 13+ requires DeviceOrientationEvent.requestPermission() from a user gesture
 * Pattern: Permission is one-shot; subscribeOrientation returns an unsubscribe function for clean teardown
 */

export type OrientationPermission = 'unknown' | 'unsupported' | 'granted' | 'denied';

interface DeviceOrientationEventStatic {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

/**
 * intent: Pull a compass heading (0–360°, clockwise from True North) out of a DeviceOrientationEvent
 * method: Prefer iOS webkitCompassHeading (already true-north calibrated); fall back to W3C alpha (anti-clockwise around z)
 * effect: Returns null when neither field is usable (NaN / unsupported)
 */
export function extractHeading(event: DeviceOrientationEvent): number | null {
  const ios = (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
  if (typeof ios === 'number' && !isNaN(ios)) {
    return ((ios % 360) + 360) % 360;
  }
  if (event.alpha !== null && !isNaN(event.alpha)) {
    return ((360 - event.alpha) % 360 + 360) % 360;
  }
  return null;
}

/**
 * intent: Resolve to the current OrientationPermission state, prompting iOS if needed
 * method: iOS exposes a static requestPermission; non-iOS browsers grant by default
 * effect: Must be called inside a user-gesture handler on iOS or the prompt is suppressed
 */
export async function requestOrientationPermission(): Promise<OrientationPermission> {
  if (typeof DeviceOrientationEvent === 'undefined') return 'unsupported';
  const cls = DeviceOrientationEvent as unknown as DeviceOrientationEventStatic;
  if (typeof cls.requestPermission !== 'function') return 'granted';
  try {
    const result = await cls.requestPermission();
    return result;
  } catch {
    return 'denied';
  }
}

/**
 * intent: Stream compass headings until the returned unsubscribe is called
 * method: Listen for deviceorientationabsolute when available (true-north without calibration), fall back to deviceorientation
 * effect: Caller is responsible for invoking the returned function to detach the listener
 */
export function subscribeOrientation(onHeading: (heading: number) => void): () => void {
  const handler = (event: Event): void => {
    const heading = extractHeading(event as DeviceOrientationEvent);
    if (heading !== null) onHeading(heading);
  };
  const eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(eventName, handler);
  return () => window.removeEventListener(eventName, handler);
}
