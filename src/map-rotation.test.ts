import { describe, expect, it } from 'vitest';
import {
  BEARING_STEP_DEG,
  correctDragOffset,
  coveringSquareSide,
  effectiveOrientationMode,
  nextMapBearing,
  parseOrientationMode,
  pivotPanOffset,
  rotateVec,
  screenToContainer,
  type Vec,
} from './map-rotation';

function expectVec(actual: Vec, x: number, y: number): void {
  expect(actual.x).toBeCloseTo(x, 6);
  expect(actual.y).toBeCloseTo(y, 6);
}

/** Where a container point lands on screen: the inverse of screenToContainer. */
function containerToScreen(point: Vec, screenCenter: Vec, size: Vec, bearingDeg: number): Vec {
  const turned = rotateVec({ x: point.x - size.x / 2, y: point.y - size.y / 2 }, bearingDeg);
  return { x: turned.x + screenCenter.x, y: turned.y + screenCenter.y };
}

describe('coveringSquareSide', () => {
  it('is the viewport diagonal rounded up', () => {
    expect(coveringSquareSide(300, 400)).toBe(500);
    expect(coveringSquareSide(390, 844)).toBe(930);
  });

  it('covers every viewport corner at every bearing', () => {
    const w = 390;
    const h = 844;
    const half = coveringSquareSide(w, h) / 2;
    for (let deg = 0; deg < 360; deg += 5) {
      for (const corner of [{ x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }]) {
        // A viewport corner, seen in the container frame, must fall inside the square.
        const local = rotateVec(corner, -deg);
        expect(Math.abs(local.x)).toBeLessThanOrEqual(half);
        expect(Math.abs(local.y)).toBeLessThanOrEqual(half);
      }
    }
  });
});

describe('rotateVec', () => {
  it('turns clockwise in a y-down frame, as CSS rotate() does', () => {
    // Up the screen (0, -1) turned 90 degrees clockwise points right.
    expectVec(rotateVec({ x: 0, y: -1 }, 90), 1, 0);
    expectVec(rotateVec({ x: 1, y: 0 }, 90), 0, 1);
  });

  it('is undone by the opposite angle', () => {
    const v = rotateVec(rotateVec({ x: 3, y: -7 }, 37), -37);
    expectVec(v, 3, -7);
  });
});

describe('screenToContainer', () => {
  const center = { x: 195, y: 422 };
  const size = { x: 930, y: 930 };

  it('maps the screen centre to the container centre at any bearing', () => {
    for (const deg of [0, 45, 133, -90]) {
      expectVec(screenToContainer(center, center, size, deg), 465, 465);
    }
  });

  it('is a plain offset when the map is not turned', () => {
    expectVec(screenToContainer({ x: 205, y: 402 }, center, size, 0), 475, 445);
  });

  it('round-trips through the forward mapping', () => {
    const screen = { x: 37, y: 610 };
    for (const deg of [0, 45, 90, 200, -30]) {
      const back = containerToScreen(screenToContainer(screen, center, size, deg), center, size, deg);
      expectVec(back, screen.x, screen.y);
    }
  });

  it('puts a tap above the centre to the left in a map turned 90 degrees clockwise', () => {
    // The container's left edge is at the top of the screen after a 90 degree turn.
    const p = screenToContainer({ x: center.x, y: center.y - 100 }, center, size, 90);
    expectVec(p, 365, 465);
  });
});

describe('correctDragOffset', () => {
  it('leaves an offset alone when the map is not turned', () => {
    expectVec(correctDragOffset({ x: 12, y: -4 }, { x: 1, y: 1 }, 0), 12, -4);
  });

  it('undoes the scale Leaflet read off the rotated bounding box, then unrotates', () => {
    // At 45 degrees a square's bounding box is sqrt(2) wide, so Leaflet divided by sqrt(2).
    const scale = Math.SQRT2;
    const screenDelta = { x: 100, y: 0 };
    const leafletOffset = { x: screenDelta.x / scale, y: screenDelta.y / scale };
    const fixed = correctDragOffset(leafletOffset, { x: scale, y: scale }, 45);
    // Turning the corrected container offset back onto the screen gives the finger's delta.
    expectVec(rotateVec(fixed, 45), 100, 0);
  });
});

describe('parseOrientationMode', () => {
  it('reads the stored token and treats everything else as north-up', () => {
    expect(parseOrientationMode('direction-up')).toBe('direction-up');
    expect(parseOrientationMode('north-up')).toBe('north-up');
    expect(parseOrientationMode(null)).toBe('north-up');
    expect(parseOrientationMode('garbage')).toBe('north-up');
  });
});

describe('effectiveOrientationMode', () => {
  it('is direction-up only with a compass grant and a stored direction-up', () => {
    expect(effectiveOrientationMode(true, 'direction-up')).toBe('direction-up');
    expect(effectiveOrientationMode(true, 'north-up')).toBe('north-up');
    expect(effectiveOrientationMode(false, 'direction-up')).toBe('north-up');
    expect(effectiveOrientationMode(false, 'north-up')).toBe('north-up');
  });
});

describe('nextMapBearing', () => {
  it('turns the map against the heading so the heading points up', () => {
    expect(nextMapBearing(0, 90, BEARING_STEP_DEG)).toBe(-90);
  });

  it('holds the applied bearing until the heading moves more than the threshold', () => {
    expect(nextMapBearing(-90, 93, 5)).toBe(-90);
    expect(nextMapBearing(-90, 95, 5)).toBe(-90); // exactly 5 is not "more than"
    expect(nextMapBearing(-90, 96, 5)).toBe(-96);
    expect(nextMapBearing(-90, 84, 5)).toBe(-84);
  });

  it('crosses north by the short way round', () => {
    // Heading 350 then 4: a 14 degree turn through north, not 346 the other way.
    const applied = nextMapBearing(0, 350, 5); // 10: the short way from 0 to -350
    expect(applied).toBe(10);
    expect(nextMapBearing(applied, 4, 5)).toBe(-4);
  });

  it('stays unwrapped across repeated turns', () => {
    let b = 0;
    for (const h of [90, 180, 270, 0, 90]) b = nextMapBearing(b, h, 5);
    expect(b).toBe(-450);
  });
});

describe('pivotPanOffset', () => {
  it('needs no pan when the pivot is at the centre', () => {
    expectVec(pivotPanOffset({ x: 0, y: 0 }, 0, 90), 0, 0);
  });

  it('needs no pan when the bearing does not change', () => {
    expectVec(pivotPanOffset({ x: 40, y: -10 }, 30, 30), 0, 0);
  });

  it('keeps the pivot at the same screen point across the turn', () => {
    const center = { x: 200, y: 300 };
    const size = { x: 930, y: 930 };
    const pivot = { x: size.x / 2 + 120, y: size.y / 2 - 80 };
    const before = containerToScreen(pivot, center, size, 20);
    const o = pivotPanOffset({ x: 120, y: -80 }, 20, -65);
    // panBy(o) moves a container point from p to p - o.
    const after = containerToScreen({ x: pivot.x - o.x, y: pivot.y - o.y }, center, size, -65);
    expectVec(after, before.x, before.y);
  });
});
