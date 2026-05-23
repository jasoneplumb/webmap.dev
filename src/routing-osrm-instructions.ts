// Translate OSRM maneuvers into:
//   1. A Valhalla-compatible numeric `type` so guidance.ts's icon picker
//      doesn't need provider-specific code paths.
//   2. A short English instruction string. OSRM doesn't generate prose —
//      consumers are expected to assemble it from `type` + `modifier` + `name`.
//
// Localization is out of scope (issue #189).

/** Subset of OSRM maneuver types we explicitly recognise. */
export type OsrmManeuverType =
  | 'turn'
  | 'new name'
  | 'depart'
  | 'arrive'
  | 'merge'
  | 'on ramp'
  | 'off ramp'
  | 'fork'
  | 'end of road'
  | 'continue'
  | 'roundabout'
  | 'rotary'
  | 'roundabout turn'
  | 'notification'
  | 'use lane';

/** OSRM turn-modifier strings. */
export type OsrmModifier =
  | 'uturn'
  | 'sharp right'
  | 'right'
  | 'slight right'
  | 'straight'
  | 'slight left'
  | 'left'
  | 'sharp left';

/**
 * Map an OSRM maneuver onto a Valhalla maneuver-type number.
 *
 * Valhalla numbering reference (kept in sync with guidance.ts's icon table):
 *   1=start, 4=destination, 8=continue, 9=slight_right, 10=right,
 *   11=sharp_right, 12=u_turn_right, 13=u_turn_left, 14=sharp_left,
 *   15=left, 16=slight_left, 17=ramp_straight, 18=ramp_right,
 *   19=ramp_left, 20=exit_right, 21=exit_left, 22=stay_straight,
 *   25=merge, 26=roundabout_enter.
 */
export function osrmManeuverToValhallaType(type: string, modifier?: string): number {
  switch (type) {
    case 'depart':
      return 1;
    case 'arrive':
      return 4;
    case 'turn':
    case 'end of road':
      return turnModifierToValhalla(modifier);
    case 'continue':
    case 'new name':
    case 'notification':
      return modifier === undefined || modifier === 'straight'
        ? 8
        : turnModifierToValhalla(modifier);
    case 'merge':
      return 25;
    case 'on ramp':
      return modifier === 'left' ? 19 : 18;
    case 'off ramp':
      return modifier === 'left' ? 21 : 20;
    case 'fork':
      if (modifier === 'left' || modifier === 'slight left') return 24;
      if (modifier === 'right' || modifier === 'slight right') return 23;
      return 22;
    case 'roundabout':
    case 'rotary':
    case 'roundabout turn':
      return 26;
    case 'use lane':
      return 8;
    default:
      return 0;
  }
}

function turnModifierToValhalla(modifier?: string): number {
  switch (modifier) {
    case 'uturn':       return 12;
    case 'sharp right': return 11;
    case 'right':       return 10;
    case 'slight right':return 9;
    case 'slight left': return 16;
    case 'left':        return 15;
    case 'sharp left':  return 14;
    case 'straight':    return 8;
    default:            return 8;
  }
}

/**
 * Synthesize a short English instruction for an OSRM maneuver. The `name`
 * argument is the OSRM step's `name` (street name) — empty string is fine.
 */
export function synthesizeOsrmInstruction(
  type: string,
  modifier: string | undefined,
  name: string,
): string {
  const onto = name ? ` onto ${name}` : '';
  const on = name ? ` on ${name}` : '';

  switch (type) {
    case 'depart':
      return name ? `Head out on ${name}` : 'Head out';
    case 'arrive':
      return 'Arrive at destination';
    case 'turn':
      return `${turnVerb(modifier)}${onto}`;
    case 'new name':
      return name ? `Continue on ${name}` : 'Continue';
    case 'continue':
      return modifier && modifier !== 'straight'
        ? `${turnVerb(modifier)}${onto}`
        : name ? `Continue on ${name}` : 'Continue';
    case 'merge':
      return `Merge${onto}`;
    case 'on ramp':
      return `Take the ramp${onto}`;
    case 'off ramp':
      return `Take the exit${onto}`;
    case 'fork':
      return `Keep ${forkSide(modifier)} at the fork${onto}`;
    case 'end of road':
      return `${turnVerb(modifier)} at the end of the road${onto}`;
    case 'roundabout':
    case 'rotary':
      return `Enter the ${type === 'rotary' ? 'rotary' : 'roundabout'}${onto}`;
    case 'roundabout turn':
      return `At the roundabout, ${turnVerb(modifier).toLowerCase()}${onto}`;
    case 'use lane':
      return name ? `Continue on ${name}` : 'Continue in lane';
    case 'notification':
      return name ? `Continue${on}` : '';
    default:
      return name ? `Continue${on}` : 'Continue';
  }
}

function turnVerb(modifier?: string): string {
  switch (modifier) {
    case 'uturn':        return 'Make a U-turn';
    case 'sharp right':  return 'Turn sharp right';
    case 'right':        return 'Turn right';
    case 'slight right': return 'Bear right';
    case 'straight':     return 'Continue straight';
    case 'slight left':  return 'Bear left';
    case 'left':         return 'Turn left';
    case 'sharp left':   return 'Turn sharp left';
    default:             return 'Continue';
  }
}

function forkSide(modifier?: string): string {
  if (modifier === 'left' || modifier === 'slight left' || modifier === 'sharp left') return 'left';
  if (modifier === 'right' || modifier === 'slight right' || modifier === 'sharp right') return 'right';
  return 'straight';
}
