import { describe, expect, it } from 'vitest';
import {
  containerToScreen,
  correctDragOffset,
  coveringSquareSide,
  rotateVec,
  screenToContainer,
  tileAreaRatio,
} from './map-rotation';

function expectVec(actual: { x: number; y: number }, x: number, y: number): void {
  expect(actual.x).toBeCloseTo(x, 6);
  expect(actual.y).toBeCloseTo(y, 6);
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
      for (const corner of [
        { x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 },
        { x: -w / 2, y: h / 2 }, { x: w / 2, y: h / 2 },
      ]) {
        // A viewport corner, expressed in the rotated container's own frame, must land
        // inside the square — otherwise that corner of the screen shows no tiles.
        const p = rotateVec(corner, -deg);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(half + 1e-9);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(half + 1e-9);
      }
    }
  });
});

describe('rotateVec', () => {
  it('turns screen-up into screen-right at +90 (clockwise, y down)', () => {
    expectVec(rotateVec({ x: 0, y: -1 }, 90), 1, 0);
  });

  it('is undone by the opposite angle', () => {
    const v = { x: 12.5, y: -7 };
    expectVec(rotateVec(rotateVec(v, 45), -45), v.x, v.y);
  });
});

describe('screenToContainer / containerToScreen', () => {
  const center = { x: 195, y: 422 };
  const side = 930;
  const square = { x: side, y: side };

  it('maps the screen centre to the container centre at any bearing', () => {
    for (const deg of [0, 45, 137, -90]) {
      expectVec(screenToContainer(center, center, square, deg), side / 2, side / 2);
    }
  });

  it('is a plain offset from the container\'s top-left at bearing 0', () => {
    // An unrotated 390 x 844 container centred at (195, 422) starts at the client origin.
    expectVec(screenToContainer({ x: 30, y: 40 }, center, { x: 390, y: 844 }, 0), 30, 40);
  });

  it('puts a point tapped straight above centre on the container diagonal at 45', () => {
    // At bearing 45 the container's own "up-left" diagonal points at screen-up.
    const tapped = screenToContainer({ x: center.x, y: center.y - 100 }, center, square, 45);
    const d = 100 / Math.SQRT2;
    expectVec(tapped, side / 2 - d, side / 2 - d);
  });

  it('round-trips', () => {
    const screen = { x: 37, y: 801 };
    for (const deg of [0, 45, 200]) {
      const back = containerToScreen(screenToContainer(screen, center, square, deg), center, square, deg);
      expectVec(back, screen.x, screen.y);
    }
  });
});

describe('correctDragOffset', () => {
  it('passes a drag through unchanged at bearing 0 and unit scale', () => {
    expectVec(correctDragOffset({ x: 10, y: -4 }, { x: 1, y: 1 }, 0), 10, -4);
  });

  it('undoes the bounding-rect scale Leaflet reads off a rotated square and turns the delta', () => {
    const scale = Math.cos(Math.PI / 4) + Math.sin(Math.PI / 4); // |cos|+|sin| at 45
    // A 100 px drag to the right on screen, as Leaflet hands it over, is a move to the
    // container's right-and-up: the container is turned clockwise, so its own x axis
    // points down-right on screen.
    const leaflet = { x: 100 / scale, y: 0 };
    const d = 100 / Math.SQRT2;
    expectVec(correctDragOffset(leaflet, { x: scale, y: scale }, 45), d, -d);
  });
});

describe('tileAreaRatio', () => {
  it('reports the extra area a covering square costs on a phone portrait viewport', () => {
    expect(tileAreaRatio(390, 844)).toBeCloseTo(2.63, 2);
  });

  it('is about 2 for a square viewport (diagonal squared over side squared)', () => {
    expect(tileAreaRatio(1000, 1000)).toBeCloseTo((1415 * 1415) / 1e6, 6);
  });
});
