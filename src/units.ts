// Locale-aware distance units. Road distances are shown in miles/feet for
// regions whose road signage is imperial, and kilometres/metres elsewhere.
// The unit system is also forwarded to Valhalla so its `instruction` strings
// (which bake the unit into the text) match what the pill displays.

export type UnitSystem = 'imperial' | 'metric';

/** Regions whose road signage is imperial: US, UK, Myanmar, Liberia. */
const IMPERIAL_REGIONS = new Set(['US', 'GB', 'MM', 'LR']);

const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.28084;

/**
 * Resolve the unit system for a BCP-47 locale tag, defaulting to
 * `navigator.language`. Unrecognised or region-less tags fall back to metric.
 */
export function detectUnitSystem(locale?: string): UnitSystem {
  let region: string | null = null;
  try {
    const tag = locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en');
    // maximize() adds likely subtags so a bare "en" still resolves a region.
    region = new Intl.Locale(tag).maximize().region ?? null;
  } catch {
    region = null;
  }
  return region !== null && IMPERIAL_REGIONS.has(region) ? 'imperial' : 'metric';
}

let cached: UnitSystem | null = null;

/** Memoised unit system for the current session. */
export function unitSystem(): UnitSystem {
  if (cached === null) cached = detectUnitSystem();
  return cached;
}

/** Valhalla's `directions_options.units` value for a unit system. */
export function valhallaUnits(system: UnitSystem): 'miles' | 'kilometers' {
  return system === 'imperial' ? 'miles' : 'kilometers';
}

/** Metres per unit of Valhalla's reported `length` field for a unit system. */
export function metersPerValhallaUnit(system: UnitSystem): number {
  return system === 'imperial' ? METERS_PER_MILE : 1000;
}

/** Format a metre distance for display in the given unit system. */
export function formatDistance(meters: number, system: UnitSystem = unitSystem()): string {
  if (!isFinite(meters) || meters < 0) return '—';
  if (system === 'imperial') {
    const miles = meters / METERS_PER_MILE;
    if (miles >= 0.1) return `${miles.toFixed(1)} mi`;
    return `${Math.round((meters * FEET_PER_METER) / 10) * 10} ft`;
  }
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}
