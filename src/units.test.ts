import { describe, it, expect } from 'vitest';
import {
  detectUnitSystem,
  valhallaUnits,
  metersPerValhallaUnit,
  formatDistance,
} from './units';

describe('detectUnitSystem', () => {
  it.each(['en-US', 'en-GB', 'my-MM', 'en-LR'])(
    'resolves %s to imperial',
    (locale) => {
      expect(detectUnitSystem(locale)).toBe('imperial');
    },
  );

  it.each(['de-DE', 'fr-FR', 'ja-JP', 'en-AU', 'es-MX'])(
    'resolves %s to metric',
    (locale) => {
      expect(detectUnitSystem(locale)).toBe('metric');
    },
  );

  it('resolves a bare language tag via likely-subtags (en → US → imperial)', () => {
    expect(detectUnitSystem('en')).toBe('imperial');
  });

  it('falls back to metric for an unparseable tag', () => {
    expect(detectUnitSystem('not a locale!!')).toBe('metric');
  });
});

describe('valhallaUnits', () => {
  it('maps unit systems to Valhalla directions_options values', () => {
    expect(valhallaUnits('imperial')).toBe('miles');
    expect(valhallaUnits('metric')).toBe('kilometers');
  });
});

describe('metersPerValhallaUnit', () => {
  it('returns metres per reported length unit', () => {
    expect(metersPerValhallaUnit('imperial')).toBeCloseTo(1609.344, 3);
    expect(metersPerValhallaUnit('metric')).toBe(1000);
  });
});

describe('formatDistance', () => {
  it('formats metric distances in km and m', () => {
    expect(formatDistance(0, 'metric')).toBe('0 m');
    expect(formatDistance(450, 'metric')).toBe('450 m');
    expect(formatDistance(999, 'metric')).toBe('999 m');
    expect(formatDistance(1000, 'metric')).toBe('1.0 km');
    expect(formatDistance(2500, 'metric')).toBe('2.5 km');
  });

  it('formats imperial distances in miles and feet', () => {
    expect(formatDistance(0, 'imperial')).toBe('0 ft');
    expect(formatDistance(30, 'imperial')).toBe('100 ft');
    // 0.1 mi is the miles/feet crossover.
    expect(formatDistance(1609.344, 'imperial')).toBe('1.0 mi');
    expect(formatDistance(4828, 'imperial')).toBe('3.0 mi');
  });

  it('returns an em dash for invalid input', () => {
    expect(formatDistance(NaN, 'metric')).toBe('—');
    expect(formatDistance(-5, 'imperial')).toBe('—');
    expect(formatDistance(Infinity, 'metric')).toBe('—');
  });
});
