// DeviceOrientationEvent wrapper: iOS-13+ permission gate + heading extraction. Used by compass.ts.

export type OrientationPermission = 'unknown' | 'unsupported' | 'granted' | 'denied';

interface DeviceOrientationEventStatic {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

// iOS webkitCompassHeading is already true-north clockwise; W3C alpha is anti-clockwise so flip it.
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

// Must be called from inside a user-gesture handler on iOS or the prompt is suppressed.
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

// 'deviceorientationabsolute' yields true-north headings without calibration when available.
export function subscribeOrientation(onHeading: (heading: number) => void): () => void {
  const handler = (event: Event): void => {
    const heading = extractHeading(event as DeviceOrientationEvent);
    if (heading !== null) onHeading(heading);
  };
  const eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(eventName, handler);
  return () => window.removeEventListener(eventName, handler);
}
